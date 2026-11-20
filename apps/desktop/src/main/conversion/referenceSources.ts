import { createHash } from "node:crypto";
import { Type } from "typebox";
import type { ImportImage, ImportUnit, PreparedImport, SourceFragmentEdit, SourceFragmentRevision } from "../../shared/conversion/types";
import { wordSourceText } from "../../shared/conversion/wordSource";
import { usableFormulaLatex } from "./wordFormulas";

/** Shared by built-in reference conversion and external conversion tools. */
export const SourceFragmentEditSchema = Type.Object({
  ref: Type.String({ minLength: 1, maxLength: 120 }),
  path: Type.Array(Type.Union([Type.String(), Type.Integer({ minimum: 0 })]), { maxItems: 24 }),
  kind: Type.Union([Type.Literal("typo"), Type.Literal("recognition"), Type.Literal("image-formula")]),
  before: Type.String({ minLength: 1, maxLength: 12000 }), after: Type.String({ maxLength: 12000 }),
  reason: Type.String({ minLength: 4, maxLength: 1000 }), evidenceImageId: Type.Optional(Type.String({ minLength: 1, maxLength: 120 }))
}, { additionalProperties: false });

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Keep full originals in durable records, not in every model tool response. */
export function sourceRevisionChanges(revisions: readonly SourceFragmentRevision[] = []) {
  return revisions.slice(-20).map(({ ref, path, kind, before, after, reason, evidenceImageId }) => ({ ref, path, kind, before, after, reason, ...(evidenceImageId ? { evidenceImageId } : {}) }));
}
export function sourceImageHash(input: PreparedImport, unit: ImportUnit, image: ImportImage): string {
  // Rendering the same immutable PDF may vary in antialiased pixels.
  return digest(unit.page && image.id === unit.id ? [input.sourceHash, unit.id, unit.page] : image.dataUrl);
}

function source(input: PreparedImport, ref: string) {
  const found = input.units.flatMap(unit => unit.blocks.flatMap((block, index) => block.attrs.id === ref ? [{ unit, block, index }] : []));
  if (found.length !== 1 || !found[0].unit.nativeReferences) throw new Error(`原稿片段 ${ref} 不存在或不能局部修订。`);
  return found[0];
}

function target(block: any, path: (string | number)[]) {
  if (!Array.isArray(path) || path.length > 24 || path.length % 2) throw new Error("path 只能使用 content 与子节点下标定位原稿节点。");
  let node = block, parent: any[] | undefined, index = -1;
  for (let at = 0; at < path.length; at += 2) {
    const next = path[at + 1];
    if (path[at] !== "content" || !Number.isInteger(next) || Number(next) < 0 || !Array.isArray(node?.content) || Number(next) >= node.content.length) throw new Error("原稿局部修改路径无效，请重新读取片段。");
    parent = node.content; index = Number(next); node = parent![index];
  }
  return { node, parent, index };
}

function smallTypo(before: string, after: string): boolean {
  let start = 0, endBefore = before.length, endAfter = after.length;
  while (start < Math.min(endBefore, endAfter) && before[start] === after[start]) start++;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter--; }
  const changed = before.slice(start, endBefore) + after.slice(start, endAfter);
  return changed.length <= 8 && /\p{Script=Han}/u.test(changed) && !/[A-Za-z\p{N}\p{Sm}\\$]|不|非|无|未|正|负/u.test(changed);
}

/** Where to look instead: the page the fragment is printed on, or the pictures it holds itself. */
function evidenceHint(unit: ImportUnit, ref: string) {
  return unit.images.some(image => image.id === unit.id)
    ? `改用 ${ref} 所在这一页的原稿 evidenceImageId:"${unit.id}"（先查看这张整页原图），或这一段原稿自己引用的图片`
    : "改用这一段原稿自己引用的图片";
}

