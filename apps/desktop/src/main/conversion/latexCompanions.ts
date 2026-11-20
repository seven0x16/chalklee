import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { decodeLatexSource, latexGraphicCandidates, latexInputCandidates, latexReferences } from "../../shared/latex/source";

const MAX_FILES = 300;
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
const MAX_DEPTH = 10;

/**
 * The files a .tex original names (\input files and pictures), keyed by their path relative to its folder.
 * Only regular files inside the workspace are read, never hidden ones or ChalkLee's own data; the
 * conversion worker gets them with the original so that it never reads the disk itself.
 */
export async function readLatexCompanions(root: string, sourceFile: string, main: Uint8Array): Promise<Record<string, Uint8Array>> {
  const canonicalRoot = await realpath(root);
  const folder = path.dirname(await realpath(sourceFile));
  const files: Record<string, Uint8Array> = {};
  let total = 0;
  const read = async (relative: string): Promise<Uint8Array | null> => {
    if (files[relative]) return files[relative];
    if (Object.keys(files).length >= MAX_FILES) return null;
    const absolute = path.resolve(folder, ...relative.split("/"));
    try {
      const canonical = await realpath(absolute);
      const inside = path.relative(canonicalRoot, canonical);
      if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
      if (inside.split(path.sep).some(part => part.startsWith("."))) return null;
      const stats = await lstat(canonical);
      if (!stats.isFile() || stats.size > MAX_FILE_BYTES || total + stats.size > MAX_TOTAL_BYTES) return null;
      const bytes = new Uint8Array(await readFile(canonical));
      total += bytes.byteLength;
      files[relative] = bytes;
      return bytes;
    } catch { return null; }
  };
  const graphics: string[] = [], graphicsPaths: string[] = [];
  const scan = async (bytes: Uint8Array, depth: number) => {
    let text: string;
    try { text = decodeLatexSource(bytes).text; } catch { return; }
    const references = latexReferences(text);
    graphics.push(...references.graphics);
    graphicsPaths.push(...references.graphicsPaths);
    if (depth >= MAX_DEPTH) return;
    for (const reference of references.inputs) {
      for (const candidate of latexInputCandidates(reference)) {
        const known = !!files[candidate];
        const found = await read(candidate);
        if (!found) continue;
        if (!known) await scan(found, depth + 1);
        break;
      }
    }
  };
  await scan(main, 0);
  for (const reference of new Set(graphics)) {
    for (const candidate of latexGraphicCandidates(reference, [...new Set(graphicsPaths)])) if (await read(candidate)) break;
  }
  return files;
}
