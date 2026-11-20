import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { history, undo } from "@tiptap/pm/history";
import { EditorState, Plugin } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeInlineMathNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { ChalkLeeFindReplaceExtension, chalkLeeFindKey, chalkLeeFindMatches, chalkLeeFindStepTransaction, chalkLeeFindTransaction, chalkLeeReplaceTransaction } from "./findReplace";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeInlineMathNode, ...chalkLeeStructuralExtensions]);
const findPlugin = (ChalkLeeFindReplaceExtension.config.addProseMirrorPlugins as () => Plugin[]).call({})[0];

function state() {
  const bold = schema.marks.bold.create();
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create({ id: "title" }, [schema.text("2025 学年"), schema.text("期中", [bold])]),
    schema.nodes.question.create({ id: "q", kind: "free-response", number: { mode: "auto" } }, [
      schema.nodes.questionStem.create({ id: "stem" }, schema.nodes.paragraph.create({ id: "p" }, [
        schema.text("２０２５年 "), schema.nodes.mathInline.create({ latex: "x" }), schema.text("2025")
      ]))
    ])
  ]);
  return EditorState.create({ schema, doc, plugins: [findPlugin, history()] });
}

describe("find and replace in a paper", () => {
  it("finds text across formatting and full-width digits, but not across a formula", () => {
    const doc = state().doc;
    expect(chalkLeeFindMatches(doc, "2025").map(match => doc.textBetween(match.from, match.to))).toEqual(["2025", "２０２５", "2025"]);
    expect(chalkLeeFindMatches(doc, "学年期中")).toHaveLength(1);
    expect(chalkLeeFindMatches(doc, "年 2025")).toHaveLength(0);
  });

  it("steps through matches and selects the current one", () => {
    let current = state();
    current = current.apply(chalkLeeFindTransaction(current, "2025"));
    expect(chalkLeeFindKey.getState(current)).toMatchObject({ current: 0 });
    current = current.apply(chalkLeeFindStepTransaction(current, -1)!);
    expect(chalkLeeFindKey.getState(current)?.current).toBe(2);
    expect(current.doc.textBetween(current.selection.from, current.selection.to)).toBe("2025");
  });

  it("replaces one match keeping its formatting, then all remaining matches in one undo step", () => {
    let current = state();
    current = current.apply(chalkLeeFindTransaction(current, "期中"));
    current = current.apply(chalkLeeReplaceTransaction(current, "期末", false)!);
    expect(current.doc.firstChild!.textContent).toBe("2025 学年期末");
    expect(current.doc.firstChild!.lastChild!.marks.map(mark => mark.type.name)).toEqual(["bold"]);

    current = current.apply(chalkLeeFindTransaction(current, "2025"));
    const before = current.doc;
    current = current.apply(chalkLeeReplaceTransaction(current, "2026", true)!);
    expect(chalkLeeFindMatches(current.doc, "2026")).toHaveLength(3);
    expect(chalkLeeFindKey.getState(current)?.matches).toHaveLength(0);
    expect(undo(current, transaction => { current = current.apply(transaction); })).toBe(true);
    expect(current.doc.eq(before)).toBe(true);
  });

  it("deleting a match by replacing it with nothing keeps the paragraph", () => {
    let current = state();
    current = current.apply(chalkLeeFindTransaction(current, "2025 学年期中"));
    current = current.apply(chalkLeeReplaceTransaction(current, "", true)!);
    expect(current.doc.firstChild!.type.name).toBe("paragraph");
    expect(current.doc.firstChild!.attrs.id).toBe("title");
  });
});
