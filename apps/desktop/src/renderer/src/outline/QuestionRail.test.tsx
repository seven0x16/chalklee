import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutlineItem } from "../viewers/types";
import { QuestionRail, questionOutlinePresentation, railMarks, railStep, railYields, visibleOutlineIds } from "./QuestionRail";

let root: Root;
let shell: HTMLElement;
let scroller: HTMLElement;
let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  const { window, document } = parseHTML("<html><body><div id='app'></div><div class='chalklee-editor-scroll-shell'><div class='chalklee-editor-scroll'></div></div></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  frames = new Map();
  let lastFrame = 0;
  Object.assign(window, {
    requestAnimationFrame(callback: FrameRequestCallback) { frames.set(++lastFrame, callback); return lastFrame; },
    cancelAnimationFrame(frame: number) { frames.delete(frame); }
  });
  shell = document.querySelector<HTMLElement>(".chalklee-editor-scroll-shell")!;
  scroller = document.querySelector<HTMLElement>(".chalklee-editor-scroll")!;
  root = createRoot(document.getElementById("app")!);
});
afterEach(() => { act(() => root.unmount()); vi.unstubAllGlobals(); vi.useRealTimers(); });

function advanceFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => { callbacks.forEach(callback => callback(0)); });
}

const outline: OutlineItem[] = [
  { id: "h1", label: "一、选择题", level: 2, kind: "heading", target: "h1" },
  { id: "q1", label: "第 1 题 · 函数", level: 3, kind: "question", target: "q1", parentId: "h1" },
  { id: "q2", label: "第 2 题", level: 3, kind: "question", target: "q2", parentId: "h1" },
  { id: "group", label: "题组 3 · 几何探究", level: 3, kind: "question", questionGroup: true, childQuestionIds: ["a", "b"], target: "group", parentId: "h1" }
];

function mount(props: Partial<Parameters<typeof QuestionRail>[0]> = {}) {
  const onOutline = vi.fn();
  act(() => root.render(<QuestionRail scroller={scroller} outline={outline} currentQuestionId={null} onOutline={onOutline} {...props} />));
  advanceFrame();
  return {
    onOutline,
    rail: () => shell.querySelector<HTMLElement>(".question-rail"),
    track: () => shell.querySelector<HTMLButtonElement>(".question-rail-track")!,
    card: () => shell.querySelector<HTMLElement>(".question-rail-card")!,
    entry: (id: string) => shell.querySelector<HTMLButtonElement>(`[data-outline-id="${id}"]`)!
  };
}

