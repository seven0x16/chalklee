import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { layoutWord, type ChalkWordLayout } from "./layout";
import { paragraph, type WordParagraph, type WordSection } from "./model";

let host: HTMLElement;
const heights: Record<string, number> = { one: 100, two: 100, three: 20, h1: 10, h2: 10 };
const page = { width: 200, height: 200, top: 20, bottom: 20, left: 10, right: 10, header: 0, footer: 0 };
const p = (id: string): WordParagraph => {
  const result = paragraph(id); result.inlines = [{ kind: "text", text: id, style: {} }, { kind: "page-number" }, { kind: "text", text: "/", style: {} }, { kind: "section-page-count" }];
  return result;
};
const section = (id: string, extra: Partial<WordSection> = {}): WordSection => ({ page, blocks: [p(id)], header: [p(id === "one" ? "h1" : "h2")], footer: [], ...extra });
const layout = (sections: WordSection[]) => layoutWord({ format: "docx", sections, assets: [], warnings: [] }, host, [], new AbortController().signal);
const text = (html: string) => { const el = document.createElement("div"); el.innerHTML = html; return el.textContent; };

beforeEach(() => {
  const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document); vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4 });
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() } });
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const el = create(tag);
    el.getBoundingClientRect = () => {
      const height = heights[el.dataset.wordBlock!] ?? Array.from(el.children).reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
      let top = 0;
      if (el.dataset.wordBlock) for (let sibling = el.previousElementSibling; sibling; sibling = sibling.previousElementSibling) top += sibling.getBoundingClientRect().height;
      return { top, bottom: top + height, left: 0, right: 180, width: 180, height } as DOMRect;
    };
    return el;
  }) as typeof document.createElement);
  vi.spyOn(document, "createTreeWalker").mockReturnValue({ nextNode: () => null } as unknown as TreeWalker);
  host = create("div");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("continuous Word sections", () => {
  it("publishes settled pages before completion without exposing a mutable continuous-section tail", async () => {
    const one = section("one"), two = section("two", { breakType: "continuous" }), three = section("three", { breakType: "continuous" });
    const before = JSON.stringify([one, two, three]), snapshots: { height: number; html: string }[] = [];
    const result = await layoutWord({ format: "docx", assets: [], warnings: [], sections: [one, two, three] }, host, [], new AbortController().signal, {
      onProgress: partial => {
        expect(partial.pages).toHaveLength(1);
        const page = partial.pages[0]!; snapshots.push({ height: page.contentHeight, html: page.html }); Object.freeze(page);
      }
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.height).toBe(160);
    expect(text(snapshots[0]!.html)).toContain("two1/…");
    expect(text(snapshots[0]!.html)).not.toContain("three");
    expect(text(result.pages[0]!.html)).toContain("two1/2");
    expect(JSON.stringify([one, two, three])).toBe(before);
  });

  it("publishes a complete first section before preparing later pages and honours close during the yield", async () => {
    const controller = new AbortController(), progress = vi.fn((_partial: ChalkWordLayout) => controller.abort());
    await expect(layoutWord({ format: "docx", assets: [], warnings: [], sections: [section("one"), section("two")] }, host, [], controller.signal, { onProgress: progress })).rejects.toThrow();
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls[0]![0].pages).toHaveLength(1);
    expect(progress.mock.calls[0]![0].pages[0].html).not.toContain("two");
  });

  it("continues on the current paper, keeps each section's page counts and preserves later page headers", async () => {
    const two = section("two", { breakType: "continuous" }); (two.blocks[0] as WordParagraph).heading = 1;
    const result = await layout([section("one"), two, section("three", { breakType: "continuous" })]);
    expect(result.pages).toHaveLength(2);
    expect(result.pages.map(p => p.contentHeight)).toEqual([160, 60]);
    expect(result.pages.map(p => p.number)).toEqual([1, 2]);
    expect(result.pages[0]!.sectionIndices).toEqual([0, 1]);
    expect(result.pages[1]!.sectionIndices).toEqual([1, 2]);
    expect(text(result.pages[0]!.html)).toContain("one1/1");
    expect(text(result.pages[0]!.html)).toContain("two1/2");
    expect(text(result.pages[1]!.html)).toContain("two2/2");
    expect(text(result.pages[1]!.html)).toContain("three2/1");
    expect(text(result.pages[0]!.header)).toBe("h11/1");
    expect(text(result.pages[1]!.header)).toBe("h22/2");
    expect(result.outline[0]!.target).toEqual({ page: 1 });
  });

  it.each(["keepLines", "before", "after", "geometry", "restart"])("starts a fresh page when required by %s", async reason => {
    const one = section("one"), two = section("two", { breakType: "continuous" });
    if (reason === "keepLines") (two.blocks[0] as WordParagraph).style.keepLines = true;
    if (reason === "before") (two.blocks[0] as WordParagraph).pageBreakBefore = true;
    if (reason === "after") (one.blocks[0] as WordParagraph).pageBreakAfter = true;
    if (reason === "geometry") two.page = { ...page, width: 300 };
    if (reason === "restart") two.pageNumberStart = 1;
    const result = await layout([one, two]);
    expect(result.pages).toHaveLength(2);
    expect(text(result.pages[0]!.html)).not.toContain("two");
    expect(text(result.pages[1]!.html)).toContain("two");
    expect(result.pages[0]!.contentHeight).toBe(100);
    if (reason === "restart") expect(result.pages[1]!.number).toBe(1);
  });

  it("inserts only the parity page required by odd/even section starts, then restarts numbering", async () => {
    const odd = await layout([section("one"), section("two", { breakType: "oddPage", pageNumberStart: 1 })]);
    expect(odd.pages.map(p => p.number)).toEqual([1, 2, 1]);
    expect(odd.pages[1]).toMatchObject({ html: "", header: "", footer: "", contentHeight: 0 });
    expect(text(odd.pages[2]!.html)).toContain("two1/1");
    const even = await layout([section("one"), section("two", { breakType: "evenPage" })]);
    expect(even.pages).toHaveLength(2);
    expect(text(even.pages[1]!.html)).toContain("two2/1");
  });
});
