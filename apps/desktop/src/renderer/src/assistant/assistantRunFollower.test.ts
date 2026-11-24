import { describe, expect, it, vi } from "vitest";
import { assistantRunFollower } from "./assistantRunFollower";

const state = (patch: { id?: string; running?: boolean; error?: string | null; undoable?: string[] | null; stopReason?: string } = {}) => ({
  id: patch.id ?? "c1", running: patch.running ?? false, error: patch.error ?? null, undoable: patch.undoable ?? null,
  messages: [{ role: "assistant" as const, id: "m1", content: [], timestamp: 1, stopReason: patch.stopReason ?? "stop" }]
});
const follow = () => {
  const handlers = { document: "卷.chalklee", onEnded: vi.fn(), onUndone: vi.fn() };
  return { handlers, follower: assistantRunFollower(handlers) };
};

describe("following a ChalkLee AI run", () => {
  it("reports a change that arrives just after the run ends, and its undo", () => {
    const { handlers, follower } = follow();
    follower.update(state({ running: true }));
    follower.update(state());
    expect(handlers.onEnded).toHaveBeenLastCalledWith(false);
    follower.update(state({ undoable: ["卷.chalklee"] }));
    expect(handlers.onEnded).toHaveBeenLastCalledWith(true);
    follower.update(state());
    expect(handlers.onUndone).toHaveBeenCalledTimes(1);
  });
  it("does not count another document, a stopped run or a failed run as the change", () => {
    for (const end of [state({ undoable: ["别的.chalklee"] }), state({ undoable: ["卷.chalklee"], stopReason: "aborted" }), state({ undoable: ["卷.chalklee"], error: "连接中断" })]) {
      const { handlers, follower } = follow();
      follower.update(state({ running: true }));
      follower.update(end);
      expect(handlers.onEnded.mock.calls).toEqual([[false]]);
    }
  });
  it("lets go when the teacher moves to another conversation or a later run starts", () => {
    const moved = follow();
    moved.follower.update(state({ running: true }));
    moved.follower.update(state({ id: "c2" }));
    expect(moved.handlers.onEnded.mock.calls).toEqual([[false]]);
    const later = follow();
    later.follower.update(state({ running: true }));
    later.follower.update(state({ undoable: ["卷.chalklee"] }));
    later.follower.update(state({ running: true }));
    later.follower.update(state());
    expect(later.handlers.onUndone).not.toHaveBeenCalled();
  });
});