describe("outline rail on the paper's edge", () => {
  it("draws a line for every heading and question beside the paper, marking the selected question", () => {
    const { rail, track } = mount({ currentQuestionId: "q2" });
    expect(rail()!.parentElement).toBe(shell);
    const marks = Array.from(track().querySelectorAll("i")).map(mark => mark.className);
    expect(marks).toEqual([
      "question-rail-mark is-heading level-2",
      "question-rail-mark is-question",
      "question-rail-mark is-question is-current",
      "question-rail-mark is-question"
    ]);
    expect(track().getAttribute("aria-label")).toBe("章节目录");
  });

  it("opens the whole outline from the rail, jumps to a question while staying open, and closes with Escape", () => {
    const { rail, track, card, entry, onOutline } = mount({ currentQuestionId: "a", basketQuestionIds: new Set(["q1"]) });
    expect(rail()!.classList.contains("is-open")).toBe(false);
    expect(card().querySelector(".outline-entry")).toBeNull();
    act(() => track().click());
    advanceFrame();
    expect([rail()!.classList.contains("is-open"), track().getAttribute("aria-expanded")]).toEqual([true, "true"]);
    // A subquestion keeps its numbered group current; the basket and the group's number show on the tiles.
    expect(entry("group").getAttribute("aria-current")).toBe("true");
    expect(entry("group").querySelector(".outline-index")?.textContent).toBe("3");
    expect(entry("q1").title).toBe("第 1 题 · 函数\n已在选题篮");
    act(() => entry("q2").click());
    expect(onOutline).toHaveBeenCalledWith(outline[2]);
    expect(rail()!.classList.contains("is-open")).toBe(true);
    const restoreFocus = vi.spyOn(track(), "focus").mockImplementation(() => {
      expect(track().getAttribute("aria-expanded")).toBe("false");
    });
    const escape = new window.Event("keydown", { bubbles: true });
    Object.assign(escape, { key: "Escape" });
    act(() => { card().dispatchEvent(escape); });
    expect(rail()!.classList.contains("is-open")).toBe(false);
    expect(restoreFocus).toHaveBeenCalledOnce();
    expect(entry("q2")).toBeTruthy();
  });

  it("opens after a short pause on the rail and closes once the pointer has left the rail and the outline", () => {
    vi.useFakeTimers();
    const { rail, track, card } = mount();
    const pointer = (target: HTMLElement, type: string) => act(() => { target.dispatchEvent(new window.Event(type, { bubbles: true })); });
    pointer(track(), "mouseover");
    act(() => vi.advanceTimersByTime(40));
    expect(rail()!.classList.contains("is-open")).toBe(false);
    act(() => vi.advanceTimersByTime(100));
    expect(rail()!.classList.contains("is-open")).toBe(true);
    pointer(track(), "mouseout");
    pointer(card(), "mouseover");
    act(() => vi.advanceTimersByTime(400));
    expect(rail()!.classList.contains("is-open")).toBe(true);
    pointer(card(), "mouseout");
    act(() => vi.advanceTimersByTime(400));
    expect(rail()!.classList.contains("is-open")).toBe(false);
  });

  it("is absent without an outline or a paper to sit on", () => {
    mount({ outline: [] });
    expect(shell.querySelector(".question-rail")).toBeNull();
    act(() => root.render(<QuestionRail scroller={null} outline={outline} currentQuestionId={null} onOutline={() => undefined} />));
    expect(document.querySelector(".question-rail")).toBeNull();
  });

  it("highlights the new paper's visible questions when the two papers share question IDs", () => {
    const second = scroller.cloneNode() as HTMLElement;
    shell.appendChild(second);
    for (const [paper, visibleId] of [[scroller, "q1"], [second, "q2"]] as const) {
      paper.getBoundingClientRect = () => ({ top: 0, bottom: 200 }) as DOMRect;
      for (const id of ["q1", "q2"]) {
        const question = document.createElement("div");
        const top = id === visibleId ? 50 : 250;
        question.dataset.nodeId = id;
        question.getBoundingClientRect = () => ({ top, bottom: top + 50, height: 50 }) as DOMRect;
        paper.appendChild(question);
      }
    }
    const { track } = mount();
    const visibleMarks = () => [...track().children].map(mark => mark.hasAttribute("data-in-view"));
    expect(visibleMarks()).toEqual([true, true, false, false]);
    act(() => scroller.dispatchEvent(new window.Event("scroll")));
    act(() => root.render(<QuestionRail scroller={second} outline={outline} currentQuestionId={null} onOutline={() => undefined} />));
    expect(visibleMarks()).toEqual([false, false, false, false]);
    advanceFrame();
    expect(visibleMarks()).toEqual([true, false, true, false]);
  });

  it("keeps visibility tied to the current paper target after its id changes", async () => {
    vi.stubGlobal("MutationObserver", window.MutationObserver);
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 200 }) as DOMRect;
    const question = document.createElement("div");
    question.dataset.nodeId = "q1";
    question.getBoundingClientRect = () => ({ top: 20, bottom: 60, height: 40 }) as DOMRect;
    scroller.appendChild(question);
    const { entry, track } = mount();
    act(() => track().click());
    advanceFrame();
    expect(entry("q1").hasAttribute("data-in-view")).toBe(true);
    expect(entry("q2").hasAttribute("data-in-view")).toBe(false);
    await act(async () => { question.dataset.nodeId = "q2"; });
    advanceFrame();
    expect(entry("q1").hasAttribute("data-in-view")).toBe(false);
    expect(entry("q2").hasAttribute("data-in-view")).toBe(true);
  });

  it("counts what is on screen, with the headings above it", () => {
    const box = (top: number, bottom: number) => () => ({ top, bottom, height: bottom - top, left: 0, right: 100, width: 100, x: 0, y: top, toJSON() {} }) as DOMRect;
    scroller.getBoundingClientRect = box(100, 500);
    for (const [id, top] of [["h1", -200], ["q1", -100], ["q2", 300], ["group", 600]] as const) {
      const element = document.createElement("div");
      element.dataset.nodeId = id;
      element.getBoundingClientRect = box(top, top + 80);
      scroller.appendChild(element);
    }
    expect([...visibleOutlineIds(scroller, outline)].sort()).toEqual(["h1", "q2"]);
  });

  it("keeps the current section visible while reading paragraphs or a full-page image below its heading", () => {
    let scroll = 300;
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 200 }) as DOMRect;
    const sections: OutlineItem[] = [
      { id: "section", label: "解答题", level: 2, kind: "heading" },
      { id: "source", label: "原稿", level: 3, kind: "heading", parentId: "section" },
      { id: "answers", label: "答案", level: 2, kind: "heading" }
    ];
    for (const [id, top] of [["section", 0], ["source", 100], ["image", 140], ["answers", 1000]] as const) {
      const element = document.createElement(id === "image" ? "img" : "h2");
      element.dataset.nodeId = id;
      const height = id === "image" ? 800 : 20;
      element.getBoundingClientRect = () => ({ top: top - scroll, bottom: top - scroll + height, height }) as DOMRect;
      scroller.appendChild(element);
    }
    expect([...visibleOutlineIds(scroller, sections)]).toEqual(["section", "source"]);
    scroll = 900;
    expect([...visibleOutlineIds(scroller, sections)]).toEqual(["section", "source", "answers"]);
    scroll = 1100;
    expect([...visibleOutlineIds(scroller, sections)]).toEqual(["answers"]);
  });

  it("counts a question answered in its passage by its blank, or else by the passage, and a split node by any piece", () => {
    const box = (top: number, height: number) => () => ({ top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON() {} }) as DOMRect;
    scroller.getBoundingClientRect = box(100, 400);
    const place = (id: string, top: number, height: number) => {
      const element = document.createElement("div");
      element.dataset.nodeId = id;
      element.getBoundingClientRect = box(top, height);
      scroller.appendChild(element);
    };
    const passage: OutlineItem[] = [
      { id: "h2", label: "Ⅲ．语法填空", level: 2, kind: "heading" },
      { id: "q36", label: "第 36 题", level: 3, kind: "question", parentId: "h2", groupId: "grammar", blankId: "blank_36" },
      { id: "q37", label: "第 37 题", level: 3, kind: "question", parentId: "h2", groupId: "grammar", blankId: "blank_37" },
      { id: "q38", label: "第 38 题", level: 3, kind: "question", parentId: "h2", groupId: "grammar" },
      { id: "q46", label: "第 46 题", level: 3, kind: "question", parentId: "h2" }
    ];
    place("h2", -400, 20);
    place("grammar", -300, 700);
    for (const id of ["q36", "q37", "q38"]) place(id, 0, 0);
    place("blank_36", 200, 18);
    place("blank_37", 700, 18);
    // The writing task runs over a page break: its first piece is above the screen, the second on it.
    place("q46", -200, 120);
    place("q46", 450, 80);
    expect([...visibleOutlineIds(scroller, passage)].sort()).toEqual(["h2", "q36", "q38", "q46"]);
  });

  it("fades out of the way of a question's margin controls and lets the pointer through to them", () => {
    const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
    const rail = rect(980, 300, 20, 160);
    expect(railYields(rail, [rect(940, 280, 70, 64)])).toBe(true);
    expect(railYields(rail, [rect(940, 470, 70, 64)])).toBe(false);
    expect(railYields(rail, [rect(980, 300, 0, 0)])).toBe(false);

    const controls = document.createElement("div");
    controls.className = "chalklee-question-add";
    scroller.appendChild(controls);
    window.HTMLElement.prototype.getBoundingClientRect = () => rail;
    controls.getBoundingClientRect = () => rect(940, 280, 70, 64);
    const { rail: railElement } = mount();
    expect(railElement()!.hasAttribute("data-yielding")).toBe(true);
    controls.getBoundingClientRect = () => rect(940, 620, 70, 64);
    act(() => { scroller.dispatchEvent(new window.Event("scroll")); });
    advanceFrame();
    expect(railElement()!.hasAttribute("data-yielding")).toBe(false);
  });

  it("packs the lines tighter for long papers without letting them merge", () => {
    expect(railStep(600, 20)).toBe(6);
    expect(railStep(600, 150)).toBe(4);
    expect(railStep(600, 1000)).toBe(4);
  });

  // A long handout: 3 units, each with 4 sections of 30 questions.
  const long: OutlineItem[] = Array.from({ length: 3 }, (_, unit) => [
    { id: `u${unit}`, label: `Unit ${unit + 1}`, level: 2, kind: "heading" as const },
    ...Array.from({ length: 4 }, (_, section) => [
      { id: `u${unit}s${section}`, label: `${section + 1}. 用法`, level: 3, kind: "heading" as const },
      ...Array.from({ length: 30 }, (_, question) => ({ id: `u${unit}s${section}q${question}`, label: `第 ${question + 1} 题`, level: 4, kind: "question" as const }))
    ]).flat()
  ]).flat();
  const covers = (marks: ReturnType<typeof railMarks>) => marks.flatMap(mark => mark.items.map(item => item.id));
  const height = (marks: ReturnType<typeof railMarks>) => marks.reduce((sum, mark) => sum + (mark.heading ? 1.6 : 1), 0);

  it("gives every entry its own line while they fit, then lets neighbouring questions share lines", () => {
    expect(railMarks(outline, 100).map(mark => mark.items.length)).toEqual([1, 1, 1, 1]);
    const marks = railMarks(long, 120);
    expect(covers(marks)).toEqual(long.map(item => item.id));
    expect(height(marks)).toBeLessThanOrEqual(120);
    // Every heading keeps its own line; the questions below each share a few.
    expect(marks.filter(mark => mark.heading).map(mark => mark.key)).toEqual(long.filter(item => item.kind === "heading").map(item => item.id));
    expect(marks.find(mark => mark.items.some(item => item.id === "u1s2q5"))?.items.length).toBeGreaterThan(1);
  });

  it("merges the deepest headings into their section next, and shares everything evenly as a last resort", () => {
    const sections = railMarks(long, 20);
    expect(covers(sections)).toEqual(long.map(item => item.id));
    expect(height(sections)).toBeLessThanOrEqual(20);
    expect(sections.filter(mark => mark.heading).map(mark => mark.key)).toEqual(["u0", "u1", "u2"]);
    const even = railMarks(long, 4);
    expect(covers(even)).toEqual(long.map(item => item.id));
    expect(even).toHaveLength(4);
    expect(even.every(mark => !mark.heading)).toBe(true);
  });

  it("darkens and colours a shared line for any entry in it", () => {
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 48 + 4 * 20 });
    const { track } = mount({ outline: long, currentQuestionId: "u1s2q5" });
    const marks = Array.from(track().querySelectorAll("i"));
    expect(marks.length).toBeLessThan(long.length);
    expect(marks.filter(mark => mark.classList.contains("is-current"))).toHaveLength(1);
    expect(marks.filter(mark => mark.classList.contains("is-heading")).map(mark => mark.className)).toEqual(Array(3).fill("question-rail-mark is-heading level-2"));
  });

  it("shows question preview instead of repeating the numbered title", () => {
    expect(questionOutlinePresentation("第 1 题 · 几何模型")).toEqual({ index: "1", text: "几何模型", unnumbered: false });
    expect(questionOutlinePresentation("题组 A · 阅读材料")).toEqual({ index: "A", text: "阅读材料", unnumbered: false });
    expect(questionOutlinePresentation("第 12 题")).toEqual({ index: "12", text: "第 12 题", unnumbered: false });
    expect(questionOutlinePresentation("题目 · 假如你是李华")).toEqual({ index: "–", text: "假如你是李华", unnumbered: true });
  });
});
