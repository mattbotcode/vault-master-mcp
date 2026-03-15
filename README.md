# vault-master-mcp

**Graph-aware MCP server for Obsidian vaults**

Treats your Obsidian vault as a living knowledge graph. Instead of flat file access, AI agents get graph traversal, full-text search, token-budgeted context assembly, structured write-back, and temporal freshness tracking. The only Obsidian MCP server that builds an in-memory graph index from wikilinks, backlinks, and tags.

---

## Quick Start

```bash
# Run directly with npx
npx vault-master-mcp --vault ~/my-vault

# Or install globally
npm install -g vault-master-mcp
vault-master-mcp --vault ~/my-vault
```

## Claude Desktop Config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "vault-master": {
      "command": "npx",
      "args": ["vault-master-mcp", "--vault", "/path/to/your/vault"]
    }
  }
}
```

---

## Tools

| Tool | Category | Description |
|------|----------|-------------|
| `search_vault` | Discovery | Full-text search with graph context |
| `find_related` | Discovery | Find notes by graph proximity or tag |
| `list_notes` | Discovery | Browse vault by folder, tag, or frontmatter |
| `read_note` | Context | Read note with backlinks, freshness, metadata |
| `get_graph_context` | Context | Token-budgeted subgraph assembly |
| `walk_graph` | Context | BFS traversal with direction control |
| `create_note` | Write | Create note with frontmatter and wikilinks |
| `update_note` | Write | Update content or frontmatter |
| `add_links` | Write | Add wikilinks between notes |
| `mark_superseded` | Write | Mark note as replaced with freshness tracking |

---

## Architecture

- **In-memory graph** — adjacency index built from wikilinks, backlinks, and tags at startup; kept in sync via file watcher
- **SQLite + FTS5** — persistent index for full-text search and metadata queries across large vaults
- **chokidar file watcher** — incremental index updates on vault changes without full rebuilds
- **MCP stdio transport** — runs as a subprocess, communicates over stdin/stdout per the MCP spec

---

## Freshness Model

Notes carry optional frontmatter fields that agents use to assess knowledge currency:

| Field | Purpose |
|-------|---------|
| `status` | Lifecycle state (`active`, `archived`, `superseded`, `draft`) |
| `superseded_by` | Wikilink to the note that replaces this one |
| `last_verified` | ISO date when the content was last confirmed accurate |
| `revision_of` | Wikilink to the original note this revises |

When reading a note, `read_note` surfaces these fields alongside backlink counts and graph degree so agents can decide whether to trust or chase fresher sources.

---

## Development

```bash
git clone https://github.com/mattbotcode/vault-master-mcp
cd vault-master-mcp
npm install
npm test        # run tests
npm run build   # compile TypeScript
```

Tests use [Vitest](https://vitest.dev/) with a temporary in-memory vault fixture. The test suite covers all 10 tools, graph traversal, FTS5 search, freshness tracking, and file watcher integration (114 tests).

---

## License

MIT
