import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chalkLeeDesignLayoutCss } from "./designLayout";
afterEach(() => vi.unstubAllGlobals());
describe("designer card padding and semantic labels", () => {
  it("derives label alignment without changing editable DOM or duplicating group solution labels", () => {
    const { document } = parseHTML('<article><section class="chalklee-question-object" data-node-id="q1"><div class="chalklee-question-object-head"><span>1</span></div><section data-chalklee-region="answer" data-node-id="a1"><p>B</p></section><section data-chalklee-region="analysis" data-node-id="x1"><p>Explain</p></section><div class="chalklee-group-solution"><section data-chalklee-region="answer" data-node-id="group-answer"></section></div></section></article>');
    const paper = document.querySelector("article") as unknown as HTMLElement;
    const original = paper.outerHTML;
    vi.stubGlobal("getComputedStyle", (node: HTMLElement) => ({ paddingTop: "8px", paddingRight: "12px", paddingLeft: node.dataset.chalkleeRegion === "analysis" ? "40px" : "12px", fontSize: "14px" }));
    const css = chalkLeeDesignLayoutCss(paper, "doc-test");
    expect(css).toContain('[data-chalklee-design="doc-test"] .chalklee-question-object[data-node-id="q1"] > .chalklee-question-object-head');
    expect(css).toContain("top: 8px; left: 12px; right: 12px;");
    expect(css).toContain('[data-node-id="a1"]::before');
    expect(css).not.toContain('[data-node-id="x1"]::before');
    expect(css).not.toContain("group-answer");
    expect(css).toContain("#chalklee-print-root");
    expect(chalkLeeDesignLayoutCss(paper, "doc-test")).toBe(css);
    expect(paper.outerHTML).toBe(original);
  });
});
