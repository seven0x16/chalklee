import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import { findQuestionCard, readQuestionListPosition, restoreQuestionListPosition } from "./questionCardViewport";

const questionKey = "/workspace/卷子.chalklee\u0000second";

function listWithFirstCardHeight(height: number) {
  const { window, document } = parseHTML("<div id='list'><div id='content'><article></article><article></article><button>显示更多</button></div></div>");
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  const list = document.getElementById("list") as unknown as HTMLElement;
  const content = document.getElementById("content") as unknown as HTMLElement;
  list.scrollTop = 0;
  Object.defineProperty(list, "clientTop", { value: 0 });
  list.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
  const rect = (position: number, size: number) => {
    const top = 100 + position - list.scrollTop;
    return { top, bottom: top + size } as DOMRect;
  };
  const [first, second, footer] = Array.from(content.children) as HTMLElement[];
  first.dataset.questionKey = "first";
  second.dataset.questionKey = questionKey;
  first.getBoundingClientRect = () => rect(0, height);
  second.getBoundingClientRect = () => rect(height + 12, 200);
  footer.getBoundingClientRect = () => rect(height + 224, 24);
  return { list, content, second };
}

afterEach(() => vi.unstubAllGlobals());

it("restores a search tab to the same cut in the same card when preceding formatting changes its height", () => {
  const before = listWithFirstCardHeight(80);
  before.list.scrollTop = 112;
  const position = readQuestionListPosition(before.list, before.content);
  expect(position).toEqual({ key: questionKey, scrollTop: 112, offset: -20 });

  const after = listWithFirstCardHeight(160);
  expect(findQuestionCard(after.content, questionKey)).toBe(after.second);
  restoreQuestionListPosition(after.list, after.content, position);
  expect(readQuestionListPosition(after.list, after.content)).toEqual({ key: questionKey, scrollTop: 192, offset: -20 });
});

it("uses the recorded scroll offset when the result card is gone", () => {
  const { list, content } = listWithFirstCardHeight(80);
  restoreQuestionListPosition(list, content, { key: "removed", scrollTop: 140, offset: -92 });
  expect(list.scrollTop).toBe(140);
  restoreQuestionListPosition(list, content);
  expect(list.scrollTop).toBe(0);
});

it("keeps the same question in view when its saved offset falls beyond the shorter card", () => {
  const { list, content } = listWithFirstCardHeight(80);
  restoreQuestionListPosition(list, content, { key: questionKey, scrollTop: 400, offset: -308 });
  expect(readQuestionListPosition(list, content)).toEqual({ key: questionKey, scrollTop: 92, offset: 0 });
});
