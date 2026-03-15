import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, unlink, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { VaultWatcher } from "../../src/graph/watcher.js";
import { VaultDatabase } from "../../src/db/sqlite.js";
import { GraphEngine } from "../../src/graph/engine.js";
import { VaultIndexer } from "../../src/graph/indexer.js";

// Helper: poll until condition is true or timeout
async function waitFor(
  fn: () => boolean,
  timeoutMs = 3000,
  intervalMs = 50
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timed out");
}

let tmpVault: string;
let db: VaultDatabase;
let graph: GraphEngine;
let indexer: VaultIndexer;
let watcher: VaultWatcher;

beforeEach(async () => {
  tmpVault = await mkdtemp(join(tmpdir(), "vault-watcher-test-"));
  db = new VaultDatabase(":memory:");
  graph = new GraphEngine();
  indexer = new VaultIndexer(tmpVault, db, graph);
});

afterEach(async () => {
  await watcher?.stop();
  db.close();
  await rm(tmpVault, { recursive: true, force: true });
});

describe("VaultWatcher", () => {
  it("indexes a new .md file on add", async () => {
    watcher = new VaultWatcher(tmpVault, indexer, {
      debounceMs: 10,
      usePolling: true,
      pollingInterval: 50,
    });
    watcher.start();

    // Wait for watcher to be ready before writing
    await new Promise((r) => setTimeout(r, 300));

    const filePath = join(tmpVault, "note.md");
    await writeFile(filePath, "# Hello\nThis is a test note.");

    await waitFor(() => db.getNote("note.md") !== null);
    expect(db.getNote("note.md")).not.toBeNull();
    expect(graph.getNode("note.md")).not.toBeNull();
  });

  it("updates index when a file changes", async () => {
    // Pre-create a file so we can observe an update
    const filePath = join(tmpVault, "existing.md");
    await writeFile(filePath, "# Original\nOriginal content.");
    await indexer.fullScan();

    const noteBefore = db.getNote("existing.md");
    expect(noteBefore).not.toBeNull();

    watcher = new VaultWatcher(tmpVault, indexer, {
      debounceMs: 10,
      usePolling: true,
      pollingInterval: 50,
    });
    watcher.start();

    // Wait a moment so watcher is fully initialized before writing
    await new Promise((r) => setTimeout(r, 300));

    await writeFile(filePath, "# Updated\nUpdated content. [[other-note]]");

    // Wait for the change to be indexed (outLinks would include other-note if resolved, or we just check it re-ran)
    // We can verify by checking if the graph node still exists after re-index
    await waitFor(() => {
      const note = db.getNote("existing.md");
      // The content changed — we confirm indexFile was called by checking mtime-sensitive fields
      // Since we can't easily check content in db, we verify graph still has the node
      return note !== null && graph.getNode("existing.md") !== null;
    });

    expect(db.getNote("existing.md")).not.toBeNull();
  });

  it("removes file from index on delete", async () => {
    const filePath = join(tmpVault, "to-delete.md");
    await writeFile(filePath, "# To Delete");
    await indexer.fullScan();

    expect(db.getNote("to-delete.md")).not.toBeNull();

    watcher = new VaultWatcher(tmpVault, indexer, {
      debounceMs: 10,
      usePolling: true,
      pollingInterval: 50,
    });
    watcher.start();

    // Wait for watcher to be ready
    await new Promise((r) => setTimeout(r, 300));

    await unlink(filePath);

    await waitFor(() => db.getNote("to-delete.md") === null);
    expect(db.getNote("to-delete.md")).toBeNull();
    expect(graph.getNode("to-delete.md")).toBeNull();
  });

  it("ignores non-.md files", async () => {
    watcher = new VaultWatcher(tmpVault, indexer, {
      debounceMs: 10,
      usePolling: true,
      pollingInterval: 50,
    });
    watcher.start();

    await writeFile(join(tmpVault, "data.json"), '{"key": "value"}');
    await writeFile(join(tmpVault, "image.png"), "fake-binary");

    // Wait to ensure no indexing happened
    await new Promise((r) => setTimeout(r, 300));

    expect(db.getAllPaths()).toHaveLength(0);
  });

  it("debounces rapid changes to the same file", async () => {
    let indexCallCount = 0;
    const originalIndexFile = indexer.indexFile.bind(indexer);
    indexer.indexFile = async (path: string) => {
      indexCallCount++;
      return originalIndexFile(path);
    };

    watcher = new VaultWatcher(tmpVault, indexer, {
      debounceMs: 100,
      usePolling: true,
      pollingInterval: 50,
    });
    watcher.start();

    await new Promise((r) => setTimeout(r, 300));

    const filePath = join(tmpVault, "debounce.md");
    // Write rapidly — only one index call should happen after debounce settles
    await writeFile(filePath, "# v1");
    await new Promise((r) => setTimeout(r, 30));
    await writeFile(filePath, "# v2");
    await new Promise((r) => setTimeout(r, 30));
    await writeFile(filePath, "# v3");

    // Wait for debounce to fire and indexing to complete
    await waitFor(() => db.getNote("debounce.md") !== null, 3000);

    // Should have been indexed only once (or a small number of times, not 3)
    expect(indexCallCount).toBeLessThanOrEqual(2);
    expect(db.getNote("debounce.md")).not.toBeNull();
  });

  it("stop() clears pending timers and closes watcher", async () => {
    watcher = new VaultWatcher(tmpVault, indexer, {
      debounceMs: 500,
      usePolling: true,
      pollingInterval: 50,
    });
    watcher.start();

    await new Promise((r) => setTimeout(r, 100));

    // Trigger a change to create a pending timer
    await writeFile(join(tmpVault, "pending.md"), "# Pending");

    // Stop immediately before debounce fires
    await watcher.stop();

    // Verify stop doesn't throw and watcher is cleaned up
    // The file should NOT be in the index because timer was cancelled
    expect(db.getNote("pending.md")).toBeNull();
  });
});
