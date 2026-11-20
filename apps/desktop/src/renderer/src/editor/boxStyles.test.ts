import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { history, undo } from "@tiptap/pm/history";
import { EditorState, NodeSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { CHALKLEE_BOX_PRESETS, chalkLeeBoxPresetStyleName } from "../../../shared/document/boxPresets";
import { chalkLeeApplyBoxStyleToAllTransaction, chalkLeeApplyBoxStyleTransaction } from "./boxStyles";
import { ChalkLeeBoxKeyboardExtension, ChalkLeeBoxNode } from "./extensions/boxNodes";
import type { Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import type { ChalkLeeEditorLayout } from "./layoutAppearance";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeBoxNode, ...chalkLeeStructuralExtensions]);
const p = (id: string) => schema.nodes.paragraph.create({ id }, schema.text("内容"));
const box = (id: string, attrs: Record<string, unknown> = {}) => schema.nodes.box.create({ id, ...attrs }, p(`${id}-p`));
const layout = (boxStyles: ChalkLeeEditorLayout["boxStyles"] = {}, boxStyleRef?: string) => ({ boxStyles, ...(boxStyleRef ? { boxStyleRef } : {}) }) as ChalkLeeEditorLayout;
const preset = (id: string) => {
  const found = CHALKLEE_BOX_PRESETS.find(item => item.id === id)!;
  return { name: chalkLeeBoxPresetStyleName(found.id), style: found.style };
};
function state(boxes: ReturnType<typeof box>[], current: ChalkLeeEditorLayout, selected = 0) {
  const doc = schema.nodes.doc.create({ runtimeLayout: current }, boxes);
  let position = 0;
  doc.forEach((node, offset, index) => { if (index === selected) position = offset; });
  return EditorState.create({ doc, selection: NodeSelection.create(doc, position), plugins: [history()] });
}
const styles = (current: EditorState) => (current.doc.attrs.runtimeLayout as ChalkLeeEditorLayout).boxStyles;
const refs = (current: EditorState) => current.doc.content.content.map(node => node.attrs.styleRef);

describe("choosing a box style", () => {
  it("copies a preset into the document, keeps the box selected with its own title, and undoes in one step", () => {
    const before = state([box("a", { label: "定义" }), box("b")], layout({ "box.note": { frame: { label: "注意" } } }));
    const after = before.apply(chalkLeeApplyBoxStyleTransaction(before, "a", preset("grid"))!);
    expect(refs(after)).toEqual(["box.preset-grid", null]);
    expect(styles(after)["box.preset-grid"]).toEqual(preset("grid").style);
    expect(styles(after)["box.note"]).toBeDefined();
    expect(after.doc.firstChild!.attrs.label).toBe("定义");
    expect(after.selection instanceof NodeSelection && after.selection.from).toBe(0);
    expect(undo(after, tr => { expect(tr.doc.eq(before.doc)).toBe(true); })).toBe(true);
  });

  it("drops a preset copy no box uses any more, and keeps a different style of the same name", () => {
    const first = state([box("a"), box("b")], layout());
    const grid = first.apply(chalkLeeApplyBoxStyleTransaction(first, "a", preset("grid"))!);
    const sticky = grid.apply(chalkLeeApplyBoxStyleTransaction(grid, "a", preset("sticky"))!);
    expect(Object.keys(styles(sticky))).toEqual(["box.preset-sticky"]);

    const changed = state([box("a")], layout({ "box.preset-grid": { ...preset("grid").style, backgroundColor: "#ffffff" } }));
    const chosen = changed.apply(chalkLeeApplyBoxStyleTransaction(changed, "a", preset("grid"))!);
    expect(refs(chosen)).toEqual(["box.preset-grid-2"]);
  });

  it("gives every box, and boxes added later, the style for 全部盒子使用", () => {
    const before = state([box("a", { styleRef: "box.preset-grid" }), box("b", { styleRef: "box.note" }), box("c")], layout({ "box.preset-grid": preset("grid").style, "box.note": { frame: { label: "注意" } } }), 1);
    const after = before.apply(chalkLeeApplyBoxStyleToAllTransaction(before, preset("grid"))!);
    expect(refs(after)).toEqual(["box.preset-grid", "box.preset-grid", "box.preset-grid"]);
    expect((after.doc.attrs.runtimeLayout as ChalkLeeEditorLayout).boxStyleRef).toBe("box.preset-grid");
    expect(after.selection instanceof NodeSelection && after.selection.node.attrs.id).toBe("b");
  });

  it("keeps a box selected whole from being replaced by pasted text", () => {
    const addPlugins = ChalkLeeBoxKeyboardExtension.config.addProseMirrorPlugins as unknown as (this: unknown) => Plugin[];
    const plugin = addPlugins.call({})[0];
    const current = state([box("a", { label: "定义" })], layout());
    const view = { state: current, dispatch: () => { throw new Error("nothing is written"); } } as unknown as EditorView;
    expect(plugin.props.handlePaste!.call(plugin, view, { clipboardData: { getData: () => "明天第三节课" } } as unknown as ClipboardEvent, null as never)).toBe(true);
    expect(plugin.props.handleTextInput!.call(plugin, view, 1, 1, "x", () => current.tr)).toBe(true);
  });
});
