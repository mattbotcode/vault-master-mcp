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
