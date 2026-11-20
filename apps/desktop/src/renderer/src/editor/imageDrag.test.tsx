import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { getSchema, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeInlineImageNode } from "./extensions/nodes";
import { useChalkLeeImageDrag } from "./imageDrag";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeInlineImageNode]);
let root: Root;
let events: EventTarget;
const PointerEventBase = Event;
beforeEach(() => {
  const { window, document } = parseHTML("<html><body><div id='root'></div><div id='paper'></div></body></html>");
  events = new EventTarget();
  // Use browser-style abortable listeners, which linkedom does not implement.
  void window.addEventListener;
  window.addEventListener = events.addEventListener.bind(events);
  window.removeEventListener = events.removeEventListener.bind(events);
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  root = createRoot(document.getElementById("root")!);
});
afterEach(() => { act(() => root?.unmount()); vi.unstubAllGlobals(); });

function fixture() {
  let state = EditorState.create({ schema, plugins: [history()], doc: schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.nodes.imageInline.create({ id: "figure", assetId: "diagram" })),
    schema.nodes.paragraph.create(null, schema.text("destination"))
  ]) });
  const original = state.doc;
  const dispatch = vi.fn((tr: Transaction) => { state = state.apply(tr); });
  const dom = document.getElementById("paper")!;
  dom.getBoundingClientRect = () => ({ left: 0, right: 500, top: 0, bottom: 500 }) as DOMRect;
  document.elementFromPoint = () => dom;
  const editor = { isEditable: true, isDestroyed: false, get state() { return state; }, view: {
    dom, dispatch, focus: vi.fn(), posAtCoords: () => ({ pos: 4 }), coordsAtPos: () => ({ left: 80, top: 80, bottom: 100 })
  } } as unknown as Editor;
  let drag: ReturnType<typeof useChalkLeeImageDrag>;
  function Harness() { drag = useChalkLeeImageDrag(editor, "figure"); return null; }
  act(() => root.render(<Harness />));
  const handle = Object.assign(document.createElement("img"), {
    setPointerCapture: vi.fn(), hasPointerCapture: () => false, releasePointerCapture: vi.fn()
  });
  const down = () => drag.onPointerDown({ button: 0, clientX: 10, clientY: 10, pointerId: 1, currentTarget: handle,
    preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Parameters<typeof drag.onPointerDown>[0]);
  const pointer = (type: string, buttons: number) => events.dispatchEvent(Object.assign(new PointerEventBase(type, { cancelable: true }), {
    pointerId: 1, clientX: 100, clientY: 100, buttons
  }));
  return { down, pointer, original, dispatch, get state() { return state; }, undo: () => undo(state, dispatch) };
}

describe("image pointer dragging", () => {
  it.each([false, true])("cancels a missed release before the next click (drag started: %s)", started => {
    const f = fixture();
    const pageStyle = document.createElement("style");
    document.head.append(pageStyle);
    f.down();
    if (started) {
      f.pointer("pointermove", 1);
      expect(document.head.querySelectorAll("style")).toHaveLength(2);
    }
    f.pointer("pointermove", 0);
    f.pointer("pointerup", 0);
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(f.state.doc.eq(f.original)).toBe(true);
    expect(document.querySelector(".chalklee-image-drop-hint")).toBeNull();
    expect(document.body.classList.contains("chalklee-image-dragging")).toBe(false);
    expect(Array.from(document.head.querySelectorAll("style"))).toEqual([pageStyle]);
  });

  it("leaves a click unchanged and permits a deliberate drag with one-step undo", () => {
    const f = fixture();
    f.down();
    f.pointer("pointerup", 0);
    expect(f.dispatch).not.toHaveBeenCalled();
    f.down();
    f.pointer("pointermove", 1);
    f.pointer("pointerup", 0);
    expect(f.state.doc.firstChild?.childCount).toBe(0);
    expect(f.state.doc.lastChild?.firstChild?.attrs.assetId).toBe("diagram");
    expect(f.undo()).toBe(true);
    expect(f.state.doc.eq(f.original)).toBe(true);
  });
});
