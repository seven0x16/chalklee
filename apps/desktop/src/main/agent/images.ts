import { randomUUID } from "node:crypto";
import type { ChalkLeeArchiveAssetInput } from "@chalklee/format";
import { importCropRect } from "../conversion/crop";

/** Where an agent's picture comes from: a picture sent in the conversation, a page of a PDF in the workspace, or an image file. */
export interface AgentImageSources {
  attachment?(index: number): { data: string; mimeType: string } | undefined;
  page(path: string, page: number): Promise<string>;
  /** A PNG or JPEG file, as a data URL. */
  file(path: string): Promise<string>;
}

/** Image files a picture may be taken from whole; other kinds are pages of an original. */
export const AGENT_IMAGE_FILE = /\.(png|jpe?g)$/i;

/** Widest a picture goes in by default, as when pasted: body text, and inside an option. */
const MAX_WIDTH_PT = 300, MAX_OPTION_WIDTH_PT = 100;
/** Screenshots are usually taken on a 2× screen: two pixels per CSS pixel, at 0.75pt each. */
const SCREENSHOT_PT_PER_PIXEL = 0.375;
/** A rendered PDF page is taken as A4 wide when sizing a crop from it. */
const PAGE_WIDTH_PT = 595.28;

const isSourced = (value: Record<string, unknown>) => value.type === "image" && !value.attrs && (value.attachment !== undefined || value.path !== undefined);

/**
 * Replaces pictures named by source ({type:"image", attachment:2}, {type:"image", path:"期中.pdf", page:3} or {type:"image", path:"图.png"}, optional crop
 * [x,y,width,height] in 0–1000 of the source) with the paper's own image nodes, returning the cropped PNGs as new assets.
 */
export async function resolveAgentImages<T>(value: T, sources: AgentImageSources): Promise<{ value: T; assets: ChalkLeeArchiveAssetInput[] }> {
  const assets: ChalkLeeArchiveAssetInput[] = [];
  const visit = async (node: unknown, inOption: boolean): Promise<unknown> => {
    if (Array.isArray(node)) return Promise.all(node.map(item => visit(item, inOption)));
    if (!node || typeof node !== "object") return node;
    const item = node as Record<string, unknown>;
    if (isSourced(item)) return picture(item, inOption);
    const entries = await Promise.all(Object.entries(item).map(async ([key, child]) => [key, await visit(child, inOption || key === "options")] as const));
    return Object.fromEntries(entries);
  };
  const picture = async (item: Record<string, unknown>, inOption: boolean) => {
    let dataUrl: string, ptPerPixel: number | undefined;
    if (item.attachment !== undefined) {
      const index = Number(item.attachment);
      const image = Number.isInteger(index) && index > 0 ? sources.attachment?.(index) : undefined;
      if (!image) throw new Error(`找不到图片 ${String(item.attachment)}：请用消息“附带图片”中的编号。`);
      dataUrl = `data:${image.mimeType};base64,${image.data}`;
      ptPerPixel = SCREENSHOT_PT_PER_PIXEL;
    } else if (typeof item.path === "string" && AGENT_IMAGE_FILE.test(item.path) && item.page === undefined) {
      dataUrl = await sources.file(item.path);
      ptPerPixel = SCREENSHOT_PT_PER_PIXEL;
    } else {
      const page = Number(item.page);
      if (typeof item.path !== "string" || !Number.isInteger(page) || page < 1) throw new Error("原稿中的图片需要 path（工作区中的 PDF）和 page（从 1 开始的页码）；图片文件只支持 PNG 和 JPG。");
      dataUrl = await sources.page(item.path, page);
    }
    const crop = item.crop ?? [0, 0, 1000, 1000];
    if (!Array.isArray(crop) || crop.length !== 4 || crop.some(value => !Number.isFinite(value))) throw new Error("crop 应为 [x, y, width, height]，按原图 0–1000 计算。");
    const [x, y, width, height] = crop as number[];
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1001 || y + height > 1001) throw new Error("crop 超出了原图范围。");
    const { image, size, rect } = importCropRect(dataUrl, [x, y, width, height]);
    const id = `agent_image_${randomUUID().slice(0, 8)}`;
    assets.push({ id, path: `assets/${id}.png`, mediaType: "image/png", data: image.crop(rect).toPNG() });
    const natural = ptPerPixel ? rect.width * ptPerPixel : PAGE_WIDTH_PT * rect.width / size.width;
    const requested = Number(item.widthPt);
    const widthPt = Math.round(Number.isFinite(requested) && requested > 0 ? Math.min(requested, 520) : Math.min(natural, inOption ? MAX_OPTION_WIDTH_PT : MAX_WIDTH_PT));
    return { type: "image", attrs: { id: `node_${randomUUID()}`, assetId: id, widthPt, heightPt: Math.round(widthPt * rect.height / rect.width), alt: typeof item.alt === "string" && item.alt.trim() ? item.alt.trim().slice(0, 200) : "图片" } };
  };
  return { value: await visit(value, false) as T, assets };
}

/** Whether the content names any picture to resolve, so plain edits skip the work. */
export function hasAgentImages(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasAgentImages);
  if (!value || typeof value !== "object") return false;
  return isSourced(value as Record<string, unknown>) || Object.values(value).some(hasAgentImages);
}
