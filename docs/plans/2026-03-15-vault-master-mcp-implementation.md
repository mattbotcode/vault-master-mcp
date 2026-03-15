# Vault-Master MCP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server that treats an Obsidian vault as a living knowledge graph — graph-aware traversal, structured write-back, and temporal freshness tracking.

**Architecture:** In-memory adjacency graph built from wikilinks/backlinks/tags/frontmatter, backed by SQLite+FTS5 for persistence and full-text search. MCP server exposes 10 tools over stdio transport. File watcher (chokidar) keeps index in sync.

**Tech Stack:** TypeScript, `@modelcontextprotocol/server`, `better-sqlite3`, `zod/v4`, `chokidar`, `gray-matter`, `vitest`

**Design Spec:** `docs/specs/2026-03-15-vault-master-mcp-design.md`

---

## Chunk 1: Project Scaffold + Parsers

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "vault-master-mcp",
  "version": "0.1.0",
  "description": "MCP server for graph-aware Obsidian vault traversal",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "vault-master-mcp": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "keywords": ["mcp", "obsidian", "knowledge-graph", "vault"],
  "license": "MIT",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "better-sqlite3": "^11.8.2",
    "chokidar": "^4.0.3",
    "gray-matter": "^4.0.3",
    "zod": "^3.25.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.15.2",
    "typescript": "^5.8.3",
    "vitest": "^3.1.2"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
*.db
*.db-journal
.DS_Store
```

- [ ] **Step 5: Create src/types.ts**

```typescript
// Core types for vault-master-mcp

export interface NoteMeta {
  path: string;
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
  outLinks: string[]; // wikilink targets (resolved paths)
  tags: string[];
  createdAt: Date;
  modifiedAt: Date;
}

export interface FreshnessInfo {
  status: "active" | "superseded" | "draft" | "archived";
  supersededBy?: string;
  lastVerified?: string;
  revisionOf?: string;
}

export interface GraphNode {
  path: string;
  title: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  tokenEstimate: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "wikilink" | "tag";
}

export interface SubgraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalTokens: number;
  truncated: boolean;
}

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  score: number;
  neighbors?: string[];
}

export interface WalkResult {
  path: string;
  depth: number;
  title: string;
  tags: string[];
}
```

- [ ] **Step 6: Install dependencies**

Run: `cd /home/mattbot/.openclaw/vault-master-mcp && npm install`

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/types.ts
git commit -m "feat: project scaffold with types, build config, and test setup"
```

---

### Task 2: Frontmatter Parser (TDD)

**Files:**
- Create: `src/parser/frontmatter.ts`
- Create: `tests/parser/frontmatter.test.ts`
- Create: `tests/fixtures/sample-note.md`
- Create: `tests/fixtures/no-frontmatter.md`
- Create: `tests/fixtures/freshness-note.md`

- [ ] **Step 1: Create test fixtures**

`tests/fixtures/sample-note.md`:
```markdown
---
title: "Test Note"
tags: [economics, fed]
status: active
keywords: [inflation, rates]
---

# Test Note

This is a test note with [[wikilink]] and [[another-note|display text]].
```

`tests/fixtures/no-frontmatter.md`:
```markdown
# Plain Note

No frontmatter here. Just [[a-link]].
```

`tests/fixtures/freshness-note.md`:
```markdown
---
title: "Old Analysis"
status: superseded
superseded_by: "analysis/2026-update.md"
last_verified: "2026-01-15"
revision_of: "analysis/original.md"
---

# Old Analysis
This has been superseded.
```

- [ ] **Step 2: Write failing tests**

`tests/parser/frontmatter.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseFrontmatter, extractFreshness } from "../../src/parser/frontmatter.js";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "../fixtures", name), "utf-8");

describe("parseFrontmatter", () => {
  it("extracts frontmatter fields from markdown", () => {
    const result = parseFrontmatter(fixture("sample-note.md"));
    expect(result.data.title).toBe("Test Note");
    expect(result.data.tags).toEqual(["economics", "fed"]);
    expect(result.data.status).toBe("active");
    expect(result.content).toContain("# Test Note");
    expect(result.content).not.toContain("---");
  });

  it("returns empty data for notes without frontmatter", () => {
    const result = parseFrontmatter(fixture("no-frontmatter.md"));
    expect(result.data).toEqual({});
    expect(result.content).toContain("# Plain Note");
  });

  it("preserves all frontmatter keys", () => {
    const result = parseFrontmatter(fixture("sample-note.md"));
    expect(result.data.keywords).toEqual(["inflation", "rates"]);
  });
});

describe("extractFreshness", () => {
  it("extracts freshness fields from frontmatter", () => {
    const { data } = parseFrontmatter(fixture("freshness-note.md"));
    const freshness = extractFreshness(data);
    expect(freshness.status).toBe("superseded");
    expect(freshness.supersededBy).toBe("analysis/2026-update.md");
    expect(freshness.lastVerified).toBe("2026-01-15");
    expect(freshness.revisionOf).toBe("analysis/original.md");
  });

  it("defaults status to active when not specified", () => {
    const freshness = extractFreshness({});
    expect(freshness.status).toBe("active");
  });

  it("handles partial freshness fields", () => {
    const freshness = extractFreshness({ status: "draft" });
    expect(freshness.status).toBe("draft");
    expect(freshness.supersededBy).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/parser/frontmatter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement frontmatter parser**

`src/parser/frontmatter.ts`:
```typescript
import matter from "gray-matter";
import type { FreshnessInfo } from "../types.js";

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  content: string;
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const { data, content } = matter(raw);
  return { data: data ?? {}, content };
}