function evidenceFor(input: PreparedImport, ref: string, imageId?: string) {
  const { unit, block } = source(input, ref);
  const image = imageId && unit.images.find(image => image.id === imageId);
  // A figure printed on the next page (a question's diagram below its text) is not evidence for this page's words.
  if (imageId && !image) throw new Error(`${imageId} 不在 ${ref} 所在的原稿页上，不能作为它的原图依据：${evidenceHint(unit, ref)}。`);
  if (image && image.id !== unit.id && !JSON.stringify(block).includes(`"${image.id}"`)) throw new Error(`${image.id} 不在 ${ref} 中，不能作为它的原图依据：${evidenceHint(unit, ref)}。`);
  return image || undefined;
}

const printedPrefix = (block: unknown) => wordSourceText(block).match(/^\s*(?:[（(]\s*[）)]\s*)?(?:\d+[.．、)）]|[（(]\d+[）)]|[A-H][.．、:：)）])/)?.[0].replace(/\s/g, "") ?? "";

function applyEdit(input: PreparedImport, edit: SourceFragmentEdit) {
  if (!edit || typeof edit.ref !== "string" || !["typo", "recognition", "image-formula"].includes(edit.kind)
    || typeof edit.before !== "string" || !edit.before || edit.before.length > 12000 || typeof edit.after !== "string" || edit.after.length > 12000
    || edit.kind !== "image-formula" && edit.before === edit.after || typeof edit.reason !== "string" || edit.reason.trim().length < 4 || edit.reason.length > 1000) throw new Error("请提供有效的局部原值、新值及具体修改依据。");
  if (edit.kind === "typo" && !smallTypo(edit.before, edit.after)) throw new Error("普通改字仅用于少量明确的中文错别字；原稿中的英语、标点和括号保持原样，不能为语句通顺补写。确有提取错误时须先对照原图，再按 recognition 修订。");
  const selected = source(input, edit.ref);
  const prefix = printedPrefix(selected.block);
  const { node, parent, index } = target(selected.block, edit.path);
  if (edit.kind === "image-formula") {
    if (!["image", "imageInline"].includes(node.type) || node.attrs?.assetId !== edit.before) throw new Error("图片公式的 before 必须是该节点当前的 assetId。");
    if (edit.evidenceImageId !== edit.before) throw new Error("请先查看这张完整原图，再将图片转换为公式。");
    if (!usableFormulaLatex(edit.after)) throw new Error("公式 LaTeX 无效，请保留原图或修正公式语法。");
    const replacement = { type: node.type === "image" ? "blockMath" : "mathInline", attrs: { ...(node.type === "image" ? { id: node.attrs.id } : {}), latex: edit.after } };
    if (parent) parent[index] = replacement;
    else selected.unit.blocks[selected.index] = replacement as typeof selected.block;
  } else if (node.type === "text") {
    const at = node.text.indexOf(edit.before);
    if (at < 0 || node.text.indexOf(edit.before, at + 1) >= 0) throw new Error("before 与当前文字不符或出现多次，请读取片段后精确定位。");
    if (edit.kind === "typo" && (!smallTypo(edit.before, edit.after) || /^\s*[A-H][.．、:：)）]/.test(wordSourceText(selected.block)))) throw new Error("普通改字仅用于少量明确错别字；数字、符号、英语材料和选项须对照原图按 recognition 修订。");
    const value = node.text.slice(0, at) + edit.after + node.text.slice(at + edit.before.length);
    if (!value.trim()) throw new Error("不能清空原稿文字节点。");
    if (edit.kind === "typo" && /待核对|未提取|缺图/.test(node.text) && (node.text.match(/待核对|未提取|缺图/g) ?? []).join() !== (value.match(/待核对|未提取|缺图/g) ?? []).join()) throw new Error("不能通过普通改字消除原稿缺失或待核对提示。");
    node.text = value;
  } else if (["mathInline", "blockMath"].includes(node.type)) {
    if (edit.kind !== "recognition" || node.attrs?.latex !== edit.before || !usableFormulaLatex(edit.after)) throw new Error("公式修订须提供完整的原 LaTeX、新 LaTeX 和原图依据。");
    node.attrs.latex = edit.after;
  } else throw new Error("只能局部修改文字、公式，或将完整公式图片转为公式，不能改来源和题目结构。");
  if (printedPrefix(source(input, edit.ref).block) !== prefix) throw new Error("不能通过片段修订改动题号或选项号。");
}

