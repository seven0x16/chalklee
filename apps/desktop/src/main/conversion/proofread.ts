import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createChalkLeeArchive, readChalkLeeArchive, validateChalkLeeSemantics } from "@chalklee/format";
import type { ChalkLeeArchiveAssetInput, ChalkLeeDocument } from "@chalklee/format";
import type { ImportNotice, ImportRecord, ImportResult } from "../../shared/conversion/types";
import type { WorkspaceFileNode } from "../../shared/contracts";
import { associateQuestionNotices } from "../../shared/conversion/questionReview";
import type { AgentEditorBridge } from "../agent/editorBridge";
import { dedupeImportNotices } from "./documentImport";
import { readWorkspaceDocument, writeWorkspaceDocument } from "../workspace/files";
import { workspaceStorageDirectory } from "../workspace/storage";

type Node = any;
type Bytes = (assetId: string) => Uint8Array | undefined;
/** One version of the paper, with the pictures its image nodes point to. */
export interface ProofreadSide { document: ChalkLeeDocument; bytes: Bytes }
export interface ProofreadMerge {
  document: ChalkLeeDocument;
  /** Pictures the merged paper needs that the teacher's file does not have yet. */
  assets: ChalkLeeArchiveAssetInput[];
  /** Blocks the proofread replaced, added or removed. */
  applied: number;
  /** Teacher's blocks left as they are although the proofread would have changed them. */
  kept: string[];
  /** Node ids of the proofread copy, as they are in the merged paper. */
  ids: Map<string, string>;
}

const digest = (data: Uint8Array | undefined) => data ? createHash("sha256").update(data).digest("hex") : "missing";
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const kept = (key: string, value: unknown) => key !== "id" && key !== "src" && !key.startsWith("runtime") && value !== null && value !== undefined;
const isQuestion = (node: Node) => node.type === "question" || node.type === "questionGroup";

/**
 * A node as content, the same however it was saved: no ids or editor-only attributes, empty values dropped, marks in one
 * order and neighbouring text runs joined. Pictures compare by their bytes, so a re-cropped figure counts as a change.
 */
function canonical(node: Node, bytes: Bytes): Node {
  const attrs = Object.fromEntries(Object.entries(node.attrs ?? {}).filter(([key, value]) => kept(key, value))
    .map(([key, value]) => [key, key === "assetId" && typeof value === "string" ? `sha:${digest(bytes(value))}` : value]));
  const marks = (node.marks ?? []).map((mark: Node) => {
    const markAttrs = Object.fromEntries(Object.entries(mark.attrs ?? {}).filter(([, value]) => value !== null && value !== undefined));
    return { type: mark.type, ...(Object.keys(markAttrs).length ? { attrs: markAttrs } : {}) };
  }).sort((left: Node, right: Node) => stable(left).localeCompare(stable(right)));
  const content: Node[] = [];
  for (const child of node.content ?? []) {
    if (child.type === "text" && !child.text) continue;
    const next = canonical(child, bytes), previous = content.at(-1);
    if (previous?.type === "text" && next.type === "text" && stable(previous.marks ?? []) === stable(next.marks ?? [])) previous.text += next.text;
    else content.push(next);
  }
  return { type: node.type, ...(node.text !== undefined ? { text: node.text } : {}), ...(Object.keys(attrs).length ? { attrs } : {}), ...(marks.length ? { marks } : {}), ...(content.length ? { content } : {}) };
}

/**
 * Whether `candidate` still says what `reference` says. Attributes only the candidate has are ignored: the editor fills
 * in defaults such as an image's layout when it saves, which is not a change by the teacher.
 */
function covers(reference: Node, candidate: Node): boolean {
  if (reference.type !== candidate.type || reference.text !== candidate.text) return false;
  const attrsCover = (left: Record<string, unknown> = {}, right: Record<string, unknown> = {}) => Object.keys(left).every(key => stable(left[key]) === stable(right[key]));
  if (!attrsCover(reference.attrs, candidate.attrs)) return false;
  const [leftMarks, rightMarks] = [reference.marks ?? [], candidate.marks ?? []];
  if (leftMarks.length !== rightMarks.length || leftMarks.some((mark: Node, index: number) => mark.type !== rightMarks[index].type || !attrsCover(mark.attrs, rightMarks[index].attrs))) return false;
  const [left, right] = [reference.content ?? [], candidate.content ?? []];
  return left.length === right.length && left.every((child: Node, index: number) => covers(child, right[index]));
}
function objectCovers(reference: unknown, candidate: unknown): boolean {
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) return stable(reference) === stable(candidate);
  return Object.entries(reference).every(([key, value]) => value === null || value === undefined || objectCovers(value, (candidate as any)?.[key]));
}

