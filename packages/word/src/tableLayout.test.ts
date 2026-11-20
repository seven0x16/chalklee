import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { layoutWord, renderWordBlocks } from "./layout";
import { paragraph, type WordBlock, type WordTable } from "./model";
import { measureTableRows, repeatedTableHeader, tableRowPageCut } from "./tableLayout";

let host: HTMLElement;
let collapsedBorder = false;
let rowInk: { top: number; bottom: number }[] = [];
let paragraphHeights = new Map<string, number>();
const p = (label: string) => { const result = paragraph(label); result.inlines = [{ kind: "text", text: label, style: {} }]; return result; };
const table = (heights: number[], headerRows: number, cantSplit: boolean): WordTable => ({
  kind: "table", id: "table", widths: [180], headerRows,
  rowProperties: heights.map(height => ({ height, heightRule: "atLeast", cantSplit })),
  rows: heights.map((_, i) => [{ span: 1, blocks: [p(i === 0 && headerRows ? "header" : `row${i}`)] }]),
});
const layout = (blocks: WordBlock[]) => layoutWord({ format: "docx", sections: [{ page: { width: 200, height: 200, top: 20, bottom: 20, left: 10, right: 10 }, header: [], footer: [], blocks }], assets: [], warnings: [] }, host, [], new AbortController().signal);

