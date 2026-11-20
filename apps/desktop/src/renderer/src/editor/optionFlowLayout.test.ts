import { Schema } from "@tiptap/pm/model";
import { DecorationSet } from "@tiptap/pm/view";
import { parseHTML } from "linkedom";
import { describe, expect, it, vi } from "vitest";
import { readAppStylesheet } from "../../../test-fixtures/stylesheet";
import { chalkLeeOptionNodeView } from "./extensions/optionNodeViews";

const css = readAppStylesheet();

function declarationsFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s").exec(css)?.[1] ?? "";
}

describe("ChalkLee option flow layout", () => {
  it("keeps short auto-layout options on one row and allows content-driven wrapping", () => {
    const group = declarationsFor('[data-chalklee-options][data-layout="auto"] .chalklee-option-grid');
    const option = declarationsFor('[data-chalklee-options][data-layout="auto"] [data-chalklee-option]');

    expect(group).toMatch(/display:\s*flex;/);
    expect(group).toMatch(/flex-wrap:\s*wrap;/);
    expect(group).toMatch(/align-items:\s*flex-start;/);
    expect(option).toMatch(/min-width:\s*min\(72pt, 100%\);/);
    expect(option).toMatch(/max-width:\s*100%;/);
    expect(option).toMatch(/flex:\s*0 1 auto;/);
    expect(declarationsFor(".chalklee-option-content")).toMatch(/overflow-wrap:\s*anywhere;/);
  });

  it("preserves explicit fixed-column choices", () => {
    expect(css).toContain('[data-chalklee-options][data-layout="one-column"] .chalklee-option-grid { grid-template-columns: minmax(0, 1fr); }');
    expect(css).toContain('[data-chalklee-options][data-layout="two-column"] .chalklee-option-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }');
    expect(css).toContain('[data-chalklee-options][data-layout="four-column"] .chalklee-option-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }');
  });

  it("uses a defined neutral-gray paper token for authoring placeholders", () => {
    expect(declarationsFor(".chalklee-paper")).toMatch(/--chalklee-placeholder-color:\s*#9a9a9a;/);
    expect(declarationsFor(".chalklee-option-empty-hint")).toMatch(/color:\s*var\(--chalklee-placeholder-color\);/);
    expect(css).toMatch(/content:\s*"输入题干";[^}]*color:\s*var\(--chalklee-placeholder-color\);/s);
    expect(declarationsFor('.chalklee-paper[data-pristine="true"] .chalklee-editor-content > p:last-child::before'))
      .toMatch(/color:\s*var\(--chalklee-placeholder-color\);/);
    expect(css).not.toContain("--cm-theme-text-rgb");
  });

  it("keeps option hints decorative, non-selectable, and out of print", () => {
    const hint = declarationsFor(".chalklee-option-empty-hint");
    expect(hint).toMatch(/pointer-events:\s*none;/);
    expect(hint).toMatch(/user-select:\s*none;/);
    expect(declarationsFor(":is(#chalklee-print-root, #chalklee-paginated-print-root) .chalklee-option-empty-hint")).toMatch(/display:\s*none;/);
    const schema = new Schema({ nodes: { doc: { content: "option+" }, option: { content: "paragraph+" }, paragraph: { content: "text*" }, text: {} } });
    const { document } = parseHTML("<html><body></body></html>");
    vi.stubGlobal("document", document);
    try {
      const empty = schema.nodes.option.create(null, schema.nodes.paragraph.create());
      const { dom, contentDOM, update } = chalkLeeOptionNodeView(empty);
      const hintElement = (dom as HTMLElement).querySelector(".chalklee-option-empty-hint")!;
      expect(hintElement.getAttribute("aria-hidden")).toBe("true");
      expect(hintElement.getAttribute("contenteditable")).toBe("false");
      expect(contentDOM?.contains(hintElement)).toBe(false);

      const filled = schema.nodes.option.create(null, schema.nodes.paragraph.create(null, schema.text("选项")));
      expect(update?.(filled, [], DecorationSet.empty)).toBe(true);
      expect((dom as HTMLElement).querySelector(".chalklee-option-empty-hint")).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
});
