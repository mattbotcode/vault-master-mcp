import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VaultDatabase } from "../../src/db/sqlite.js";
import { GraphEngine } from "../../src/graph/engine.js";
import {
  handleReadNote,
  handleGetGraphContext,
  handleWalkGraph,
} from "../../src/tools/context.js";
import type { NoteMeta, GraphNode } from "../../src/types.js";

let db: VaultDatabase;
let graph: GraphEngine;

const makeNote = (
  path: string,
  title: string,
  content: string,
  tags: string[] = [],
  frontmatter: Record<string, unknown> = { status: "active" },
  outLinks: string[] = []
): NoteMeta => ({
  path,
  title,
  content,
  frontmatter,
  outLinks,
  tags,
  createdAt: new Date(),
  modifiedAt: new Date(),
});

const makeGraphNode = (
  path: string,
  title: string,
  tags: string[] = [],
  tokenEstimate = 100
): GraphNode => ({
  path,
  title,
  tags,
  frontmatter: {},
  tokenEstimate,
});

beforeEach(() => {
  db = new VaultDatabase(":memory:");
  graph = new GraphEngine();

  // Seed notes
  const notes = [
    makeNote(
      "economics/inflation.md",
      "Inflation Analysis",
      "CPI rose 3.2% in February. The Fed is watching closely.",
      ["economics", "cpi"],
      { status: "active", last_verified: "2026-01-15" },
      ["economics/rates.md"]
    ),
    makeNote(
      "economics/rates.md",
      "Interest Rates",
      "The Federal Reserve held rates steady at 5.25%.",
      ["economics", "fed"],
      { status: "active", superseded_by: "economics/rates-v2.md" }
    ),
    makeNote(
      "projects/alpha.md",
      "Project Alpha",
      "Engineering project about distributed systems.",
      ["engineering"],
      { status: "draft" }
    ),
  ];

  for (const note of notes) {
    db.upsertNote(note);
    graph.addNode(makeGraphNode(note.path, note.title, note.tags));
  }

  // Add edges: inflation -> rates (outgoing), rates <- inflation (incoming)
  graph.addEdge("economics/inflation.md", "economics/rates.md", "wikilink");
});

afterEach(() => {
  db.close();
});

// ============================================================
// read_note tests
// ============================================================

describe("read_note", () => {
  it("returns note content and title", () => {
    const result = handleReadNote(db, graph, { path: "economics/inflation.md" });
    expect(result).not.toBeNull();
    expect(result!.path).toBe("economics/inflation.md");
    expect(result!.title).toBe("Inflation Analysis");
    expect(result!.content).toContain("CPI rose 3.2%");
  });

  it("includes frontmatter data", () => {
    const result = handleReadNote(db, graph, { path: "economics/inflation.md" });
    expect(result).not.toBeNull();
    expect(result!.frontmatter).toHaveProperty("status", "active");
    expect(result!.frontmatter).toHaveProperty("last_verified", "2026-01-15");
  });

  it("includes outLinks from DB", () => {
    const result = handleReadNote(db, graph, { path: "economics/inflation.md" });
    expect(result).not.toBeNull();
    expect(result!.outLinks).toContain("economics/rates.md");
  });

  it("includes backlinks from graph", () => {
    // rates.md is pointed to by inflation.md
    const result = handleReadNote(db, graph, { path: "economics/rates.md" });
    expect(result).not.toBeNull();
    expect(result!.backlinks).toContain("economics/inflation.md");
  });

  it("includes tags from DB", () => {
    const result = handleReadNote(db, graph, { path: "economics/inflation.md" });
    expect(result).not.toBeNull();
    expect(result!.tags).toContain("economics");
    expect(result!.tags).toContain("cpi");
  });

  it("includes freshness info extracted from frontmatter", () => {
    const result = handleReadNote(db, graph, { path: "economics/inflation.md" });
    expect(result).not.toBeNull();
    expect(result!.freshness.status).toBe("active");
    expect(result!.freshness.lastVerified).toBe("2026-01-15");
  });

  it("reflects superseded_by in freshness info", () => {
    const result = handleReadNote(db, graph, { path: "economics/rates.md" });
    expect(result).not.toBeNull();
    expect(result!.freshness.supersededBy).toBe("economics/rates-v2.md");
  });

  it("includes freshness status for draft note", () => {
    const result = handleReadNote(db, graph, { path: "projects/alpha.md" });
    expect(result).not.toBeNull();
    expect(result!.freshness.status).toBe("draft");
  });

  it("returns null for non-existent note", () => {
    const result = handleReadNote(db, graph, { path: "does-not-exist.md" });
    expect(result).toBeNull();
  });

  it("returns empty backlinks for note with no incoming links", () => {
    const result = handleReadNote(db, graph, { path: "projects/alpha.md" });
    expect(result).not.toBeNull();
    expect(result!.backlinks).toHaveLength(0);
  });
});

// ============================================================
// get_graph_context tests
// ============================================================

