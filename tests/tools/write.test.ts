import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { VaultDatabase } from "../../src/db/sqlite.js";
import { GraphEngine } from "../../src/graph/engine.js";
import { VaultIndexer } from "../../src/graph/indexer.js";
import {
  handleCreateNote,
  handleUpdateNote,
  handleAddLinks,
  handleMarkSuperseded,
} from "../../src/tools/write.js";
import type { WriteToolContext } from "../../src/tools/write.js";

let tmpDir: string;
let db: VaultDatabase;
let graph: GraphEngine;
let indexer: VaultIndexer;
let ctx: WriteToolContext;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "vault-master-test-"));
  db = new VaultDatabase(":memory:");
  graph = new GraphEngine();
  indexer = new VaultIndexer(tmpDir, db, graph);
  ctx = { vaultPath: tmpDir, db, graph, indexer };
});

afterEach(async () => {
  db.close();
  await rm(tmpDir, { recursive: true, force: true });
});

// ============================================================
// create_note tests
// ============================================================

describe("create_note", () => {
  it("creates file on disk with content", async () => {
    const result = await handleCreateNote(ctx, {
      path: "notes/hello.md",
      content: "Hello, world!",
    });

    expect(result.success).toBe(true);

    const diskContent = await readFile(join(tmpDir, "notes/hello.md"), "utf-8");
    expect(diskContent).toContain("Hello, world!");
  });

  it("creates file with frontmatter serialized correctly", async () => {
    const result = await handleCreateNote(ctx, {
      path: "notes/tagged.md",
      content: "Some content here.",
      frontmatter: { status: "active", tags: ["test", "notes"] },
    });

    expect(result.success).toBe(true);

    const diskContent = await readFile(join(tmpDir, "notes/tagged.md"), "utf-8");
    expect(diskContent).toContain("status: active");
    expect(diskContent).toContain("tags:");
    expect(diskContent).toContain("Some content here.");
  });

  it("re-indexes the note into DB after creation", async () => {
    await handleCreateNote(ctx, {
      path: "notes/indexed.md",
      content: "Indexed content.",
      frontmatter: { title: "Indexed Note" },
    });

    const note = db.getNote("notes/indexed.md");
    expect(note).not.toBeNull();
    expect(note!.path).toBe("notes/indexed.md");
  });

  it("re-indexes the note into graph after creation", async () => {
    await handleCreateNote(ctx, {
      path: "notes/graph-node.md",
      content: "Graph node content.",
    });

    const node = graph.getNode("notes/graph-node.md");
    expect(node).not.toBeNull();
  });

  it("creates parent directories if needed", async () => {
    const result = await handleCreateNote(ctx, {
      path: "deep/nested/dir/note.md",
      content: "Deep note.",
    });

    expect(result.success).toBe(true);

    const diskContent = await readFile(
      join(tmpDir, "deep/nested/dir/note.md"),
      "utf-8"
    );
    expect(diskContent).toContain("Deep note.");
  });

  it("appends See also wikilinks when link_to provided", async () => {
    await handleCreateNote(ctx, {
      path: "notes/source.md",
      content: "Source note.",
      link_to: ["notes/target.md", "notes/other.md"],
    });

    const diskContent = await readFile(join(tmpDir, "notes/source.md"), "utf-8");
    expect(diskContent).toContain("See also:");
    expect(diskContent).toContain("[[notes/target.md]]");
    expect(diskContent).toContain("[[notes/other.md]]");
  });

  it("returns error when path is empty", async () => {
    const result = await handleCreateNote(ctx, {
      path: "",
      content: "content",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ============================================================
// update_note tests
// ============================================================

describe("update_note", () => {
  beforeEach(async () => {
    // Create a note to update
    await handleCreateNote(ctx, {
      path: "notes/to-update.md",
      content: "Original content.",
      frontmatter: { status: "draft", title: "Original Title" },
    });
  });

  it("updates body content while preserving frontmatter", async () => {
    const result = await handleUpdateNote(ctx, {
      path: "notes/to-update.md",
      content: "Updated content.",
    });

    expect(result.success).toBe(true);

    const diskContent = await readFile(
      join(tmpDir, "notes/to-update.md"),
      "utf-8"
    );
    expect(diskContent).toContain("Updated content.");
    // Frontmatter keys should still be present
    expect(diskContent).toContain("status: draft");
    expect(diskContent).toContain("title: Original Title");
    // Old content gone
    expect(diskContent).not.toContain("Original content.");
  });

  it("merges frontmatter_updates without losing existing keys", async () => {
    const result = await handleUpdateNote(ctx, {
      path: "notes/to-update.md",
      frontmatter_updates: { status: "active", new_key: "new_value" },
    });

    expect(result.success).toBe(true);

    const diskContent = await readFile(
      join(tmpDir, "notes/to-update.md"),
      "utf-8"
    );
    // Updated key
    expect(diskContent).toContain("status: active");
    // New key added
    expect(diskContent).toContain("new_key: new_value");
    // Pre-existing key preserved
    expect(diskContent).toContain("title: Original Title");
    // Body content preserved
    expect(diskContent).toContain("Original content.");
  });

  it("can update both content and frontmatter simultaneously", async () => {
    const result = await handleUpdateNote(ctx, {
      path: "notes/to-update.md",
      content: "New body.",
      frontmatter_updates: { status: "active" },
    });

    expect(result.success).toBe(true);

    const diskContent = await readFile(
      join(tmpDir, "notes/to-update.md"),
      "utf-8"
    );
    expect(diskContent).toContain("New body.");
    expect(diskContent).toContain("status: active");
  });

  it("re-indexes after update", async () => {
    await handleUpdateNote(ctx, {
      path: "notes/to-update.md",
      content: "Re-indexed content with unique_marker_xyz.",
    });

    const note = db.getNote("notes/to-update.md");
    expect(note).not.toBeNull();
    expect(note!.content).toContain("unique_marker_xyz");
  });

  it("returns error for non-existent note", async () => {
    const result = await handleUpdateNote(ctx, {
      path: "notes/does-not-exist.md",
      content: "Some content.",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ============================================================
// add_links tests
// ============================================================

describe("add_links", () => {
  beforeEach(async () => {
    await handleCreateNote(ctx, {
      path: "notes/source.md",
      content: "This is the source note.",
    });
    await handleCreateNote(ctx, {
      path: "notes/existing-related.md",
      content: "A note with an existing Related section.\n\n## Related\n- [[notes/old-link.md]]\n",
    });
  });

  it("appends a Related section with wikilinks", async () => {
    const result = await handleAddLinks(ctx, {
      from: "notes/source.md",
      to: ["notes/target-a.md", "notes/target-b.md"],
    });

    expect(result.success).toBe(true);

    const diskContent = await readFile(
      join(tmpDir, "notes/source.md"),
      "utf-8"
    );
    expect(diskContent).toContain("## Related");
    expect(diskContent).toContain("- [[notes/target-a.md]]");
    expect(diskContent).toContain("- [[notes/target-b.md]]");
  });

  it("appends to existing Related section without creating a duplicate", async () => {
    const result = await handleAddLinks(ctx, {
      from: "notes/existing-related.md",
      to: ["notes/new-link.md"],
    });

    expect(result.success).toBe(true);

    const diskContent = await readFile(
      join(tmpDir, "notes/existing-related.md"),
      "utf-8"
    );

    // Should only have one ## Related heading
    const relatedCount = (diskContent.match(/## Related/g) ?? []).length;
    expect(relatedCount).toBe(1);

    // Should contain both old and new links
    expect(diskContent).toContain("- [[notes/old-link.md]]");
    expect(diskContent).toContain("- [[notes/new-link.md]]");
  });

  it("re-indexes after adding links", async () => {
    await handleAddLinks(ctx, {
      from: "notes/source.md",
      to: ["notes/target-a.md"],
    });

    const note = db.getNote("notes/source.md");
    expect(note).not.toBeNull();
    // Content should reflect the updated file
    expect(note!.content).toContain("## Related");
  });

  it("returns error for non-existent from note", async () => {
    const result = await handleAddLinks(ctx, {
      from: "notes/no-such-note.md",
      to: ["notes/target.md"],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ============================================================
// mark_superseded tests
// ============================================================

describe("mark_superseded", () => {
  beforeEach(async () => {
    await handleCreateNote(ctx, {
      path: "notes/old-note.md",
      content: "This note will be superseded.",
      frontmatter: { status: "active", title: "Old Note" },
    });
  });

  it("updates frontmatter status to superseded", async () => {
    const result = await handleMarkSuperseded(ctx, {
      old_path: "notes/old-note.md",
      new_path: "notes/new-note.md",
    });

    expect(result.success).toBe(true);

    const diskContent = await readFile(
      join(tmpDir, "notes/old-note.md"),
      "utf-8"
    );
    expect(diskContent).toContain("status: superseded");
  });

  it("adds superseded_by frontmatter key", async () => {
    await handleMarkSuperseded(ctx, {
      old_path: "notes/old-note.md",
      new_path: "notes/new-note.md",
    });

    const diskContent = await readFile(
      join(tmpDir, "notes/old-note.md"),
      "utf-8"
    );
    expect(diskContent).toContain("superseded_by: notes/new-note.md");
  });

  it("adds reason to frontmatter when provided", async () => {
    await handleMarkSuperseded(ctx, {
      old_path: "notes/old-note.md",
      new_path: "notes/new-note.md",
      reason: "Replaced by updated analysis",
    });

    const diskContent = await readFile(
      join(tmpDir, "notes/old-note.md"),
      "utf-8"
    );
    expect(diskContent).toContain("Replaced by updated analysis");
  });

  it("preserves other frontmatter keys", async () => {
    await handleMarkSuperseded(ctx, {
      old_path: "notes/old-note.md",
      new_path: "notes/new-note.md",
    });

    const diskContent = await readFile(
      join(tmpDir, "notes/old-note.md"),
      "utf-8"
    );
    expect(diskContent).toContain("title: Old Note");
  });

  it("preserves note body content", async () => {
    await handleMarkSuperseded(ctx, {
      old_path: "notes/old-note.md",
      new_path: "notes/new-note.md",
    });

    const diskContent = await readFile(
      join(tmpDir, "notes/old-note.md"),
      "utf-8"
    );
    expect(diskContent).toContain("This note will be superseded.");
  });

  it("re-indexes after marking superseded", async () => {
    await handleMarkSuperseded(ctx, {
      old_path: "notes/old-note.md",
      new_path: "notes/new-note.md",
    });

    const fm = db.getFrontmatter("notes/old-note.md");
    expect(fm.status).toBe("superseded");
    expect(fm.superseded_by).toBe("notes/new-note.md");
  });

  it("returns error for non-existent old note", async () => {
    const result = await handleMarkSuperseded(ctx, {
      old_path: "notes/no-such.md",
      new_path: "notes/new-note.md",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
