import type { VaultDatabase } from "../db/sqlite.js";
import type { GraphEngine } from "../graph/engine.js";
import type { SearchResult, WalkResult } from "../types.js";

export interface SearchVaultArgs {
  query: string;
  limit?: number;
  include_neighbors?: boolean;
}

export interface FindRelatedArgs {
  note_path?: string;
  topic?: string;
  depth?: number;
  max_results?: number;
}

export interface ListNotesArgs {
  folder?: string;
  tag?: string;
  has_frontmatter_key?: string;
}

export function handleSearchVault(
  db: VaultDatabase,
  graph: GraphEngine,
  args: SearchVaultArgs
): SearchResult[] {
  const limit = args.limit ?? 20;
  const results = db.searchFTS(args.query, limit);

  if (args.include_neighbors) {
    for (const result of results) {
      result.neighbors = graph.getNeighborhood(result.path);
    }
  }

  return results;
}

export function handleFindRelated(
  graph: GraphEngine,
  args: FindRelatedArgs
): WalkResult[] {
  const depth = args.depth ?? 2;
  const maxResults = args.max_results ?? 20;

  if (args.note_path) {
    const walked = graph.bfs(args.note_path, depth);
    return walked.filter((r) => r.path !== args.note_path).slice(0, maxResults);
  }

  if (args.topic) {
    const tagged = graph.getByTag(args.topic);
    return tagged.slice(0, maxResults).map((path) => {
      const node = graph.getNode(path);
      return {
        path,
        depth: 0,
        title: node?.title ?? path,
        tags: node?.tags ?? [],
      };
    });
  }

  return [];
}

export function handleListNotes(
  db: VaultDatabase,
  args: ListNotesArgs
): { path: string; title: string }[] {
  if (args.tag) {
    const paths = db.getNotesByTag(args.tag);
    return paths.map((path) => {
      const note = db.getNote(path);
      return { path, title: note?.title ?? path };
    });
  }

  const allPaths = db.getAllPaths();
  let filtered = allPaths;

  if (args.folder) {
    filtered = filtered.filter((p) => p.startsWith(args.folder!));
  }

  if (args.has_frontmatter_key) {
    filtered = filtered.filter((p) => {
      const fm = db.getFrontmatter(p);
      return args.has_frontmatter_key! in fm;
    });
  }

  return filtered.map((path) => {
    const note = db.getNote(path);
    return { path, title: note?.title ?? path };
  });
}
