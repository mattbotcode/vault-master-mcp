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
    // Sanitize for FTS5: wrap each word in double quotes to force literal matching,
    // strip characters that have special FTS5 meaning
    const safeQuery = query
      .replace(/[":(){}*^~]/g, " ")  // strip FTS5 operators
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => `"${word}"`)
      .join(" ")
      || '""';  // empty query fallback
    try {
      const rows = this.db
        .prepare(
          `SELECT path, title, snippet(notes_fts, 2, '<b>', '</b>', '...', 32) as snippet,
                  rank
           FROM notes_fts
           WHERE notes_fts MATCH ?
           ORDER BY rank
           LIMIT ?`
        )
        .all(safeQuery, limit) as { path: string; title: string; snippet: string; rank: number }[];
      return rows.map((r) => ({
        path: r.path,
        title: r.title,
        snippet: r.snippet,
        score: -r.rank,
      }));
    } catch {
      // Malformed FTS5 query — return empty results
      return [];
    }
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
