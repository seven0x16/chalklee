import type { Node as PMNode } from "@tiptap/pm/model";
import { chalkLeeColumnLayout, chalkLeePageSizePt } from "./pagination";

export const CHALKLEE_IMAGE_ROW_GAP_PT = 12;
export type ChalkLeeAutomaticImageRow = {
  from: number; to: number; id: string;
  images: { node: PMNode; pos: number; widthPt: number }[];
};

/** Rendering only: consecutive, unformatted pictures in one question region
 * can share a row. Authored block/wrap/inline layouts and cross-question pairs
 * keep their meaning; no nodes, assets or ownership are changed. */
export function chalkLeeAutomaticImageRows(doc: PMNode, availableWidthPt?: number): ChalkLeeAutomaticImageRow[] {
  const page = doc.attrs.runtimePage;
  const width = availableWidthPt ?? (page ? chalkLeeColumnLayout(page).widthPt - 24 : 440);
  const maxHeight = page ? chalkLeePageSizePt(page).height - page.marginsPt.top - page.marginsPt.bottom - 18 : 700;
  const rows: ChalkLeeAutomaticImageRow[] = [];
  doc.descendants((parent, parentPos) => {
    if (!["questionStem", "questionMaterial", "questionAnswer", "questionAnalysis"].includes(parent.type.name)) return;
    let images: ChalkLeeAutomaticImageRow["images"] = [], used = 0;
    const flush = () => {
      if (images.length > 1) rows.push({ from: images[0].pos, to: images.at(-1)!.pos + images.at(-1)!.node.nodeSize,
        id: images.map(image => image.node.attrs.id).join(":"), images });
      images = []; used = 0;
    };
    parent.forEach((node, offset) => {
      const size = Number(node.attrs.widthPt);
      if (node.type.name !== "image" || node.attrs.layout != null || node.attrs.imagePairId
        || (node.attrs.textAlign != null && node.attrs.textAlign !== "center")
        || node.attrs.spaceBeforePt != null || node.attrs.spaceAfterPt != null
        || Number(node.attrs.heightPt) > maxHeight
        || !Number.isFinite(size) || size <= 0 || size > width) { flush(); return; }
      if (images.length && used + CHALKLEE_IMAGE_ROW_GAP_PT + size > width) flush();
      used += (images.length ? CHALKLEE_IMAGE_ROW_GAP_PT : 0) + size;
      images.push({ node, pos: parentPos + 1 + offset, widthPt: size });
    });
    flush();
  });
  return rows;
}
