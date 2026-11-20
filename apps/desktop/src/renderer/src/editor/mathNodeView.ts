import type { NodeViewRendererProps } from "@tiptap/core";
import type { NodeView } from "@tiptap/pm/view";
import { requestChalkLeeMathEdit } from "./mathEditing";
import { renderChalkLeeMathMarkup } from "./mathMarkup";

/** The formula is static on the paper. The editing panel opens only on request. */
export function chalkLeeMathNodeView({ editor, node, getPos }: NodeViewRendererProps): NodeView {
  const inline = node.type.name === "mathInline";
  const tag = inline ? "span" : "div";
  const dom = document.createElement(tag);
  // Tiptap creates node views again after EditorContent attaches. Defer building
  // the glyphs until then so each formula is parsed once on open.
  if (!(editor as typeof editor & { contentComponent?: unknown }).contentComponent) return { dom };

  // Keep an outer box for editor selection and the formula's existing line metrics.
  dom.className = `node-${node.type.name}`;
  const formula = document.createElement(tag);
  formula.className = `chalklee-math-node ${inline ? "inline" : "block"}`;
  formula.setAttribute(inline ? "data-chalklee-inline-math" : "data-chalklee-block-math", "");
  formula.style.whiteSpace = "normal";
  formula.setAttribute("role", "group");
  formula.setAttribute("aria-keyshortcuts", "Enter F2");
  formula.title = "双击编辑公式；选中后按 Enter 或 F2";
  const render = document.createElement("span");
  render.className = "chalklee-math-render";
  render.setAttribute("role", "math");
  formula.append(render);
  dom.append(formula);

  const updateLayout = () => {
    if (node.attrs.id == null) delete formula.dataset.nodeId;
    else formula.dataset.nodeId = String(node.attrs.id);
    if (!inline) formula.style.textAlign = node.attrs.textAlign ?? "center";
  };
  const updateFormula = () => {
    const latex = String(node.attrs.latex ?? "");
    const label = latex || "空公式";
    formula.setAttribute("aria-label", `公式：${label}`);
    render.setAttribute("aria-label", label);
    render.innerHTML = latex.trim() ? renderChalkLeeMathMarkup(latex) : "空公式";
    // The math label already exposes the source. Its layout spans only draw glyphs.
    for (const child of render.children) child.setAttribute("aria-hidden", "true");
  };
  updateLayout();
  updateFormula();

  const edit = () => {
    const position = getPos();
    if (typeof position !== "number") return;
    editor.commands.setNodeSelection(position);
    requestChalkLeeMathEdit(editor, { kind: "edit", position });
  };
  formula.addEventListener("dblclick", event => {
    event.preventDefault();
    event.stopPropagation();
    edit();
  });

  let trigger: HTMLButtonElement | undefined;
  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false;
      const latexChanged = next.attrs.latex !== node.attrs.latex;
      const layoutChanged = next.attrs.id !== node.attrs.id || next.attrs.textAlign !== node.attrs.textAlign;
      node = next;
      if (layoutChanged) updateLayout();
      if (latexChanged) updateFormula();
      return true;
    },
    selectNode() {
      dom.classList.add("ProseMirror-selectednode");
      formula.classList.add("selected");
      if (trigger) return;
      trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "chalklee-math-edit-trigger";
      trigger.setAttribute("contenteditable", "false");
      trigger.setAttribute("aria-label", "编辑公式");
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.textContent = "编辑";
      trigger.addEventListener("mousedown", event => {
        event.preventDefault();
        event.stopPropagation();
      });
      trigger.addEventListener("click", event => {
        event.stopPropagation();
        edit();
      });
      formula.append(trigger);
    },
    deselectNode() {
      dom.classList.remove("ProseMirror-selectednode");
      formula.classList.remove("selected");
      trigger?.remove();
      trigger = undefined;
    },
    stopEvent: event => Boolean(trigger?.contains(event.target as globalThis.Node)),
    // The formula is atomic; its rendered glyphs and edit button never become document content.
    ignoreMutation: () => true
  };
}
