import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { OcrError, type OcrBox, type OcrLayout, type OcrReference, type PageRecognizer } from "./ocrReference";

/** DeepSeek OCR's key; tests may bring their own fetch. */
export interface DeepSeekOcrConnection { apiKey: string; fetch?: typeof fetch }

const OCR_URL = "https://api.deepseek.com/v1/tools/ocr";
// The service gives up 180 s after the upload starts.
const REQUEST_TIMEOUT_MS = 190000;

// DeepSeek's block types under PaddleOCR-VL's names, so one transcript builder serves both.
const TYPES: Record<string, string> = {
  title: "doc_title", sub_title: "paragraph_title", image: "image", image_caption: "figure_title", table: "table",
  header: "header", footer: "footer", page_number: "number", equation: "display_formula", formula: "display_formula"
};
const BLOCK = /<｜ref｜>([^<]*)<｜\/ref｜><｜box｜>([^<]*)<｜\/box｜>/g;
/** An option letter printed alone, e.g. “A.” or “(B)”. */
const OPTION_LABEL = /^[（(]?[A-HＡ-Ｈ][)）]?[.．、]?$/;
const TALL_FORMULA = /\\(?:d?frac|sqrt|sum|int|begin|overset|underset|xrightarrow)/;

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };
/** Formulas in a recognized table cell, "$x < 5$ 且 $x > 0$", keep their comparison signs: only real tags outside them go. */
const MATH = /(\$\$[\s\S]*?\$\$|\$[^$]*\$)/;
const HTML_TAG = /<\/?(?:table|thead|tbody|tfoot|tr|td|th|caption|colgroup|col|p|div|span|font|center|b|strong|i|em|u|s|sub|sup)\b[^<>]*>/gi;
const plainText = (html: string) => html.split(MATH).map((part, index) => index % 2 ? part : part.replace(/<br\s*\/?>/gi, " ").replace(HTML_TAG, ""))
  .join("").replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, name: string) => entities[name]);