/** Longest run of identical blocks the two versions share, as index pairs in order. */
function commonBlocks(left: string[], right: string[]): Array<[number, number]> {
  const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) {
    table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < left.length && j < right.length;) {
    if (left[i] === right[j]) { pairs.push([i, j]); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const walk = (node: Node, visit: (node: Node) => void) => { visit(node); node.content?.forEach((child: Node) => walk(child, visit)); };

/**
 * Brings a proofread into the teacher's copy of the draft. Blocks the proofread changed replace the teacher's only where
 * the teacher left them as drafted; a block both changed keeps the teacher's version. The teacher's own additions,
 * order and deletions stay.
 */
export function mergeProofread(base: ProofreadSide, theirs: ProofreadSide & { assets: ChalkLeeArchiveAssetInput[] }, ours: ProofreadSide): ProofreadMerge {
  const drafted = base.document.content.content as Node[], proofread = theirs.document.content.content as Node[], current = ours.document.content.content as Node[];
  const draftKeys = drafted.map(node => stable(canonical(node, base.bytes)));
  const proofreadKeys = proofread.map(node => stable(canonical(node, theirs.bytes)));
  // What became of each proofread block: unchanged, a revision of a drafted block, or new.
  const fate: Array<{ kind: "same" | "revised"; draft: Node } | { kind: "added" }> = [];
  const removed: Node[] = [];
  // Within a stretch that differs, a revision is the next block of the same kind (and question number).
  const alike = (left: Node, right: Node) => left.type === right.type && (!isQuestion(left) || stable(left.attrs?.number) === stable(right.attrs?.number));
  const pairStretch = (draftFrom: number, draftTo: number, proofreadFrom: number, proofreadTo: number) => {
    let next = proofreadFrom;
    for (let index = draftFrom; index < draftTo; index++) {
      let match = next;
      while (match < proofreadTo && !alike(drafted[index], proofread[match])) match++;
      if (match === proofreadTo) { removed.push(drafted[index]); continue; }
      for (; next < match; next++) fate[next] = { kind: "added" };
      fate[match] = { kind: "revised", draft: drafted[index] }; next = match + 1;
    }
    for (; next < proofreadTo; next++) fate[next] = { kind: "added" };
  };
  let draftAt = 0, proofreadAt = 0;
  for (const [draftIndex, proofreadIndex] of [...commonBlocks(draftKeys, proofreadKeys), [drafted.length, proofread.length] as [number, number]]) {
    pairStretch(draftAt, draftIndex, proofreadAt, proofreadIndex);
    if (draftIndex < drafted.length) fate[proofreadIndex] = { kind: "same", draft: drafted[draftIndex] };
    draftAt = draftIndex + 1; proofreadAt = proofreadIndex + 1;
  }

  const ids = new Map<string, string>();
  const mapIds = (node: Node, original: Node | undefined) => {
    if (node.attrs?.id && original?.type === node.type && original.attrs?.id) ids.set(node.attrs.id, original.attrs.id);
    node.content?.forEach((child: Node, index: number) => mapIds(child, original?.type === node.type ? original.content?.[index] : undefined));
  };
  // A revised block keeps the ids it had, so selections, links and the question basket still find it.
  const adopt = (revision: Node, original: Node, teacher: Node) => {
    const next = structuredClone(revision);
    const carry = (node: Node, before: Node | undefined) => {
      if (node.attrs?.id) {
        const id = before?.type === node.type && before.attrs?.id ? before.attrs.id : node.attrs.id;
        ids.set(node.attrs.id, id); node.attrs.id = id;
      }
      node.content?.forEach((child: Node, index: number) => carry(child, before?.type === node.type ? before.content?.[index] : undefined));
    };
    carry(next, original);
    // Tags, a frame label or a score the teacher added stay on the question.
    for (const [key, value] of Object.entries(teacher.attrs ?? {})) if (!(key in (original.attrs ?? {})) && !(key in next.attrs)) next.attrs[key] = value;
    return next;
  };
  const byId = new Map(current.map(node => [node.attrs?.id, node]));
  const untouched = (original: Node, teacher: Node) => covers(canonical(original, base.bytes), canonical(teacher, ours.bytes));
  const replaced = new Map<string, Node>(), dropped = new Set<string>(), teacherKept: string[] = [];
  let applied = 0;
  proofread.forEach((node, index) => {
    const entry = fate[index];
    if (entry.kind === "same") { mapIds(node, entry.draft); return; }
    if (entry.kind === "added") return;
    const teacher = byId.get(entry.draft.attrs?.id);
    if (!teacher) return;
    if (untouched(entry.draft, teacher)) { replaced.set(teacher.attrs.id, adopt(node, entry.draft, teacher)); applied++; return; }
    ids.set(node.attrs?.id, teacher.attrs.id);
    if (!covers(canonical(node, theirs.bytes), canonical(teacher, ours.bytes))) teacherKept.push(teacher.attrs.id);
  });
  for (const original of removed) {
    const teacher = byId.get(original.attrs?.id);
    if (!teacher) continue;
    if (untouched(original, teacher)) { dropped.add(teacher.attrs.id); applied++; }
    else teacherKept.push(teacher.attrs.id);
  }
  const merged = current.filter(node => !dropped.has(node.attrs?.id)).map(node => replaced.get(node.attrs?.id) ?? node);
  // New blocks follow the block that precedes them in the proofread copy, wherever the teacher has moved it.
  const present = new Set(merged.map(node => node.attrs?.id));
  const insertions = new Map<string | null, Node[]>();
  let anchor: string | null = null;
  proofread.forEach((node, index) => {
    const entry = fate[index];
    if (entry.kind !== "added") { if (present.has(entry.draft.attrs?.id)) anchor = entry.draft.attrs.id; return; }
    const block = structuredClone(node);
    walk(block, child => { if (child.attrs?.id) ids.set(child.attrs.id, child.attrs.id); });
    insertions.set(anchor, [...insertions.get(anchor) ?? [], block]); applied++;
  });
  const content = [...insertions.get(null) ?? [], ...merged.flatMap(node => [node, ...insertions.get(node.attrs?.id) ?? []])];

  // Pictures of proofread blocks: new ones are added; a re-cropped one gets a new id rather than changing the teacher's.
  const fromProofread = [...replaced.values(), ...[...insertions.values()].flat()];
  for (const block of fromProofread) walk(block, node => {
    const blank = node.attrs?.sourceBlankId;
    if (blank && ids.has(blank)) node.attrs.sourceBlankId = ids.get(blank);
  });
  const assets: ChalkLeeArchiveAssetInput[] = [], renamed = new Map<string, string>();
  for (const id of new Set(fromProofread.flatMap(block => { const found: string[] = []; walk(block, node => { if (typeof node.attrs?.assetId === "string") found.push(node.attrs.assetId); }); return found; }))) {
    const asset = theirs.assets.find(item => item.id === id), data = theirs.bytes(id);
    if (!asset || !data) throw new Error(`校对结果缺少图片 ${id}。`);
    const existing = ours.bytes(id);
    if (existing && digest(existing) === digest(data)) continue;
    const nextId = existing ? `${id}_${digest(data).slice(0, 8)}` : id;
    if (existing) renamed.set(id, nextId);
    if (!ours.bytes(nextId)) assets.push({ ...asset, id: nextId, path: `assets/${nextId}${path.posix.extname(asset.path)}`, data });
  }
  if (renamed.size) for (const block of fromProofread) walk(block, node => { if (renamed.has(node.attrs?.assetId)) node.attrs.assetId = renamed.get(node.attrs.assetId); });

  const resultIds = new Set<string>();
  for (const block of content) walk(block, node => { if (node.attrs?.id) resultIds.add(node.attrs.id); });
  const anchors = [...ours.document.provenance?.anchors ?? [], ...(theirs.document.provenance?.anchors ?? []).map(item => ({ ...item, nodeId: ids.get(item.nodeId) ?? item.nodeId }))]
    .filter((item, index, all) => resultIds.has(item.nodeId) && all.findIndex(other => other.nodeId === item.nodeId) === index);
  // The proofread may adjust the paper's layout, unless the teacher already did.
  const appearance = objectCovers(base.document.appearance, ours.document.appearance) ? theirs.document.appearance : ours.document.appearance;
  const document: ChalkLeeDocument = { ...ours.document, appearance, content: { ...ours.document.content, content },
    ...(ours.document.provenance ? { provenance: { ...ours.document.provenance, anchors } } : {}) };
  return { document, assets, applied, kept: teacherKept, ids };
}

/** Where a proofread lands: the teacher's copy of the draft, live in any open editor. `by` proofread it: "ChalkLee AI" or the agent's name. */
export interface ProofreadTarget {
  root: string;
  file: WorkspaceFileNode;
  by: string;
  /** Replaces the editor's line counting the changes, when something else tells the teacher. */
  notice?: string;
  editors?: AgentEditorBridge;
  changed(filePath: string, kind: "changed"): void;
}

/**
 * Writes a proofread into the converted document in place. The teacher's unsaved edits are saved first, the paper as it
 * was stays a version, and an open editor takes the change as one undoable step. The conversion record gains the
 * proofread's notes for the questions still to check.
 */
export async function applyProofread(target: ProofreadTarget, proofread: { document: ChalkLeeDocument; assets: ChalkLeeArchiveAssetInput[]; notices: ImportNotice[]; record: ImportRecord }): Promise<ImportResult & { applied: number; kept: number }> {
  const prepared = await target.editors?.prepare(target.file.path);
  try {
    await prepared?.save();
    const fresh = await readWorkspaceDocument(target.root, target.file.path).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("这份初稿已被移出工作区或删除，校对结果没有写入。");
      throw error;
    });
    const archive = await readChalkLeeArchive(fresh.data);
    let history: string;
    try { history = await workspaceStorageDirectory(target.root, ["history", archive.document.id], false); }
    catch { throw new Error("找不到这份文档的转换记录，无法校对。"); }
    const [initial, existing] = await Promise.all([
      readFile(path.join(history, "initial.chalklee")).then(bytes => readChalkLeeArchive(bytes)),
      readFile(path.join(history, "import.json"), "utf8").then(text => JSON.parse(text) as ImportRecord)
    ]).catch(() => { throw new Error("找不到这份文档的初稿记录，无法校对。"); });
    const proofreadBytes = new Map(proofread.assets.map(asset => [asset.id, asset.data]));
    const merge = mergeProofread({ document: initial.document, bytes: id => initial.assets[id] },
      { document: proofread.document, bytes: id => proofreadBytes.get(id), assets: proofread.assets },
      { document: archive.document, bytes: id => archive.assets[id] });
    merge.document.metadata = { ...merge.document.metadata, updatedAt: new Date().toISOString() };
    const assets = [...archive.manifest.assets.map(asset => ({ ...asset, data: archive.assets[asset.id] })), ...merge.assets];

    let file = { ...target.file, size: fresh.size, modifiedAt: fresh.modifiedAt };
    if (merge.applied) {
      const bytes = await createChalkLeeArchive(merge.document, assets);
      const written = await readChalkLeeArchive(bytes);
      const issues = validateChalkLeeSemantics(written.document, written.manifest);
      if (issues.length) throw new Error(`校对结果结构校验失败：${issues[0].message}`);
      prepared?.assertLease();
      const saved = await writeWorkspaceDocument(target.root, target.file.path, Uint8Array.from(bytes).buffer, fresh.modifiedAt, { reason: "proofread", by: target.by });
      await prepared?.commit(merge.document, saved, [], "document", {
        assets: merge.assets.map(asset => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, dataBase64: Buffer.from(asset.data).toString("base64") })),
        notice: target.notice ?? `${target.by}${/\w$/.test(target.by) ? " " : ""}校对已修改 ${merge.applied} 处${merge.kept.length ? `，你改过的 ${merge.kept.length} 处保留原样` : ""}，可撤销恢复`
      });
      target.changed(target.file.path, "changed");
      file = { ...file, size: saved.size, modifiedAt: saved.modifiedAt };
    }

    const record: ImportRecord = { ...existing, warnings: mergedNotices(merge, proofread.document, proofread.notices, "ChalkLee AI 校对对这里有修改，因为你已经改过，保留了你的版本，请对照原稿核对。"), questionCount: proofread.record.questionCount,
      conversion: { ...proofread.record.conversion!, calls: [...existing.conversion?.calls ?? [], ...proofread.record.conversion?.calls ?? []], cachedUnits: existing.conversion?.cachedUnits ?? 0 } };
    const recordFile = path.join(history, "import.json"), temporary = `${recordFile}.${randomUUID()}.next`;
    await writeFile(temporary, JSON.stringify(record, null, 2), { mode: 0o600, flag: "wx" }); await rename(temporary, recordFile);
    return { file, record, applied: merge.applied, kept: merge.kept.length };
  } finally { await prepared?.release(); }
}

