import type { QuestionSnapshot } from "../../../shared/questionBank/search";

type SnapshotKey = { path: string; questionId: string; renderHash: string };
type Value = QuestionSnapshot | Error;

const keyOf = (item: SnapshotKey) => `${item.path}\u0000${item.questionId}\u0000${item.renderHash}`;

/** A few nearby/edited questions may exceed the budget; everything else is LRU.
 * Count image bytes, not just questions (one scan can be several megabytes).
 * The item limit also bounds the non-image document and listener overhead. */
export function createQuestionSnapshotLoader(
  read: (path: string, questionId: string) => Promise<QuestionSnapshot>,
  { capacity = 100, byteBudget = 32 * 1024 * 1024, concurrency = 3 } = {}
) {
  const cache = new Map<string, { value: Value; bytes: number }>();
  const listeners = new Map<string, Set<() => void>>();
  const pins = new Map<string, number>();
  const queue = new Map<string, SnapshotKey>();
  const requested = new Set<string>();
  let bytes = 0, running = 0, generation = 0;
  const notify = (key: string) => listeners.get(key)?.forEach(listener => listener());
  const forget = (key: string) => {
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    bytes -= entry.bytes;
    notify(key);
  };
  const trim = () => {
    for (const key of cache.keys()) {
      if (cache.size <= capacity && bytes <= byteBudget) break;
      if (!pins.has(key)) forget(key);
    }
  };
  const touch = (key: string) => {
    const entry = cache.get(key);
    if (!entry) return;
    cache.delete(key);
    cache.set(key, entry);
  };
  const pump = () => {
    while (running < concurrency && queue.size) {
      const [key, job] = [...queue].at(-1)!;
      queue.delete(key);
      // A different search tab or a fast scroll may have removed this request.
      if (!pins.has(key) && !listeners.has(key)) { requested.delete(key); continue; }
      const epoch = generation;
      running++;
      const save = (value: Value) => {
        if (epoch !== generation || (!pins.has(key) && !listeners.has(key))) return;
        const size = value instanceof Error ? 0 : value.assets.reduce((total, asset) => total + asset.data.byteLength, 0);
        cache.set(key, { value, bytes: size });
        bytes += size;
        trim();
        notify(key);
      };
      void read(job.path, job.questionId).then(save, reason => save(reason instanceof Error ? reason : new Error(String(reason)))).finally(() => {
        running--;
        if (epoch === generation) requested.delete(key);
        pump();
      });
    }
  };
  return {
    get: (item: SnapshotKey) => cache.get(keyOf(item))?.value,
    request(item: SnapshotKey) {
      const key = keyOf(item);
      if (cache.has(key)) { touch(key); return; }
      if (requested.has(key)) return;
      requested.add(key);
      queue.set(key, item);
      pump();
    },
    retain(item: SnapshotKey) {
      const key = keyOf(item);
      pins.set(key, (pins.get(key) ?? 0) + 1);
      touch(key);
      return () => {
        const count = pins.get(key) ?? 0;
        if (count > 1) pins.set(key, count - 1);
        else {
          pins.delete(key);
          if (queue.delete(key)) requested.delete(key);
        }
        trim();
      };
    },
    subscribe(item: SnapshotKey, listener: () => void) {
      const key = keyOf(item), set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.delete(key);
      };
    },
    clear() {
      generation++;
      queue.clear();
      requested.clear();
      pins.clear();
      for (const key of cache.keys()) forget(key);
    }
  };
}

export type QuestionSnapshotLoader = ReturnType<typeof createQuestionSnapshotLoader>;
