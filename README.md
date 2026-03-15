<p align="center">
  <h1 align="center">vault-master-mcp</h1>
  <p align="center">
    <strong>Your Obsidian vault is a knowledge graph. Your AI should treat it like one.</strong>
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/vault-master-mcp"><img src="https://img.shields.io/npm/v/vault-master-mcp.svg" alt="npm version"></a>
    <a href="https://github.com/mattbotcode/vault-master-mcp/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
    <img src="https://img.shields.io/badge/tests-122%20passing-brightgreen.svg" alt="Tests">
    <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP-compatible-purple.svg" alt="MCP Compatible"></a>
  </p>
</p>

---

## The Problem

Every Obsidian MCP server gives your AI flat file access — read a note, list a folder, maybe search by name. But your vault isn't a folder of files. It's a **knowledge graph** of interconnected ideas linked by `[[wikilinks]]`, tags, and frontmatter.

When an AI agent reads a single note without understanding its connections, it's like reading one page of a wiki and thinking you understand the topic.

**vault-master-mcp** builds an in-memory graph index from your vault's wikilinks, backlinks, and tags, then gives AI agents the tools to **traverse**, **search**, and **assemble context** from that graph — all within a token budget.

---

## Key Features

### Token-Budgeted Context Assembly
Ask for context on a topic and get the optimal subgraph that fits your token budget. No more "sorry, that's too much context" — the server handles it.

```
get_graph_context({ topic: "machine-learning", token_budget: 4000 })
→ Returns the most relevant connected notes that fit in 4K tokens
```

### Graph Traversal
BFS walks with direction control. Follow only outgoing links, incoming backlinks, or both.

```
walk_graph({ start: "projects/my-project.md", depth: 2, direction: "outgoing" })
→ See everything this note links to, 2 levels deep
```

### Knowledge Freshness Tracking
Notes carry lifecycle metadata — `active`, `superseded`, `draft`, `archived`. Agents can check if knowledge is current or chase fresher sources via `superseded_by` links.

### Live Sync
Chokidar file watcher keeps the graph and search index updated as you edit in Obsidian. No restarts needed.

### Full-Text Search with Graph Context
SQLite FTS5 search that optionally includes graph neighbors in results, so agents find notes *and* their connections.

---

## Quick Start

```bash
npx vault-master-mcp --vault ~/my-vault
```

That's it. The server indexes your vault, starts the file watcher, and connects over stdio.

Or install globally:

```bash
npm install -g vault-master-mcp
vault-master-mcp --vault ~/my-vault
```

---

## Works With

vault-master-mcp runs as an MCP server — it works with any MCP-compatible client:

