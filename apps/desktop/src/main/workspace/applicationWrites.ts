import path from "node:path";
import type { WriteDocumentResult } from "../../shared/contracts";

interface FileVersion {
  modifiedAt: number;
  size: number;
}

interface TrackedWrite extends FileVersion {
  expiresAt: number;
}

const DEFAULT_TRACKING_WINDOW_MS = 5_000;

/**
 * Correlates file-system notifications with writes initiated by ChalkLee.
 *
 * The watcher runs independently from the IPC write request, so an ordinary
 * autosave otherwise looks exactly like an edit made by another application.
 */
export class ApplicationWriteTracker {
  private readonly writes = new Map<string, TrackedWrite>();

  constructor(
    private readonly trackingWindowMs = DEFAULT_TRACKING_WINDOW_MS,
    private readonly now: () => number = Date.now
  ) {}

  record(filePath: string, result: WriteDocumentResult): void {
    this.prune();
    this.writes.set(path.resolve(filePath), {
      ...result,
      expiresAt: this.now() + this.trackingWindowMs
    });
  }

  matches(filePath: string, version: FileVersion): boolean {
    this.prune();
    const tracked = this.writes.get(path.resolve(filePath));
    return Boolean(tracked
      && tracked.modifiedAt === version.modifiedAt
      && tracked.size === version.size);
  }

  clear(): void {
    this.writes.clear();
  }

  private prune(): void {
    const now = this.now();
    for (const [filePath, tracked] of this.writes) {
      if (tracked.expiresAt < now) this.writes.delete(filePath);
    }
  }
}
