import { randomUUID } from "node:crypto";
import type { ChalkLeeBlockNode, ChalkLeeArchiveAssetInput } from "@chalklee/format";
import type { ImportImage, ImportUnit } from "../../shared/conversion/types";
import { isTransientImportFailure } from "../../shared/conversion/failure";

export class ImportPageFailure extends Error {}

/** Service, configuration, cancellation and storage failures stop the run.
 * They are not evidence that a source page needs to become an image draft. */
export function pageFailure(error: unknown): never {
  if (!(error instanceof Error) || error instanceof TypeError || (error as NodeJS.ErrnoException).code || isTransientImportFailure(error.message)
    || /\b(?:401|403|404)\b|unauthorized|forbidden|invalid.{0,15}(?:key|model)|api.?key|authentication|insufficient.{0,10}(?:quota|balance)|余额|鉴权|无权限/i.test(error.message)) throw error;
  throw new ImportPageFailure(error.message);
}

export const draftParagraph = (text: string, id = `node_${randomUUID()}`): ChalkLeeBlockNode => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });

/** Preserve a fragment as source prose when its counterpart is across a failed
 * page. Do not invent missing question regions or attach answers across the gap. */
export function preserveImportFragment(node: ChalkLeeBlockNode): ChalkLeeBlockNode[] {
  if (node.type !== "question" && node.type !== "questionGroup") return [node];
  const result: ChalkLeeBlockNode[] = [draftParagraph(`${node.attrs.number.mode === "fixed" ? `第 ${node.attrs.number.label} 题` : "题目"}片段（待核对续页）`, node.attrs.id)];
  for (const region of node.content) {
    if (region.type === "optionGroup") {
      for (const option of region.content) result.push(draftParagraph(`${option.attrs.label}.`, option.attrs.id), ...option.content);
    } else if (region.type === "subQuestionList") result.push(...region.content.flatMap(preserveImportFragment));
    else {
      if (region.type === "questionAnswer" || region.type === "questionAnalysis") result.push(draftParagraph(region.type === "questionAnswer" ? "答案" : "解析", region.attrs.id));
      result.push(...region.content);
    }
  }
  return result;
}

export function preserveImportPage(unit: ImportUnit, image: ImportImage): { blocks: ChalkLeeBlockNode[]; asset: ChalkLeeArchiveAssetInput; nodeId: string } {
  const assetId = `${unit.id}_unconverted_source`, nodeId = `${assetId}_heading`;
  const scale = Math.min(420 / image.widthPt, 540 / image.heightPt, 1);
  return {
    nodeId,
    blocks: [
      { type: "heading", attrs: { id: nodeId, level: 3 }, content: [{ type: "text", text: `第 ${unit.page} 页原稿（待核对）` }] },
      draftParagraph("本页还没转好，已保留原稿图像；继续转换后可编辑。", `${assetId}_notice`),
      { type: "image", attrs: { id: `${assetId}_image`, assetId, widthPt: image.widthPt * scale, heightPt: image.heightPt * scale, alt: `第 ${unit.page} 页未完成转换的原稿` } }
    ],
    asset: { id: assetId, path: `assets/${assetId}.png`, mediaType: "image/png", data: Buffer.from(image.dataUrl.split(",")[1], "base64") }
  };
}
