import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyChalkLeeDocument } from "../../../shared/document/newDocument";
import { createChalkLeePaginatedPrintRoot } from "./paginatedPrint";

describe("printing the editor's sheets", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves each sheet's offset and the laid-out content without changing the live paper", () => {
    const { document } = parseHTML(`<article class="chalklee-paper hide-answers" style="transform:scale(.8)" data-zoom=".8">
      <div class="chalklee-paper-sheets"><div class="chalklee-paper-sheet" style="top:0px"></div><div class="chalklee-paper-sheet" style="top:1154px"></div></div>
      <div class="chalklee-editor-content" contenteditable="true">
        <h1>试卷</h1>
        <table><tbody><tr><td>第一页</td></tr><tr class="chalklee-page-gap"></tr>
          <tr class="chalklee-page-repeat-header"><td>续页表头</td></tr><tr><td>第二页</td></tr></tbody></table>
        <img src="animated.svg" data-chalklee-print-src="static.svg">
      </div>
    </article>`);
    const paper = document.querySelector("article")! as unknown as HTMLElement;
    const rect = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;
    paper.querySelectorAll<HTMLElement>(".chalklee-paper-sheet").forEach((sheet, index) => {
      sheet.getBoundingClientRect = () => rect(index * 1154, index * 1154 + 1122);
    });
    paper.querySelector("h1")!.getClientRects = () => [rect(5, 20)] as unknown as DOMRectList;
    const before = paper.outerHTML;
    const options = { answers: false, analysis: true };
    const page = createEmptyChalkLeeDocument("试卷").appearance.page;
    const root = createChalkLeePaginatedPrintRoot(paper, page, options)!;
    const sheets = Array.from(root.querySelectorAll<HTMLElement>(".chalklee-print-sheet > .chalklee-paper"));
    expect(sheets.map(sheet => sheet.style.top)).toEqual(["-0px", "-1154px"]);
    expect(sheets[1].querySelector(".chalklee-page-repeat-header")?.textContent).toBe("续页表头");
    expect(sheets[1].querySelector("img")?.getAttribute("src")).toBe("static.svg");
    expect(sheets[1].querySelector("h1")?.style.visibility).toBe("hidden");
    expect(sheets[1].querySelector(".chalklee-editor-content")?.getAttribute("contenteditable")).toBe("false");
    expect(sheets[1].style.transform ?? "").toBe("");
    expect(createChalkLeePaginatedPrintRoot(paper, page, { ...options, answers: true })).toBeNull();
    expect(createChalkLeePaginatedPrintRoot(paper, page, { ...options, solutionPlacement: "end" })).toBeNull();
    expect(paper.outerHTML).toBe(before);
  });

  it.each([
    { mode: "single column", columns: 1, trimColumnFlow: false, authored: false, trim: true },
    { mode: "multiple columns for preview", columns: 2, trimColumnFlow: false, authored: false, trim: false },
    { mode: "multiple columns for print and export", columns: 2, trimColumnFlow: true, authored: false, trim: true },
    { mode: "multiple columns with authored styles", columns: 2, trimColumnFlow: true, authored: true, trim: false }
  ])("keeps flowing content and its continuation in $mode", ({ columns, trimColumnFlow, authored, trim }) => {
    const count = 4;
    const sheets = Array.from({ length: count }, (_, index) => `<div class="chalklee-paper-sheet" style="top:${index * 100}px"></div>`).join("");
    const blocks = Array.from({ length: 12 }, (_, index) => index === 4
      ? '<table><tbody><tr class="chalklee-page-repeat-header"><td>续页表头</td></tr></tbody></table>'
      : `<p>卷面第 ${index + 1} 段</p>`).join("");
    const { document } = parseHTML(`<article class="chalklee-paper" data-column-count="${columns}">
      <div class="chalklee-paper-sheets">${sheets}</div>
      <div class="chalklee-editor-content">${blocks}</div>
      ${authored ? '<style data-chalklee-design-sheet>p:last-child { font-weight: bold; }</style>' : ""}
    </article>`);
    const paper = document.querySelector("article")! as unknown as HTMLElement;
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect;
    paper.querySelectorAll(".chalklee-paper-sheet").forEach((sheet, index) => {
      sheet.getBoundingClientRect = () => rect(index * 100, 90);
    });
    const original = paper.querySelector(".chalklee-editor-content")!;
    Array.from(original.children).forEach((block, index) => {
      block.getBoundingClientRect = () => rect(index * 31, index === 4 ? 120 : 20);
    });
    const page = createEmptyChalkLeeDocument("试卷").appearance.page;
    const root = createChalkLeePaginatedPrintRoot(paper, page, {}, { trimColumnFlow })!;
    const pages = Array.from(root.querySelectorAll(".chalklee-print-sheet .chalklee-editor-content"));
    expect(pages).toHaveLength(count);
    expect(pages[1].querySelector(".chalklee-page-repeat-header")?.textContent).toBe("续页表头");
    expect(pages[0].textContent?.includes("卷面第 12 段")).toBe(!trim);
    expect(pages[3].innerHTML).toBe(original.innerHTML);
  });

  it("preserves the formula and its baseline near the measured page at a non-default zoom", () => {
    const sheets = Array.from({ length: 4 }, (_, index) => `<div class="chalklee-paper-sheet" style="top:${index * 50}px"></div>`).join("");
    const { document } = parseHTML(`<article class="chalklee-paper" data-column-count="2" data-zoom="2">
      <div class="chalklee-paper-sheets">${sheets}</div>
      <div class="chalklee-editor-content"><p><span data-chalklee-inline-math><span class="chalklee-math-render">
        <span class="ML__latex"><span class="ML__strut"></span><span class="ML__base"><span>公式</span></span></span>
      </span></span><span data-chalklee-inline-math><span class="chalklee-math-render">
        <span class="ML__latex"><span class="ML__strut"></span><span class="ML__base"><span>末页公式</span></span></span>
      </span></span></p></div>
    </article>`);
    vi.stubGlobal("getComputedStyle", () => ({ display: "inline-block", verticalAlign: "baseline", width: "20.0078px", height: "10.0078px" }));
    const paper = document.querySelector("article")! as unknown as HTMLElement;
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height, width: 40 }) as DOMRect;
    paper.querySelectorAll<HTMLElement>(".chalklee-paper-sheet").forEach((sheet, index) => {
      sheet.getBoundingClientRect = () => rect(index * 100, 90);
    });
    paper.querySelector("p")!.getBoundingClientRect = () => rect(120, 25);
    paper.querySelectorAll(".ML__strut").forEach((strut, index) => {
      strut.getBoundingClientRect = () => rect(index ? 322 : 122, 16);
    });
    paper.querySelectorAll(".ML__base").forEach((base, index) => {
      base.getClientRects = () => [rect(index ? 322 : 122, 20.015625)] as unknown as DOMRectList;
    });
    const before = paper.outerHTML;
    const page = createEmptyChalkLeeDocument("试卷").appearance.page;
    const root = createChalkLeePaginatedPrintRoot(paper, page, {}, { trimColumnFlow: true })!;
    const formulas = Array.from(root.querySelectorAll<HTMLElement>(".ML__base"));
    expect(formulas.map(formula => formula.textContent)).toEqual(["公式", "", "公式", "", "公式", "末页公式", "", "末页公式"]);
    for (const index of [1, 3, 6]) {
      expect(formulas[index].style.width).toBe("20.0078125px");
      expect(formulas[index].style.height).toBe("10.0078125px");
      expect(formulas[index].style.verticalAlign).toBe("-2.0078125px");
    }
    expect(paper.outerHTML).toBe(before);
  });

  it("omits hidden solution contents while keeping the visible link on its sheet", () => {
    const { document } = parseHTML(`<article class="chalklee-paper hide-answers">
      <div class="chalklee-paper-sheets"><div class="chalklee-paper-sheet" style="top:0px"></div></div>
      <div class="chalklee-editor-content">
        <div data-chalklee-region="answer"><a href="#hidden">答案</a><img src="answer.png"></div>
        <div data-chalklee-region="analysis"><a href="#visible">解析</a></div>
      </div>
    </article>`);
    const rect = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;
    const paper = document.querySelector("article")! as unknown as HTMLElement;
    paper.querySelector(".chalklee-paper-sheet")!.getBoundingClientRect = () => rect(0, 90);
    paper.querySelector('[href="#hidden"]')!.getClientRects = () => [] as unknown as DOMRectList;
    paper.querySelector('[href="#visible"]')!.getClientRects = () => [rect(10, 30)] as unknown as DOMRectList;
    const page = createEmptyChalkLeeDocument("试卷").appearance.page;
    const root = createChalkLeePaginatedPrintRoot(paper, page, { answers: false }, { trimColumnFlow: true })!;
    expect(root.querySelector('[data-chalklee-region="answer"]')?.childNodes).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('[href="#visible"]')?.style.visibility || "").toBe("");
    expect(paper.querySelector('img[src="answer.png"]')).not.toBeNull();
  });
});
