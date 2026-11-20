import { afterEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { createChalkLeePrintRoot } from "./printRoot";
import { chalkLeeGroupBody } from "./paginationMeasure";
import type { ChalkLeePageAppearance } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../../../shared/document/newDocument";
import { agentContentBlocks } from "../../../main/agent/content";

const page: ChalkLeePageAppearance = {
  size: "A4", orientation: "portrait", marginsPt: { top: 45, right: 45, bottom: 45, left: 45 },
  background: { type: "solid", color: "#ffffff" }, printBackground: false
};

function paperFixture(questions: string, kind = "grammar-fill") {
  const { document } = parseHTML(`<main class="chalklee-paper" data-zoom="1" data-column-count="1">
    <div class="chalklee-editor-content"><div class="node-questionGroup">
      <section class="chalklee-question-object group" data-node-id="group" data-question-kind="${kind}">
        <div class="chalklee-question-object-content"><div data-node-view-content-react>
          <div data-chalklee-region="material"><p>Read the passage and fill the blanks.</p></div>
          <div data-chalklee-subquestions>${questions}</div>
          <div class="chalklee-group-solution">Answers</div>
        </div></div>
      </section>
    </div></div>
  </main>`);
  vi.stubGlobal("document", document);
  const paper = document.querySelector("main")! as unknown as HTMLElement;
  const group = paper.querySelector<HTMLElement>(".group")!;
  group.getBoundingClientRect = () => ({ top: 0, bottom: 300, height: 300 }) as DOMRect;
  const body = group.querySelector<HTMLElement>("[data-chalklee-subquestions]")!;
  body.getBoundingClientRect = () => ({ top: 200, bottom: 250, height: 50 }) as DOMRect;
  return { paper, group };
}

afterEach(() => vi.unstubAllGlobals());

describe("question pagination in print", () => {
  it("removes the viewport clip when laying out a new flow for printing", () => {
    const { document } = parseHTML('<main class="chalklee-paper"><div class="chalklee-editor-surface" style="clip-path: inset(12px)"><div class="chalklee-editor-content"><p>Print this line</p></div></div></main>');
    vi.stubGlobal("document", document);
    const paper = document.querySelector("main")! as unknown as HTMLElement;
    const root = createChalkLeePrintRoot(paper, page);
    expect(root.querySelector<HTMLElement>(".chalklee-editor-surface")?.style.getPropertyValue("clip-path")).toBeFalsy();
    expect(paper.querySelector<HTMLElement>(".chalklee-editor-surface")?.style.getPropertyValue("clip-path")).toBe("inset(12px)");
  });

  it("keeps measured short questions together despite an imported inline split style", () => {
    const { paper } = paperFixture('<section class="chalklee-question-object" data-pagination-keep-together="true" style="break-inside:auto"><section data-chalklee-region="stem"><p>Translate the sentence.</p><p>________________</p></section></section>');
    const before = paper.outerHTML;
    const root = createChalkLeePrintRoot(paper, page);
    expect(root.querySelector<HTMLElement>('[data-pagination-keep-together="true"]')!.style.breakInside).toBe("avoid");
    expect(paper.outerHTML).toBe(before);
  });
  it("keeps a short table whole and repeats a table's header rows on every printed page", () => {
    const { document } = parseHTML(`<main class="chalklee-paper" data-zoom="1" data-column-count="1"><div class="chalklee-editor-content">
      <h3>单词</h3><div class="react-renderer node-table" id="block"><figure><table data-chalklee-table data-pagination-whole="true"><colgroup><col></colgroup><tbody><tr data-repeat-header="true"><td>单词</td></tr><tr><td>dinosaur</td></tr></tbody></table></figure></div>
      <table data-chalklee-table><tbody><tr data-repeat-header="true"><td>短语</td></tr><tr class="chalklee-page-gap chalklee-page-gap-table"><td></td></tr><tr><td>look up</td></tr></tbody></table>
    </div></main>`);
    vi.stubGlobal("document", document);
    const paper = document.querySelector("main")! as unknown as HTMLElement;
    const before = paper.outerHTML;
    const root = createChalkLeePrintRoot(paper, page);
    const [short, long] = Array.from(root.querySelectorAll<HTMLElement>("[data-chalklee-table]"));
    // The whole block beside the heading stays whole, so the heading moves along with it.
    expect(root.querySelector<HTMLElement>("#block")!.style.breakInside).toBe("avoid");
    expect(short.style.breakInside).toBe("avoid");
    expect(long.style.breakInside).not.toBe("avoid");
    for (const table of [short, long]) {
      expect(Array.from(table.children).map(child => child.tagName.toLowerCase())).toEqual(table === short ? ["colgroup", "thead", "tbody"] : ["thead", "tbody"]);
      expect(table.querySelector("thead")!.textContent).toBe(table === short ? "单词" : "短语");
      expect(table.querySelector("tbody")!.textContent).not.toContain(table === short ? "单词" : "短语");
    }
    expect(paper.outerHTML).toBe(before);
  });

  it("keeps a question's stem and options together while its answer and analysis may follow on the next page", () => {
    const regions = '<section data-chalklee-region="stem"><p>如图，求角的度数。</p></section><section data-chalklee-options></section>'
      + '<section data-chalklee-region="answer"><p>B</p></section><section data-chalklee-region="analysis"><p>本题考查平行线。</p><p>故选：B．</p></section>';
    const { paper } = paperFixture(`<section class="chalklee-question-object" data-pagination-split="true" data-pagination-keep-body="true" data-pagination-keep-regions="answer" style="break-inside:avoid">
      <div class="chalklee-question-object-content"><div data-node-view-content-react>${regions}</div></div></section>`);
    const question = createChalkLeePrintRoot(paper, page).querySelector<HTMLElement>('[data-pagination-keep-body="true"]')!;
    const [stem, options, answer, analysis] = Array.from(question.querySelector("[data-node-view-content-react]")!.children) as HTMLElement[];
    expect(question.style.breakInside).toBe("auto");
    expect([stem.style.breakInside, stem.style.breakAfter, options.style.breakInside]).toEqual(["avoid", "avoid-page", "avoid"]);
    expect(answer.style.breakInside).toBe("avoid");
    expect(analysis.style.breakInside || "").toBe("");
    expect(analysis.querySelector<HTMLElement>("p")!.style.breakAfter).toBe("avoid");
  });
  it("keeps a short letter closing together only in the print copy", () => {
    const { paper } = paperFixture('<section data-chalklee-region="stem"><p>Write a letter.</p><p style="text-align:right">Yours,</p><p style="text-align:right">Alex</p></section>');
    const before = paper.outerHTML;
    const root = createChalkLeePrintRoot(paper, page);
    const paragraphs = root.querySelectorAll<HTMLElement>('[data-chalklee-region="stem"] > p');
    expect(paragraphs[1].style.breakAfter).toBe("avoid-page");
    expect(paragraphs[2].style.breakAfter).not.toBe("avoid-page");
    expect(paper.outerHTML).toBe(before);
  });
  it("lets a passage with only blank-linked placeholders flow across pages", () => {
    const { paper, group } = paperFixture('<section class="chalklee-question-object" data-linked-placeholder="true"></section>');
    expect(chalkLeeGroupBody(group)?.hasVisibleSubquestions).toBe(false);
    const root = createChalkLeePrintRoot(paper, page);
    const body = chalkLeeGroupBody(root.querySelector<HTMLElement>(".group")!)!;
    expect(body.container.style.breakInside).not.toBe("avoid");
    expect(root.querySelector(".chalklee-print-group-solutions")?.textContent?.trim()).toBe("Answers");
    expect(group.querySelector(".chalklee-group-solution")?.textContent).toBe("Answers");
  });

  it("keeps a compact passage and its visible subquestion together", () => {
    const { paper, group } = paperFixture('<section class="chalklee-question-object"><p>Choose an answer.</p></section>', "reading");
    expect(chalkLeeGroupBody(group)?.hasVisibleSubquestions).toBe(true);
    const root = createChalkLeePrintRoot(paper, page);
    expect(chalkLeeGroupBody(root.querySelector<HTMLElement>(".group")!)?.container.style.breakInside).toBe("avoid");
  });

  it("preserves the matching layout that permits continuous pagination", () => {
    const { paper, group } = paperFixture('<section class="chalklee-question-object"><p>Match the description.</p></section>', "matching");
    group.dataset.paginationOverflow = "true";
    const first = group.querySelector<HTMLElement>("[data-chalklee-subquestions] > section")!;
    first.getBoundingClientRect = () => ({ top: 200, bottom: 250, height: 50 }) as DOMRect;
    const before = paper.outerHTML;
    const root = createChalkLeePrintRoot(paper, page);
    expect(root.querySelector<HTMLElement>(".group")?.dataset.paginationOverflow).toBe("true");
    expect(root.querySelector<HTMLElement>('[data-chalklee-region="material"]')?.style.breakAfter).toBe("avoid-page");
    expect(root.querySelector<HTMLElement>("[data-chalklee-subquestions] > section")?.style.breakBefore).toBe("avoid-page");
    expect(paper.outerHTML).toBe(before);
  });
});

function outputFixture() {
  const model = createEmptyChalkLeeDocument("试卷");
  model.content.content.push(...agentContentBlocks([
    { type: "heading", level: 2, text: "一、选择题" },
    { type: "question", id: "q1", number: "13", stem: ["第一题题干"], answer: ["普通答案"], analysis: ["普通解析"] },
    { type: "questionGroup", id: "group", number: "", material: ["阅读材料"], questions: [{ stem: ["小题"], answer: ["小题答案"], analysis: ["小题解析"] }] }
  ]));
  // Use the canonical IDs that a rendered editor exposes.
  const questions = model.content.content.filter(node => node.type === "question" || node.type === "questionGroup");
  const { document, window } = parseHTML(`<main class="chalklee-paper hide-answers hide-analysis" data-column-count="1">
    <div class="chalklee-editor-content"><h2>一、选择题</h2>
      <section class="chalklee-question-object" data-node-id="${questions[0].attrs.id}"><p>第一题题干</p>
        <section data-chalklee-region="answer">普通答案<div data-chalklee-image><img alt="答案配图" /></div></section><section data-chalklee-region="analysis">普通解析<span data-chalklee-inline-math>公式</span></section>
      </section>
      <section class="chalklee-question-object group" data-node-id="${questions[1].attrs.id}"><div class="chalklee-question-object-content"><div data-node-view-content-react>
        <div data-chalklee-region="material">阅读材料</div><div data-chalklee-subquestions><p>小题</p></div>
        <div class="chalklee-group-solution" data-heading="答案："><section data-chalklee-region="answer">小题答案</section></div>
        <div class="chalklee-group-solution" data-heading="解析："><section data-chalklee-region="analysis">小题解析</section></div>
      </div></div></section>
    </div></main>`);
  vi.stubGlobal("document", document);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  const paper = document.querySelector("main")! as unknown as HTMLElement;
  for (const node of paper.querySelectorAll<HTMLElement>(".group, [data-chalklee-subquestions]")) node.getBoundingClientRect = () => ({ top: 0, bottom: 200 }) as DOMRect;
  for (const node of paper.querySelectorAll<HTMLElement>("[data-chalklee-image]")) node.getClientRects = () => [] as unknown as DOMRectList;
  return { paper, model };
}

describe("print and PDF solution choices", () => {
  it.each(["after-question", "end"] as const)("selects solutions independently of the editor in %s output", placement => {
    for (const answers of [true, false]) for (const analysis of [true, false]) {
      const { paper, model } = outputFixture(), before = paper.outerHTML;
      const root = createChalkLeePrintRoot(paper, page, { answers, analysis, solutionPlacement: placement }, model);
      expect(root.textContent?.includes("普通答案")).toBe(answers);
      expect(root.textContent?.includes("小题答案")).toBe(answers);
      expect(root.textContent?.includes("普通解析")).toBe(analysis);
      expect(root.textContent?.includes("小题解析")).toBe(analysis);
      expect(Boolean(root.querySelector("[data-chalklee-inline-math]"))).toBe(analysis);
      expect(Boolean(root.querySelector("[data-chalklee-image]"))).toBe(answers);
      expect(root.querySelectorAll('[data-chalklee-region="answer"]')).toHaveLength(answers ? 2 : 0);
      const appendix = root.querySelector(".chalklee-print-appendix");
      expect(Boolean(appendix)).toBe(placement === "end" && (answers || analysis));
      if (appendix) {
        expect(appendix.textContent).toContain("第 13 题");
        expect(appendix.textContent).toContain("一、选择题");
        expect(root.querySelector(".chalklee-question-object [data-chalklee-region=answer]")).toBeNull();
        expect(root.querySelector(".chalklee-question-object [data-chalklee-region=analysis]")).toBeNull();
      }
      expect(paper.outerHTML).toBe(before);
    }
  });

  it("starts the appendix in a separate page flow for multi-column papers", () => {
    const { paper, model } = outputFixture();
    paper.dataset.columnCount = "2";
    const root = createChalkLeePrintRoot(paper, { ...page, columnCount: 2 }, { answers: true, analysis: true, solutionPlacement: "end" }, model);
    const sections = root.querySelectorAll(".chalklee-print-column-section");
    expect(sections).toHaveLength(2);
    expect(sections[0].querySelector(".chalklee-print-appendix")).toBeNull();
    expect(sections[1].querySelector(".chalklee-print-appendix")).not.toBeNull();
  });
});

describe("cover and contents in print", () => {
  it("moves the cover and contents onto sheets of their own before the body, without the screen's spacer or empty fields", () => {
    const { document } = parseHTML(`<main class="chalklee-paper" data-zoom="1" data-column-count="1">
      <div class="chalklee-paper-sheets">${'<div class="chalklee-paper-sheet"></div>'.repeat(4)}</div>
      <div class="chalklee-editor-surface"><div class="chalklee-editor-content"><div data-chalklee-front-spacer="" data-pages="2"></div><p>正文</p></div></div>
      <div class="chalklee-paper-running chalklee-cover-layer"><section class="chalklee-cover" data-selected="true">
        <div class="chalklee-cover-heading"><div class="chalklee-cover-field" data-field="title">期中</div><div class="chalklee-cover-field" data-field="subtitle" data-empty="true">副标题</div></div>
      </section></div>
      <div class="chalklee-paper-running chalklee-toc-layer"><section class="chalklee-toc-page" style="top: 1155px">
        <div class="chalklee-toc-title">目录</div><ol class="chalklee-toc-entries"><li class="chalklee-toc-entry">一、函数<span class="chalklee-toc-page-number">1</span></li></ol>
      </section></div>
    </main>`);
    vi.stubGlobal("document", document);
    const paper = document.querySelector("main")! as unknown as HTMLElement;
    const model = createEmptyChalkLeeDocument("期中");
    model.appearance.cover = {};
    const root = createChalkLeePrintRoot(paper, page, {}, model);
    const cover = root.querySelector<HTMLElement>(".chalklee-cover")!;
    const contents = root.querySelector<HTMLElement>(".chalklee-toc-page")!;
    expect(cover.nextElementSibling).toBe(contents);
    expect(contents.nextElementSibling?.classList.contains("chalklee-editor-surface")).toBe(true);
    expect(contents.getAttribute("style") ?? "").not.toContain("top");
    expect(contents.textContent).toContain("一、函数");
    expect(cover.hasAttribute("data-selected")).toBe(false);
    expect(cover.style.width).toBe("595.28pt");
    expect(cover.textContent).not.toContain("副标题");
    expect(root.querySelector("[data-chalklee-front-spacer]")).toBeNull();
    const css = root.querySelector("style")!.textContent!;
    expect(css).toContain("@page chalklee-front");
    // Four sheets on screen, two of them the cover and contents: the body has two.
    expect(css).toContain('"第 " counter(page) " 页／共 " "2" " 页"');
  });
});
