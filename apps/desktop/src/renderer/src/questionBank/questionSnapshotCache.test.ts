import { describe, expect, it, vi } from "vitest";
import type { QuestionSnapshot } from "../../../shared/questionBank/search";
import { createQuestionSnapshotLoader } from "./questionSnapshotCache";

const item = (questionId: string) => ({ path: "/paper.chalklee", questionId, renderHash: "render" });
const snapshot = (size: number) => ({ assets: [{ data: new ArrayBuffer(size) }] }) as QuestionSnapshot;
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe("question snapshot cache", () => {
  it("evicts images by bytes, keeps the visible question, and releases large snapshots after leaving the viewport", async () => {
    const read = vi.fn(async (_path: string, id: string) => snapshot(id === "large" ? 20 : 6));
    const cache = createQuestionSnapshotLoader(read, { byteBudget: 10 });
    const a = item("a"), b = item("b"), large = item("large");
    const releaseA = cache.retain(a);
    cache.request(a); await settle();
    const releaseB = cache.retain(b);
    cache.request(b); await settle();
    expect(cache.get(a)).toBeDefined();
    releaseA();
    expect(cache.get(a)).toBeUndefined();
    expect(cache.get(b)).toBeDefined();
    releaseB();
    const releaseLarge = cache.retain(large);
    cache.request(large); await settle();
    expect(cache.get(b)).toBeUndefined();
    expect(cache.get(large)).toBeDefined();
    releaseLarge();
    expect(cache.get(large)).toBeUndefined();
  });

  it("drops waiting reads when cards leave and ignores an in-flight old workspace reply", async () => {
    let complete!: (value: QuestionSnapshot) => void;
    const read = vi.fn(() => new Promise<QuestionSnapshot>(resolve => { complete = resolve; }));
    const cache = createQuestionSnapshotLoader(read, { concurrency: 1 });
    const a = item("a"), b = item("b");
    cache.retain(a); cache.request(a);
    const releaseB = cache.retain(b); cache.request(b); releaseB();
    cache.clear(); complete(snapshot(6)); await settle();
    expect(read).toHaveBeenCalledTimes(1);
    expect(cache.get(a)).toBeUndefined();
    expect(cache.get(b)).toBeUndefined();
  });
});
