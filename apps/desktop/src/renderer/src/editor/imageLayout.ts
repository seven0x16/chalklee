import { chalkLeeQuestionNames } from "./questionNames";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { dropPoint } from "@tiptap/pm/transform";

export type ChalkLeeImageLayout = "auto" | "block" | "inline" | "wrap-left" | "wrap-right";
export const isChalkLeeImage = (node: PMNode | null | undefined): node is PMNode => Boolean(node && ["image", "imageInline"].includes(node.type.name));
export function findChalkLeeImage(doc: PMNode, id: string) {
  let result: { node: PMNode; pos: number } | null = null;
  doc.descendants((node, pos) => { if (isChalkLeeImage(node) && node.attrs.id === id) result = { node, pos }; });
  return result as { node: PMNode; pos: number } | null;
}
function selectImage(tr: Transaction, id: string) {
  const image = findChalkLeeImage(tr.doc, id);
  return image ? tr.setSelection(NodeSelection.create(tr.doc, image.pos)).scrollIntoView() : tr;
}

/** Convert at the existing anchor. Splitting preserves paragraph formatting and all image metadata. */
export function chalkLeeImageLayoutTransaction(state: EditorState, id: string, layout: ChalkLeeImageLayout) {
  const found = findChalkLeeImage(state.doc, id);
  if (!found || (layout === "inline" && !state.schema.nodes.imageInline)) return null;
  const { node, pos } = found;
  const attrs = { ...node.attrs, imagePairId: null, layout: layout === "auto" ? null : layout === "inline" ? "block" : layout };
  const tr = closeHistory(state.tr);
  const $pos = state.doc.resolve(pos);
  if (layout === "inline" && node.type.name === "image") {
    const image = state.schema.nodes.imageInline.create(attrs);
    const before = $pos.nodeBefore, after = state.doc.resolve(pos + node.nodeSize).nodeAfter;
    if (before?.isTextblock && before.canReplaceWith(before.childCount, before.childCount, image.type)) {
      tr.delete(pos, pos + node.nodeSize).insert(pos - 1, image);
    } else if (after?.isTextblock && after.canReplaceWith(0, 0, image.type)) {
      tr.delete(pos, pos + node.nodeSize).insert(pos + 1, image);
    } else {
      tr.replaceWith(pos, pos + node.nodeSize, state.schema.nodes.paragraph.create({ id: `node_${crypto.randomUUID()}` }, image));
    }
  } else if (layout !== "inline" && node.isInline) {
    const paragraph = $pos.parent;
    const left = paragraph.content.cut(0, $pos.parentOffset);
    const right = paragraph.content.cut($pos.parentOffset + node.nodeSize);
    const blocks: PMNode[] = [];
    if (left.size) blocks.push(paragraph.copy(left));
    blocks.push(state.schema.nodes.image.create(attrs));
    if (right.size) blocks.push(paragraph.type.create({ ...paragraph.attrs, id: left.size ? `node_${crypto.randomUUID()}` : paragraph.attrs.id }, right, paragraph.marks));
    const start = $pos.before();
    const parent = $pos.node($pos.depth - 1);
    const index = $pos.index($pos.depth - 1);
    if (!parent.canReplace(index, index + 1, Fragment.from(blocks))) return null;
    tr.replaceWith(start, $pos.after(), blocks);
  } else {
    if (node.attrs.layout === attrs.layout && !node.attrs.imagePairId) return null;
    tr.setNodeMarkup(pos, undefined, attrs, node.marks);
  }
  // A floating image must precede the text it wraps. Keep the anchor in the same region.
  if (layout.startsWith("wrap-")) {
    const current = findChalkLeeImage(tr.doc, id)!;
    const $current = tr.doc.resolve(current.pos);
    const previous = $current.nodeBefore;
    if (previous?.isTextblock) {
      tr.delete(current.pos, current.pos + current.node.nodeSize).insert(current.pos - previous.nodeSize, current.node);
    }
  }
  return selectImage(tr, id);
}

export function chalkLeeMoveImageTransaction(state: EditorState, id: string, destination: number) {
  const found = findChalkLeeImage(state.doc, id);
  if (!found || destination < 0 || destination > state.doc.content.size) return null;
  if (destination >= found.pos && destination <= found.pos + found.node.nodeSize) return null;
  const image = found.node.type.create({ ...found.node.attrs, imagePairId: null }, null, found.node.marks);
  const tr = closeHistory(state.tr).delete(found.pos, found.pos + found.node.nodeSize);
  const mapped = tr.mapping.map(destination);
  const target = dropPoint(tr.doc, mapped, new Slice(Fragment.from(image), 0, 0));
  if (target == null) return null;
  // Inline drops never silently create a new paragraph or leave the intended text line.
  if (image.isInline && !tr.doc.resolve(target).parent.inlineContent) return null;
  tr.insert(target, image);
  if (tr.doc.eq(state.doc)) return null;
  return selectImage(tr, id);
}

