import type { ImportUnit } from "../../shared/conversion/types";
import type { ImportTranscript } from "./transcript";
import { runImportAgent, type ImportCallObserver, type ImportCredentials } from "./model";
import { importCropRect, type PixelRect } from "./crop";

export interface PdfTableGrid { rows: number; columns: number; horizontal: number[]; vertical: number[] }

/** Long straight source rules constrain cell counts independently of the model.
 * A small tolerance accommodates scan skew; text strokes alone are insufficient. */
export function detectPdfTableGrid(pixels: Uint8Array, size: { width: number; height: number }, rect: PixelRect): PdfTableGrid | undefined {
  const ink = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= size.width || y >= size.height) return false;
    const offset = (y * size.width + x) * 4;
    return pixels[offset + 3] > 32 && Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < 180;
  };
  const rules = (horizontal: boolean) => {
    const start = horizontal ? rect.y : rect.x, count = horizontal ? rect.height : rect.width;
    const across = horizontal ? rect.x : rect.y, length = horizontal ? rect.width : rect.height;
    const groups: number[][] = [];
    for (let line = start; line < start + count; line++) {
      let covered = 0, run = 0, longest = 0;
      for (let point = across + 4; point < across + length - 4; point++) {
        let hit = false;
        for (let offset = -2; offset <= 2; offset++) {
          if (horizontal ? ink(point, line + offset) : ink(line + offset, point)) { hit = true; break; }
        }
        if (hit) { covered++; longest = Math.max(longest, ++run); } else run = 0;
      }
      if (covered < (length - 8) * .85 || longest < (length - 8) * .8) continue;
      const group = groups.at(-1);
      if (group && line - group.at(-1)! <= 4) group.push(line); else groups.push([line]);
    }
    return groups.map(group => Math.round((group[0] + group.at(-1)!) / 2));
  };
  const horizontal = rules(true), vertical = rules(false);
  if (horizontal.length < 2 || vertical.length < 2 || horizontal.length > 101 || vertical.length > 9) return;
  if (horizontal[0] - rect.y > Math.max(12, rect.height * .1) || rect.y + rect.height - horizontal.at(-1)! > Math.max(12, rect.height * .1)
    || vertical[0] - rect.x > Math.max(12, rect.width * .1) || rect.x + rect.width - vertical.at(-1)! > Math.max(12, rect.width * .1)) return;
  return { rows: horizontal.length - 1, columns: vertical.length - 1, horizontal, vertical };
}

export function pdfTableCandidates(transcript: ImportTranscript, unit: ImportUnit) {
  if (/^\s*\|?\s*:?-{3,}:?\s*\|/m.test(transcript.markdown)) return [];
  return unit.images.filter(image => {
    const box = image.pageBounds;
    if (!box || !image.id.startsWith("pdf_candidate_") || image.id.endsWith("_context") || box[2] < 350 || box[3] < 60) return false;
    return !transcript.figures.some(figure => {
      const other = figure.crop ?? unit.images.find(asset => asset.id === figure.assetId)?.pageBounds;
      if (!other) return false;
      const area = Math.max(0, Math.min(box[0] + box[2], other[0] + other[2]) - Math.max(box[0], other[0]))
        * Math.max(0, Math.min(box[1] + box[3], other[1] + other[3]) - Math.max(box[1], other[1]));
      return area > box[2] * box[3] * .5;
    });
  });
}

/** Restore rows/columns only by moving whole, already recognized lines.
 * Text, formulas and figure markers are never accepted from the repair reply. */
