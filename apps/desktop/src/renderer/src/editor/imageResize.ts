import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";

export type ChalkLeeImageSize = { widthPt: number; heightPt: number };
export type ChalkLeeImageResizeHandle = "nw" | "ne" | "sw" | "se";
export type ChalkLeeImageResizeGeometry = ChalkLeeImageSize & {
  scale: number;
  maxWidthPt: number;
  maxHeightPt: number;
  alignment: "left" | "center" | "right";
};

/** Use the displayed ratio, including imported images with explicit dimensions. */
export function constrainChalkLeeImageSize(size: ChalkLeeImageResizeGeometry, widthPt: number): ChalkLeeImageSize {
  const ratio = size.widthPt / size.heightPt;
  const maximum = Math.max(.1, Math.min(size.maxWidthPt, size.maxHeightPt * ratio));
  const minimum = Math.min(maximum, 24);
  const width = Math.min(maximum, Math.max(minimum, widthPt));
  return { widthPt: Math.round(width * 100) / 100, heightPt: Math.round(width / ratio * 100) / 100 };
}

export function resizeChalkLeeImage(size: ChalkLeeImageResizeGeometry, handle: ChalkLeeImageResizeHandle, dx: number, dy: number): ChalkLeeImageSize {
  const pxToPt = .75 / size.scale;
  const horizontal = dx * (handle.endsWith("w") ? -1 : 1) * pxToPt * (size.alignment === "center" ? 2 : 1);
  const vertical = dy * (handle.startsWith("n") ? -1 : 1) * pxToPt * size.widthPt / size.heightPt;
  const delta = Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical;
  return constrainChalkLeeImageSize(size, size.widthPt + delta);
}

/** The whole gesture is one history event, targeting the original image. */
export function chalkLeeImageSizeTransaction(state: EditorState, position: number, size: ChalkLeeImageSize) {
  const node = state.doc.nodeAt(position);
  if (!node || !["image", "imageInline"].includes(node.type.name) || !Number.isFinite(size.widthPt) || !Number.isFinite(size.heightPt)
    || size.widthPt <= 0 || size.heightPt <= 0) return null;
  if (node.attrs.widthPt === size.widthPt && node.attrs.heightPt === size.heightPt) return null;
  const transaction = closeHistory(state.tr).setNodeMarkup(position, undefined, { ...node.attrs, ...size });
  return transaction.setSelection(NodeSelection.create(transaction.doc, position));
}
