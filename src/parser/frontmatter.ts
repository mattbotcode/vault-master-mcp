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