/** Replays recorded changes on a fresh copy, without mutating the extraction,
 * changing refs or permitting unrecorded source replacement. */
export function workingReferenceInput(input: PreparedImport, revisions: readonly SourceFragmentRevision[] = []): PreparedImport {
  if (!revisions.length || !input.units.some(unit => unit.nativeReferences)) return input;
  if (revisions.length > 1000) throw new Error("原稿局部修订过多，请拆分文档。");
  const working = { ...input, units: input.units.map(unit => ({ ...unit, blocks: structuredClone(unit.blocks) })) };
  for (const revision of revisions) {
    const selected = source(working, revision.ref);
    if (revision.originalBlock && digest(revision.originalBlock) !== digest(source(input, revision.ref).block)) throw new Error("保存的原始片段与本次来源不一致。");
    if (selected.unit.id !== revision.unitId || digest(selected.block) !== revision.beforeHash) throw new Error("原始片段已变化，不能复用旧的局部修改。");
    const evidence = evidenceFor(input, revision.ref, revision.evidenceImageId);
    if (revision.kind !== "typo" && !evidence || revision.evidenceImageId && (!evidence || sourceImageHash(input, selected.unit, evidence) !== revision.evidenceHash)) throw new Error("局部修改的原图依据缺失或已变化。");
    applyEdit(working, revision);
    if (digest(source(working, revision.ref).block) !== revision.afterHash) throw new Error("原稿局部修改记录校验失败。");
  }
  return working;
}

/** Each transaction is checked in a copy. The caller persists revisions and
 * question structure together only after their combined compilation passes. */
export function appendSourceRevisions(input: PreparedImport, revisions: readonly SourceFragmentRevision[], edits: SourceFragmentEdit[],
  viewed: (unit: ImportUnit, image: ImportImage, full: boolean) => boolean): SourceFragmentRevision[] {
  if (!Array.isArray(edits) || edits.length > 30 || revisions.length + edits.length > 1000 || JSON.stringify(edits).length > 200000) throw new Error("请按题目分批提交原稿局部修改。");
  const working = workingReferenceInput(input, revisions);
  // Always isolate the first transaction too.
  const copy = { ...working, units: working.units.map(unit => ({ ...unit, blocks: structuredClone(unit.blocks) })) };
  const result = [...revisions];
  for (const edit of edits) {
    const selected = source(copy, edit.ref);
    const image = evidenceFor(input, edit.ref, edit.evidenceImageId);
    if (edit.kind !== "typo" && !image) throw new Error(`识图修订须写明 evidenceImageId：${evidenceHint(selected.unit, edit.ref)}。`);
    if (image && !viewed(selected.unit, image, edit.kind === "image-formula")) throw new Error(`请先查看对应原图 ${image.id}${edit.kind === "image-formula" ? "（完整原图，不加 box）" : ""}，在下一轮根据实际图像修改。`);
    const beforeHash = digest(selected.block);
    applyEdit(copy, edit);
    result.push({ ...structuredClone(edit), unitId: selected.unit.id, beforeHash, afterHash: digest(source(copy, edit.ref).block),
      ...(!result.some(revision => revision.ref === edit.ref) ? { originalBlock: structuredClone(source(input, edit.ref).block) } : {}),
      ...(image ? { evidenceHash: sourceImageHash(input, selected.unit, image) } : {}) });
  }
  return result;
}
