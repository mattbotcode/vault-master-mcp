import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { VaultIndexer } from "../../src/graph/indexer.js";
import { VaultDatabase } from "../../src/db/sqlite.js";
import { GraphEngine } from "../../src/graph/engine.js";

// For ESM, you'll need to use import.meta.url:
import { fileURLToPath } from "url";
import { dirname } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VAULT_PATH = join(__dirname, "../fixtures/vault");
let db: VaultDatabase;
let graph: GraphEngine;
let indexer: VaultIndexer;

beforeEach(() => {
  db = new VaultDatabase(":memory:");
  graph = new GraphEngine();
  indexer = new VaultIndexer(VAULT_PATH, db, graph);
});

afterEach(() => {
  db.close();
});

describe("VaultIndexer", () => {
  it("indexes all markdown files in vault", async () => {
    await indexer.fullScan();
    const paths = db.getAllPaths();
    expect(paths).toHaveLength(3);
    expect(paths).toContain("projects/alpha.md");
    expect(paths).toContain("team/bob.md");
    expect(paths).toContain("reports/q1-summary.md");
  });

  it("resolves wikilinks to relative paths", async () => {
    await indexer.fullScan();
    const links = db.getOutLinks("projects/alpha.md");
    expect(links).toContain("team/bob.md");
    expect(links).toContain("reports/q1-summary.md");
  });

  it("populates graph with nodes", async () => {
    await indexer.fullScan();
    expect(graph.size).toBe(3);
    expect(graph.getNode("projects/alpha.md")).not.toBeNull();
  });

  it("populates graph with edges", async () => {
    await indexer.fullScan();
    const outLinks = graph.getOutLinks("projects/alpha.md");
    expect(outLinks).toContain("team/bob.md");
    expect(outLinks).toContain("reports/q1-summary.md");
  });

  it("builds backlinks in graph", async () => {
    await indexer.fullScan();
    const backlinks = graph.getInLinks("projects/alpha.md");
    expect(backlinks).toContain("team/bob.md");
    expect(backlinks).toContain("reports/q1-summary.md");
  });

  it("indexes frontmatter tags in graph", async () => {
    await indexer.fullScan();
    const tagged = graph.getByTag("engineering");
    expect(tagged).toContain("projects/alpha.md");
  });

  it("indexes a single file incrementally", async () => {
    await indexer.fullScan();
    // Re-index a single file
    await indexer.indexFile("projects/alpha.md");
    const note = db.getNote("projects/alpha.md");
    expect(note).not.toBeNull();
  });

  it("removes a deleted file", async () => {
    await indexer.fullScan();
    indexer.removeFile("team/bob.md");
    expect(db.getNote("team/bob.md")).toBeNull();
    expect(graph.getNode("team/bob.md")).toBeNull();
  });
});
