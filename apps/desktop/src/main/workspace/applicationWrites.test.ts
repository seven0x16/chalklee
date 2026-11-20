import { describe, expect, it } from "vitest";
import { ApplicationWriteTracker } from "./applicationWrites";

describe("ApplicationWriteTracker", () => {
  it("recognizes watcher events produced by the application's own save", () => {
    const tracker = new ApplicationWriteTracker();
    tracker.record("/workspace/exam.chalklee", { modifiedAt: 42, size: 120 });

    expect(tracker.matches("/workspace/exam.chalklee", { modifiedAt: 42, size: 120 })).toBe(true);
    expect(tracker.matches("/workspace/other.chalklee", { modifiedAt: 42, size: 120 })).toBe(false);
  });

  it("does not hide a later external write to the same file", () => {
    const tracker = new ApplicationWriteTracker();
    tracker.record("/workspace/exam.chalklee", { modifiedAt: 42, size: 120 });

    expect(tracker.matches("/workspace/exam.chalklee", { modifiedAt: 43, size: 120 })).toBe(false);
    expect(tracker.matches("/workspace/exam.chalklee", { modifiedAt: 42, size: 121 })).toBe(false);
  });

  it("expires old writes and can be reset when the workspace changes", () => {
    let now = 1_000;
    const tracker = new ApplicationWriteTracker(500, () => now);
    tracker.record("/workspace/exam.chalklee", { modifiedAt: 42, size: 120 });
    now = 1_501;
    expect(tracker.matches("/workspace/exam.chalklee", { modifiedAt: 42, size: 120 })).toBe(false);

    tracker.record("/workspace/exam.chalklee", { modifiedAt: 43, size: 121 });
    tracker.clear();
    expect(tracker.matches("/workspace/exam.chalklee", { modifiedAt: 43, size: 121 })).toBe(false);
  });
});
