import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { chalkLeeClosingParagraphs, chalkLeeClosingKeepWithNext, chalkLeeMaterialTitles, chalkLeeSharedChoiceLeadIns, chalkLeeQuestionLeadIns } from "./closingFlow";
import { keepChalkLeeHeadingsWithNext, paginateChalkLeeFlow } from "./pagination";

function closing(body: string) {
  const { document } = parseHTML(`<main><section data-chalklee-region="stem">${body}</section></main>`);
  return document.querySelector("main")! as unknown as HTMLElement;
}
const signoff = '<p style="text-align:right">Yours,</p>', name = '<p style="text-align:right">Alex</p>';

describe("letter closing pagination", () => {
  it("keeps only the immediate question introduction together across screen gaps", () => {
    const { document } = parseHTML('<main><div class="chalklee-editor-content"><p>Earlier explanation.</p><h2>Exercises</h2><p>More explanation.</p><p>Read the passage.</p><span class="chalklee-page-gap"></span><div class="node-questionGroup"><section class="chalklee-question-object">Passage</section></div><p>Afterword.</p></div></main>');
    const root = document.querySelector("main")! as unknown as HTMLElement;
    expect(chalkLeeQuestionLeadIns(root).map(node => node.textContent)).toEqual(["Read the passage."]);
    expect(chalkLeeQuestionLeadIns(root.querySelector(".chalklee-editor-content")!)).toEqual(chalkLeeQuestionLeadIns(root));
    root.querySelector(".node-questionGroup")!.insertAdjacentHTML("beforebegin", '<div data-chalklee-page-break></div>');
    expect(chalkLeeQuestionLeadIns(root)).toEqual([]);
  });
  it("keeps short shared-choice instructions with the first option without binding a long passage", () => {
    const { document } = parseHTML('<main><section data-chalklee-region="material"><p>Match the people with the activities.</p></section><div class="react-renderer node-optionGroup"><section data-chalklee-options>A. First activity</section></div></main>');
    const main = document.querySelector("main")! as unknown as HTMLElement;
    expect(chalkLeeSharedChoiceLeadIns(main).map(node => node.textContent)).toEqual(["Match the people with the activities."]);
    main.querySelector("p")!.textContent = "Long passage. ".repeat(30);
    expect(chalkLeeSharedChoiceLeadIns(main)).toEqual([]);
  });
  it("carries the last writing row with a closing while respecting an authored empty paragraph", () => {
    const writing = '<div data-chalklee-answer-lines><div><p data-chalklee-answer-line>row 1</p><p data-chalklee-answer-line>row 2</p></div></div>';
    expect(chalkLeeClosingKeepWithNext(closing(`${writing}${signoff}${name}`)).map(node => node.textContent)).toEqual(["row 2", "Yours,"]);
    expect(chalkLeeClosingKeepWithNext(closing(`${writing}<p></p>${signoff}${name}`)).map(node => node.textContent)).toEqual(["Yours,"]);
    const flow = [{ pos: 1, top: 0, bottom: 70 }, { pos: 10, top: 70, bottom: 90 }, { pos: 20, top: 90, bottom: 102 }, { pos: 30, top: 102, bottom: 114 }];
    const joined = keepChalkLeeHeadingsWithNext(flow, [{ from: 10, to: 20 }, { from: 20, to: 30 }], 100);
    expect(paginateChalkLeeFlow(joined, 100)).toMatchObject([{ pos: 10, startPx: 70 }]);
  });
  it("moves a short centered passage title with the first line of its text", () => {
    const { document } = parseHTML('<main><section data-chalklee-region="material"><p style="text-align:center">A reading title</p><p>The first sentence.</p></section></main>');
    const titles = chalkLeeMaterialTitles(document.querySelector("main")! as unknown as HTMLElement);
    expect(titles.map(title => title.textContent)).toEqual(["A reading title"]);
    const flow = [{ pos: 1, top: 0, bottom: 85 }, { pos: 10, top: 85, bottom: 98 }, { pos: 30, top: 98, bottom: 115 }];
    expect(paginateChalkLeeFlow(keepChalkLeeHeadingsWithNext(flow, [{ from: 10, to: 30 }], 100), 100)).toMatchObject([{ pos: 10, startPx: 85 }]);
  });
  it("keeps the signoff with the name without changing the authored content", () => {
    const content = closing(`<p>Write a letter.</p>${signoff}<span class="chalklee-page-gap"></span>${name}`);
    const before = content.outerHTML;
    expect(chalkLeeClosingParagraphs(content).map(group => group.map(p => p.textContent))).toEqual([["Yours,", "Alex"]]);
    const flow = [{ pos: 1, top: 0, bottom: 80 }, { pos: 10, top: 80, bottom: 95 }, { pos: 20, top: 95, bottom: 110 }];
    expect(paginateChalkLeeFlow(keepChalkLeeHeadingsWithNext(flow, [{ from: 10, to: 20 }], 100), 100)).toMatchObject([{ pos: 10, startPx: 80 }]);
    expect(content.outerHTML).toBe(before);
    expect(keepChalkLeeHeadingsWithNext([...flow.slice(0, 2), { ...flow[2], forced: true }], [{ from: 10, to: 20 }], 100)).toHaveLength(3);
  });
  it("respects authored breaks, empty paragraphs and ordinary prose", () => {
    for (const boundary of ['<div data-chalklee-page-break></div>', '<p></p>', '<p>Body text</p>']) {
      expect(chalkLeeClosingParagraphs(closing(`${signoff}${boundary}${name}`))).toEqual([]);
    }
    expect(chalkLeeClosingParagraphs(closing(`${signoff}${name}<p>Next instruction</p>`))).toEqual([]);
    expect(chalkLeeClosingParagraphs(closing(`${signoff.repeat(5)}${name}`))).toEqual([]);
  });
});
