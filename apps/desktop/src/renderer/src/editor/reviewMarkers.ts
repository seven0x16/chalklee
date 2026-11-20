import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const chalkLeeReviewMarkerKey = new PluginKey<DecorationSet>("chalkLeeReviewMarkers");

/**
 * What conversion leaves in the paper where it could not be sure: a short bracketed note naming 待核对, such as
 * “[待核对]”, “【待核对】”, “〔公式待核对〕” or “（待核对续页）”. Plain prose mentioning 待核对 is left alone.
 */
const REVIEW_MARKER = /[[【〔（(][^[\]【】〔〕（）()\n]{0,8}待核对[^[\]【】〔〕（）()\n]{0,8}[\]】〕）)]/g;

/** Marks every review note in one text block; formatting may split a note, atoms such as formulas break it. */
function blockMarkers(block: ProseMirrorNode, position: number): Decoration[] {
  let text = "";
  const positions: number[] = [];
  block.forEach((child, offset) => {
    if (child.isText) {
      const value = child.text ?? "";
      for (let index = 0; index < value.length; index++) positions.push(position + 1 + offset + index);
      text += value;
    } else {
      positions.push(-1);
      text += "\u0000";
    }
  });
  if (!text.includes("待核对")) return [];
  return Array.from(text.matchAll(REVIEW_MARKER), match => {
    const from = positions[match.index], to = positions[match.index + match[0].length - 1];
    return from >= 0 && to >= 0 ? Decoration.inline(from, to + 1, { class: "chalklee-review-marker", title: "对照原稿确认后删去" }) : null;
  }).filter((decoration): decoration is Decoration => decoration !== null);
}

export function chalkLeeReviewMarkerDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    decorations.push(...blockMarkers(node, position));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** Rescans only the text blocks a transaction touched, so typing in a long paper stays cheap. */
function updateMarkers(decorations: DecorationSet, transaction: Transaction): DecorationSet {
  let next = decorations.map(transaction.mapping, transaction.doc);
  const { doc, mapping } = transaction;
  const blocks = new Map<number, ProseMirrorNode>();
  mapping.maps.forEach((map, index) => {
    const after = mapping.slice(index + 1);
    map.forEach((_oldFrom, _oldTo, from, to) => {
      const start = Math.max(0, Math.min(doc.content.size, after.map(from, -1)));
      const end = Math.max(start, Math.min(doc.content.size, after.map(to, 1)));
      doc.nodesBetween(start, end, (node, position) => {
        if (!node.isTextblock) return true;
        blocks.set(position, node);
        return false;
      });
    });
  });
  for (const [position, block] of blocks) {
    next = next.remove(next.find(position, position + block.nodeSize));
    next = next.add(doc, blockMarkers(block, position));
  }
  return next;
}

/**
 * Review notes left by conversion are the paper's only reminders of what to check against the original, so they
 * stand out on screen until the teacher deletes them. Printing keeps the words but drops the highlight.
 */
export const ChalkLeeReviewMarkerExtension = Extension.create({
  name: "chalkLeeReviewMarkers",
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: chalkLeeReviewMarkerKey,
      state: {
        init: (_config, state) => chalkLeeReviewMarkerDecorations(state.doc),
        apply: (transaction, decorations) => transaction.docChanged ? updateMarkers(decorations, transaction) : decorations
      },
      props: { decorations: state => chalkLeeReviewMarkerKey.getState(state) }
    })];
  }
});
