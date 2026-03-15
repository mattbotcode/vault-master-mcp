import { describe, it, expect, beforeEach } from "vitest";
import { GraphEngine } from "../../src/graph/engine.js";
import type { GraphNode } from "../../src/types.js";

let graph: GraphEngine;

const makeNode = (path: string, tokens = 100): GraphNode => ({
  path,
  title: path.replace(".md", ""),
  tags: [],
  frontmatter: {},
  tokenEstimate: tokens,
});

beforeEach(() => {
  graph = new GraphEngine();
  // Build a small graph:
  //   a -> b -> c
  //   a -> d
  //   d -> c
  graph.addNode(makeNode("a.md"));
  graph.addNode(makeNode("b.md"));
  graph.addNode(makeNode("c.md"));
  graph.addNode(makeNode("d.md"));
  graph.addEdge("a.md", "b.md", "wikilink");
  graph.addEdge("a.md", "d.md", "wikilink");
  graph.addEdge("b.md", "c.md", "wikilink");
  graph.addEdge("d.md", "c.md", "wikilink");
});

describe("GraphEngine — basic operations", () => {
  it("stores and retrieves nodes", () => {
    expect(graph.getNode("a.md")).not.toBeNull();
    expect(graph.getNode("a.md")!.title).toBe("a");
  });

  it("returns null for unknown nodes", () => {
    expect(graph.getNode("unknown.md")).toBeNull();
  });

  it("tracks outLinks", () => {
    expect(graph.getOutLinks("a.md")).toEqual(
      expect.arrayContaining(["b.md", "d.md"])
    );
  });

  it("tracks inLinks (backlinks)", () => {
    expect(graph.getInLinks("c.md")).toEqual(
      expect.arrayContaining(["b.md", "d.md"])
    );
  });

  it("removes a node and its edges", () => {
    graph.removeNode("b.md");
    expect(graph.getNode("b.md")).toBeNull();
    expect(graph.getOutLinks("a.md")).not.toContain("b.md");
    expect(graph.getInLinks("c.md")).not.toContain("b.md");
  });
});

describe("GraphEngine — BFS", () => {
  it("traverses breadth-first from a start node", () => {
    const result = graph.bfs("a.md", 3);
    const paths = result.map((r) => r.path);
    expect(paths).toContain("a.md");
    expect(paths).toContain("b.md");
    expect(paths).toContain("d.md");
    expect(paths).toContain("c.md");
  });

  it("respects depth limit", () => {
    const result = graph.bfs("a.md", 1);
    const paths = result.map((r) => r.path);
    expect(paths).toContain("a.md");
    expect(paths).toContain("b.md");
    expect(paths).toContain("d.md");
    expect(paths).not.toContain("c.md");
  });

  it("returns only start node at depth 0", () => {
    const result = graph.bfs("a.md", 0);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("a.md");
  });
});

describe("GraphEngine — getSubgraph (token-budgeted)", () => {
  it("returns nodes within token budget", () => {
    const sub = graph.getSubgraph("a.md", 250, 3);
    expect(sub.totalTokens).toBeLessThanOrEqual(250);
    expect(sub.nodes.length).toBeGreaterThan(0);
  });

  it("marks as truncated when budget exceeded", () => {
    const sub = graph.getSubgraph("a.md", 150, 3);
    // Budget only fits ~1 node (each is 100 tokens), should be truncated
    expect(sub.truncated).toBe(true);
  });

  it("includes edges between included nodes", () => {
    const sub = graph.getSubgraph("a.md", 1000, 3);
    expect(sub.edges.length).toBeGreaterThan(0);
    expect(sub.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "a.md", to: "b.md" }),
      ])
    );
  });
});

describe("GraphEngine — getNeighborhood", () => {
  it("returns immediate neighbors", () => {
    const neighbors = graph.getNeighborhood("a.md");
    expect(neighbors).toEqual(expect.arrayContaining(["b.md", "d.md"]));
  });

  it("includes backlinks in neighborhood", () => {
    const neighbors = graph.getNeighborhood("c.md");
    expect(neighbors).toEqual(expect.arrayContaining(["b.md", "d.md"]));
  });
});

describe("GraphEngine — tag index", () => {
  it("indexes notes by tag", () => {
    const tagged = makeNode("tagged.md");
    tagged.tags = ["economics", "fed"];
    graph.addNode(tagged);
    expect(graph.getByTag("economics")).toContain("tagged.md");
    expect(graph.getByTag("fed")).toContain("tagged.md");
  });

  it("returns empty for unknown tag", () => {
    expect(graph.getByTag("nonexistent")).toEqual([]);
  });
});
