import type { ChalkLeeDocument } from "@chalklee/format";

/** A question or a part of one, as saved in a document. */
export interface QuestionContentNode {
  type?: string;
  text?: string;
  attrs?: Record<string, any>;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: QuestionContentNode[];
}

/** Each picture's sha256 by asset id, so one picture in two documents counts as the same. */
export type QuestionAssetHashes = ReadonlyMap<string, string>;

/** A question opened for editing in the library, from what its document holds now. */
export interface QuestionForEdit {
  path: string;
  questionId: string;
  /** The document's look, holding only this question. */
  document: ChalkLeeDocument;
  node: QuestionContentNode;
  assets: Array<{ id: string; path: string; mediaType: string; data: ArrayBuffer }>;
  /** Documents an edit reaches, this one included. */
  syncPapers: number;
}

/** One document's question before and after a library edit, so the edit can be put back. */
export interface QuestionContentChange { path: string; questionId: string; before: QuestionContentNode; after: QuestionContentNode }

/** A content edit saved: documents changed, its undo, copies left alone because they read differently, and any failure. */
export interface QuestionContentSaveResult { papers: number; undoId: string | null; different: string[]; failed: string[]; error: string | null }

const CONTENT_ATTRS = ["latex", "label", "answer", "colspan", "rowspan", "svg"];
const CONTENT_MARKS = new Set(["bold", "italic", "underline", "strike", "superscript", "subscript"]);
const FACE_REGIONS = ["questionMaterial", "questionStem", "optionGroup"];
const SOLUTION_REGIONS = ["questionAnswer", "questionAnalysis"];
const REGION_ORDER = ["questionMaterial", "questionStem", "optionGroup", "subQuestionList", ...SOLUTION_REGIONS];
const VISIBLE_ATOMS = new Set(["mathInline", "blockMath", "image", "imageInline", "graphic", "blank", "table"]);
/** Attributes that belong to a question's place in its document rather than to what it says. */
const PLACE_ATTRS = ["number", "score", "difficulty", "tags"];

const regionOf = (node: QuestionContentNode | undefined, type: string) => node?.content?.find(child => child.type === type);
const subQuestions = (node: QuestionContentNode) => (regionOf(node, "subQuestionList")?.content ?? []).filter(child => child.type === "question" || child.type === "questionGroup");
const hasContent = (node: QuestionContentNode | undefined): boolean => !node ? false
  : node.type === "text" ? Boolean(node.text?.trim())
  : VISIBLE_ATOMS.has(String(node.type)) || (node.content ?? []).some(hasContent);

function contentShape(node: QuestionContentNode, hashes: QuestionAssetHashes): unknown {
  const attrs: Array<[string, unknown]> = [];
  for (const name of CONTENT_ATTRS) {
    const value = node.attrs?.[name];
    if (value == null || value === "" || ((name === "colspan" || name === "rowspan") && value === 1)) continue;
    attrs.push([name, value]);
  }
  const assetId = node.attrs?.assetId;
  if (assetId) attrs.push(["asset", hashes.get(String(assetId)) ?? `id:${assetId}`]);
  const marks = (node.marks ?? []).map(mark => mark.type ?? "").filter(type => CONTENT_MARKS.has(type)).sort();
  // Empty answer lines are page layout; only words written on them are content.
  const children = (node.type === "answerLines" ? (node.content ?? []).filter(hasContent) : node.content ?? []);
  const shaped: unknown[] = [];
  let run = null as { text: string; marks: string } | null;
  for (const child of children) {
    if (child.type === "text") {
      const childMarks = (child.marks ?? []).map(mark => mark.type ?? "").filter(type => CONTENT_MARKS.has(type)).sort().join(" ");
      if (run?.marks === childMarks) run.text += child.text ?? "";
      else { run = { text: child.text ?? "", marks: childMarks }; shaped.push(run); }
    } else { run = null; shaped.push(contentShape(child, hashes)); }
  }
  return [node.type ?? "", node.text ?? "", attrs, marks, shaped];
}

const regionKey = (node: QuestionContentNode | undefined, hashes: QuestionAssetHashes) => hasContent(node) ? JSON.stringify(contentShape(node!, hashes)) : "";

/** What students read: stem or material, options and subquestions, without answers and analysis. */
export function questionFaceKey(node: QuestionContentNode, hashes: QuestionAssetHashes): string {
  return JSON.stringify([FACE_REGIONS.map(type => regionKey(regionOf(node, type), hashes)), subQuestions(node).map(sub => questionFaceKey(sub, hashes))]);
}

/** The whole question's content; alignment, fonts, spacing, ids and its number are not part of it. */
export function questionContentKey(node: QuestionContentNode, hashes: QuestionAssetHashes): string {
  return JSON.stringify([questionFaceKey(node, hashes), solutionKeys(node, hashes)]);
}

function solutionKeys(node: QuestionContentNode, hashes: QuestionAssetHashes): unknown {
  return [SOLUTION_REGIONS.map(type => regionKey(regionOf(node, type), hashes)), subQuestions(node).map(sub => solutionKeys(sub, hashes))];
}