/** Notes of the merged-in copy follow its blocks into the paper; a block the teacher kept is flagged with `keptMessage`. */
function mergedNotices(merge: ProofreadMerge, incoming: ChalkLeeDocument, notices: ImportNotice[], keptMessage: string): ImportNotice[] {
  const resultIds = new Set<string>(), topOf = new Map<string, string>();
  walk(merge.document.content, node => { if (node.attrs?.id) resultIds.add(node.attrs.id); });
  for (const block of incoming.content.content as Node[]) walk(block, node => { if (node.attrs?.id) topOf.set(node.attrs.id, block.attrs?.id); });
  const located: ImportNotice[] = notices.map(({ questionIds: _questionIds, ...notice }) => {
    if (!notice.nodeId) return notice;
    const target = [notice.nodeId, topOf.get(notice.nodeId)].map(id => id && (merge.ids.get(id) ?? id)).find(id => id && resultIds.has(id));
    const { nodeId: _nodeId, ...rest } = notice;
    return target ? { ...rest, nodeId: target } : rest;
  });
  const owners = new Set<string>();
  walk(merge.document.content, node => { if (isQuestion(node)) owners.add(node.attrs.id); });
  for (const id of merge.kept) located.push({ message: keptMessage, nodeId: id, ...(owners.has(id) ? { questionIds: [id] } : {}) });
  return dedupeImportNotices(associateQuestionNotices(located, merge.document));
}

