import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { canSkipConversion, isOriginalKind } from "../../shared/document/kinds";
import type { WorkspaceFileNode } from "../../shared/contracts";
import { readWorkspaceSourceHash } from "../conversion/workspaceLinks";
import { workspaceStorageDirectory } from "./storage";

/**
 * Originals the teacher keeps for reading, such as a textbook, remembered by content so renaming or moving
 * them keeps the mark. Stored as `.chalklee/originals/no-conversion.json`; the size spares hashing other files.
 */
type MarkedOriginal = { sha256: string; size: number };
const STORE = ["originals"];
const FILE = "no-conversion.json";

async function readMarks(root: string): Promise<MarkedOriginal[]> {
  try {
    const file = path.join(await workspaceStorageDirectory(root, STORE, false), FILE);
    const value = JSON.parse(await readFile(file, "utf8")) as { originals?: unknown };
    return Array.isArray(value.originals) ? value.originals.filter((item): item is MarkedOriginal =>
      !!item && typeof item.sha256 === "string" && /^[\da-f]{64}$/.test(item.sha256) && Number.isInteger(item.size) && item.size >= 0) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Marks or unmarks one original; `needed` false keeps it out of conversion counts and batches. */
export async function setOriginalConversionNeeded(root: string, file: { path: string; size: number }, needed: boolean): Promise<void> {
  const kind = path.extname(file.path).slice(1).toLowerCase();
  if (!isOriginalKind(kind)) throw new Error("只有 PDF、DOC、DOCX 和 LaTeX 原稿需要转换。");
  if (!needed && !canSkipConversion(kind)) throw new Error("LaTeX 原稿是老师自己的源码，不提供“不需要转换”。");
  const sha256 = await readWorkspaceSourceHash(file.path);
  const marks = (await readMarks(root)).filter(mark => mark.sha256 !== sha256);
  if (!needed) marks.push({ sha256, size: file.size });
  const directory = await workspaceStorageDirectory(root, STORE, true), target = path.join(directory, FILE);
  const temporary = `${target}.${randomUUID()}.next`;
  await writeFile(temporary, JSON.stringify({ originals: marks }), { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
}

/** Sets `noConversion` on scanned originals whose content the teacher marked. */
export async function markOriginalsNotNeedingConversion(root: string, files: WorkspaceFileNode[]): Promise<void> {
  const marks = await readMarks(root);
  if (!marks.length) return;
  const sizes = new Set(marks.map(mark => mark.size)), hashes = new Set(marks.map(mark => mark.sha256));
  for (const file of files) {
    if (!isOriginalKind(file.extension) || !sizes.has(file.size)) continue;
    try { if (hashes.has(await readWorkspaceSourceHash(file.path))) file.noConversion = true; }
    catch { /* A file being written stays as it was. */ }
  }
}
