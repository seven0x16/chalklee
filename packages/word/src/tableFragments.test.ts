import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTableCellPageCut, measureTableFragments, renderTableFragment, type TableFragmentGeometry } from "./tableFragments";
import type { ParagraphBox } from "./pagination";

beforeEach(() => { const { document } = parseHTML("<html><body></body></html>"); vi.stubGlobal("document", document); });
afterEach(() => vi.unstubAllGlobals());
const paragraph = (top: number, lines: number, props: Partial<ParagraphBox> = {}): ParagraphBox => ({ top, bottom: top + lines * 20,
  lines: Array.from({ length: lines }, (_, i) => ({ top: top + i * 20, bottom: top + (i + 1) * 20 })), ...props });
function constraints(...groups: ParagraphBox[][]) {
  return createTableCellPageCut(new Map([[document.createElement("table"),
    { rows: [{ cells: groups.map(ps => ({ paragraphs: [ps] })) }] } as TableFragmentGeometry]]));
}
function source() {
  const flow = document.createElement("div");
  flow.innerHTML = '<table data-word-block="table"><tbody><tr data-word-table-row="0"><td data-word-column="0"><div class="chalk-word-cell-content"><p data-word-block="a">A</p></div></td><td data-word-column="1"><div class="chalk-word-cell-content"><p data-word-block="b">B</p></div></td></tr><tr data-word-table-row="1"><td data-word-column="0"><div class="chalk-word-cell-content"><p data-word-block="c">C</p><p data-word-block="d"><b>D</b><img src="blob:picture" alt="picture"></p></div></td><td data-word-column="1"><div class="chalk-word-cell-content"><p data-word-block="e">E</p></div></td></tr></tbody></table>';
  const rect = (el: HTMLElement, top: number, bottom: number, left: number, width: number) => { el.getBoundingClientRect = () => ({ top, bottom, height: bottom - top, left, right: left + width, width } as DOMRect); };
  const table = flow.firstElementChild as HTMLElement; rect(table, 50, 250, 20, 200);
  for (const [i, row] of Array.from(table.querySelectorAll<HTMLElement>("tr")).entries()) {
    rect(row, 50 + i * 100, 150 + i * 100, 20, 200);
    for (const [j, cell] of Array.from(row.children).entries()) {
      rect(cell as HTMLElement, 50 + i * 100, 150 + i * 100, 20 + j * 100, 100);
      rect(cell.firstElementChild as HTMLElement, 55 + i * 100, 145 + i * 100, 25 + j * 100, 90);
      for (const [k, p] of Array.from(cell.querySelectorAll<HTMLElement>("p")).entries()) rect(p, 55 + i * 100 + k * 50, 95 + i * 100 + k * 50, 25 + j * 100, 90);
      for (const image of cell.querySelectorAll<HTMLElement>("img")) rect(image, 205, 245, 25 + j * 100, 40);
    }
  }
  return { flow, table };
}

