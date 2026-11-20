import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { ChalkLeeDocument, ChalkLeeManifest, ChalkLeeProvenance } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../../../shared/document/newDocument";
import type { QuestionSnapshot } from "../../../shared/questionBank/search";

export interface PreparedQuestionAsset { id: string; path: string; mediaType: string; sha256: string; data: Uint8Array }

export interface PreparedQuestionInsertion {
  /** Persisted ChalkLee JSON (no runtime attributes yet), one per snapshot. */
  nodes: JSONContent[];
  /** Images not already present in the target document. */
  assets: PreparedQuestionAsset[];
  provenance: ChalkLeeProvenance;
  questionIds: string[];
}

const STYLE_TABLES: Record<string, keyof ChalkLeeDocument["appearance"]> = {
  question: "questionStyles",
  questionGroup: "questionStyles",
  optionGroup: "optionStyles",
  option: "optionStyles",
  questionAnswer: "answerStyles",
  questionAnalysis: "analysisStyles"
};

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp" };

/** Where inserted questions go next to a named top-level block; null once that block is gone. */
export function questionInsertionAnchorPosition(doc: ProseMirrorNode, placement: { afterId: string } | { beforeId: string }) {
  const after = "afterId" in placement;
  const id = after ? placement.afterId : placement.beforeId;
  let position: number | null = null;
  doc.forEach((node, offset) => {
    if (position === null && node.attrs.id === id) position = after ? offset + node.nodeSize : offset;
  });
  return position;
}

/**
 * Copy saved questions into another document as independent snapshots: fresh
 * IDs, auto numbering, the target's own styles, deduplicated images and a
 * provenance anchor back to the source question.
 */
export function prepareQuestionInsertion(
  snapshots: readonly QuestionSnapshot[],
  target: { document: ChalkLeeDocument; manifest: Pick<ChalkLeeManifest, "assets"> },
  createId: () => string = () => `node_${crypto.randomUUID()}`,
  createAssetId: () => string = () => `asset_${crypto.randomUUID()}`
): PreparedQuestionInsertion {
  const appearance = target.document.appearance as unknown as Record<string, Record<string, unknown> | undefined>;
  const bySha = new Map<string, string>();
  for (const asset of target.manifest.assets) if (/^[0-9a-f]{64}$/.test(asset.sha256)) bySha.set(asset.sha256, asset.id);
  const assets: PreparedQuestionAsset[] = [];
  const previous = target.document.provenance;
  const sources = [...(previous?.sources ?? [])];
  const anchors = [...(previous?.anchors ?? [])];
  const nodes: JSONContent[] = [];
  const questionIds: string[] = [];

  for (const snapshot of snapshots) {
    const ids = new Map<string, string>();
    const pairs = new Map<string, string>();
    const assetIds = new Map<string, string>();
    for (const asset of snapshot.assets) {
      const existing = bySha.get(asset.sha256);
      if (existing) { assetIds.set(asset.id, existing); continue; }
      const id = createAssetId();
      const data = new Uint8Array(asset.data.slice(0));
      assets.push({ id, path: `assets/${id}.${EXTENSIONS[asset.mediaType] ?? asset.path.split(".").pop() ?? "bin"}`, mediaType: asset.mediaType, sha256: asset.sha256, data });
      bySha.set(asset.sha256, id);
      assetIds.set(asset.id, id);
    }
    const collectIds = (node: JSONContent) => {
      if (typeof node.attrs?.id === "string") ids.set(node.attrs.id, createId());
      node.content?.forEach(collectIds);
    };
    const rewrite = (node: JSONContent): JSONContent => {
      const next: JSONContent = { ...node };
      if (node.attrs) {
        const attrs: Record<string, unknown> = { ...node.attrs };
        if (typeof attrs.id === "string") attrs.id = ids.get(attrs.id);
        if (typeof attrs.sourceBlankId === "string") {
          // Links outside the copied question cannot survive the copy.
          if (ids.has(attrs.sourceBlankId)) attrs.sourceBlankId = ids.get(attrs.sourceBlankId);
          else delete attrs.sourceBlankId;
        }
        if (typeof attrs.imagePairId === "string") {
          if (!pairs.has(attrs.imagePairId)) pairs.set(attrs.imagePairId, createId());
          attrs.imagePairId = pairs.get(attrs.imagePairId);
        }
        if ((node.type === "image" || node.type === "imageInline") && typeof attrs.assetId === "string") {
          const assetId = assetIds.get(attrs.assetId);
          if (!assetId) throw new Error("题目图片缺失，请在题目所在的文档中检查后重试。");
          attrs.assetId = assetId;
        }
        const table = STYLE_TABLES[node.type ?? ""];
        if (table && typeof attrs.styleRef === "string" && !appearance[table]?.[attrs.styleRef]) delete attrs.styleRef;
        next.attrs = attrs;
      }
      if (node.content) next.content = node.content.map(rewrite);
      return next;
    };
    const source = structuredClone(snapshot.node) as JSONContent;
    collectIds(source);
    const copy = rewrite(source);
    copy.attrs = { ...copy.attrs, number: { mode: "auto" } };
    nodes.push(copy);
    const questionId = String(copy.attrs.id);
    questionIds.push(questionId);

    let sourceRecord = sources.find(candidate => candidate.type === "chalklee" && candidate.relativePath === snapshot.location.relativePath);
    if (!sourceRecord) {
      sourceRecord = { id: createId(), type: "chalklee", fileName: snapshot.location.relativePath.split("/").pop() ?? snapshot.location.relativePath, relativePath: snapshot.location.relativePath };
      sources.push(sourceRecord);
    }
    anchors.push({ nodeId: questionId, sourceId: sourceRecord.id, locator: { kind: "chalklee", nodeId: snapshot.location.questionId } });
  }

  return { nodes, assets, provenance: { method: previous?.method ?? "manual", ...previous, sources, anchors }, questionIds };
}

/** A new paper with the questions in the given order under its title, prepared exactly as an insertion into an empty document. */
export function createQuestionPaper(
  title: string,
  snapshots: readonly QuestionSnapshot[],
  createId: () => string = () => `node_${crypto.randomUUID()}`,
  createAssetId?: () => string
): { document: ChalkLeeDocument; assets: PreparedQuestionAsset[]; questionIds: string[] } {
  const document = createEmptyChalkLeeDocument(title, createId);
  const prepared = prepareQuestionInsertion(snapshots, { document, manifest: { assets: [] } }, createId, createAssetId);
  // The empty paragraph after the questions stays, so the teacher can keep typing below them.
  const [heading, ...rest] = document.content.content;
  document.content.content = [heading, ...prepared.nodes, ...rest] as ChalkLeeDocument["content"]["content"];
  document.provenance = prepared.provenance;
  return { document, assets: prepared.assets, questionIds: prepared.questionIds };
}
