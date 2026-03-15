import { readFile, stat } from "fs/promises";
import { join, relative, basename } from "path";
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

  async fullScan(): Promise<void> {
    // Use fs to find all .md files recursively
    const files = await this.findMarkdownFiles(this.vaultPath);

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

  async indexFile(relativePath: string): Promise<void> {
    const absPath = join(this.vaultPath, relativePath);
    const note = await this.parseFile(absPath);
    if (!note) return;

    const allPaths = this.db.getAllPaths();
    const pathMap = this.buildPathMap(allPaths);
    note.outLinks = this.resolveLinks(note.outLinks, pathMap);

    this.persistNote(note);
  }

  removeFile(relativePath: string): void {
    this.db.deleteNote(relativePath);
    this.graph.removeNode(relativePath);
  }

  private async findMarkdownFiles(dir: string): Promise<string[]> {
    const { readdir } = await import("fs/promises");
    const results: string[] = [];

    const SKIP_DIRS = new Set([".obsidian", ".git", "node_modules", ".trash"]);

    async function walk(currentDir: string) {
      const entries = await readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) await walk(fullPath);
        } else if (entry.name.endsWith(".md")) {
          results.push(fullPath);
        }
      }
    }

    await walk(dir);
    return results;
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
        content,
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

  private buildPathMap(paths: string[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const p of paths) {
      map.set(p.replace(/\.md$/, ""), p);
      const name = basename(p, ".md");
      if (!map.has(name)) {
        map.set(name, p);
      }
    }
    return map;
  }

  private resolveLinks(
    rawLinks: string[],
    pathMap: Map<string, string>
  ): string[] {
    const resolved: string[] = [];
    for (const link of rawLinks) {
      const match =
        pathMap.get(link) ??
        pathMap.get(link.replace(/\.md$/, "")) ??
        null;
      if (match) {
        resolved.push(match);
      }
    }
    return resolved;
  }

  private persistNote(note: NoteMeta): void {
    this.db.upsertNote(note);

    const graphNode: GraphNode = {
      path: note.path,
      title: note.title,
      tags: note.tags,
      frontmatter: note.frontmatter,
      tokenEstimate: estimateTokens(note.content),
    };

    this.graph.removeNode(note.path);
    this.graph.addNode(graphNode);

    for (const target of note.outLinks) {
      this.graph.addEdge(note.path, target, "wikilink");
    }
  }
}
