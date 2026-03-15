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

  it("handles malformed FTS5 queries without crashing", () => {
    db.upsertNote(sampleNote);
    // These would crash raw FTS5 — sanitization prevents the crash
    expect(() => db.searchFTS("(")).not.toThrow();
    expect(() => db.searchFTS("note:")).not.toThrow();
    expect(() => db.searchFTS("AND OR NOT")).not.toThrow();
    expect(() => db.searchFTS("))()(")).not.toThrow();
    expect(() => db.searchFTS("")).not.toThrow();
  });

  it("FTS search still works with normal queries after sanitization", () => {
    db.upsertNote(sampleNote);
    const results = db.searchFTS("economics");
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("projects/test.md");
  });
});
