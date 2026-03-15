import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VaultDatabase } from "../../src/db/sqlite.js";
import { GraphEngine } from "../../src/graph/engine.js";
import {
  handleSearchVault,
  handleFindRelated,
  handleListNotes,
} from "../../src/tools/discovery.js";
import type { NoteMeta, GraphNode } from "../../src/types.js";

let db: VaultDatabase;
let graph: GraphEngine;

const makeNote = (path: string, title: string, content: string, tags: string[] = []): NoteMeta => ({
  path,
  title,
  content,
  frontmatter: { status: "active" },
  outLinks: [],
  tags,
  createdAt: new Date(),
  modifiedAt: new Date(),
});

const makeGraphNode = (path: string, tags: string[] = []): GraphNode => ({
  path,
  title: path.replace(".md", ""),
  tags,
  frontmatter: {},
  tokenEstimate: 100,
});

beforeEach(() => {
  db = new VaultDatabase(":memory:");
  graph = new GraphEngine();

  // Seed data
  const notes = [
    makeNote("economics/inflation.md", "Inflation Analysis", "CPI rose 3.2% in February. The Fed is watching.", ["economics"]),
    makeNote("economics/rates.md", "Interest Rates", "The Federal Reserve held rates steady.", ["economics", "fed"]),
    makeNote("projects/alpha.md", "Project Alpha", "Engineering project about software.", ["engineering"]),
  ];

  for (const note of notes) {
    db.upsertNote(note);
    graph.addNode(makeGraphNode(note.path, note.tags));
  }

  // Add edges
  graph.addEdge("economics/inflation.md", "economics/rates.md", "wikilink");
});

afterEach(() => {
  db.close();
});

describe("search_vault", () => {
  it("returns FTS matches", () => {
    const results = handleSearchVault(db, graph, { query: "inflation" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe("economics/inflation.md");
  });

  it("respects limit parameter", () => {
    const results = handleSearchVault(db, graph, { query: "economics", limit: 1 });
    expect(results.length).toBe(1);
  });

  it("includes neighbors when requested", () => {
    const results = handleSearchVault(db, graph, {
      query: "inflation",
      include_neighbors: true,
    });
    expect(results[0].neighbors).toBeDefined();
    expect(results[0].neighbors).toContain("economics/rates.md");
  });
});

describe("find_related", () => {
  it("finds related notes by graph proximity", () => {
    const results = handleFindRelated(graph, {
      note_path: "economics/inflation.md",
      depth: 1,
    });
    const paths = results.map((r) => r.path);
    expect(paths).toContain("economics/rates.md");
  });

  it("finds related notes by topic/tag", () => {
    const results = handleFindRelated(graph, {
      topic: "economics",
      depth: 1,
    });
    expect(results.length).toBeGreaterThan(0);
  });

  it("respects max_results", () => {
    const results = handleFindRelated(graph, {
      note_path: "economics/inflation.md",
      depth: 2,
      max_results: 1,
    });
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

describe("list_notes", () => {
  it("lists all notes when no filter", () => {
    const results = handleListNotes(db, {});
    expect(results.length).toBe(3);
  });

  it("filters by tag", () => {
    const results = handleListNotes(db, { tag: "fed" });
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("economics/rates.md");
  });

  it("filters by folder prefix", () => {
    const results = handleListNotes(db, { folder: "economics" });
    expect(results.length).toBe(2);
  });
});