export function applyPdfTableReferences(original: ImportTranscript, raw: string, grids?: Record<string, PdfTableGrid>): ImportTranscript {
  const value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  if (!Array.isArray(value?.tables) || value.tables.length > 8) throw new Error("表格核对结果不完整。");
  if (!value.tables.length) return original;
  const lines = original.markdown.split("\n"), used = new Set<number>();
  const replacements = value.tables.map((table: any) => {
    if (!Array.isArray(table?.rows) || !table.rows.length || table.rows.length > 100) throw new Error("表格行列引用无效。");
    const width = table.rows[0]?.length;
    if (!Number.isInteger(width) || width < 1 || width > 8) throw new Error("表格列数无效。");
    if (grids) {
      const grid = grids[table.candidateId ?? (Object.keys(grids).length === 1 ? Object.keys(grids)[0] : "")];
      if (!grid) throw new Error("表格必须引用已有候选编号。");
      if (table.rows.length !== grid.rows || width !== grid.columns) throw new Error(`原稿表格线确定为 ${grid.rows} 行 ${grid.columns} 列；同一单元格内的所有原文行必须放进同一个引用数组，不能按文字条数新增表格行。`);
    }
    const indices: number[] = [];
    const rows: string[][] = table.rows.map((row: any) => {
      if (!Array.isArray(row) || row.length !== width) throw new Error("表格各行列数不一致。");
      return row.map((cell: any) => {
        if (!Array.isArray(cell)) throw new Error("表格单元格必须引用原文行。");
        return cell.map((ref: any) => {
          const match = typeof ref === "string" && ref.match(/^line_(\d+)$/);
          const index = match ? Number(match[1]) - 1 : -1;
          if (index < 0 || index >= lines.length || !lines[index].trim() || used.has(index)) throw new Error("表格引用未知、空白或重复的原文行。");
          used.add(index); indices.push(index);
          // The Markdown table splitter removes one escape before each pipe.
          return lines[index].replace(/\|/g, "\\|");
        }).join("<br>");
      });
    });
    if (!indices.length) throw new Error("表格缺少原文内容。");
    const start = Math.min(...indices), end = Math.max(...indices);
    for (let index = start; index <= end; index++) if (lines[index].trim() && !indices.includes(index)) throw new Error("表格不能跨过未引用的正文内容。");
    const header = `|${Array(width).fill(" ").join("|")}|\n|${Array(width).fill(" --- ").join("|")}|`;
    return { start, end, markdown: header + "\n" + rows.map(row => `| ${row.join(" | ")} |`).join("\n") };
  });
  const result = structuredClone(original);
  for (const item of replacements.sort((a: { start: number }, b: { start: number }) => b.start - a.start))
    lines.splice(item.start, item.end - item.start + 1, item.markdown);
  result.markdown = lines.join("\n");
  return result;
}

export async function checkPdfTranscriptTables(credentials: ImportCredentials, original: ImportTranscript, unit: ImportUnit, signal: AbortSignal, observe?: ImportCallObserver): Promise<ImportTranscript> {
  const page = unit.images.find(image => image.id === unit.id);
  if (!page) return original;
  const candidates = pdfTableCandidates(original, unit).flatMap(image => {
    const source = importCropRect(page.dataUrl, image.pageBounds!);
    const grid = detectPdfTableGrid(source.image.toBitmap(), source.size, source.rect);
    // A frame with a row of pictures and a row of A/B/C/D captions is an
    // option layout. Its separate labelled figures are already references;
    // asking for a text table would force the model to invent empty rows.
    if (grid?.rows === 2) {
      const box = image.pageBounds!;
      const labels = original.figures.flatMap(figure => {
        if (!figure.optionLabel) return [];
        const bounds = figure.crop ?? unit.images.find(asset => asset.id === figure.assetId)?.pageBounds;
        if (!bounds) return [];
        const x = bounds[0] + bounds[2] / 2, y = bounds[1] + bounds[3] / 2;
        return x > box[0] && x < box[0] + box[2] && y > box[1] && y < box[1] + box[3] ? [figure.optionLabel] : [];
      }).sort();
      if (labels.length === grid.columns && labels.every((label, index) => label === String.fromCharCode(65 + index))) return [];
    }
    return grid ? [{ image, grid }] : [];
  });
  if (!candidates.length) return original;
  const grids = Object.fromEntries(candidates.map(candidate => [candidate.image.id, candidate.grid]));
  let repair: { error: string; previous: string } | undefined;
  for (let attempt = 0; ; attempt++) {
    const raw = await runImportAgent(credentials, JSON.stringify({ lines: original.markdown.split("\n").map((text, index) => ({ ref: `line_${index + 1}`, text })), candidates: candidates.map(({ image: { dataUrl: _pixels, ...image }, grid }) => ({ ...image, grid })), ...(repair ? { repair } : {}) }), [page, ...candidates.map(candidate => candidate.image)], signal,
      `核对原稿中带框的文字表格是否被转录摊平成段落。候选也可能是图形，只有实际看见文字单元格才恢复表格。grid来自原稿表格线：rows与columns为实际行列数，horizontal与vertical是整页像素坐标，必须遵守，不能按条目数量增添横线。跨页续表即使从半句话开始、没有表头，也保留本页原来的左右列。只引用输入line_编号，不抄写、不改字、不补跨页缺词；不要按题号猜测行列。每个表格包含其连续范围内的全部非空原文行，每行只引用一次。原稿同一格的多行放在同一个ref数组，例如一行两列的表格返回rows:[[["line_1","line_3","line_5"],["line_7","line_9","line_10","line_12"]]]，不能把这些段落另分成表格行。空格用[]。不把表格前后的正文收入表格，不新增表头。只输出JSON：{"tables":[{"candidateId":"候选编号","rows":[[["左格line_编号"],["右格line_编号"]]]}]}。没有遗漏表格返回{"tables":[]}。`, observe, "source-table-check");
    signal.throwIfAborted();
    try { return applyPdfTableReferences(original, raw, grids); }
    catch (error) {
      if (attempt === 2) throw error;
      repair = { error: error instanceof Error ? error.message : "表格引用无效", previous: raw };
    }
  }
}