| Client | Config Location |
|--------|----------------|
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) |
| **Claude Code** | `~/.claude/settings.json` or project `.mcp.json` |
| **Cursor** | Cursor MCP settings |
| **VS Code + Copilot** | `.vscode/mcp.json` |
| **Any MCP client** | See [MCP docs](https://modelcontextprotocol.io) |

> **Note on OpenClaw:** OpenClaw does not currently support native MCP clients. The OpenClaw team considers direct MCP integration a "token tax" (tool definitions loaded into every agent session). The planned bridge is **mcporter**, which converts MCP servers into on-demand CLI commands — but this is not yet available. For multi-agent setups using OpenClaw, delegate vault discovery queries to a Claude Code session that has vault-master connected.

### Claude Desktop Example

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

### Claude Code Example

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

## Tools (10)

### Discovery
| Tool | Description |
|------|-------------|
| `search_vault` | Full-text search (FTS5) with optional graph neighbor expansion |
| `find_related` | Find notes by graph proximity or tag — starts from a note and fans out |
| `list_notes` | Browse vault by folder, tag, or frontmatter key |

### Context Assembly
| Tool | Description |
|------|-------------|
| `read_note` | Read note with backlinks, freshness metadata, and graph degree |
| `get_graph_context` | Token-budgeted subgraph assembly — the right amount of context, every time |
| `walk_graph` | BFS traversal with direction control (outgoing / incoming / both) |

### Write-Back
| Tool | Description |
|------|-------------|
| `create_note` | Create note with frontmatter and auto-linked `[[wikilinks]]` |
| `update_note` | Update content or merge frontmatter into existing notes |
| `add_links` | Add wikilinks between notes (creates Related section if absent) |
| `mark_superseded` | Mark a note as replaced — updates freshness chain for agents |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  MCP Client                      │
│         (Claude, Cursor, VS Code...)             │
└──────────────────┬──────────────────────────────┘
                   │ stdio (JSON-RPC)
┌──────────────────▼──────────────────────────────┐
│              vault-master-mcp                    │
│                                                  │
│  ┌─────────────┐  ┌──────────────────────────┐  │
│  │  Graph       │  │  SQLite + FTS5           │  │
│  │  Engine      │  │                          │  │
│  │              │  │  • Full-text search      │  │
│  │  • Adjacency │  │  • Metadata queries      │  │
│  │    index     │  │  • Frontmatter store     │  │
│  │  • BFS       │  │  • Link persistence      │  │
│  │  • Subgraph  │  │                          │  │
│  │    extraction│  └──────────────────────────┘  │
│  └─────────────┘                                 │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │  Chokidar File Watcher                      │ │
│  │  • Incremental re-index on vault changes    │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────┬──────────────────────────────┘
                   │ filesystem
┌──────────────────▼──────────────────────────────┐
│            Obsidian Vault (~/my-vault)            │
│                                                  │
│  notes.md ──[[wikilinks]]──► other-notes.md      │
│  #tags, frontmatter, folders                     │
└──────────────────────────────────────────────────┘
```

**Dual-index design:** The in-memory graph handles traversal and subgraph extraction at speed. SQLite with FTS5 handles full-text search and persistent metadata. Both stay in sync via the file watcher.

---

## Freshness Model

Notes can carry optional frontmatter that agents use to assess knowledge currency:

```yaml
---
status: active          # active | superseded | draft | archived
superseded_by: "[[new-approach.md]]"
last_verified: 2026-03-15
revision_of: "[[original-note.md]]"
---
```

When an agent reads a note via `read_note`, these fields are surfaced alongside backlink counts and graph degree — giving the agent enough signal to decide whether to trust the content or follow the `superseded_by` chain to fresher knowledge.

---

## How It Compares

| Feature | vault-master-mcp | Typical Obsidian MCP |
|---------|:---:|:---:|
| Read/write notes | Yes | Yes |
| Full-text search | FTS5 | Basic |
| Graph traversal (BFS) | Yes | No |
| Token-budgeted context | Yes | No |
| Backlink awareness | Yes | Rarely |
| Freshness tracking | Yes | No |
| Live file watching | Yes | Rarely |
| Directed link walking | Yes | No |
| In-memory graph index | Yes | No |

---

## Development

```bash
git clone https://github.com/mattbotcode/vault-master-mcp
cd vault-master-mcp
npm install
npm test        # 122 tests via Vitest
npm run build   # compile TypeScript
```

Tests run against a temporary in-memory vault fixture covering all 10 tools, graph traversal, FTS5 search, freshness tracking, and file watcher integration.

---

## Contributing

Contributions are welcome! Whether it's:

- Bug reports and feature requests via [Issues](https://github.com/mattbotcode/vault-master-mcp/issues)
- Pull requests for new tools, performance improvements, or bug fixes
- Documentation improvements
- Sharing your use cases

Please open an issue first for major changes so we can discuss the approach.

---

## Roadmap

- [ ] Semantic search via embeddings
- [ ] Multi-vault support
- [ ] Graph visualization endpoint
- [ ] Plugin system for custom tools
- [ ] Vault health/quality scoring

---

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Built for the AI-native knowledge management era.</sub>
</p>
