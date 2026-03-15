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
  for (const line of withoutCode.split("\n")) {
    // Skip heading lines
    if (/^\s*#{1,6}\s/.test(line)) continue;
    const lineRegex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g;
    let match: RegExpExecArray | null;
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
