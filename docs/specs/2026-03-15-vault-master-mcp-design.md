# Vault-Master MCP — Design Spec

**Date:** 2026-03-15
**Status:** Approved
**Author:** Matt + Claude Code (based on Kingpin's proposal)

---

## Problem

AI agents interact with Obsidian vaults at the file level when they need to interact at the graph level. This causes four pain points:

1. **Discovery** — agents can't find notes without exact paths; keyword mismatches cause duplicated work
2. **Context Assembly** — wikilinks are dead text; agents either over-fetch (token burn) or under-fetch (miss critical context)
3. **Write-back** — inbox pattern is one-way; agents are "guests" who can't maintain the vault
4. **Staleness** — no temporal metadata; agents follow outdated notes without knowing they're superseded

## Goal

An open-source MCP server that treats an Obsidian vault as a **living knowledge graph** — enabling graph-aware traversal, structured write-back, and temporal freshness tracking. Built for internal use on SystemVault first, then generalized for community adoption.

## Architecture

- **Approach:** In-memory graph + SQLite persistence (Approach B)
- **MCP Server:** TypeScript, `@modelcontextprotocol/server` SDK, stdio transport
- **Graph Engine:** In-memory adjacency graph built from wikilinks, backlinks, tags, frontmatter. Supports BFS/DFS, subgraph extraction, token-budgeted context assembly
- **Persistence:** SQLite with FTS5 for full-text search. Index file stored alongside vault
- **File Watcher:** chokidar-based, detects vault changes, incrementally updates SQLite + in-memory graph
- **Distribution:** `npx vault-master-mcp --vault ~/my-vault` — zero external deps, local-first, privacy-centric
- **Repo:** github.com/openclaw/vault-master-mcp (public, MIT license)

## Competitive Landscape

8+ existing Obsidian MCP servers (cyanheads, MarkusPfundstein, StevenStavrakis, etc.) — ALL treat the vault as a flat file collection. None build a graph index. Our differentiator is graph-aware traversal.

## MCP Tools (10 tools)

### Discovery
- `search_vault` — FTS with graph context (query, limit, include_neighbors)
- `find_related` — graph proximity from a note/topic (note_path/topic, depth, max_results)
- `list_notes` — browse vault structure (folder, tag, has_frontmatter_key)

### Context Assembly
- `read_note` — read with metadata, backlinks, freshness info (path)
- `get_graph_context` — optimal subgraph within token budget (topic, token_budget, depth)
- `walk_graph` — BFS/DFS traversal (start, depth, direction)

### Write-back
- `create_note` — create with frontmatter + wikilinks (path, content, frontmatter, link_to)
- `update_note` — modify content or frontmatter (path, content/frontmatter_updates)
- `add_links` — create wikilinks between notes (from, to[])
- `mark_superseded` — mark note as replaced (old_path, new_path, reason)

## Freshness Model

Frontmatter fields: `status` (active/superseded/draft/archived), `superseded_by`, `last_verified`, `revision_of`, `keywords`

## SQLite Schema

Tables: `notes`, `links`, `tags`, `frontmatter`, `notes_fts` (FTS5 virtual table)

## In-Memory Graph

Maps: `nodes` (path→node), `outLinks` (path→linked paths), `inLinks` (path→backlink paths), `tagIndex` (tag→note paths)

Operations: `bfs`, `getSubgraph` (token-budgeted), `findPath`, `getNeighborhood`

## Project Structure

```
vault-master-mcp/
├── src/
│   ├── index.ts, server.ts
│   ├── graph/ (engine.ts, indexer.ts, watcher.ts)
│   ├── db/ (sqlite.ts, queries.ts)
│   ├── tools/ (discovery.ts, context.ts, write.ts)
│   ├── parser/ (markdown.ts, frontmatter.ts)
│   └── types.ts
├── tests/ (fixtures/, *.test.ts)
└── docs/
```