/** The window's editors, so a paper open while its conversion is written back changes as one undoable step. */
const conversionWriteBack: { editors?: AgentEditorBridge; changed?(filePath: string, kind: "changed"): void } = {};
export function configureConversionWriteBack(options: typeof conversionWriteBack) { Object.assign(conversionWriteBack, options); }

/**
 * Writes a finished conversion into the ChalkLee it continues or converts again, so one paper stays one file. It merges as
 * a proofread does: blocks the teacher left as delivered take the new result, the teacher's edits stay and are flagged where
 * the new result differs, and the paper as it was stays a version. Null when the paper cannot take it: it is no longer
 * beside the original, cannot be read, or has no record of what was delivered to tell the teacher's edits apart. The
 * caller then saves a new ChalkLee instead.
 */
export async function applyConversion(root: string, targetPath: string, directory: string, conversion: {
  /** The result as converted, before knowledge-point tags; later merges compare the paper with it. */
  initial: Uint8Array;
  delivered: Uint8Array;
  notices: ImportNotice[];
  record: ImportRecord;
}): Promise<ImportResult | null> {
  const target = await realpath(targetPath).catch(() => null);
  if (!target || path.extname(target).toLowerCase() !== ".chalklee" || path.dirname(target) !== directory) return null;
  const prepared = await conversionWriteBack.editors?.prepare(target);
  try {
    await prepared?.save();
    const fresh = await readWorkspaceDocument(root, target).catch(() => null);
    const ours = fresh && await readChalkLeeArchive(fresh.data).catch(() => null);
    if (!fresh || !ours) return null;
    const history = await workspaceStorageDirectory(root, ["history", ours.document.id], false).catch(() => null);
    const base = history && await readFile(path.join(history, "initial.chalklee")).then(bytes => readChalkLeeArchive(bytes)).catch(() => null);
    if (!history || !base) return null;
    const previous = await readFile(path.join(history, "import.json"), "utf8").then(text => JSON.parse(text) as ImportRecord).catch(() => null);
    const [theirs, initial] = await Promise.all([readChalkLeeArchive(conversion.delivered), readChalkLeeArchive(conversion.initial)]);
    const merge = mergeProofread({ document: base.document, bytes: id => base.assets[id] },
      { document: theirs.document, bytes: id => theirs.assets[id], assets: theirs.manifest.assets.map(asset => ({ ...asset, data: theirs.assets[asset.id] })) },
      { document: ours.document, bytes: id => ours.assets[id] });
    const document = convertedPaper(merge, ours.document, theirs.document);
    const bytes = await createChalkLeeArchive(document, [...ours.manifest.assets.map(asset => ({ ...asset, data: ours.assets[asset.id] })), ...merge.assets]);
    const written = await readChalkLeeArchive(bytes);
    const issues = validateChalkLeeSemantics(written.document, written.manifest);
    if (issues.length) throw new Error(`转换结果结构校验失败：${issues[0].message}`);
    // Finishing a draft continues it; anything else converts the paper again.
    const action = previous?.conversion?.followUp ? "继续整理" : previous?.conversion?.status === "draft" ? "继续转换" : "重新转换";
    prepared?.assertLease();
    const saved = await writeWorkspaceDocument(root, target, Uint8Array.from(bytes).buffer, fresh.modifiedAt, { reason: "conversion", label: `${action}前` });
    await prepared?.commit(document, saved, [], "document", {
      assets: merge.assets.map(asset => ({ id: asset.id, path: asset.path, mediaType: asset.mediaType, dataBase64: Buffer.from(asset.data).toString("base64") })),
      notice: `${action}的结果已写入${merge.kept.length ? `，你改过的 ${merge.kept.length} 处保留原样` : ""}，可撤销恢复`
    });
    conversionWriteBack.changed?.(target, "changed");
    // The conversion under the paper's ids is what the next merge tells the teacher's edits apart from.
    await replaceFile(path.join(history, "initial.chalklee"), await deliveredBase(initial, merge, document.id).catch(() => conversion.initial));
    const record: ImportRecord = { ...conversion.record, documentId: document.id,
      warnings: mergedNotices(merge, theirs.document, conversion.notices, `${action}对这里有不同结果，因为你已经改过，保留了你的版本，请对照原稿核对。`) };
    await replaceFile(path.join(history, "import.json"), JSON.stringify(record, null, 2));
    return { file: { kind: "file", id: `file:${target}`, fileId: target, path: target, name: path.basename(target), extension: "chalklee", size: saved.size, modifiedAt: saved.modifiedAt, status: "editable" }, record };
  } finally { await prepared?.release(); }
}

