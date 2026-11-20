import { useReactNodeView, type NodeViewProps } from "@tiptap/react";
import { useCallback, type HTMLAttributes } from "react";

type ContentOwner = Pick<NodeViewProps, "editor" | "node" | "getPos">;

/** Newly mounted content lives directly under its ProseMirror node view until
 * React attaches it. Reading the browser selection for every such move forces
 * layout after every preceding DOM insertion. Only a selection inside this
 * content can need Tiptap's selection preservation; use the model to check it.
 * Existing/remounted content always follows Tiptap's normal attachment path.
 */
export function mountChalkLeeNodeViewContent(
  element: HTMLElement | null,
  owner: ContentOwner,
  attach: ((element: HTMLElement | null) => void) | undefined
) {
  const content = element?.closest(".react-renderer")
    ?.querySelector<HTMLElement>(":scope > [data-node-view-content-react]");
  if (element && content) {
    const position = owner.getPos();
    const { anchor, head } = owner.editor.state.selection;
    const end = typeof position === "number" ? position + owner.node.nodeSize : null;
    const selectionInside = typeof position !== "number" || end === null
      || (anchor > position && anchor < end && head > position && head < end);
    if (!selectionInside) {
      element.removeAttribute("data-node-view-wrapper");
      element.appendChild(content);
    }
  }
  attach?.(element);
}

export function ChalkLeeNodeViewContent({
  as: Tag = "div",
  nodeView,
  ...props
}: { as?: "div" | "table"; nodeView: ContentOwner } & HTMLAttributes<HTMLElement>) {
  const { nodeViewContentRef, nodeViewContentChildren } = useReactNodeView();
  const contentRef = useCallback((element: HTMLElement | null) => {
    mountChalkLeeNodeViewContent(element, nodeView, nodeViewContentRef);
  }, [nodeView.editor, nodeView.node, nodeView.getPos, nodeViewContentRef]);
  return <Tag {...props} ref={contentRef} data-node-view-content=""
    style={{ whiteSpace: "pre-wrap", ...props.style }}>{nodeViewContentChildren}</Tag>;
}
