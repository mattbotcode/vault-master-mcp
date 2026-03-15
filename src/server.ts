import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VaultDatabase } from "./db/sqlite.js";
import type { GraphEngine } from "./graph/engine.js";
import {
  handleSearchVault,
  handleFindRelated,
  handleListNotes,
} from "./tools/discovery.js";

export function createServer(db: VaultDatabase, graph: GraphEngine): McpServer {
  const server = new McpServer({
    name: "vault-master-mcp",
    version: "0.1.0",
  });

  // --- Discovery Tools ---

  server.tool(
    "search_vault",
    "Full-text search with graph context. Returns matching notes with optional neighbor info.",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results (default 20)"),
      include_neighbors: z.boolean().optional().describe("Include graph neighbors in results"),
    },
    async (args) => {
      const results = handleSearchVault(db, graph, args);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  server.tool(
    "find_related",
    "Find related notes by graph proximity from a note or topic.",
    {
      note_path: z.string().optional().describe("Start note path"),
      topic: z.string().optional().describe("Topic/tag to search by"),
      depth: z.number().optional().describe("Graph traversal depth (default 2)"),
      max_results: z.number().optional().describe("Max results (default 20)"),
    },
    async (args) => {
      const results = handleFindRelated(graph, args);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  server.tool(
    "list_notes",
    "Browse vault structure. Filter by folder, tag, or frontmatter key.",
    {
      folder: z.string().optional().describe("Filter by folder prefix"),
      tag: z.string().optional().describe("Filter by tag"),
      has_frontmatter_key: z.string().optional().describe("Filter by frontmatter key presence"),
    },
    async (args) => {
      const results = handleListNotes(db, args);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  return server;
}