/** The merged paper keeps the teacher's identity and title; where its content came from is the new conversion's say. */
function convertedPaper(merge: ProofreadMerge, ours: ChalkLeeDocument, theirs: ChalkLeeDocument): ChalkLeeDocument {
  const resultIds = new Set<string>();
  walk(merge.document.content, node => { if (node.attrs?.id) resultIds.add(node.attrs.id); });
  const sources = new Set((theirs.provenance?.sources ?? []).map(source => source.id));
  const anchors = (theirs.provenance?.anchors ?? []).map(anchor => ({ ...anchor, nodeId: merge.ids.get(anchor.nodeId) ?? anchor.nodeId }))
    .filter((anchor, index, all) => resultIds.has(anchor.nodeId) && sources.has(anchor.sourceId) && all.findIndex(other => other.nodeId === anchor.nodeId) === index);
  // Older drafts carried their state in the title; a finished paper drops it unless the teacher renamed it.
  const title = ours.metadata.title === `${theirs.metadata.title}（待核对草稿）` ? theirs.metadata.title : ours.metadata.title;
  return { ...merge.document, metadata: { ...ours.metadata, title, updatedAt: new Date().toISOString() },
    ...(theirs.provenance ? { provenance: { ...theirs.provenance, anchors } } : {}) };
}

/** The conversion's own copy under the ids its blocks have in the paper. */
async function deliveredBase(initial: Awaited<ReturnType<typeof readChalkLeeArchive>>, merge: ProofreadMerge, documentId: string): Promise<Uint8Array> {
  const document = structuredClone(initial.document);
  document.id = documentId;
  walk(document.content, node => {
    if (node.attrs?.id && merge.ids.has(node.attrs.id)) node.attrs.id = merge.ids.get(node.attrs.id);
    if (node.attrs?.sourceBlankId && merge.ids.has(node.attrs.sourceBlankId)) node.attrs.sourceBlankId = merge.ids.get(node.attrs.sourceBlankId);
  });
  if (document.provenance?.anchors) document.provenance.anchors = document.provenance.anchors.map(anchor => ({ ...anchor, nodeId: merge.ids.get(anchor.nodeId) ?? anchor.nodeId }));
  return createChalkLeeArchive(document, initial.manifest.assets.map(asset => ({ ...asset, data: initial.assets[asset.id] })));
}

async function replaceFile(filePath: string, data: string | Uint8Array) {
  const temporary = `${filePath}.${randomUUID()}.next`;
  await writeFile(temporary, data, { mode: 0o600, flag: "wx" }); await rename(temporary, filePath);
}