/** The edited question for its own document: its number, score, difficulty and tags stay as the document holds them. */
export function editedQuestionNode(current: QuestionContentNode, after: QuestionContentNode): QuestionContentNode {
  const attrs: Record<string, any> = { ...current.attrs, ...after.attrs, id: current.attrs?.id };
  for (const name of PLACE_ATTRS) {
    if (current.attrs && name in current.attrs) attrs[name] = current.attrs[name];
    else delete attrs[name];
  }
  // The card numbers subquestions for display; the document keeps its own numbering.
  const numbers = new Map(subQuestions(current).map(sub => [String(sub.attrs?.id), sub]));
  const content = after.content?.map(part => part.type !== "subQuestionList" ? part : { ...part, content: part.content?.map(sub => {
    const own = numbers.get(String(sub.attrs?.id));
    return own ? editedQuestionNode(own, sub) : sub;
  }) });
  return { ...after, attrs, ...(content ? { content } : {}) };
}

/**
 * The same edit on another document's copy, or null when that copy reads differently from what
 * was edited. Stem, options and subquestions change only on a copy where they all read the same;
 * an answer or analysis only where that part read the same. Parts that stay keep the copy's own
 * ids, alignment and fonts, and `partial` says some part was left as it was.
 */
export function questionCopyWithEdit(
  before: QuestionContentNode,
  after: QuestionContentNode,
  copy: QuestionContentNode,
  sourceHashes: QuestionAssetHashes,
  copyHashes: QuestionAssetHashes,
  createId: () => string = () => `node_${crypto.randomUUID()}`
): { node: QuestionContentNode; partial: boolean } | null {
  if (questionFaceKey(before, sourceHashes) !== questionFaceKey(copy, copyHashes)) return null;
  const assetsByHash = new Map([...copyHashes].map(([id, hash]) => [hash, id]));
  let partial = false, missingPicture = false;

  const pairIds = (left: QuestionContentNode | undefined, right: QuestionContentNode | undefined, pairs = new Map<string, QuestionContentNode>()) => {
    if (!left || !right) return pairs;
    if (left.attrs?.id && right.attrs?.id) pairs.set(String(left.attrs.id), right);
    const named = (node: QuestionContentNode) => (node.content ?? []).filter(child => child.type !== "text");
    const leftChildren = named(left), rightChildren = named(right);
    if (leftChildren.length === rightChildren.length) leftChildren.forEach((child, index) => pairIds(child, rightChildren[index], pairs));
    return pairs;
  };
  const carry = (node: QuestionContentNode, targets: ReadonlyMap<string, QuestionContentNode>): QuestionContentNode => {
    const next: QuestionContentNode = { ...node };
    if (node.attrs) {
      const target = node.attrs.id ? targets.get(String(node.attrs.id)) : undefined;
      if (target && target.type === node.type) {
        // A part that stays keeps this document's look and takes only the new content.
        const attrs: Record<string, any> = { ...target.attrs };
        for (const name of CONTENT_ATTRS) {
          if (node.attrs[name] != null) attrs[name] = node.attrs[name];
          else delete attrs[name];
        }
        if (node.attrs.assetId) attrs.assetId = node.attrs.assetId;
        next.attrs = attrs;
      } else next.attrs = { ...node.attrs, ...(node.attrs.id ? { id: createId() } : {}) };
      if (next.attrs.assetId) {
        const hash = sourceHashes.get(String(next.attrs.assetId));
        const local = hash ? assetsByHash.get(hash) : undefined;
        if (local) next.attrs.assetId = local;
        else missingPicture = true;
      }
    }
    if (node.content) next.content = node.content.map(child => carry(child, targets));
    return next;
  };
  const merge = (left: QuestionContentNode, edited: QuestionContentNode, target: QuestionContentNode): QuestionContentNode => ({
    ...target,
    content: REGION_ORDER.flatMap(type => {
      const was = regionOf(left, type), now = regionOf(edited, type), own = regionOf(target, type);
      const keep = own ? [own] : [];
      if (type === "subQuestionList") {
        if (!now || !was || !own) return keep;
        const places = new Map((was.content ?? []).map((sub, index) => [String(sub.attrs?.id), index]));
        return [{ ...own, content: (now.content ?? []).map(sub => {
          const index = places.get(String(sub.attrs?.id));
          return index === undefined ? carry(sub, new Map()) : merge(was.content![index], sub, own.content![index]);
        }) }];
      }
      if (regionKey(was, sourceHashes) === regionKey(now, sourceHashes)) return keep;
      if (SOLUTION_REGIONS.includes(type) && regionKey(was, sourceHashes) !== regionKey(own, copyHashes)) { partial = true; return keep; }
      return now ? [carry(now, pairIds(was, own))] : [];
    })
  });

  const node = merge(before, after, copy);
  return missingPicture ? null : { node, partial };
}
