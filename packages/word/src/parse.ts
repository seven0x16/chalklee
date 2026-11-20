import { isCompound } from "./compound";
import { parseDoc } from "./doc";
import { parseDocx } from "./docx";
import type { WordDocument } from "./model";

/** Detect the bytes: old .doc filenames sometimes contain a DOCX archive. */
export async function parseWord(bytes: Uint8Array, options: { includeEquations?: boolean } = {}): Promise<WordDocument> {
  if (bytes.length > 64 * 1024 * 1024) throw new Error("目前支持 64 MB 以内的 Word 原稿。");
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return parseDocx(bytes, options);
  if (isCompound(bytes)) return parseDoc(bytes, options);
  throw new Error("无法读取这份 Word 原稿：目前支持 DOC 和 DOCX 格式。");
}
