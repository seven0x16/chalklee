export const MARKDOWN_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const MARKDOWN_SOURCE_ERRORS = {
  size: "目前支持 10 MB 以内的 Markdown 文件，请按章节拆分后打开。",
  encoding: "Markdown 文件不是 UTF-8 编码，请用文本编辑器另存为 UTF-8 后打开。",
  binary: "文件含有二进制内容，无法作为 Markdown 打开。"
};

/** Decode Markdown identically in the preview, conversion worker and agent tools. */
export function readMarkdownSource(data: ArrayBuffer | Uint8Array): string {
  if (data.byteLength > MARKDOWN_SOURCE_MAX_BYTES) throw new Error(MARKDOWN_SOURCE_ERRORS.size);
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { throw new Error(MARKDOWN_SOURCE_ERRORS.encoding); }
  if (source.includes("\0")) throw new Error(MARKDOWN_SOURCE_ERRORS.binary);
  return source;
}

/** Encoding belongs to the file, independent of how the editor displays line breaks. */
export function decodeMarkdownFile(data: ArrayBuffer | Uint8Array) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const text = readMarkdownSource(bytes);
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const lf = text.match(/(?<!\r)\n/g)?.length ?? 0;
  return { text, bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, lineSeparator: crlf > lf ? "\r\n" : "\n" };
}
export function encodeMarkdownFile(text: string, bom: boolean): Uint8Array {
  const bytes = new TextEncoder().encode(`${bom ? "\ufeff" : ""}${text}`);
  readMarkdownSource(bytes);
  return bytes;
}

export async function markdownRevision(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
