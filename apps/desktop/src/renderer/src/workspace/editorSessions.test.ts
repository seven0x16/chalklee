import { describe, expect, it, vi } from "vitest";
import { prepareWorkspaceEditors, registerWorkspaceEditor } from "./editorSessions";

describe("workspace editor file-operation coordination", () => {
  it("waits for every affected editor and leaves sibling paths alone", async () => {
    let finish!: () => void;
    const release = vi.fn(), other = vi.fn(async () => () => {});
    const remove = registerWorkspaceEditor("/root/目录/讲义.chalklee", async saveChanges => {
      expect(saveChanges).toBe(false);
      await new Promise<void>(resolve => { finish = resolve; });
      return release;
    });
    const removeOther = registerWorkspaceEditor("/root/目录二/讲义.chalklee", other);
    try {
      const prepared = prepareWorkspaceEditors("/root/目录", false);
      let settled = false;
      void prepared.then(() => { settled = true; });
      await Promise.resolve(); expect(settled).toBe(false);
      finish();
      const resume = await prepared;
      expect(release).not.toHaveBeenCalled();
      expect(other).not.toHaveBeenCalled();
      resume(); expect(release).toHaveBeenCalledOnce();
    } finally { remove(); removeOther(); }
  });

  it("requests saving for copies/trash and releases already-paused editors when another save fails", async () => {
    const release = vi.fn();
    const first = vi.fn(async () => release);
    const removeA = registerWorkspaceEditor("/root/a.chalklee", first);
    const removeB = registerWorkspaceEditor("/root/b.chalklee", async () => { throw new Error("磁盘版本冲突"); });
    try {
      await expect(prepareWorkspaceEditors("/root", true)).rejects.toThrow("磁盘版本冲突");
      expect(first).toHaveBeenCalledWith(true);
      expect(release).toHaveBeenCalledOnce();
    } finally { removeA(); removeB(); }
  });
});
