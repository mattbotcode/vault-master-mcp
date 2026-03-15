import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseFrontmatter, extractFreshness } from "../../src/parser/frontmatter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
