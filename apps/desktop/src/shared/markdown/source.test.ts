import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { decodeMarkdownFile, encodeMarkdownFile } from "./source";

describe("Markdown source preservation", () => {
  it.each(["# 标题\n\n\t原文  \n末行", "\ufeff# 标题\r\n\r\n\t原文  \r\n末行", "\ufeff", ""])("preserves bytes and changes only the edited text", original => {
    const bytes = new TextEncoder().encode(original), file = decodeMarkdownFile(bytes);
    const state = EditorState.create({ doc: file.text.replace(/\r\n|\r|\n/g, file.lineSeparator), extensions: [EditorState.lineSeparator.of(file.lineSeparator)] });
    expect(encodeMarkdownFile(state.sliceDoc(), file.bom)).toEqual(bytes);
    const next = state.update({ changes: { from: state.doc.length, insert: "补充" } }).state;
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(encodeMarkdownFile(next.sliceDoc(), file.bom))).toBe(original + "补充");
  });
  it("normalizes mixed line endings to the majority when edited", () => {
    const file = decodeMarkdownFile(new TextEncoder().encode("一\r\n二\n三\r\n四"));
    const state = EditorState.create({ doc: file.text.replace(/\r\n|\r|\n/g, file.lineSeparator), extensions: [EditorState.lineSeparator.of(file.lineSeparator)] });
    expect(state.sliceDoc()).toBe("一\r\n二\r\n三\r\n四");
  });
});
