#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join } from "path";
import { VaultDatabase } from "./db/sqlite.js";
import { GraphEngine } from "./graph/engine.js";
import { VaultIndexer } from "./graph/indexer.js";
import { VaultWatcher } from "./graph/watcher.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  // Parse --vault argument
  const vaultArg = process.argv.find((arg) => arg.startsWith("--vault"));
  let vaultPath: string;

  if (vaultArg?.includes("=")) {
    vaultPath = vaultArg.split("=")[1];
  } else {
    const idx = process.argv.indexOf("--vault");
    if (idx >= 0 && process.argv[idx + 1]) {
      vaultPath = process.argv[idx + 1];
    } else {
      console.error("Usage: vault-master-mcp --vault <path-to-vault>");
      process.exit(1);
    }
  }

  // Initialize components
  const dbPath = join(vaultPath, ".vault-master.db");
  const db = new VaultDatabase(dbPath);
  const graph = new GraphEngine();
  const indexer = new VaultIndexer(vaultPath, db, graph);

  // Full index on startup
  console.error(`[vault-master] Indexing vault at ${vaultPath}...`);
  const start = Date.now();
  await indexer.fullScan();
  console.error(`[vault-master] Indexed ${graph.size} notes in ${Date.now() - start}ms`);

  // Start file watcher for incremental updates
  const watcher = new VaultWatcher(vaultPath, indexer);
  watcher.start();
  console.error("[vault-master] File watcher active");

  // Clean up on exit (MCP hosts send SIGTERM, terminals send SIGINT)
  const cleanup = async () => {
    try {
      await watcher.stop();
      db.close();
    } catch (err) {
      console.error("[vault-master] Cleanup error:", err);
    }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Create and start MCP server
  const server = createServer(db, graph, vaultPath, indexer);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[vault-master] MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