beforeEach(() => {
  collapsedBorder = false;
  rowInk = [];
  paragraphHeights = new Map();
  const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document); vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4 });
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() } });
  const create = document.createElement.bind(document);
  function height(el: HTMLElement): number {
    if (el.tagName === "P") return paragraphHeights.get(el.dataset.wordBlock!) ?? (el.dataset.wordBlock === "intro" ? 80 : 20);
    if (el.tagName === "TR") return parseFloat(el.style.height) || 20;
    if (el.tagName === "COLGROUP" || el.tagName === "COL") return 0;
    return Array.from(el.children).reduce((sum, c) => sum + height(c as HTMLElement), 0);
  }
  function top(el: HTMLElement): number {
    if (el === host || !el.parentElement) return 0;
    let result = top(el.parentElement);
    for (let sibling = el.previousElementSibling; sibling; sibling = sibling.previousElementSibling) result += height(sibling as HTMLElement);
    return result;
  }
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const el = create(tag);
    el.getBoundingClientRect = () => { const y = top(el) + (collapsedBorder && tag === "tr" ? .5 : 0), h = height(el); return { top: y, bottom: y + h, height: h, left: 0, right: 180, width: 180 } as DOMRect; };
    return el;
  }) as typeof document.createElement);
  vi.spyOn(document, "createTreeWalker").mockImplementation(((flow: HTMLElement) => {
    const texts = rowInk.length ? Array.from(flow.querySelectorAll("td p span")).flatMap(span => Array.from(span.childNodes).filter(n => n.nodeType === 3)) : [];
    let index = 0; return { nextNode: () => texts[index++] ?? null } as unknown as TreeWalker;
  }) as typeof document.createTreeWalker);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    let node: Node;
    return { selectNodeContents: (value: Node) => { node = value; }, getClientRects: () => {
      const y = node.parentElement!.closest("tr")!.getBoundingClientRect().top;
      return rowInk.map(b => ({ top: y + b.top, bottom: y + b.bottom, height: b.bottom - b.top }));
    } } as unknown as Range;
  });
  host = create("div");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Word table page flow", () => {
  it("keeps the plain post-table paragraph on the section's last page instead of splitting off a blank page", async () => {
    const blank = paragraph("blank"), end = paragraph("end"); end.sectionBreakAfter = true;
    const t = table([150], 0, false), blocks = [t, blank, end], before = JSON.stringify(blocks);
    const page = { width: 200, height: 200, top: 20, bottom: 20, left: 10, right: 10 };
    const result = await layoutWord({ format: "docx", assets: [], warnings: [], sections: [
      { page, header: [], footer: [], blocks }, { page, header: [], footer: [], blocks: [p("following")], breakType: "nextPage" }
    ] }, host, [], new AbortController().signal);
    expect(result.pages.map(p => p.contentHeight)).toEqual([160, 20]);
    const root = document.createElement("div"); root.innerHTML = result.pages[0]!.html;
    expect(root.querySelector('[data-word-block="blank"]')).not.toBeNull();
    expect(result.pages[1]!.html).toContain("following"); expect(JSON.stringify(blocks)).toBe(before);
    const odd = await layoutWord({ format: "docx", assets: [], warnings: [], sections: [
      { page, header: [], footer: [], blocks }, { page, header: [], footer: [], blocks: [p("following")], breakType: "oddPage" }
    ] }, host, [], new AbortController().signal);
    expect(odd.pages).toHaveLength(3); expect(odd.pages[1]!.html).toBe(""); expect(odd.pages[2]!.html).toContain("following");
  });

  it.each(["spacing", "fixed", "break", "decoration", "extra-blank", "continuous"])("preserves intentional post-table blank space or pagination: %s", async reason => {
    const blank = paragraph("blank"), end = paragraph("end"); end.sectionBreakAfter = true;
    if (reason === "spacing") blank.style.before = 10;
    if (reason === "fixed") { blank.style.lineRule = "exact"; blank.style.linePixels = 20; }
    if (reason === "break") blank.pageBreakBefore = true;
    if (reason === "decoration") blank.textStyle.background = "#eeeeee";
    const blocks: WordBlock[] = [table([150], 0, false), ...(reason === "extra-blank" ? [paragraph("extra")] : []), blank, end];
    const page = { width: 200, height: 200, top: 20, bottom: 20, left: 10, right: 10 };
    const result = await layoutWord({ format: "docx", assets: [], warnings: [], sections: [
      { page, header: [], footer: [], blocks }, { page, header: [], footer: [], blocks: [p("following")], breakType: reason === "continuous" ? "continuous" : "nextPage" }
    ] }, host, [], new AbortController().signal);
    if (reason !== "continuous") expect(result.pages.length).toBeGreaterThan(2);
    else expect(result.pages[1]!.contentHeight).toBe(30);
  });

  it("moves a cell's kept title and body together, retaining the source and following text", async () => {
    const t = table([120], 0, false), title = p("title"), body = p("body");
    title.style.keepNext = true; body.style.keepLines = true;
    paragraphHeights.set("body", 80); t.rows[0]![0]!.blocks = [title, body];
    const model = JSON.stringify(t), result = await layout([p("intro"), t, p("tail")]);
    expect(result.pages.map(p => p.contentHeight)).toEqual([80, 140]);
    const parts = result.pages.map(page => { const root = document.createElement("div"); root.innerHTML = page.html; return root; });
    expect(parts[0]!.querySelector("table")).toBeNull();
    expect(parts[1]!.textContent).toBe("titlebodytail");
    expect(JSON.stringify(t)).toBe(model);
  });

  it("continues an oversized kept cell rather than pushing it forever", async () => {
    const t = table([400], 0, false), body = p("body"); body.style.keepLines = true;
    paragraphHeights.set("body", 400); t.rows[0]![0]!.blocks = [body];
    const result = await layout([p("intro"), t, p("tail")]);
    expect(result.pages.map(p => p.contentHeight)).toEqual([160, 160, 160, 20]);
    expect(result.pages.at(-1)!.html).toContain("tail");
  });

  it("renders a short row once on the next page when only its padding would cross the boundary", async () => {
    rowInk = [{ top: 10, bottom: 25 }];
    const t = table([90], 0, false), before = JSON.stringify(t);
    const result = await layout([p("intro"), t, p("tail")]);
    expect(result.pages.map(p => p.contentHeight)).toEqual([80, 110]);
    const first = document.createElement("div"); first.innerHTML = result.pages[0]!.html;
    const second = document.createElement("div"); second.innerHTML = result.pages[1]!.html;
    expect(first.querySelector("table")).toBeNull();
    expect(second.querySelector("table")?.textContent).toBe("row0");
    expect(JSON.stringify(t)).toBe(before);
  });

  it("moves a row when a split would leave only its leading or trailing padding", () => {
    const rows = [{ top: 100, bottom: 140, lines: [{ top: 112, bottom: 128 }] }];
    expect(tableRowPageCut(0, 108, 160, rows)).toBe(100);
    expect(tableRowPageCut(0, 134, 160, rows)).toBe(100);
  });

  it("keeps real multi-line row splits and leaves the last line with trailing padding", () => {
    const rows = [{ top: 40, bottom: 140, lines: [{ top: 50, bottom: 70 }, { top: 90, bottom: 110 }] }];
    expect(tableRowPageCut(0, 80, 160, rows)).toBe(80);
    expect(tableRowPageCut(0, 130, 160, rows)).toBe(90);
  });

  it("preserves progress for oversized rows and source-required blank rows", () => {
    expect(tableRowPageCut(0, 150, 160, [{ top: 40, bottom: 240, lines: [{ top: 50, bottom: 70 }] }])).toBe(150);
    expect(tableRowPageCut(40, 130, 160, [{ top: 40, bottom: 140, lines: [{ top: 50, bottom: 70 }] }])).toBe(130);
    expect(tableRowPageCut(0, 130, 160, [{ top: 40, bottom: 140, lines: [] }])).toBe(130);
  });

  it("measures row ink with collapsed outer edges and keeps the initial header with its first body row", () => {
    collapsedBorder = true;
    host.append(renderWordBlocks([p("intro"), table([20, 60], 1, false)], [], 160));
    const rows = measureTableRows(host, 0, [{ top: 85, bottom: 95 }, { top: 120, bottom: 140 }]);
    expect(rows).toEqual([
      { top: 80, bottom: 100.5, lines: [{ top: 85, bottom: 95 }] },
      { top: 80, bottom: 160, lines: [{ top: 120, bottom: 140 }] },
    ]);
    expect(tableRowPageCut(0, 110, 160, rows)).toBe(80);
  });

  it("respects explicit allow-split rows while moving rows that must stay together to an empty page", async () => {
    const split = await layout([p("intro"), table([120], 0, false), p("tail")]);
    const kept = await layout([p("intro"), table([120], 0, true), p("tail")]);
    expect(split.pages.map(p => p.contentHeight)).toEqual([160, 60]);
    expect(kept.pages.map(p => p.contentHeight)).toEqual([80, 140]);
  });

  it("moves collapsed outer borders with an intact first row, leaving no half-pixel table fragment behind", async () => {
    collapsedBorder = true;
    const result = await layout([p("intro"), table([120], 0, true), p("tail")]);
    expect(result.pages.map(p => p.contentHeight)).toEqual([80, 140]);
    const first = document.createElement("div"); first.innerHTML = result.pages[0]!.html;
    expect(first.querySelector("table")).toBeNull();
  });

  it("reserves repeat-header height, keeps each body row visible exactly once and updates header page fields", async () => {
    const t = table([20, 60, 60, 60, 60, 60], 1, true);
    const header = t.rows[0]![0]!.blocks[0]!;
    if (header.kind !== "paragraph") throw Error("missing header");
    header.inlines.push({ kind: "page-number" });
    const before = JSON.stringify(t), result = await layout([t, p("tail")]);
    expect(JSON.stringify(t)).toBe(before);
    expect(result.pages.map(p => p.contentHeight)).toEqual([140, 140, 100]);
    const visible: string[] = [], repeated: string[] = [];
    for (const page of result.pages) {
      const root = document.createElement("div"); root.innerHTML = page.html;
      const head = root.querySelector('[data-word-repeat-header="true"]'); if (head) repeated.push(head.textContent!);
      for (const p of root.querySelectorAll<HTMLElement>('.chalk-word-table-fragment p[data-word-block]')) {
        if (p.dataset.wordBlock !== "header") visible.push(p.dataset.wordBlock!);
      }
    }
    expect(visible).toEqual(["row1", "row2", "row3", "row4", "row5"]);
    expect(repeated).toEqual(["header2", "header3"]);
  });

  it("splits an oversized row without orphaning its initial header or getting stuck", async () => {
    const result = await layout([table([20, 150], 1, true), p("tail")]);
    expect(result.pages.map(p => p.contentHeight)).toEqual([160, 50]);
    expect(result.pages[0]!.html).toContain("row1");
  });

  it("omits an oversized repeat header and never repeats a header on the table's first fragment or after the table", () => {
    const tables = [{ top: 40, bottom: 500, headerEnd: 80, headerHeight: 40, headerHtml: "header" }];
    expect(repeatedTableHeader(tables, 40, 160)).toBeUndefined();
    expect(repeatedTableHeader(tables, 200, 160)).toBe(tables[0]);
    expect(repeatedTableHeader(tables, 200, 40)).toBeUndefined();
    expect(repeatedTableHeader(tables, 500, 160)).toBeUndefined();
  });
});
