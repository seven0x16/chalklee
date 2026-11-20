import { addAbortSignal, Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import JSZip from "jszip";
import { OcrError, type OcrReference, type PageRecognizer } from "./ocrReference";
import { ocrJson, ocrRequest, structuredOcrPage, type StructuredBlock } from "./structuredOcr";

const LABEL = "MinerU";
const API = "https://mineru.net/api/v4";
const MAX_ARCHIVE = 32 * 1024 * 1024;
const MAX_LAYOUT = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { equation: "display_formula", interline_equation: "display_formula", page_number: "number", title: "doc_title" };

function resultData(result: any) {
  if (result?.code === 0) return result.data;
  if (["A0202", "A0211"].includes(result?.code)) throw new OcrError("MinerU API Token 无效或已过期，请重新填写。", true);
  throw new OcrError("MinerU 暂时无法解析页面，请稍后重试。");
}

function fileUrl(value: unknown): string {
  const error = new OcrError("MinerU 返回的文件传输地址无效。");
  if (typeof value !== "string") throw error;
  let url: URL;
  try { url = new URL(value); } catch { throw error; }
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || !["cdn-mineru.openxlab.org.cn", "mineru.oss-cn-shanghai.aliyuncs.com"].includes(url.hostname)) throw error;
  return url.href;
}

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** One page of MinerU's content list (V1), as cloud and self-hosted 2.2–3.x services return it, with boxes in 0..1000. */
export function mineruContentBlocks(items: unknown): StructuredBlock[] {
  if (!Array.isArray(items) || items.some(item => item?.page_idx !== 0)) throw new OcrError("MinerU 返回的页数与原稿不一致。");
  return items.flatMap(item => {
    const type = item.type === "text" && item.text_level === 1 ? "doc_title" : TYPES[item.type] ?? item.type;
    const block = {
      type, box: item.bbox,
      text: type === "table" ? item.table_body : type === "list" ? strings(item.list_items).join("\n") : type === "code" ? item.code_body : item.text
    };
    // The V1 content list attaches captions to the image and has no separate box for them; before 2.2 they were img_caption.
    const caption = [...strings(item.image_caption), ...strings(item.img_caption)].join(" ");
    return caption ? [block, { type: "figure_title", box: item.bbox, text: caption }] : [block];
  });
}

async function readArchive(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new OcrError("MinerU 没有返回识别文件。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.length;
      if (size > MAX_ARCHIVE) throw new OcrError("MinerU 返回的单页识别文件过大。");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
}

/** The text of the result file whose name matches, read within a page's limit; undefined when there is none. */
export async function zipText(response: Response, name: RegExp, signal: AbortSignal): Promise<string | undefined> {
  try {
    const archive = await JSZip.loadAsync(await readArchive(response));
    const entry = Object.values(archive.files).find(file => !file.dir && name.test(file.name));
    if (!entry) return undefined;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of addAbortSignal(signal, new Readable().wrap(entry.nodeStream()))) {
      size += chunk.length;
      if (size > MAX_LAYOUT) throw new OcrError("MinerU 返回的单页版面过大。");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size).toString("utf8");
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof OcrError) throw error;
    throw new OcrError("MinerU 返回的版面文件无法读取。");
  }
}

async function readLayout(response: Response, signal: AbortSignal): Promise<OcrReference> {
  const text = await zipText(response, /(?:^|\/)(?:[^/]+_)?content_list\.json$/i, signal);
  if (text === undefined) throw new OcrError("MinerU 未返回带坐标的版面，请检查精度版解析权限。");
  let items: unknown;
  try { items = JSON.parse(text); } catch { throw new OcrError("MinerU 返回的版面文件无法读取。"); }
  return structuredOcrPage("mineru", mineruContentBlocks(items));
}

export class MineruPageRecognizer implements PageRecognizer {
  constructor(private readonly apiKey: string) {}

  async recognize(png: string, fileName: string, signal: AbortSignal): Promise<OcrReference> {
    const timeout = AbortSignal.timeout(180_000);
    const taskSignal = AbortSignal.any([signal, timeout]);
    try {
      const submitted = resultData(await ocrJson(LABEL, `${API}/file-urls/batch`, this.apiKey, taskSignal, {
        files: [{ name: fileName, is_ocr: true }], model_version: "vlm", enable_formula: true, enable_table: true
      }));
      if (typeof submitted?.batch_id !== "string" || !/^[a-z0-9-]+$/i.test(submitted.batch_id)) {
        throw new OcrError("MinerU 未返回解析任务。");
      }
      const uploaded = await ocrRequest(LABEL, fileUrl(submitted.file_urls?.[0]), {
        method: "PUT", body: new Uint8Array(Buffer.from(png, "base64"))
      }, taskSignal);
      await uploaded.body?.cancel();
      for (;;) {
        await delay(2000, undefined, { signal: taskSignal });
        const data = resultData(await ocrJson(LABEL, `${API}/extract-results/batch/${submitted.batch_id}`, this.apiKey, taskSignal));
        const result = data?.extract_result?.[0];
        if (result?.state === "failed") throw new OcrError("MinerU 未能解析这一页。");
        if (result?.state === "done") {
          return await readLayout(await ocrRequest(LABEL, fileUrl(result.full_zip_url), {}, taskSignal), taskSignal);
        }
      }
    } catch (error) {
      signal.throwIfAborted();
      if (timeout.aborted) throw new OcrError("MinerU 等待读取结果超时。");
      throw error;
    }
  }
}
