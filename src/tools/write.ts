import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import matter from "gray-matter";
import type { VaultDatabase } from "../db/sqlite.js";
import type { GraphEngine } from "../graph/engine.js";
import type { VaultIndexer } from "../graph/indexer.js";

export interface WriteToolContext {
  vaultPath: string;
  db: VaultDatabase;
  graph: GraphEngine;
  indexer: VaultIndexer;
}

export interface WriteResult {
  success: boolean;
  error?: string;
}

// ============================================================
// create_note
// ============================================================

export interface CreateNoteArgs {
  path: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  link_to?: string[];
}

export async function handleCreateNote(
  ctx: WriteToolContext,
  args: CreateNoteArgs
): Promise<WriteResult> {
  if (!args.path) {
    return { success: false, error: "path is required" };
  }

  try {
    const absPath = join(ctx.vaultPath, args.path);

    // Create parent directories if needed
    await mkdir(dirname(absPath), { recursive: true });

    // Build file content: frontmatter + body
    let body = args.content;

    // Append "See also" wikilinks if link_to provided
    if (args.link_to && args.link_to.length > 0) {
      const links = args.link_to.map((l) => `[[${l}]]`).join(", ");
      body = `${body}\n\nSee also: ${links}`;
    }

    // Serialize with gray-matter
    const fileContent =
      args.frontmatter && Object.keys(args.frontmatter).length > 0
        ? matter.stringify(body, args.frontmatter as Record<string, string>)
        : body;

    await writeFile(absPath, fileContent, "utf-8");

    // Re-index
    await ctx.indexer.indexFile(args.path);

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// update_note
// ============================================================

export interface UpdateNoteArgs {
  path: string;
  content?: string;
  frontmatter_updates?: Record<string, unknown>;
}

export async function handleUpdateNote(
  ctx: WriteToolContext,
  args: UpdateNoteArgs
): Promise<WriteResult> {
  try {
    const absPath = join(ctx.vaultPath, args.path);

    // Read existing file — will throw if missing
    let raw: string;
    try {
      raw = await readFile(absPath, "utf-8");
    } catch {
      return { success: false, error: `Note not found: ${args.path}` };
    }

    // Parse existing content
    const parsed = matter(raw);
    let frontmatter = parsed.data as Record<string, unknown>;
    let body = parsed.content;

    // Apply updates
    if (args.content !== undefined) {
      body = args.content;
    }

    if (args.frontmatter_updates) {
      frontmatter = { ...frontmatter, ...args.frontmatter_updates };
    }

    // Write back
    const fileContent =
      Object.keys(frontmatter).length > 0
        ? matter.stringify(body, frontmatter as Record<string, string>)
        : body;

    await writeFile(absPath, fileContent, "utf-8");

    // Re-index
    await ctx.indexer.indexFile(args.path);

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// add_links
// ============================================================

export interface AddLinksArgs {
  from: string;
  to: string[];
}

export async function handleAddLinks(
  ctx: WriteToolContext,
  args: AddLinksArgs
): Promise<WriteResult> {
  try {
    const absPath = join(ctx.vaultPath, args.from);

    let raw: string;
    try {
      raw = await readFile(absPath, "utf-8");
    } catch {
      return { success: false, error: `Note not found: ${args.from}` };
    }

    const newLinks = args.to.map((t) => `- [[${t}]]`).join("\n");

    let updated: string;
    if (raw.includes("## Related")) {
      // Append to existing Related section
      updated = raw.trimEnd() + "\n" + newLinks + "\n";
    } else {
      // Create new Related section
      updated = raw.trimEnd() + "\n\n## Related\n" + newLinks + "\n";
    }

    await writeFile(absPath, updated, "utf-8");

    // Re-index
    await ctx.indexer.indexFile(args.from);

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// mark_superseded
// ============================================================

export interface MarkSupersededArgs {
  old_path: string;
  new_path: string;
  reason?: string;
}

export async function handleMarkSuperseded(
  ctx: WriteToolContext,
  args: MarkSupersededArgs
): Promise<WriteResult> {
  try {
    const absPath = join(ctx.vaultPath, args.old_path);

    let raw: string;
    try {
      raw = await readFile(absPath, "utf-8");
    } catch {
      return { success: false, error: `Note not found: ${args.old_path}` };
    }

    const parsed = matter(raw);
    const frontmatter = parsed.data as Record<string, unknown>;
    const body = parsed.content;

    // Update frontmatter
    frontmatter.status = "superseded";
    frontmatter.superseded_by = args.new_path;
    if (args.reason !== undefined) {
      frontmatter.superseded_reason = args.reason;
    }

    const fileContent = matter.stringify(
      body,
      frontmatter as Record<string, string>
    );

    await writeFile(absPath, fileContent, "utf-8");

    // Re-index
    await ctx.indexer.indexFile(args.old_path);

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
