import { readChalkLeeFixture } from "../../../test-fixtures/documents";
import { getSchema, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ChalkLeeBlankNode, ChalkLeeDocumentNode, ChalkLeeInlineMathNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeQuestionStemPresentation } from "./extensions/QuestionNodeView";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { readAppStylesheet } from "../../../test-fixtures/stylesheet";

type FixtureNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: FixtureNode[];
};

const css = readAppStylesheet();
const nodeViewSource = readFileSync(new URL("./extensions/QuestionNodeView.tsx", import.meta.url), "utf8");
const englishGolden = readChalkLeeFixture("english-exam") as { content: FixtureNode };
const mathGolden = readChalkLeeFixture("math-exam") as { content: FixtureNode };
const schema = getSchema([
  StarterKit.configure({ document: false, paragraph: false }),
  ChalkLeeDocumentNode,
  ChalkLeeParagraphNode,
  ChalkLeeBlankNode,
  ChalkLeeInlineMathNode,
  ...chalkLeeStructuralExtensions
] as Extensions);

function fixtureQuestion(fixture: { content: FixtureNode }, id: string) {
  const visit = (node: FixtureNode): FixtureNode | null => {
    if (node.type === "question" && node.attrs?.id === id) return node;
    for (const child of node.content ?? []) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  const question = visit(fixture.content);
  if (!question) throw new Error(`Missing Golden question ${id}`);
  return schema.nodeFromJSON(question);
}

function ordinaryEmptyChoice() {
  const paragraph = (id: string, text = "") => ({
    type: "paragraph",
    attrs: { id },
    ...(text ? { content: [{ type: "text", text }] } : {})
  });
  return schema.nodeFromJSON({
    type: "question",
    attrs: { id: "ordinary", kind: "single-choice", number: { mode: "auto" } },
    content: [
      {
        type: "questionStem",
        attrs: { id: "ordinary_stem" },
        content: [paragraph("ordinary_stem_p")]
      },
      {
        type: "optionGroup",
        attrs: { id: "ordinary_options", layout: "auto" },
        content: ["A", "B"].map((label) => ({
          type: "option",
          attrs: { id: `ordinary_option_${label}`, label },
          content: [paragraph(`ordinary_option_${label}_p`, label)]
        }))
      }
    ]
  });
}

describe("ChalkLee empty question stem visibility contract", () => {
  it("classifies linked source blanks without changing ordinary math questions", () => {
    expect(chalkLeeQuestionStemPresentation(fixtureQuestion(englishGolden, "question_1"))).toMatchObject({
      hasSourceBlank: true,
      ownsSourceBlank: false,
      hasOptions: true,
      stemEmpty: true,
      linkedPlaceholder: false
    });
    expect(chalkLeeQuestionStemPresentation(fixtureQuestion(englishGolden, "question_26"))).toMatchObject({
      hasSourceBlank: true,
      ownsSourceBlank: false,
      hasOptions: false,
      stemEmpty: true,
      linkedPlaceholder: true
    });
    expect(chalkLeeQuestionStemPresentation(fixtureQuestion(englishGolden, "question_31"))).toMatchObject({
      hasSourceBlank: true,
      ownsSourceBlank: true,
      hasOptions: false,
      stemEmpty: false,
      linkedPlaceholder: false
    });
    expect(chalkLeeQuestionStemPresentation(fixtureQuestion(mathGolden, "question_2"))).toMatchObject({
      hasSourceBlank: false,
      ownsSourceBlank: false,
      hasOptions: true,
      stemEmpty: false,
      linkedPlaceholder: false
    });
  });

  it("keeps an ordinary empty choice stem editable", () => {
    expect(chalkLeeQuestionStemPresentation(ordinaryEmptyChoice())).toMatchObject({
      hasSourceBlank: false,
      ownsSourceBlank: false,
      hasOptions: true,
      stemEmpty: true,
      linkedPlaceholder: false
    });
    expect(nodeViewSource).toContain('data-source-blank={hasSourceBlank ? "true" : "false"}');
    expect(nodeViewSource).toContain('data-inline-number={ownsSourceBlank ? "true" : "false"}');
    expect(nodeViewSource).not.toContain("data-has-options=");
    expect(css).toMatch(
      /:not\(\[data-linked-placeholder="true"\]\):not\(\[data-source-blank="true"\]\)\[data-stem-empty="true"\][^{]*>\s*p:first-of-type::before\s*\{[^}]*content:\s*"输入题干";/s
    );
  });

  it("hides an empty externally linked source-blank choice", () => {
    expect(css).toMatch(
      /\[data-stem-empty="true"\]\[data-source-blank="true"\][^{]*\{\s*display:\s*none;/
    );
    expect(css).not.toMatch(
      /\.chalklee-question-object\[data-stem-empty="true"\](?!\[data-source-blank="true"\])[^\{]*\{\s*display:\s*none;/
    );
  });

  it("keeps ordinary option placement stable as its stem gains text", () => {
    expect(css).toMatch(
      /\.chalklee-question-object:not\(\.group\):not\(\[data-inline-number="true"\]\) \[data-chalklee-region="stem"\] > p:first-of-type\s*\{[^}]*padding-left:\s*var\(--chalklee-number-slot, 18pt\);/s
    );
    expect(css).toMatch(
      /\.chalklee-question-object:not\(\.group\):not\(\[data-inline-number="true"\]\) \.chalklee-option-grid\s*\{[^}]*padding-left:\s*var\(--chalklee-number-slot, 18pt\);/s
    );
    expect(css).not.toMatch(/\[data-stem-empty="true"\][^{}]*\.chalklee-option-grid/);
  });

  it("keeps linked placeholders hidden and authoring hints out of print", () => {
    expect(css).toContain('.chalklee-question-object[data-linked-placeholder="true"] { display: none; }');
    expect(css).toMatch(
      // Only single questions drop the hint; question groups are left out on purpose.
      /#chalklee-print-root \.chalklee-question-object:not\(\.group\)\[data-stem-empty="true"\]:not\(\[data-source-blank="true"\]\)[^{]*::before\s*\{\s*content:\s*none;/
    );
  });
});
