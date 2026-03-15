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
