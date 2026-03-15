import { extractFreshness } from "../parser/frontmatter.js";
import type { VaultDatabase } from "../db/sqlite.js";
import type { GraphEngine } from "../graph/engine.js";
import type { FreshnessInfo, SubgraphResult, WalkResult } from "../types.js";

export interface ReadNoteArgs {
  path: string;
}

export interface ReadNoteResult {
  path: string;
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
  freshness: FreshnessInfo;
  outLinks: string[];
  backlinks: string[];
  tags: string[];
}

export interface GetGraphContextArgs {
  topic: string;
  token_budget?: number;
  depth?: number;
}

export interface WalkGraphArgs {
  start: string;
  depth?: number;
  direction?: "outgoing" | "incoming" | "both";
}

export function handleReadNote(
  db: VaultDatabase,
  graph: GraphEngine,
  args: ReadNoteArgs
): ReadNoteResult | null {
  const note = db.getNote(args.path);
  if (!note) return null;

  const frontmatter = db.getFrontmatter(args.path);
  const freshness = extractFreshness(frontmatter);
  const outLinks = db.getOutLinks(args.path);
  const backlinks = graph.getInLinks(args.path);
  const tags = db.getNoteTags(args.path);

  return {
    path: note.path,
    title: note.title,
    content: note.content,
    frontmatter,
    freshness,
    outLinks,
    backlinks,
    tags,
  };
}

export function handleGetGraphContext(
  db: VaultDatabase,
  graph: GraphEngine,
  args: GetGraphContextArgs
): SubgraphResult {
  const tokenBudget = args.token_budget ?? 4000;
  const depth = args.depth ?? 2;

  // Check if topic is a known note path
  const note = db.getNote(args.topic);
  if (note) {
    return graph.getSubgraph(args.topic, tokenBudget, depth);
  }

  // Topic is a tag — find tagged notes and use first as seed
  const tagged = graph.getByTag(args.topic);
  if (tagged.length > 0) {
    return graph.getSubgraph(tagged[0], tokenBudget, depth);
  }

  // No matches
  return { nodes: [], edges: [], totalTokens: 0, truncated: false };
}

export function handleWalkGraph(
  graph: GraphEngine,
  args: WalkGraphArgs
): WalkResult[] {
  const depth = args.depth ?? 2;
  const direction = args.direction ?? "both";

  if (direction === "both") {
    return graph.bfs(args.start, depth);
  }

  // Custom BFS with direction filter
  const results: WalkResult[] = [];
  const visited = new Set<string>();
  const queue: { path: string; depth: number }[] = [
    { path: args.start, depth: 0 },
  ];

  while (queue.length > 0) {
    const { path, depth: d } = queue.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);

    const node = graph.getNode(path);
    if (node) {
      results.push({
        path: node.path,
        depth: d,
        title: node.title,
        tags: node.tags,
      });
    }

    if (d < depth) {
      const neighbors =
        direction === "outgoing"
          ? graph.getOutLinks(path)
          : graph.getInLinks(path);
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push({ path: neighbor, depth: d + 1 });
        }
      }
    }
  }

  return results;
}