describe("table cell continuation", () => {
  it("applies keep-lines, keep-next and widow control within each cell", () => {
    expect(constraints([paragraph(100, 4, { keepLines: true })])(0, 160, 160)).toBe(100);
    expect(constraints([paragraph(100, 2, { keepNext: true }), paragraph(140, 3, { keepLines: true })])(0, 160, 160)).toBe(100);
    expect(constraints([paragraph(100, 4, { widowControl: true })])(0, 160, 160)).toBe(140);
  });

  it("keeps chains out of adjacent cells and relaxes impossible constraints to make progress", () => {
    expect(constraints([paragraph(100, 2, { keepNext: true })], [paragraph(140, 3, { keepLines: true })])(0, 160, 160)).toBe(140);
    expect(constraints([paragraph(100, 20, { keepLines: true, widowControl: true })])(100, 260, 160)).toBe(260);
    expect(constraints([paragraph(100, 2, { keepNext: true }), paragraph(140, 20, { keepLines: true })])(0, 160, 160)).toBe(160);
    expect(constraints([paragraph(100, 2, { keepNext: true }), paragraph(140, 3, { keepLines: true, breakBefore: true })])(0, 160, 160)).toBe(140);
  });

  it("retains constraints from an earlier tall cell even when other cells start in a different vertical order", () => {
    const cut = constraints([paragraph(680, 2, { keepNext: true }), paragraph(720, 2, { keepLines: true })],
      [paragraph(580, 8, { widowControl: true })], [paragraph(755, 3, { keepLines: true })]);
    expect(cut(530, 729, 200)).toBe(680);
    expect(cut(745, 790, 200)).toBe(755);
    expect(cut(820, 880, 200)).toBe(880);
  });

  it("remeasures no geometry while fragmenting and retains only this page's rows, cell blocks and images", () => {
    const { flow, table } = source(), before = table.outerHTML;
    const measured = measureTableFragments(flow, 0, new Map()).get(table)!;
    expect(measured.canFragment).toBe(true);
    for (const el of [table, ...Array.from(table.querySelectorAll<HTMLElement>("*"))]) el.getBoundingClientRect = () => { throw Error("unexpected remeasure"); };
    const pages = [[50, 150], [150, 200], [200, 250]].map(([a, b]) => renderTableFragment(measured, a!, b!));
    expect(pages.map(p => p.textContent)).toEqual(["AB", "CE", "D"]);
    expect(pages.map(p => p.querySelectorAll("tr").length)).toEqual([1, 1, 1]);
    expect(pages.map(p => p.querySelectorAll("img").length)).toEqual([0, 0, 1]);
    expect(pages[2]!.querySelector("b")?.textContent).toBe("D");
    expect(pages[2]!.querySelector("img")?.getAttribute("src")).toBe("blob:picture");
    expect(table.outerHTML).toBe(before);
  });

  it("preserves horizontally merged cells, column geometry and partial-paragraph clipping", () => {
    const { flow, table } = source();
    const cell = table.querySelector("td")!; cell.colSpan = 2; cell.nextElementSibling!.remove();
    // The merged cell covers both original columns.
    cell.getBoundingClientRect = () => ({ top: 50, bottom: 150, height: 100, left: 20, right: 220, width: 200 } as DOMRect);
    const measured = measureTableFragments(flow, 0, new Map()).get(table)!;
    const first = renderTableFragment(measured, 50, 75), follow = renderTableFragment(measured, 75, 150);
    expect(first.querySelector("td")!.getAttribute("colspan")).toBe("2");
    expect(first.querySelectorAll("col").length).toBe(2);
    expect(first.textContent).toBe("A"); expect(follow.textContent).toBe("A");
    expect(parseFloat((follow.querySelector("p") as HTMLElement).style.top)).toBe(-20);
  });

  it("retains the established geometry path for vertical merges, exact-height and nested tables", () => {
    for (const kind of ["merge", "exact", "nested"]) {
      const { flow, table } = source();
      if (kind === "merge") table.querySelector("td")!.rowSpan = 2;
      if (kind === "exact") table.querySelector("tr")!.dataset.wordExactHeight = "true";
      if (kind === "nested") table.querySelector(".chalk-word-cell-content")!.append(document.createElement("table"));
      expect(measureTableFragments(flow, 0, new Map()).get(table)!.canFragment).toBe(false);
    }
  });

  it("does not connect keep-next chains across a nested table", () => {
    const { flow, table } = source();
    table.querySelector<HTMLElement>('[data-word-block="c"]')!.dataset.keepNext = "true";
    const next = table.querySelector<HTMLElement>('[data-word-block="d"]')!; next.dataset.keepLines = "true";
    const nested = document.createElement("table");
    nested.getBoundingClientRect = () => ({ top: 195, bottom: 205, left: 25, width: 90, height: 10 } as DOMRect);
    next.before(nested);
    const measured = measureTableFragments(flow, 0, new Map());
    expect(createTableCellPageCut(measured)(0, 220, 160)).toBe(205);
  });

  it("does not paginate invisible overflow from a fixed-height cell", () => {
    const { flow, table } = source(), p = table.querySelector<HTMLElement>('[data-word-block="a"]')!;
    p.dataset.keepLines = "true";
    const content = p.parentElement!, frame = document.createElement("div"); frame.className = "chalk-word-cell-frame";
    frame.getBoundingClientRect = () => ({ top: 55, bottom: 75, left: 25, width: 90, height: 20 } as DOMRect);
    content.before(frame); frame.append(content);
    expect(createTableCellPageCut(measureTableFragments(flow, 0, new Map()))(0, 80, 160)).toBe(80);
  });

  it("retains visible inline image overflow outside a paragraph, falling back for cell overflow", () => {
    const { flow, table } = source(), image = table.querySelector("img")!;
    image.getBoundingClientRect = () => ({ top: 190, bottom: 245, height: 55, left: 25, right: 65, width: 40 } as DOMRect);
    const measured = measureTableFragments(flow, 0, new Map()).get(table)!;
    expect(measured.canFragment).toBe(true);
    expect(renderTableFragment(measured, 150, 200).querySelector("img")).not.toBeNull();
    image.getBoundingClientRect = () => ({ top: 190, bottom: 270, height: 80, left: 25, right: 65, width: 40 } as DOMRect);
    expect(measureTableFragments(flow, 0, new Map()).get(table)!.canFragment).toBe(false);
  });
});