describe("get_graph_context", () => {
  it("returns subgraph nodes for a note path topic", () => {
    const result = handleGetGraphContext(db, graph, {
      topic: "economics/inflation.md",
      token_budget: 4000,
      depth: 2,
    });
    expect(result.nodes.length).toBeGreaterThan(0);
    const paths = result.nodes.map((n) => n.path);
    expect(paths).toContain("economics/inflation.md");
  });

  it("includes edges between included nodes", () => {
    const result = handleGetGraphContext(db, graph, {
      topic: "economics/inflation.md",
      token_budget: 4000,
      depth: 2,
    });
    // Should include the edge from inflation -> rates (both included with budget 4000)
    expect(result.edges.length).toBeGreaterThan(0);
    const edge = result.edges.find(
      (e) =>
        e.from === "economics/inflation.md" && e.to === "economics/rates.md"
    );
    expect(edge).toBeDefined();
  });

  it("sets truncated flag when budget is too small", () => {
    // Budget of 50 tokens — less than a single node's estimate (100)
    const result = handleGetGraphContext(db, graph, {
      topic: "economics/inflation.md",
      token_budget: 50,
      depth: 2,
    });
    // Start node itself costs 100 tokens, so even that might not fit,
    // OR the neighbors won't fit. Either way truncated should be true if
    // multiple nodes exist in the subgraph.
    // At budget=50, nothing fits → 0 nodes, truncated=true
    expect(result.truncated).toBe(true);
  });

  it("totalTokens is within budget", () => {
    const budget = 250;
    const result = handleGetGraphContext(db, graph, {
      topic: "economics/inflation.md",
      token_budget: budget,
      depth: 2,
    });
    expect(result.totalTokens).toBeLessThanOrEqual(budget);
  });

  it("works with tag as topic — finds tagged notes as seed", () => {
    const result = handleGetGraphContext(db, graph, {
      topic: "economics",
      token_budget: 4000,
      depth: 1,
    });
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it("returns empty result for unknown topic (not a note or tag)", () => {
    const result = handleGetGraphContext(db, graph, {
      topic: "totally-unknown-xyz",
      token_budget: 4000,
      depth: 2,
    });
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.totalTokens).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("uses default token_budget and depth when not specified", () => {
    const result = handleGetGraphContext(db, graph, {
      topic: "economics/inflation.md",
    });
    // Should succeed with defaults (4000 tokens, depth 2)
    expect(result.nodes.length).toBeGreaterThan(0);
  });
});

// ============================================================
// walk_graph tests
// ============================================================

describe("walk_graph", () => {
  it("traverses both directions by default", () => {
    // From rates.md: outgoing = nothing registered, incoming = inflation.md
    const result = handleWalkGraph(graph, { start: "economics/rates.md" });
    const paths = result.map((r) => r.path);
    expect(paths).toContain("economics/rates.md");
    // inflation.md links to rates.md, so it's an incoming neighbor
    expect(paths).toContain("economics/inflation.md");
  });

  it("traverses outgoing links only", () => {
    // From inflation.md outgoing: rates.md
    const result = handleWalkGraph(graph, {
      start: "economics/inflation.md",
      direction: "outgoing",
      depth: 1,
    });
    const paths = result.map((r) => r.path);
    expect(paths).toContain("economics/inflation.md");
    expect(paths).toContain("economics/rates.md");
    // alpha.md is not reachable via outgoing from inflation
    expect(paths).not.toContain("projects/alpha.md");
  });

  it("traverses incoming links only (backlinks)", () => {
    // From rates.md incoming: inflation.md
    const result = handleWalkGraph(graph, {
      start: "economics/rates.md",
      direction: "incoming",
      depth: 1,
    });
    const paths = result.map((r) => r.path);
    expect(paths).toContain("economics/rates.md");
    expect(paths).toContain("economics/inflation.md");
  });

  it("does NOT traverse outgoing when direction is incoming", () => {
    // From inflation.md incoming: nobody links to inflation
    const result = handleWalkGraph(graph, {
      start: "economics/inflation.md",
      direction: "incoming",
      depth: 2,
    });
    const paths = result.map((r) => r.path);
    // rates.md is only reachable via outgoing from inflation, not incoming
    expect(paths).not.toContain("economics/rates.md");
  });

  it("respects depth limit", () => {
    // depth=0 — only the start node
    const result = handleWalkGraph(graph, {
      start: "economics/inflation.md",
      depth: 0,
      direction: "both",
    });
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("economics/inflation.md");
  });

  it("returns depth info for each node", () => {
    const result = handleWalkGraph(graph, {
      start: "economics/inflation.md",
      direction: "outgoing",
      depth: 1,
    });
    const startNode = result.find((r) => r.path === "economics/inflation.md");
    const ratesNode = result.find((r) => r.path === "economics/rates.md");
    expect(startNode!.depth).toBe(0);
    expect(ratesNode!.depth).toBe(1);
  });

  it("returns title and tags for each node", () => {
    const result = handleWalkGraph(graph, {
      start: "economics/inflation.md",
      depth: 0,
    });
    expect(result[0].title).toBe("Inflation Analysis");
    expect(result[0].tags).toContain("economics");
  });
});
