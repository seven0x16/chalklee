import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import type { NodeViewProps } from "@tiptap/react";
import { mountChalkLeeNodeViewContent } from "./ChalkLeeNodeViewContent";

function fixture(anchor = 1, head = anchor, position: number | undefined = 10) {
  const { document } = parseHTML('<div class="react-renderer"><section data-node-view-wrapper><div id="target" data-node-view-content></div></section><div data-node-view-content-react><p>题干</p></div></div>');
  const target = document.getElementById("target") as unknown as HTMLElement;
  const content = document.querySelector("[data-node-view-content-react]")!;
  const owner = { editor: { state: { selection: { anchor, head } } }, node: { nodeSize: 20 }, getPos: () => position } as unknown as Pick<NodeViewProps, "editor" | "node" | "getPos">;
  const captureSelection = vi.fn();
  const attach = vi.fn((element: HTMLElement | null) => {
    if (element && element.firstChild !== content) {
      captureSelection();
      element.appendChild(content as unknown as Node);
    }
  });
  return { target, content, owner, attach, captureSelection };
}

describe("ChalkLee node view content attachment", () => {
  it("mounts a new view outside the selection without reading browser selection", () => {
    const f = fixture();
    mountChalkLeeNodeViewContent(f.target, f.owner, f.attach);
    expect(f.target.firstChild).toBe(f.content);
    expect(f.captureSelection).not.toHaveBeenCalled();
    expect(f.attach).toHaveBeenCalledWith(f.target);
  });

  it.each([[15, 15], [12, 25], [25, 12]])("preserves a caret or selection inside newly inserted content (%i, %i)", (anchor, head) => {
    const f = fixture(anchor, head);
    mountChalkLeeNodeViewContent(f.target, f.owner, f.attach);
    expect(f.captureSelection).toHaveBeenCalledOnce();
    expect(f.target.firstChild).toBe(f.content);
  });

  it("uses the normal attachment path when the model position is unavailable", () => {
    const f = fixture();
    f.owner.getPos = () => undefined;
    mountChalkLeeNodeViewContent(f.target, f.owner, f.attach);
    expect(f.captureSelection).toHaveBeenCalledOnce();
  });

  it("preserves browser selection on a subsequent move of existing content", () => {
    const f = fixture();
    mountChalkLeeNodeViewContent(f.target, f.owner, f.attach);
    const replacement = f.target.ownerDocument.createElement("div");
    f.target.after(replacement);
    mountChalkLeeNodeViewContent(replacement, f.owner, f.attach);
    expect(f.captureSelection).toHaveBeenCalledOnce();
    expect(replacement.firstChild).toBe(f.content);
  });

  it("handles ref cleanup and repeated attachment without moving the content", () => {
    const f = fixture();
    mountChalkLeeNodeViewContent(f.target, f.owner, f.attach);
    mountChalkLeeNodeViewContent(null, f.owner, f.attach);
    mountChalkLeeNodeViewContent(f.target, f.owner, f.attach);
    expect(f.captureSelection).not.toHaveBeenCalled();
    expect(f.target.textContent).toBe("题干");
  });
});