export type ChalkLeePairImage = { node: PMNode; pos: number; question: PMNode; questionPos: number; index: number; label: string };
export type ChalkLeeImagePair = { id: string; images: [ChalkLeePairImage, ChalkLeePairImage]; from: number; to: number };

const candidateCache = new WeakMap<PMNode, ChalkLeePairImage[]>();

/** Only direct stem images of adjacent, unframed top-level questions are eligible. */
export function chalkLeePairCandidates(doc: PMNode): ChalkLeePairImage[] {
  const cached = candidateCache.get(doc);
  if (cached) return cached;
  const images: ChalkLeePairImage[] = [];
  // Named by the numbers the paper prints; questions in a box are numbered with the paper but their pictures are not paired.
  const names = chalkLeeQuestionNames(doc);
  doc.forEach((question, questionPos, index) => {
    if (question.type.name !== "question") return;
    if (question.attrs.runtimeFrame || question.attrs.sourceBlankId) return;
    const stem = question.firstChild;
    if (stem?.type.name !== "questionStem") return;
    const label = question.attrs.number?.mode === "none" ? "" : names.get(String(question.attrs.id)) ?? "";
    stem.forEach((node, offset) => {
      if (node.type.name === "image") images.push({ node, pos: questionPos + 2 + offset, question, questionPos, index, label });
    });
  });
  candidateCache.set(doc, images);
  return images;
}

export function chalkLeeImagePairs(doc: PMNode): ChalkLeeImagePair[] {
  const groups = new Map<string, ChalkLeePairImage[]>();
  for (const image of chalkLeePairCandidates(doc)) {
    const id = image.node.attrs.imagePairId;
    if (typeof id !== "string" || !id) continue;
    groups.set(id, [...(groups.get(id) ?? []), image]);
  }
  const claimed = new Set<number>();
  const pairs: ChalkLeeImagePair[] = [];
  for (const [id, images] of groups) {
    if (images.length !== 2 || images[1].index !== images[0].index + 1 || images.some(i => claimed.has(i.index))) continue;
    images.forEach(i => claimed.add(i.index));
    pairs.push({ id, images: images as [ChalkLeePairImage, ChalkLeePairImage], from: images[0].questionPos, to: images[1].questionPos + images[1].question.nodeSize });
  }
  return pairs;
}

export function chalkLeePairImagesTransaction(state: EditorState, firstId: string, secondId: string) {
  const candidates = chalkLeePairCandidates(state.doc);
  const first = candidates.find(i => i.node.attrs.id === firstId), second = candidates.find(i => i.node.attrs.id === secondId);
  if (!first || !second || Math.abs(first.index - second.index) !== 1) return null;
  const id = `pair_${crypto.randomUUID()}`;
  const tr = closeHistory(state.tr);
  // One row per question. Re-pairing cleanly detaches the previous companion.
  const previous = new Set(candidates.filter(i => i.index === first.index || i.index === second.index).map(i => i.node.attrs.imagePairId).filter(Boolean));
  state.doc.descendants((node, pos) => {
    if (isChalkLeeImage(node) && previous.has(node.attrs.imagePairId)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, imagePairId: null });
  });
  for (const item of [first, second]) tr.setNodeMarkup(item.pos, undefined, { ...item.node.attrs, layout: "block", imagePairId: id });
  return selectImage(tr, firstId);
}

export function chalkLeeRepairImagePairs(state: EditorState) {
  const valid = new Set(chalkLeeImagePairs(state.doc).flatMap(pair => pair.images.map(image => image.node.attrs.id)));
  const tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (isChalkLeeImage(node) && node.attrs.imagePairId && !valid.has(node.attrs.id)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, imagePairId: null });
  });
  return tr.docChanged ? tr : null;
}

export function chalkLeeNudgeImageTransaction(state: EditorState, id: string, direction: -1 | 1) {
  const image = findChalkLeeImage(state.doc, id);
  if (!image || image.node.attrs.imagePairId) return null;
  if (image.node.isInline) return chalkLeeMoveImageTransaction(state, id, image.pos + (direction < 0 ? -1 : 2));
  const $pos = state.doc.resolve(image.pos);
  const sibling = direction < 0 ? $pos.nodeBefore : state.doc.resolve(image.pos + image.node.nodeSize).nodeAfter;
  if (!sibling) return null;
  return chalkLeeMoveImageTransaction(state, id, direction < 0 ? image.pos - sibling.nodeSize : image.pos + image.node.nodeSize + sibling.nodeSize);
}
