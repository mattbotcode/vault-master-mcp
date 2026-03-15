import type { GraphNode, GraphEdge, SubgraphResult, WalkResult } from "../types.js";

export class GraphEngine {
  private nodes: Map<string, GraphNode> = new Map();
  private outLinks: Map<string, Set<string>> = new Map();
  private inLinks: Map<string, Set<string>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();

  addNode(node: GraphNode): void {
    this.nodes.set(node.path, node);
    if (!this.outLinks.has(node.path)) {
      this.outLinks.set(node.path, new Set());
    }
    if (!this.inLinks.has(node.path)) {
      this.inLinks.set(node.path, new Set());
    }
    // Index tags
    for (const tag of node.tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(node.path);
    }
  }

  removeNode(path: string): void {
    const node = this.nodes.get(path);
    if (!node) return;

    // Remove from tag index
    for (const tag of node.tags) {
      this.tagIndex.get(tag)?.delete(path);
    }

    // Remove outgoing edges
    const outgoing = this.outLinks.get(path);
    if (outgoing) {
      for (const target of outgoing) {
        this.inLinks.get(target)?.delete(path);
      }
    }

    // Remove incoming edges
    const incoming = this.inLinks.get(path);
    if (incoming) {
      for (const source of incoming) {
        this.outLinks.get(source)?.delete(path);
      }
    }

    this.outLinks.delete(path);
    this.inLinks.delete(path);
    this.nodes.delete(path);
  }

  addEdge(from: string, to: string, type: "wikilink" | "tag"): void {
    if (!this.outLinks.has(from)) {
      this.outLinks.set(from, new Set());
    }
    if (!this.inLinks.has(to)) {
      this.inLinks.set(to, new Set());
    }
    this.outLinks.get(from)!.add(to);
    this.inLinks.get(to)!.add(from);
  }

  getNode(path: string): GraphNode | null {
    return this.nodes.get(path) ?? null;
  }

  getOutLinks(path: string): string[] {
    return [...(this.outLinks.get(path) ?? [])];
  }

  getInLinks(path: string): string[] {
    return [...(this.inLinks.get(path) ?? [])];
  }

  getNeighborhood(path: string): string[] {
    const out = this.outLinks.get(path) ?? new Set<string>();
    const inc = this.inLinks.get(path) ?? new Set<string>();
    const all = new Set([...out, ...inc]);
    return [...all];
  }

  getByTag(tag: string): string[] {
    return [...(this.tagIndex.get(tag) ?? [])];
  }

  bfs(start: string, maxDepth: number): WalkResult[] {
    const results: WalkResult[] = [];
    const visited = new Set<string>();
    const queue: { path: string; depth: number }[] = [{ path: start, depth: 0 }];

    while (queue.length > 0) {
      const { path, depth } = queue.shift()!;
      if (visited.has(path)) continue;
      visited.add(path);

      const node = this.nodes.get(path);
      if (node) {
        results.push({
          path: node.path,
          depth,
          title: node.title,
          tags: node.tags,
        });
      }

      if (depth < maxDepth) {
        const neighbors = this.getNeighborhood(path);
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push({ path: neighbor, depth: depth + 1 });
          }
        }
      }
    }

    return results;
  }

  getSubgraph(
    start: string,
    tokenBudget: number,
    maxDepth: number
  ): SubgraphResult {
    const included = new Set<string>();
    const resultNodes: GraphNode[] = [];
    let totalTokens = 0;
    let truncated = false;

    const visited = new Set<string>();
    const queue: { path: string; depth: number }[] = [{ path: start, depth: 0 }];

    while (queue.length > 0) {
      const { path, depth } = queue.shift()!;
      if (visited.has(path)) continue;
      visited.add(path);

      const node = this.nodes.get(path);
      if (!node) continue;

      if (totalTokens + node.tokenEstimate > tokenBudget) {
        truncated = true;
        continue;
      }

      totalTokens += node.tokenEstimate;
      included.add(path);
      resultNodes.push(node);

      if (depth < maxDepth) {
        const neighbors = this.getNeighborhood(path);
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push({ path: neighbor, depth: depth + 1 });
          }
        }
      }
    }

    // Collect edges between included nodes
    const edges: GraphEdge[] = [];
    for (const path of included) {
      for (const target of this.outLinks.get(path) ?? []) {
        if (included.has(target)) {
          edges.push({ from: path, to: target, type: "wikilink" });
        }
      }
    }

    return { nodes: resultNodes, edges, totalTokens, truncated };
  }

  get size(): number {
    return this.nodes.size;
  }

  clear(): void {
    this.nodes.clear();
    this.outLinks.clear();
    this.inLinks.clear();
    this.tagIndex.clear();
  }
}
