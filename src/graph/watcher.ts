import { watch, type FSWatcher } from "chokidar";
import { relative } from "path";
import type { VaultIndexer } from "./indexer.js";

export interface VaultWatcherOptions {
  debounceMs?: number;
  usePolling?: boolean;
  pollingInterval?: number;
}

export class VaultWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private debounceMs: number;
  private usePolling: boolean;
  private pollingInterval: number;

  constructor(
    private vaultPath: string,
    private indexer: VaultIndexer,
    options?: VaultWatcherOptions
  ) {
    this.debounceMs = options?.debounceMs ?? 100;
    this.usePolling = options?.usePolling ?? false;
    this.pollingInterval = options?.pollingInterval ?? 100;
  }

  start(): void {
    // Watch the absolute vault path directly — chokidar v4 glob+cwd has issues in some environments
    this.watcher = watch(this.vaultPath, {
      ignoreInitial: true,
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "**/.obsidian/**",
        "**/.trash/**",
        "**/.vault-master.db*",
      ],
      usePolling: this.usePolling,
      interval: this.pollingInterval,
    });

    this.watcher.on("add", (absPath) => {
      if (absPath.endsWith(".md")) {
        this.handleChange(relative(this.vaultPath, absPath));
      }
    });
    this.watcher.on("change", (absPath) => {
      if (absPath.endsWith(".md")) {
        this.handleChange(relative(this.vaultPath, absPath));
      }
    });
    this.watcher.on("unlink", (absPath) => {
      if (absPath.endsWith(".md")) {
        this.handleDelete(relative(this.vaultPath, absPath));
      }
    });
  }

  async stop(): Promise<void> {
    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private handleChange(relativePath: string): void {
    // Debounce rapid changes to same file
    const existing = this.debounceTimers.get(relativePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(relativePath);
      try {
        await this.indexer.indexFile(relativePath);
      } catch (err) {
        console.error(`[vault-master] Error indexing ${relativePath}:`, err);
      }
    }, this.debounceMs);

    this.debounceTimers.set(relativePath, timer);
  }

  private handleDelete(relativePath: string): void {
    // Cancel any pending debounce for this file
    const existing = this.debounceTimers.get(relativePath);
    if (existing) {
      clearTimeout(existing);
      this.debounceTimers.delete(relativePath);
    }

    try {
      this.indexer.removeFile(relativePath);
    } catch (err) {
      console.error(`[vault-master] Error removing ${relativePath}:`, err);
    }
  }
}
