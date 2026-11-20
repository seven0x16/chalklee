import { describe, expect, it } from "vitest";
import { readAppStylesheet } from "../../../test-fixtures/stylesheet";

const css = readAppStylesheet();

describe("ChalkLee focused question frame", () => {
  it("uses a clear rounded frame with a soft halo without changing question layout", () => {
    const frame = /\.chalklee-question-object::before\s*\{([^}]*)\}/s.exec(css)?.[1] ?? "";
    expect(frame).toMatch(/position:\s*absolute;/);
    expect(frame).toMatch(/inset:\s*calc\(var\(--chalklee-question-spacing, 6pt\) \/ -2\) -10px;/);
    expect(frame).toMatch(/box-sizing:\s*border-box;/);
    expect(frame).toMatch(/border:\s*2px solid rgb\(var\(--cm-theme-accent-rgb\) \/ \.46\);/);
    expect(frame).toMatch(/border-radius:\s*10px;/);
    expect(frame).toMatch(/box-shadow:\s*0 0 0 3px rgb\(var\(--cm-theme-accent-rgb\) \/ \.05\)/);
    expect(frame).not.toMatch(/height:|linear-gradient/);
    expect(frame).toMatch(/opacity:\s*0;/);
    expect(frame).toMatch(/pointer-events:\s*none;/);
    expect(frame).toMatch(/transition:\s*opacity /);
  });

  it("shares the explicit selection with the inspector, including while property controls have focus", () => {
    expect(css).toMatch(/\.chalklee-question-object\.is-editing:not\(\.selected\):not\(\[data-question-drop\]\)::before\s*\{\s*opacity:\s*1;/);
    expect(css).toContain(".chalklee-question-object.selected.is-editing {");
    expect(/^\.chalklee-question-object\.selected \{/m.test(css)).toBe(false);
    expect(css).not.toContain(".ProseMirror-focused .chalklee-question-object.is-editing");
    expect(css).not.toMatch(/\.chalklee-question-object:hover::before/);
    // The stronger drag insertion indicator owns ::after independently.
    expect(css).toContain('.chalklee-question-object[data-question-drop="after"]::after { bottom: -3px; }');
  });

  it("omits the focus frame from print and disables its transition for reduced motion", () => {
    expect(css).toMatch(/#chalklee-print-root \.chalklee-question-object::before\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/@media print\s*\{\s*\.chalklee-question-object::before\s*\{\s*display:\s*none !important;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.chalklee-question-object::before,[^}]*transition:\s*none;/);
  });
});
