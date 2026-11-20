import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { ExportChalkLeePdfRequest } from "../../shared/contracts";
import { readWorkspaceConversionSources, readWorkspaceSourceHash, wholeSources } from "../conversion/workspaceLinks";

/** Suggest a name the save dialog will not offer to replace; converted ChalkLee often share the original's name. */
export async function availablePdfExportPath(directory: string, fileName: string): Promise<string> {
  return availableExportPath(directory, fileName, "pdf");
}

/** Marks a default export name, so it never matches the ChalkLee or the original the tree hides beside it. */
export const EXPORT_SUFFIX = "（导出）";

export function safeExportName(value: unknown, format: "pdf" | "docx"): string {
  const candidate = typeof value === "string" ? value.trim().replace(/\.(pdf|docx)$/i, "") : "";
  const safe = candidate.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 120);
  return `${safe || "未命名讲义"}${EXPORT_SUFFIX}.${format}`;
}

/** The first of “name.ext”, “name（2）.ext”… that does not exist yet. */
export async function availableExportPath(directory: string, fileName: string, format: string): Promise<string> {
  const base = fileName.toLowerCase().endsWith(`.${format.toLowerCase()}`) ? fileName.slice(0, -format.length - 1) : fileName;
  for (let index = 1; index < 1000; index++) {
    const candidate = path.join(directory, `${base}${index > 1 ? `（${index}）` : ""}.${format}`);
    try { await lstat(candidate); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate; throw error; }
  }
  throw new Error("同名文件过多，请换一个文件名。");
}

/** The tree hides converted originals, so replacing one from the save dialog is refused. */
export async function assertNotChalkLeeOriginal(documentPath: string, destination: string): Promise<void> {
  try { if (!(await lstat(destination)).isFile()) return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  const name = path.basename(destination), hash = await readWorkspaceSourceHash(destination);
  // An unreadable ChalkLee hides nothing, so its originals stay visible in the tree.
  const sources = await readWorkspaceConversionSources(documentPath).catch(() => []);
  if (sources.some(source => source?.sha256?.toLowerCase() === hash)) throw new Error(`“${name}”是这份 ChalkLee 的原稿，不能覆盖，请换一个文件名。`);
  // Another ChalkLee in that folder may be the one hiding it.
  const folder = path.dirname(destination);
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const other = path.join(folder, entry.name);
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".chalklee" || other === path.resolve(documentPath)) continue;
    if (wholeSources(await readWorkspaceConversionSources(other).catch(() => [])).some(source => source.sha256.toLowerCase() === hash)) {
      throw new Error(`“${name}”是《${path.basename(entry.name, path.extname(entry.name))}》的原稿，不能覆盖，请换一个文件名。`);
    }
  }
}

export function validatedPdfPage(page: ExportChalkLeePdfRequest["page"]): {
  pageSize: Electron.PrintToPDFOptions["pageSize"];
  landscape: boolean;
  margins: NonNullable<Electron.PrintToPDFOptions["margins"]>;
  printBackground: boolean;
} {
  const finite = (value: unknown, fallback: number, min: number, max: number) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
  };
  const pageSize = page?.size === "A3" || page?.size === "Letter" || page?.size === "A4"
    ? page.size
    : page?.size === "slide" ? { width: 540 / 72, height: 960 / 72 }
    : {
        width: finite(page?.widthPt, 595.28, 144, 14400) / 72,
        height: finite(page?.heightPt, 841.89, 144, 14400) / 72
      };
  return {
    pageSize,
    landscape: page?.orientation === "landscape",
    margins: {
      top: finite(page?.marginsPt?.top, 54, 0, 360) / 72,
      right: finite(page?.marginsPt?.right, 54, 0, 360) / 72,
      bottom: finite(page?.marginsPt?.bottom, 54, 0, 360) / 72,
      left: finite(page?.marginsPt?.left, 54, 0, 360) / 72
    },
    printBackground: page?.printBackground !== false
  };
}
