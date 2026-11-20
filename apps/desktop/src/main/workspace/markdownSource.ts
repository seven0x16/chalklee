import { isUtf8 } from "node:buffer";
import { MARKDOWN_SOURCE_ERRORS, MARKDOWN_SOURCE_MAX_BYTES } from "../../shared/markdown/source";

/** Check the same file constraints when the operation only needs bytes. */
export function validateMarkdownBytes(data: ArrayBuffer | Buffer): void {
  if (data.byteLength > MARKDOWN_SOURCE_MAX_BYTES) throw new Error(MARKDOWN_SOURCE_ERRORS.size);
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!isUtf8(bytes)) throw new Error(MARKDOWN_SOURCE_ERRORS.encoding);
  if (bytes.includes(0)) throw new Error(MARKDOWN_SOURCE_ERRORS.binary);
}