export function extractFreshness(
  data: Record<string, unknown>
): FreshnessInfo {
  const status = data.status as FreshnessInfo["status"] | undefined;
  return {
    status: status ?? "active",
    supersededBy: data.superseded_by as string | undefined,
    lastVerified: data.last_verified as string | undefined,
    revisionOf: data.revision_of as string | undefined,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/parser/frontmatter.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/parser/ tests/parser/ tests/fixtures/
git commit -m "feat: frontmatter parser with freshness extraction (TDD)"
```

---

### Task 3: Markdown Parser — Wikilink + Tag Extraction (TDD)

**Files:**
- Create: `src/parser/markdown.ts`
- Create: `tests/parser/markdown.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/parser/markdown.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { extractWikilinks, extractTags, estimateTokens } from "../../src/parser/markdown.js";

describe("extractWikilinks", () => {
  it("extracts simple wikilinks", () => {
    const links = extractWikilinks("See [[note-a]] and [[note-b]].");
    expect(links).toEqual(["note-a", "note-b"]);
  });

  it("extracts wikilinks with display text", () => {
    const links = extractWikilinks("Check [[path/to/note|display]].");
    expect(links).toEqual(["path/to/note"]);
  });

  it("extracts wikilinks with heading anchors", () => {
    const links = extractWikilinks("See [[note#section]].");
    expect(links).toEqual(["note"]);
  });

  it("returns empty array for no links", () => {
    const links = extractWikilinks("No links here.");
    expect(links).toEqual([]);
  });

  it("deduplicates links", () => {
    const links = extractWikilinks("[[a]] and [[a]] again.");
    expect(links).toEqual(["a"]);
  });

  it("ignores links inside code blocks", () => {
    const md = "Text\n```\n[[not-a-link]]\n```\nMore [[real-link]].";
    const links = extractWikilinks(md);
    expect(links).toEqual(["real-link"]);
  });
});

describe("extractTags", () => {
  it("extracts inline hashtags", () => {
    const tags = extractTags("This is #economics and #fed-policy.");
    expect(tags).toEqual(["economics", "fed-policy"]);
  });

  it("does not extract tags from code blocks", () => {
    const md = "```\n#not-a-tag\n```\n#real-tag";
    const tags = extractTags(md);
    expect(tags).toEqual(["real-tag"]);
  });

  it("does not extract heading markers as tags", () => {
    const tags = extractTags("# Heading\n## Another\nText #actual-tag");
    expect(tags).toEqual(["actual-tag"]);
  });

  it("deduplicates tags", () => {
    const tags = extractTags("#a #b #a");
    expect(tags).toEqual(["a", "b"]);
  });
});

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    const text = "a".repeat(400);
    const estimate = estimateTokens(text);
    expect(estimate).toBeGreaterThanOrEqual(95);
    expect(estimate).toBeLessThanOrEqual(105);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parser/markdown.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement markdown parser**

`src/parser/markdown.ts`:
```typescript
/**
 * Extracts wikilinks from markdown content.
 * Handles [[note]], [[note|display]], [[note#heading]] formats.
 * Ignores links inside code blocks.
 */
export function extractWikilinks(content: string): string[] {
  const withoutCode = stripCodeBlocks(content);
  const regex = /\[\[([^\]|#]+)(?:[|#][^\]]*)?]]/g;
  const links = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(withoutCode)) !== null) {
    links.add(match[1].trim());
  }
  return [...links];
}

/**
 * Extracts inline #tags from markdown content.
 * Ignores code blocks and heading markers (# at line start).
 */
export function extractTags(content: string): string[] {
  const withoutCode = stripCodeBlocks(content);
  const tags = new Set<string>();
  // Match #tag but not at start of line (heading) and not preceded by &
  const regex = /(?<=\s|^)#([a-zA-Z][a-zA-Z0-9_-]*)/gm;
  for (const line of withoutCode.split("\n")) {
    // Skip heading lines
    if (/^\s*#{1,6}\s/.test(line)) continue;
    let match: RegExpExecArray | null;
    const lineRegex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g;
    while ((match = lineRegex.exec(line)) !== null) {
      tags.add(match[1]);
    }
  }
  return [...tags];
}

/**
 * Rough token estimate: ~4 characters per token.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function stripCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/parser/markdown.test.ts`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/parser/markdown.ts tests/parser/markdown.test.ts
git commit -m "feat: markdown parser with wikilink/tag extraction (TDD)"
```

---

## Chunk 2: SQLite + Graph Engine

### Task 4: SQLite Database Wrapper (TDD)

**Files:**
- Create: `src/db/sqlite.ts`
- Create: `tests/db/sqlite.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/db/sqlite.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VaultDatabase } from "../../src/db/sqlite.js";
import type { NoteMeta } from "../../src/types.js";

let db: VaultDatabase;

beforeEach(() => {
  db = new VaultDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

const sampleNote: NoteMeta = {
  path: "projects/test.md",
  title: "Test Note",
  content: "# Test\nSome content about economics.",
  frontmatter: { status: "active", keywords: ["economics"] },
  outLinks: ["other/note.md"],
  tags: ["economics", "test"],
  createdAt: new Date("2026-01-01"),
  modifiedAt: new Date("2026-03-15"),
};

describe("VaultDatabase", () => {
  it("creates tables on initialization", () => {
    const tables = db.listTables();
    expect(tables).toContain("notes");
    expect(tables).toContain("links");
    expect(tables).toContain("tags");
    expect(tables).toContain("frontmatter");
    expect(tables).toContain("notes_fts");
  });

  it("upserts and retrieves a note", () => {
    db.upsertNote(sampleNote);
    const note = db.getNote("projects/test.md");
    expect(note).not.toBeNull();
    expect(note!.title).toBe("Test Note");
    expect(note!.content).toContain("economics");
  });

  it("stores and retrieves links", () => {
    db.upsertNote(sampleNote);
    const links = db.getOutLinks("projects/test.md");
    expect(links).toEqual(["other/note.md"]);
  });

  it("stores and retrieves tags", () => {
    db.upsertNote(sampleNote);
    const tags = db.getNoteTags("projects/test.md");
    expect(tags).toContain("economics");
    expect(tags).toContain("test");
  });

  it("stores and retrieves frontmatter", () => {
    db.upsertNote(sampleNote);
    const fm = db.getFrontmatter("projects/test.md");
    expect(fm.status).toBe("active");
  });

  it("full-text search returns matching notes", () => {
    db.upsertNote(sampleNote);
    const results = db.searchFTS("economics");
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("projects/test.md");
  });

  it("deletes a note and cascades", () => {
    db.upsertNote(sampleNote);
    db.deleteNote("projects/test.md");
    expect(db.getNote("projects/test.md")).toBeNull();
    expect(db.getOutLinks("projects/test.md")).toEqual([]);
    expect(db.getNoteTags("projects/test.md")).toEqual([]);
  });

  it("upsert updates existing note", () => {
    db.upsertNote(sampleNote);
    db.upsertNote({ ...sampleNote, title: "Updated Title" });
    const note = db.getNote("projects/test.md");
    expect(note!.title).toBe("Updated Title");
  });

  it("lists all note paths", () => {
    db.upsertNote(sampleNote);
    db.upsertNote({ ...sampleNote, path: "other/note.md", title: "Other" });
    const paths = db.getAllPaths();
    expect(paths).toHaveLength(2);
    expect(paths).toContain("projects/test.md");
    expect(paths).toContain("other/note.md");
  });

  it("searches by tag", () => {
    db.upsertNote(sampleNote);
    const paths = db.getNotesByTag("economics");
    expect(paths).toContain("projects/test.md");
  });

  it("gets backlinks (notes linking TO a path)", () => {
    const noteA = { ...sampleNote, path: "a.md", outLinks: ["b.md"] };
    const noteB = { ...sampleNote, path: "b.md", outLinks: [] };
    db.upsertNote(noteA);
    db.upsertNote(noteB);
    const backlinks = db.getBacklinks("b.md");
    expect(backlinks).toEqual(["a.md"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db/sqlite.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SQLite wrapper**

`src/db/sqlite.ts`:
```typescript
import Database from "better-sqlite3";
import type { NoteMeta, SearchResult } from "../types.js";

export class VaultDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT,
        modified_at TEXT
      );

      CREATE TABLE IF NOT EXISTS links (
        from_path TEXT NOT NULL,
        to_path TEXT NOT NULL,
        PRIMARY KEY (from_path, to_path),
        FOREIGN KEY (from_path) REFERENCES notes(path) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tags (
        path TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (path, tag),
        FOREIGN KEY (path) REFERENCES notes(path) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS frontmatter (
        path TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (path, key),
        FOREIGN KEY (path) REFERENCES notes(path) ON DELETE CASCADE
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        path, title, content,
        content='notes',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, path, title, content)
        VALUES (new.rowid, new.path, new.title, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, path, title, content)
        VALUES ('delete', old.rowid, old.path, old.title, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, path, title, content)
        VALUES ('delete', old.rowid, old.path, old.title, old.content);
        INSERT INTO notes_fts(rowid, path, title, content)
        VALUES (new.rowid, new.path, new.title, new.content);
      END;
    `);
  }

  upsertNote(note: NoteMeta): void {
    const upsert = this.db.transaction(() => {
      // Upsert note
      this.db
        .prepare(
          `INSERT INTO notes (path, title, content, created_at, modified_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             title = excluded.title,
             content = excluded.content,
             modified_at = excluded.modified_at`
        )
        .run(
          note.path,
          note.title,
          note.content,
          note.createdAt.toISOString(),
          note.modifiedAt.toISOString()
        );

      // Replace links
      this.db.prepare("DELETE FROM links WHERE from_path = ?").run(note.path);
      const insertLink = this.db.prepare(
        "INSERT OR IGNORE INTO links (from_path, to_path) VALUES (?, ?)"
      );
      for (const link of note.outLinks) {
        insertLink.run(note.path, link);
      }

      // Replace tags
      this.db.prepare("DELETE FROM tags WHERE path = ?").run(note.path);
      const insertTag = this.db.prepare(
        "INSERT OR IGNORE INTO tags (path, tag) VALUES (?, ?)"
      );
      for (const tag of note.tags) {
        insertTag.run(note.path, tag);
      }

      // Replace frontmatter
      this.db
        .prepare("DELETE FROM frontmatter WHERE path = ?")
        .run(note.path);
      const insertFM = this.db.prepare(
        "INSERT INTO frontmatter (path, key, value) VALUES (?, ?, ?)"
      );
      for (const [key, value] of Object.entries(note.frontmatter)) {
        insertFM.run(note.path, key, JSON.stringify(value));
      }
    });
    upsert();
  }

  getNote(path: string): { path: string; title: string; content: string } | null {
    return (
      this.db
        .prepare("SELECT path, title, content FROM notes WHERE path = ?")
        .get(path) as { path: string; title: string; content: string } | undefined
    ) ?? null;
  }

  getOutLinks(path: string): string[] {
    const rows = this.db
      .prepare("SELECT to_path FROM links WHERE from_path = ?")
      .all(path) as { to_path: string }[];
    return rows.map((r) => r.to_path);
  }

  getBacklinks(path: string): string[] {
    const rows = this.db
      .prepare("SELECT from_path FROM links WHERE to_path = ?")
      .all(path) as { from_path: string }[];
    return rows.map((r) => r.from_path);
  }

  getNoteTags(path: string): string[] {
    const rows = this.db
      .prepare("SELECT tag FROM tags WHERE path = ?")
      .all(path) as { tag: string }[];
    return rows.map((r) => r.tag);
  }

  getNotesByTag(tag: string): string[] {
    const rows = this.db
      .prepare("SELECT path FROM tags WHERE tag = ?")
      .all(tag) as { path: string }[];
    return rows.map((r) => r.path);
  }

  getFrontmatter(path: string): Record<string, unknown> {
    const rows = this.db
      .prepare("SELECT key, value FROM frontmatter WHERE path = ?")
      .all(path) as { key: string; value: string }[];
    const fm: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        fm[row.key] = JSON.parse(row.value);
      } catch {
        fm[row.key] = row.value;
      }
    }
    return fm;
  }

  searchFTS(query: string, limit = 20): SearchResult[] {
    const rows = this.db
      .prepare(
        `SELECT path, title, snippet(notes_fts, 2, '<b>', '</b>', '...', 32) as snippet,
                rank
         FROM notes_fts
         WHERE notes_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(query, limit) as { path: string; title: string; snippet: string; rank: number }[];
    return rows.map((r) => ({
      path: r.path,
      title: r.title,
      snippet: r.snippet,
      score: -r.rank, // FTS5 rank is negative (lower = better)
    }));
  }

  deleteNote(path: string): void {
    this.db.prepare("DELETE FROM notes WHERE path = ?").run(path);
  }

  getAllPaths(): string[] {
    const rows = this.db
      .prepare("SELECT path FROM notes")
      .all() as { path: string }[];
    return rows.map((r) => r.path);
  }

  listTables(): string[] {
    const rows = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'"
      )
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db/sqlite.test.ts`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/db/sqlite.ts tests/db/sqlite.test.ts
git commit -m "feat: SQLite wrapper with FTS5, CRUD, and cascading deletes (TDD)"
```

---

### Task 5: In-Memory Graph Engine (TDD)

**Files:**
- Create: `src/graph/engine.ts`
- Create: `tests/graph/engine.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/graph/engine.test.ts`:
```typescript
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
    // Budget only fits ~1 node, should be truncated
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/graph/engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement graph engine**

`src/graph/engine.ts`:
```typescript
import type { GraphNode, GraphEdge, SubgraphResult, WalkResult } from "../types.js";

export class GraphEngine {
  private nodes: Map<string, GraphNode> = new Map();
  private outLinks: Map<string, Set<string>> = new Map();
  private inLinks: Map<string, Set<string>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();

  addNode(node: GraphNode): void {
    this.nodes.set(node.path, node);
    if (!this.outLinks.has(node.path)) {
      this.outLinks.set(node.path, new Set());
    }
    if (!this.inLinks.has(node.path)) {
      this.inLinks.set(node.path, new Set());
    }
    // Index tags
    for (const tag of node.tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(node.path);
    }
  }

  removeNode(path: string): void {
    const node = this.nodes.get(path);
    if (!node) return;

    // Remove from tag index
    for (const tag of node.tags) {
      this.tagIndex.get(tag)?.delete(path);
    }

    // Remove outgoing edges
    const outgoing = this.outLinks.get(path);
    if (outgoing) {
      for (const target of outgoing) {
        this.inLinks.get(target)?.delete(path);
      }
    }

    // Remove incoming edges
    const incoming = this.inLinks.get(path);
    if (incoming) {
      for (const source of incoming) {
        this.outLinks.get(source)?.delete(path);
      }
    }

    this.outLinks.delete(path);
    this.inLinks.delete(path);
    this.nodes.delete(path);
  }

  addEdge(from: string, to: string, type: "wikilink" | "tag"): void {
    if (!this.outLinks.has(from)) {
      this.outLinks.set(from, new Set());
    }
    if (!this.inLinks.has(to)) {
      this.inLinks.set(to, new Set());
    }
    this.outLinks.get(from)!.add(to);
    this.inLinks.get(to)!.add(from);
  }

  getNode(path: string): GraphNode | null {
    return this.nodes.get(path) ?? null;
  }

  getOutLinks(path: string): string[] {
    return [...(this.outLinks.get(path) ?? [])];
  }

  getInLinks(path: string): string[] {
    return [...(this.inLinks.get(path) ?? [])];
  }

  getNeighborhood(path: string): string[] {
    const out = this.outLinks.get(path) ?? new Set<string>();
    const inc = this.inLinks.get(path) ?? new Set<string>();
    const all = new Set([...out, ...inc]);
    return [...all];
  }

  getByTag(tag: string): string[] {
    return [...(this.tagIndex.get(tag) ?? [])];
  }

  /**
   * Breadth-first traversal from start node.
   * Returns visited nodes with depth info.
   */
  bfs(start: string, maxDepth: number): WalkResult[] {
    const results: WalkResult[] = [];
    const visited = new Set<string>();
    const queue: { path: string; depth: number }[] = [{ path: start, depth: 0 }];

    while (queue.length > 0) {
      const { path, depth } = queue.shift()!;
      if (visited.has(path)) continue;
      visited.add(path);

      const node = this.nodes.get(path);
      if (node) {
        results.push({
          path: node.path,
          depth,
          title: node.title,
          tags: node.tags,
        });
      }

      if (depth < maxDepth) {
        const neighbors = this.getNeighborhood(path);
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push({ path: neighbor, depth: depth + 1 });
          }
        }
      }
    }

    return results;
  }

  /**
   * Extract a subgraph within a token budget.
   * Uses BFS from start, adding nodes until budget is exhausted.
   */
  getSubgraph(
    start: string,
    tokenBudget: number,
    maxDepth: number
  ): SubgraphResult {
    const included = new Set<string>();
    const resultNodes: GraphNode[] = [];
    let totalTokens = 0;
    let truncated = false;

    const visited = new Set<string>();
    const queue: { path: string; depth: number }[] = [{ path: start, depth: 0 }];

    while (queue.length > 0) {
      const { path, depth } = queue.shift()!;
      if (visited.has(path)) continue;
      visited.add(path);

      const node = this.nodes.get(path);
      if (!node) continue;

      if (totalTokens + node.tokenEstimate > tokenBudget) {
        truncated = true;
        continue;
      }

      totalTokens += node.tokenEstimate;
      included.add(path);
      resultNodes.push(node);

      if (depth < maxDepth) {
        const neighbors = this.getNeighborhood(path);
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push({ path: neighbor, depth: depth + 1 });
          }
        }
      }
    }

    // Collect edges between included nodes
    const edges: GraphEdge[] = [];
    for (const path of included) {
      for (const target of this.outLinks.get(path) ?? []) {
        if (included.has(target)) {
          edges.push({ from: path, to: target, type: "wikilink" });
        }
      }
    }

    return { nodes: resultNodes, edges, totalTokens, truncated };
  }

  /** Total number of nodes in the graph */
  get size(): number {
    return this.nodes.size;
  }

  /** Clear all data */
  clear(): void {
    this.nodes.clear();
    this.outLinks.clear();
    this.inLinks.clear();
    this.tagIndex.clear();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/graph/engine.test.ts`
Expected: All 15 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph/engine.ts tests/graph/engine.test.ts
git commit -m "feat: in-memory graph engine with BFS, subgraph, tag index (TDD)"
```

---

## Chunk 3: Indexer + MCP Server

### Task 6: Vault Indexer — Full Scan + Link Resolution (TDD)

**Files:**
- Create: `src/graph/indexer.ts`
- Create: `tests/graph/indexer.test.ts`
- Create: `tests/fixtures/vault/` (test vault directory)

- [ ] **Step 1: Create test vault fixture**

Create a minimal vault structure:

`tests/fixtures/vault/projects/alpha.md`:
```markdown
---
title: "Project Alpha"
tags: [active, engineering]
status: active
---

# Project Alpha

Working with [[team/bob]] on the [[reports/q1-summary]] deliverable.
Also see #engineering notes.
```

`tests/fixtures/vault/team/bob.md`:
```markdown
---
title: "Bob"
tags: [team]
---

# Bob

Team member on [[projects/alpha]].
```

`tests/fixtures/vault/reports/q1-summary.md`:
```markdown
---
title: "Q1 Summary"
status: draft
---

# Q1 Summary

Covers [[projects/alpha]] progress.
```

- [ ] **Step 2: Write failing tests**

`tests/graph/indexer.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { VaultIndexer } from "../../src/graph/indexer.js";
import { VaultDatabase } from "../../src/db/sqlite.js";
import { GraphEngine } from "../../src/graph/engine.js";

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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/graph/indexer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement vault indexer**

`src/graph/indexer.ts`:
```typescript
import { readFile, stat } from "fs/promises";
import { join, relative, basename } from "path";
import { glob } from "glob";
import { parseFrontmatter } from "../parser/frontmatter.js";
import { extractWikilinks, extractTags, estimateTokens } from "../parser/markdown.js";
import type { VaultDatabase } from "../db/sqlite.js";
import type { GraphEngine } from "./engine.js";
import type { NoteMeta, GraphNode } from "../types.js";

export class VaultIndexer {
  constructor(
    private vaultPath: string,
    private db: VaultDatabase,
    private graph: GraphEngine
  ) {}

  /**
   * Scan all .md files in the vault and index them.
   */
  async fullScan(): Promise<void> {
    const pattern = join(this.vaultPath, "**/*.md");
    const files = await glob(pattern, { nodir: true });

    // First pass: parse all files
    const notes: NoteMeta[] = [];
    for (const absPath of files) {
      const note = await this.parseFile(absPath);
      if (note) notes.push(note);
    }

    // Build path lookup for wikilink resolution
    const pathMap = this.buildPathMap(notes.map((n) => n.path));

    // Second pass: resolve wikilinks and persist
    for (const note of notes) {
      note.outLinks = this.resolveLinks(note.outLinks, pathMap);
      this.persistNote(note);
    }
  }

  /**
   * Index a single file (incremental update).
   */
  async indexFile(relativePath: string): Promise<void> {
    const absPath = join(this.vaultPath, relativePath);
    const note = await this.parseFile(absPath);
    if (!note) return;

    // Resolve links against all known paths
    const allPaths = this.db.getAllPaths();
    const pathMap = this.buildPathMap(allPaths);
    note.outLinks = this.resolveLinks(note.outLinks, pathMap);

    this.persistNote(note);
  }

  /**
   * Remove a file from the index.
   */
  removeFile(relativePath: string): void {
    this.db.deleteNote(relativePath);
    this.graph.removeNode(relativePath);
  }

  private async parseFile(absPath: string): Promise<NoteMeta | null> {
    try {
      const raw = await readFile(absPath, "utf-8");
      const fileStat = await stat(absPath);
      const relPath = relative(this.vaultPath, absPath);
      const { data, content } = parseFrontmatter(raw);

      const title =
        (data.title as string) ??
        basename(relPath, ".md");

      const rawLinks = extractWikilinks(content);
      const inlineTags = extractTags(content);
      const frontmatterTags = Array.isArray(data.tags)
        ? (data.tags as string[])
        : [];
      const allTags = [...new Set([...frontmatterTags, ...inlineTags])];

      return {
        path: relPath,
        title,
        content: raw,
        frontmatter: data,
        outLinks: rawLinks, // unresolved — will be resolved later
        tags: allTags,
        createdAt: fileStat.birthtime,
        modifiedAt: fileStat.mtime,
      };
    } catch {
      return null;
    }
  }

  /**
   * Build a map from filename (without extension) to full relative path.
   * Used for resolving wikilinks like [[bob]] to team/bob.md.
   */
  private buildPathMap(paths: string[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const p of paths) {
      // Map by full path (without .md)
      map.set(p.replace(/\.md$/, ""), p);
      // Map by filename only (for short wikilinks)
      const name = basename(p, ".md");
      if (!map.has(name)) {
        map.set(name, p);
      }
    }
    return map;
  }

  /**
   * Resolve raw wikilink targets to actual vault paths.
   */
  private resolveLinks(
    rawLinks: string[],
    pathMap: Map<string, string>
  ): string[] {
    const resolved: string[] = [];
    for (const link of rawLinks) {
      // Try exact match first, then with .md
      const match =
        pathMap.get(link) ??
        pathMap.get(link.replace(/\.md$/, "")) ??
        null;
      if (match) {
        resolved.push(match);
      }
      // Unresolved links are silently dropped (dangling wikilinks)
    }
    return resolved;
  }

  private persistNote(note: NoteMeta): void {
    // Persist to SQLite
    this.db.upsertNote(note);

    // Add to graph
    const graphNode: GraphNode = {
      path: note.path,
      title: note.title,
      tags: note.tags,
      frontmatter: note.frontmatter,
      tokenEstimate: estimateTokens(note.content),
    };

    // Remove old edges first (for re-index)
    this.graph.removeNode(note.path);
    this.graph.addNode(graphNode);

    for (const target of note.outLinks) {
      this.graph.addEdge(note.path, target, "wikilink");
    }
  }
}
```

Note: Add `glob` as a dependency:
```bash
npm install glob && npm install -D @types/glob
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/graph/indexer.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/graph/indexer.ts tests/graph/indexer.test.ts tests/fixtures/vault/
git commit -m "feat: vault indexer with full scan, link resolution, incremental update (TDD)"
```

---

### Task 7: MCP Server — Discovery Tools (TDD)

**Files:**
- Create: `src/server.ts`
- Create: `src/tools/discovery.ts`
- Create: `tests/tools/discovery.test.ts`

- [ ] **Step 1: Write failing tests for discovery tools**

`tests/tools/discovery.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/discovery.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement discovery tool handlers**

`src/tools/discovery.ts`:
```typescript
import type { VaultDatabase } from "../db/sqlite.js";
import type { GraphEngine } from "../graph/engine.js";
import type { SearchResult, WalkResult } from "../types.js";

export interface SearchVaultArgs {
  query: string;
  limit?: number;
  include_neighbors?: boolean;
}

export interface FindRelatedArgs {
  note_path?: string;
  topic?: string;
  depth?: number;
  max_results?: number;
}

export interface ListNotesArgs {
  folder?: string;
  tag?: string;
  has_frontmatter_key?: string;
}

export function handleSearchVault(
  db: VaultDatabase,
  graph: GraphEngine,
  args: SearchVaultArgs
): SearchResult[] {
  const limit = args.limit ?? 20;
  const results = db.searchFTS(args.query, limit);

  if (args.include_neighbors) {
    for (const result of results) {
      result.neighbors = graph.getNeighborhood(result.path);
    }
  }

  return results;
}

export function handleFindRelated(
  graph: GraphEngine,
  args: FindRelatedArgs
): WalkResult[] {
  const depth = args.depth ?? 2;
  const maxResults = args.max_results ?? 20;

  if (args.note_path) {
    const walked = graph.bfs(args.note_path, depth);
    // Exclude the start node itself
    return walked.filter((r) => r.path !== args.note_path).slice(0, maxResults);
  }

  if (args.topic) {
    // Find by tag
    const tagged = graph.getByTag(args.topic);
    return tagged.slice(0, maxResults).map((path) => {
      const node = graph.getNode(path);
      return {
        path,
        depth: 0,
        title: node?.title ?? path,
        tags: node?.tags ?? [],
      };
    });
  }

  return [];
}

export function handleListNotes(
  db: VaultDatabase,
  args: ListNotesArgs
): { path: string; title: string }[] {
  if (args.tag) {
    const paths = db.getNotesByTag(args.tag);
    return paths.map((path) => {
      const note = db.getNote(path);
      return { path, title: note?.title ?? path };
    });
  }

  const allPaths = db.getAllPaths();
  let filtered = allPaths;

  if (args.folder) {
    filtered = filtered.filter((p) => p.startsWith(args.folder!));
  }

  if (args.has_frontmatter_key) {
    filtered = filtered.filter((p) => {
      const fm = db.getFrontmatter(p);
      return args.has_frontmatter_key! in fm;
    });
  }

  return filtered.map((path) => {
    const note = db.getNote(path);
    return { path, title: note?.title ?? path };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/discovery.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/discovery.ts tests/tools/discovery.test.ts
git commit -m "feat: discovery tools - search_vault, find_related, list_notes (TDD)"
```

---

### Task 8: MCP Server Setup + Entry Point

**Files:**
- Create: `src/server.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Create MCP server with tool registration**

`src/server.ts`:
```typescript
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
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
```

- [ ] **Step 2: Create entry point**

`src/index.ts`:
```typescript
#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join } from "path";
import { VaultDatabase } from "./db/sqlite.js";
import { GraphEngine } from "./graph/engine.js";
import { VaultIndexer } from "./graph/indexer.js";
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

  // Create and start MCP server
  const server = createServer(db, graph);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[vault-master] MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Build and verify**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/index.ts
git commit -m "feat: MCP server setup with discovery tools and CLI entry point"
```

---

## Chunk 4: Context Assembly + Write-back + File Watcher

### Task 9: Context Assembly Tools (TDD)

**Files:**
- Create: `src/tools/context.ts`
- Create: `tests/tools/context.test.ts`

**Tools to implement:**
- `read_note` — read with metadata, backlinks, freshness info
- `get_graph_context` — optimal subgraph within token budget
- `walk_graph` — BFS/DFS traversal

**Implementation approach:**
- `read_note`: read from DB, attach backlinks from graph, extract freshness from frontmatter
- `get_graph_context`: delegate to `graph.getSubgraph()`, format result with node summaries
- `walk_graph`: delegate to `graph.bfs()`, format as list with depth info

Register all three tools in `server.ts`.

- [ ] **Step 1: Write failing tests for read_note, get_graph_context, walk_graph**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement context tool handlers**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Register tools in server.ts**
- [ ] **Step 6: Commit**

---

### Task 10: Write-back Tools (TDD)

**Files:**
- Create: `src/tools/write.ts`
- Create: `tests/tools/write.test.ts`

**Tools to implement:**
- `create_note` — create with frontmatter + wikilinks, write to disk
- `update_note` — modify content or frontmatter, write to disk
- `add_links` — add wikilinks to a note, write to disk
- `mark_superseded` — update frontmatter status, write to disk

**Implementation approach:**
- All write tools modify the file on disk, then re-index through the indexer
- `create_note`: serialize frontmatter with gray-matter, write file, index
- `update_note`: read existing, merge changes, write, re-index
- `add_links`: append wikilinks to note body, re-index
- `mark_superseded`: update frontmatter `status` and `superseded_by`, re-index

Register all four tools in `server.ts`.

- [ ] **Step 1: Write failing tests for create_note, update_note, add_links, mark_superseded**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement write tool handlers**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Register tools in server.ts**
- [ ] **Step 6: Commit**

---

### Task 11: File Watcher (TDD)

**Files:**
- Create: `src/graph/watcher.ts`
- Create: `tests/graph/watcher.test.ts`

**Implementation approach:**
- Use chokidar to watch `vaultPath/**/*.md`
- On `add`/`change`: call `indexer.indexFile(relativePath)`
- On `unlink`: call `indexer.removeFile(relativePath)`
- Debounce rapid changes (100ms)
- Wire into `index.ts` after initial scan

- [ ] **Step 1: Write failing tests for watcher events**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement file watcher**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Wire watcher into index.ts**
- [ ] **Step 6: Commit**

---

### Task 12: README + Final Integration

**Files:**
- Create: `README.md`
- Modify: `package.json` (add bin field, repository URL)

**README sections:**
- What it does (graph-aware MCP for Obsidian)
- Quick start (`npx vault-master-mcp --vault ~/my-vault`)
- Available tools (table of all 10)
- Claude Desktop config example
- Architecture diagram (text)
- Development setup

- [ ] **Step 1: Write README**
- [ ] **Step 2: Update package.json with repository and bin**
- [ ] **Step 3: Full test suite run**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: Clean compile

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete vault-master-mcp v0.1.0 MVP"
```

- [ ] **Step 6: Push to GitHub**

```bash
git push origin main
```
