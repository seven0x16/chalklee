import type { Editor } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";
import { EditorState, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { CHALKLEE_REVEAL_QUESTION_EVENT, findChalkLeeQuestionContext } from "./editorContext";
import { trackChalkLeeQuestionSelection } from "./questionSelection";

const schema = new Schema({ nodes: {
  doc: { content: "block+" },
  question: { group: "block", content: "block+", attrs: { id: {} } },
  paragraph: { group: "block", content: "text*" },
  text: {}
} });

function setup() {
  const paragraph = () => schema.nodes.paragraph.create(null, schema.text("正文"));
  let state = EditorState.create({ doc: schema.nodes.doc.create(null, [
    paragraph(), ...["q1", "q2"].map(id => schema.nodes.question.create({ id }, paragraph()))
  ]) });
  const { window, document } = parseHTML(`<html><body>
    <input id="search" />
    <header>
      <button id="left-toggle" class="complete-icon-button workspace-pane-toggle"><svg id="left-toggle-icon"></svg></button>
      <button id="right-toggle" class="complete-icon-button workspace-pane-toggle"><svg id="right-toggle-icon"></svg></button>
    </header>
    <section class="chalklee-editor-pane">
      <div class="chalklee-editor-toolbar"><input id="font" /></div>
      <div class="chalklee-editor-scroll-shell"><div class="chalklee-editor-scroll">
        <article class="chalklee-paper"><div><div id="editor">
          <p id="heading">标题</p>
          <section class="chalklee-question-object" data-node-id="q1"><span id="title1" contenteditable="true">标题</span><p id="stem1">正文</p><span class="chalklee-page-gap" /></section>
          <section class="chalklee-question-object" data-node-id="q2"><span id="title2" contenteditable="true">标题</span><p id="stem2">正文</p></section>
        </div></div></article>
      </div><div class="chalklee-line-insert">
        <button id="line-plus"><svg id="line-plus-icon"></svg></button>
        <div class="chalklee-line-insert-menu"><button id="line-heading">标题 1</button></div>
      </div></div>
    </section>
    <div id="left-resizer" class="workspace-pane-resizer left" role="separator" tabindex="0"><span id="left-resizer-grip" /></div>
    <div id="right-resizer" class="workspace-pane-resizer right" role="separator" tabindex="0"><span id="right-resizer-grip" /></div>
    <aside class="workspace-inspector"><nav><button class="outline-entry question-entry" data-outline-id="q2" id="outline-q2">2</button></nav><div id="host"><button id="property">边框</button></div><button id="region">题干</button></aside>
  </body></html>`);
  const dom = document.querySelector<HTMLElement>("#editor")!;
  const host = document.querySelector<HTMLElement>("#host")!;
  let focused: HTMLElement | null = null;
  let visible: string | null = null;
  const listeners = new Map<string, Set<() => void>>();
  const editor = {
    get state() { return state; },
    view: { dom, hasFocus: () => focused === dom },
    on(event: string, handler: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off: (event: string, handler: () => void) => listeners.get(event)?.delete(handler)
  } as unknown as Editor;
  const emit = (event = "selectionUpdate") => listeners.get(event)?.forEach(handler => handler());
  const questionPosition = (id: string) => findChalkLeeQuestionContext(state.doc, id)!.position;
  const select = (id: string, whole = false) => {
    const pos = questionPosition(id);
    state = state.apply(state.tr.setSelection(whole ? NodeSelection.create(state.doc, pos) : TextSelection.create(state.doc, pos + 2)));
    emit();
  };
  Object.defineProperty(document, "activeElement", { get: () => focused });
  dom.blur = () => { focused = null; };
  const send = (selector: string, type: string) => {
    const element = document.querySelector<HTMLElement>(selector)!;
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    if (type === "focusin") focused = element;
    element.dispatchEvent(event);
    return event;
  };
  const dispose = trackChalkLeeQuestionSelection(editor, () => host, id => { visible = id; });
  return {
    reveal(id: string) { dom.dispatchEvent(new window.CustomEvent(CHALKLEE_REVEAL_QUESTION_EVENT, { detail: { id } })); },
    get visible() { return visible; }, get state() { return state; },
    get editorFocused() { return focused === dom; },
    send, select, emit, dispose,
    apply(next: EditorState) { state = next; emit("update"); },
    async focus(selector = "#editor") { send(selector, "focusin"); await Promise.resolve(); },
    async clickQuestion(id: "q1" | "q2", whole = false) {
      send(id === "q1" ? "#stem1" : "#stem2", "pointerdown");
      select(id, whole);
      send("#editor", "focusin");
      await Promise.resolve();
    }
  };
}

describe("visible question selection and paper inspector", () => {
  it("selects a question revealed from the question search after its click cleared the selection", async () => {
    const h = setup();
    await h.clickQuestion("q1");
    h.send("#search", "pointerdown");
    await h.focus("#search");
    expect(h.visible).toBeNull();
    h.select("q2", true);
    h.reveal("q2");
    expect(h.visible).toBe("q2");
    h.reveal("missing");
    expect(h.visible).toBeNull();
    h.dispose();
  });

  it("does not select a question from a retained caret until the editor receives focus", async () => {
    const h = setup();
    h.select("q1");
    expect(h.visible).toBeNull();
    await h.focus();
    expect(h.visible).toBe("q1");
    h.dispose();
  });

  it("keeps the blue-frame owner while using sidebar and toolbar controls", async () => {
    const h = setup();
    await h.clickQuestion("q1");
    for (const selector of ["#property", "#font"]) {
      h.send(selector, "pointerdown");
      await h.focus(selector);
      h.emit("update");
      expect(h.visible).toBe("q1");
    }
    h.dispose();
  });

  it.each([false, true])("keeps question selection (whole: %s) while using either sidebar toggle", async whole => {
    const h = setup();
    await h.clickQuestion("q1", whole);
    const { doc, selection } = h.state;
    for (const side of ["left", "right"]) {
      for (const selector of [`#${side}-toggle-icon`, `#${side}-toggle`]) {
        h.send(selector, "pointerdown");
        expect(h.visible).toBe("q1");
        await h.focus(`#${side}-toggle`);
        h.emit("update");
        expect(h.visible).toBe("q1");
        expect(h.state.selection.eq(selection)).toBe(true);
        expect(h.state.doc.eq(doc)).toBe(true);
      }
    }
    h.send(".chalklee-paper", "pointerdown");
    expect(h.visible).toBeNull();
    await h.focus("#right-toggle");
    h.emit("update");
    expect(h.visible).toBeNull();
    h.dispose();
  });

  it.each([false, true])("keeps a whole-question selection (%s) when either sidebar resize handle takes focus", async whole => {
    const h = setup();
    await h.clickQuestion("q1", whole);
    const { doc, selection } = h.state;
    for (const selector of ["#left-resizer-grip", "#left-resizer", "#right-resizer-grip", "#right-resizer"]) {
      h.send(selector, "pointerdown");
      expect(h.visible).toBe("q1");
      await h.focus(selector.includes("left") ? "#left-resizer" : "#right-resizer");
      h.emit("update");
      expect(h.visible).toBe("q1");
      expect(h.state.selection.eq(selection)).toBe(true);
      expect(h.state.doc.eq(doc)).toBe(true);
    }
    h.send(".chalklee-paper", "pointerdown");
    expect(h.visible).toBeNull();
    h.dispose();
  });

  it.each(["#line-plus", "#line-plus-icon", "#line-heading"])("preserves the caret during a pointer press on %s", async selector => {
    const h = setup();
    await h.clickQuestion("q1");
    const { doc, selection } = h.state;
    h.send(selector, "pointerdown");
    // A real mouse press precedes click by at least a frame. Blurring here
    // removes the empty-line trigger before its click can open the menu.
    expect(h.editorFocused).toBe(true);
    expect(h.visible).toBe("q1");
    await h.focus("#line-heading");
    h.emit("update");
    expect(h.visible).toBe("q1");
    expect(h.state.selection.eq(selection)).toBe(true);
    expect(h.state.doc.eq(doc)).toBe(true);
    h.dispose();
  });

  it("keeps focus when pressing the plus beside a plain paragraph", async () => {
    const h = setup();
    await h.focus();
    h.send("#line-plus", "pointerdown");
    expect(h.editorFocused).toBe(true);
    expect(h.visible).toBeNull();
    h.dispose();
  });

  it.each([false, true])("clears a %s whole-question selection on paper, ignoring stale caret events", async whole => {
    const h = setup();
    await h.clickQuestion("q1", whole);
    const original = h.state.doc;
    const selection = h.state.selection;
    expect(h.send(".chalklee-paper", "pointerdown").defaultPrevented).toBe(true);
    expect(h.visible).toBeNull();
    await h.focus(); // Even an incidental focus/selection event must not resurrect it.
    h.emit();
    expect(h.visible).toBeNull();
    expect(h.state.selection.eq(selection)).toBe(true);
    expect(h.state.doc.eq(original)).toBe(true);
    await h.clickQuestion("q2");
    expect(h.visible).toBe("q2");
    h.dispose();
  });

  it("shows paper for headings and cross-question ranges, then follows keyboard navigation", async () => {
    const h = setup();
    await h.clickQuestion("q1");
    h.send("#heading", "pointerdown");
    h.apply(h.state.apply(h.state.tr.setSelection(TextSelection.create(h.state.doc, 1))));
    expect(h.visible).toBeNull();
    h.send("#editor", "keydown");
    h.select("q2");
    expect(h.visible).toBe("q2");
    const end = h.state.selection.from;
    h.select("q1");
    h.apply(h.state.apply(h.state.tr.setSelection(TextSelection.create(h.state.doc, h.state.selection.from, end))));
    expect(h.visible).toBeNull();
    h.dispose();
  });

  it("selects inline titles and lets an explicit editor command return from paper to a question", async () => {
    const h = setup();
    await h.focus("#title2");
    expect(h.visible).toBe("q2");
    h.send(".chalklee-page-gap", "pointerdown");
    expect(h.visible).toBeNull();
    h.send("#region", "pointerdown");
    await h.focus("#region");
    h.select("q1");
    await h.focus();
    expect(h.visible).toBe("q1");
    h.dispose();
  });

  it("selects a question from the outline even when the editor does not keep focus", async () => {
    const h = setup();
    h.send("#outline-q2", "pointerdown");
    expect(h.visible).toBe("q2");
    h.dispose();
  });

  it("clears deleted questions, unrelated app focus, and detaches listeners when inactive", async () => {
    const h = setup();
    await h.clickQuestion("q1");
    await h.focus("#property");
    const question = findChalkLeeQuestionContext(h.state.doc, "q1")!;
    h.apply(h.state.apply(h.state.tr.delete(question.position, question.position + question.node.nodeSize)));
    expect(h.visible).toBeNull();
    await h.clickQuestion("q2");
    await h.focus("#search");
    expect(h.visible).toBeNull();
    h.dispose();
    await h.clickQuestion("q2");
    expect(h.visible).toBeNull();
  });
});
