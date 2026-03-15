import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VaultDatabase } from "./db/sqlite.js";
import type { GraphEngine } from "./graph/engine.js";
import type { VaultIndexer } from "./graph/indexer.js";
import {
  handleSearchVault,
  handleFindRelated,
  handleListNotes,
} from "./tools/discovery.js";
import {
  handleReadNote,
  handleGetGraphContext,
  handleWalkGraph,
} from "./tools/context.js";
import {
  handleCreateNote,
  handleUpdateNote,
  handleAddLinks,
  handleMarkSuperseded,
} from "./tools/write.js";
import type { WriteToolContext } from "./tools/write.js";

export function createServer(
  db: VaultDatabase,
  graph: GraphEngine,
  vaultPath: string,
  indexer: VaultIndexer
): McpServer {
  const server = new McpServer({
    name: "vault-master-mcp",
    version: "0.1.0",
  });

  const writeCtx: WriteToolContext = { vaultPath, db, graph, indexer };

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

  // --- Context Assembly Tools ---

  server.tool(
    "read_note",
    "Read a note with full metadata, backlinks, and freshness info.",
    {
      path: z.string().describe("Note path relative to vault root"),
    },
    async (args) => {
      const result = handleReadNote(db, graph, args);
      if (!result) {
        return {
          content: [{ type: "text", text: `Note not found: ${args.path}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "get_graph_context",
    "Get optimal subgraph within token budget for a topic or note path.",
    {
      topic: z.string().describe("Note path or tag to center the context on"),
      token_budget: z.number().optional().describe("Max tokens to include (default 4000)"),
      depth: z.number().optional().describe("Max graph traversal depth (default 2)"),
    },
    async (args) => {
      const result = handleGetGraphContext(db, graph, args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "walk_graph",
    "BFS traversal from a start note. Optionally follow only outgoing or incoming links.",
    {
      start: z.string().describe("Starting note path"),
      depth: z.number().optional().describe("Max traversal depth (default 2)"),
      direction: z
        .enum(["outgoing", "incoming", "both"])
        .optional()
        .describe("Link direction to follow (default both)"),
    },
    async (args) => {
      const result = handleWalkGraph(graph, args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // --- Write-back Tools ---

  server.tool(
    "create_note",
    "Create a new note in the vault with optional frontmatter and wikilinks.",
    {
      path: z.string().describe("Path for the new note relative to vault root"),
      content: z.string().describe("Body content of the note"),
      frontmatter: z
        .record(z.unknown())
        .optional()
        .describe("Frontmatter key-value pairs"),
      link_to: z
        .array(z.string())
        .optional()
        .describe("Note paths to add as 'See also' wikilinks"),
    },
    async (args) => {
      const result = await handleCreateNote(writeCtx, {
        path: args.path,
        content: args.content,
        frontmatter: args.frontmatter as Record<string, unknown> | undefined,
        link_to: args.link_to,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    }
  );

  server.tool(
    "update_note",
    "Update body content and/or merge frontmatter into an existing note.",
    {
      path: z.string().describe("Path to the note relative to vault root"),
      content: z.string().optional().describe("New body content (replaces existing)"),
      frontmatter_updates: z
        .record(z.unknown())
        .optional()
        .describe("Frontmatter keys to merge into existing frontmatter"),
    },
    async (args) => {
      const result = await handleUpdateNote(writeCtx, {
        path: args.path,
        content: args.content,
        frontmatter_updates: args.frontmatter_updates as
          | Record<string, unknown>
          | undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    }
  );

  server.tool(
    "add_links",
    "Append wikilinks to a note's Related section (creates section if absent).",
    {
      from: z.string().describe("Source note path relative to vault root"),
      to: z.array(z.string()).describe("Target note paths to link to"),
    },
    async (args) => {
      const result = await handleAddLinks(writeCtx, {
        from: args.from,
        to: args.to,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    }
  );

  server.tool(
    "mark_superseded",
    "Mark a note as superseded by another note, updating its frontmatter.",
    {
      old_path: z
        .string()
        .describe("Path to the note being superseded (relative to vault root)"),
      new_path: z
        .string()
        .describe("Path to the replacement note (relative to vault root)"),
      reason: z
        .string()
        .optional()
        .describe("Optional reason for superseding"),
    },
    async (args) => {
      const result = await handleMarkSuperseded(writeCtx, {
        old_path: args.old_path,
        new_path: args.new_path,
        reason: args.reason,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    }
  );

  return server;
}