/** Tables come as HTML; merged areas keep their text in the first cell and stay empty elsewhere. */
export function markdownTable(html: string): string {
  const grid: string[][] = [];
  [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].forEach((row, r) => {
    let column = 0;
    for (const cell of row[1].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      const span = (name: string) => Math.max(1, Math.min(50, Number(cell[1].match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i"))?.[1] ?? 1)));
      const text = plainText(cell[2]).replace(/\s+/g, " ").trim().replaceAll("|", "\\|");
      while ((grid[r] ??= [])[column] !== undefined) column++;
      const columns = span("colspan"), rows = span("rowspan");
      for (let dr = 0; dr < rows; dr++) for (let dc = 0; dc < columns; dc++) (grid[r + dr] ??= [])[column + dc] = dr || dc ? "" : text;
      column += columns;
    }
  });
  if (!grid.length) throw new OcrError("OCR 返回的表格无法读取。");
  const width = Math.max(...grid.map(row => row.length));
  const line = (row: string[] = []) => `| ${Array.from({ length: width }, (_, index) => row[index] ?? "").join(" | ")} |`;
  return [line(grid[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...grid.slice(1).map(line)].join("\n");
}

/**
 * Blanks recognized inside a formula, as in `$a = \_\_\_\_ \text{m/s}^2$`, are written outside it like the model's own
 * transcripts. A display formula with a blank is a line to fill in: its parts become inline formulas around the blank.
 */
const blanksOutsideMath = (text: string) => text.replace(/\$\$([\s\S]+?)\$\$|\$([^$]+)\$/g, (whole, display: string | undefined, inline: string | undefined) => {
  const body = display ?? inline ?? "";
  return /(?:\\_\s*){3,}/.test(body) ? body.split(/(?:\\_\s*){3,}/).map(part => part.trim() ? `$${part.trim()}$` : "").join("______") : whole;
});

export function ocrBlockText(type: string, raw: string): string {
  if (type === "table") return /<table/i.test(raw) ? markdownTable(raw) : raw.trim();
  let text = raw.replace(/<\/?center>/gi, "").trim();
  if (type === "doc_title" || type === "paragraph_title") text = text.replace(/^#{1,6}\s+/, "");
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => `$$${body.trim()}$$`).replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => `$${body.trim()}$`);
  return blanksOutsideMath(text);
}

/** Boxes are whole-page `[[x1, y1, x2, y2], …]` in 0..1000; a block may list several. */
function boxes(value: string): OcrBox[] {
  const numbers = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (!numbers.length || numbers.length % 4) throw new OcrError("OCR 区域坐标无效。");
  const result: OcrBox[] = [];
  for (let index = 0; index < numbers.length; index += 4) {
    const [x1, y1, x2, y2] = numbers.slice(index, index + 4).map(n => Math.min(1000, Math.max(0, n)));
    if (!(x2 > x1 && y2 > y1)) throw new OcrError("OCR 区域坐标无效。");
    result.push([x1, y1, x2 - x1, y2 - y1]);
  }
  return result;
}
const union = (items: OcrBox[]): OcrBox => {
  const left = Math.min(...items.map(box => box[0])), top = Math.min(...items.map(box => box[1]));
  return [left, top, Math.max(...items.map(box => box[0] + box[2])) - left, Math.max(...items.map(box => box[1] + box[3])) - top];
};

/**
 * Option figures sometimes come back inside the box of their letter (“A.” spanning the
 * figure) instead of as images. Split such a box after the letter so the figure is kept;
 * the figure checks that follow still correct the crop against the page.
 */
function splitOptionFigures(layouts: OcrLayout[], page: { width: number; height: number }): OcrLayout[] {
  const heights = layouts.filter(layout => layout.type === "text" && layout.text && !OPTION_LABEL.test(layout.text) && layout.text.length <= 30 && !TALL_FORMULA.test(layout.text))
    .map(layout => layout.box[3] * page.height / 1000).sort((a, b) => a - b);
  if (!heights.length) return layouts;
  const label = heights[Math.floor(heights.length / 2)] * 1.3 / page.width * 1000;
  return layouts.flatMap(layout => {
    if (layout.type !== "text" || !OPTION_LABEL.test(layout.text ?? "") || layout.box[2] < label * 2.5) return [layout];
    const [x, y, width, height] = layout.box;
    return [{ ...layout, box: [x, y, label, height] }, { id: `${layout.id}_figure`, type: "image", box: [x + label, y, width - label, height] }];
  });
}

/** Turns the raw page text, with its `<｜ref｜>type<｜/ref｜><｜box｜>…<｜/box｜>` markers, into a page reference. */
export function normalizeDeepSeekOcr(text: string, page: { width: number; height: number }): OcrReference {
  const blocks = [...text.matchAll(BLOCK)];
  if (!blocks.length) throw new OcrError(text.trim() ? "OCR 没有返回内容位置。" : "OCR 没有识别出这一页的内容。");
  const layouts: OcrLayout[] = blocks.flatMap((block, index) => {
    const raw = text.slice(block.index + block[0].length, blocks[index + 1]?.index ?? text.length);
    const kind = block[1].trim();
    const type = TYPES[kind] ?? (/^\s*(?:\$\$|\\\[)/.test(raw) ? "display_formula" : "text");
    const found = boxes(block[2]);
    if (type === "image") return found.map((box, part) => ({ id: `block_${index + 1}${found.length > 1 ? `_${part + 1}` : ""}`, type, box }));
    const content = ocrBlockText(type, raw);
    return content ? [{ id: `block_${index + 1}`, type, box: union(found), text: content }] : [];
  });
  const split = splitOptionFigures(layouts, page);
  return {
    unitId: "page_1", provider: "deepseek-ocr", status: "unverified-reference",
    coordinateSystem: "whole-page-0..1000-[x,y,width,height]", sourcePageSize: page, layouts: split, tables: [],
    imageCandidates: split.filter(layout => layout.type === "image").map(layout => ({ id: layout.id, type: "image", sourceImageId: "page_1", box: layout.box }))
  };
}

function pngSize(image: Buffer): { width: number; height: number } {
  if (image.length < 24 || image.readUInt32BE(0) !== 0x89504e47 || image.toString("ascii", 12, 16) !== "IHDR") throw new OcrError("页面图像无效。");
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

function serviceError(status: number, message: unknown): OcrError {
  const detail = typeof message === "string" && message ? `：${message.slice(0, 200)}` : "";
  if (status === 401) return new OcrError("DeepSeek API Key 无效，请检查后重新填写。", true);
  if (status === 402) return new OcrError("DeepSeek 账户余额不足，请充值后重试。", true);
  if (status === 403) return new OcrError(`DeepSeek 拒绝了识别请求${detail || "。"}`, true);
  if (status === 429) return new OcrError("DeepSeek OCR 请求过于频繁，请稍后再试。");
  return new OcrError(`DeepSeek OCR 识别未完成${status === 200 ? "" : `（HTTP ${status}）`}${detail || "。"}`);
}

function multipart(parts: { name: string; value: Buffer | string; fileName?: string }[]) {
  const boundary = `chalklee-${randomUUID()}`;
  // Built by hand: a proxied Chromium session does not take FormData bodies.
  const body = new Uint8Array(Buffer.concat([...parts.flatMap(part => [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${part.fileName ? `; filename="${part.fileName.replace(/["\r\n]/g, "_")}"\r\nContent-Type: image/png` : ""}\r\n\r\n`),
    Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value), Buffer.from("\r\n")
  ]), Buffer.from(`--${boundary}--\r\n`)]));
  return { body, type: `multipart/form-data; boundary=${boundary}` };
}

async function send(connection: DeepSeekOcrConnection, form: ReturnType<typeof multipart>, signal: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    return await (connection.fetch ?? fetch)(OCR_URL, {
      method: "POST", body: form.body, redirect: "error", signal: AbortSignal.any([signal, timeout]),
      headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": form.type }
    });
  } catch {
    signal.throwIfAborted();
    throw new OcrError(timeout.aborted ? "DeepSeek OCR 识别超时。" : "无法连接 DeepSeek，请检查网络后重试。");
  }
}

/** Checks the key with DeepSeek's model list, which recognizes nothing and costs nothing. */
export async function checkDeepSeekKey(connection: DeepSeekOcrConnection, signal: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await (connection.fetch ?? fetch)("https://api.deepseek.com/models", {
      redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), headers: { Authorization: `Bearer ${connection.apiKey}` }
    });
  } catch {
    signal.throwIfAborted();
    throw new OcrError("无法连接 DeepSeek，请检查网络后重试。");
  }
  await response.body?.cancel();
  if (response.ok) return;
  if (response.status === 401 || response.status === 402) throw serviceError(response.status, undefined);
  throw new OcrError(`DeepSeek 暂时无法连接（HTTP ${response.status}），请稍后再试。`);
}

/** Uploads one page image at a time; recognition runs while the request stays open. */
export class DeepSeekPageRecognizer implements PageRecognizer {
  constructor(private readonly connection: DeepSeekOcrConnection) {}

  async recognize(png: string, fileName: string, signal: AbortSignal): Promise<OcrReference> {
    const image = Buffer.from(png, "base64");
    const size = pngSize(image);
    const form = multipart([{ name: "purpose", value: "rich_layout_recognition" }, { name: "file", value: image, fileName }]);
    for (let waits = 0, emptyRetried = false; ;) {
      const response = await send(this.connection, form, signal);
      // A rate limit turns the upload away before recognition starts, so it is not billed twice.
      if (response.status === 429 && waits < 5) {
        await response.body?.cancel();
        await delay(1000 * 2 ** waits++, undefined, { signal });
        continue;
      }
      // While recognizing, the service may send newlines first; the whole body is still one JSON object.
      const value = await response.json().catch(() => undefined);
      if (!response.ok || value?.error) throw serviceError(response.status, value?.error?.message);
      const result = Array.isArray(value?.pages) && value.pages.length === 1 ? value.pages[0] : undefined;
      if (typeof result?.text !== "string") throw new OcrError("DeepSeek OCR 返回的页数与原稿不一致。");
      if (result.finish_reason === "length") throw new OcrError("DeepSeek OCR 的识别结果不完整。");
      // Pages sometimes come back empty at random; asking again often reads them.
      if (!result.text.trim() && !emptyRetried) { emptyRetried = true; continue; }
      return normalizeDeepSeekOcr(result.text, size);
    }
  }
}
