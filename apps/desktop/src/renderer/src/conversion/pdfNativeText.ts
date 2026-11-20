import { OPS, type PDFPageProxy } from "pdfjs-dist";
import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import type { ChalkLeeBlockNode, ChalkLeeInlineNode, ChalkLeeMark } from "@chalklee/format";
import type { ImportImage, ImportUnit } from "../../../shared/conversion/types";
import { joinWrappedLines, normalizeNumberedBlanks, splitWordSourceBlocks, wordSourceText } from "../../../shared/conversion/wordSource";

type Matrix = number[];
type Box = [number, number, number, number];
export interface PdfNativeGeometry { transform: Matrix; width: number; height: number; rules: Box[]; invisibleText: boolean; fullPageImage: boolean;
  fonts?: Record<string, { bold: boolean; italic: boolean; measure: (text: string, size: number) => number }> }
const multiply = (a: Matrix, b: Matrix): Matrix => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const bounds = (m: Matrix, x: number, y: number, width: number, height: number): Box => {
  const p = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]].map(([a, b]) => [m[0] * a + m[2] * b + m[4], m[1] * a + m[3] * b + m[5]]);
  const left = Math.min(...p.map(v => v[0])), top = Math.min(...p.map(v => v[1]));
  return [left, top, Math.max(...p.map(v => v[0])) - left, Math.max(...p.map(v => v[1])) - top];
};

/** Keep real horizontal rules (including numbered fill-in lines), not just the
 * PDF text stream: dropping an underline can change the meaning of a question. */
export async function pdfNativeGeometry(page: PDFPageProxy): Promise<PdfNativeGeometry> {
  const viewport = page.getViewport({ scale: 1 }), ops = await page.getOperatorList();
  let matrix: Matrix = [1, 0, 0, 1, 0, 0], invisibleText = false, fullPageImage = false;
  const stack: Matrix[] = [], rules: Box[] = [];
  const fonts: NonNullable<PdfNativeGeometry["fonts"]> = {};
  const context = document.createElement("canvas").getContext("2d");
  ops.fnArray.forEach((op, i) => {
    const args = ops.argsArray[i];
    if (op === OPS.setFont && !fonts[args[0]]) {
      try {
        const font = page.commonObjs.get(args[0]);
        if (context && font?.loadedName) fonts[args[0]] = { bold: !!(font.bold || font.black || /bold|black|demi/i.test(font.name ?? "")), italic: !!(font.italic || /italic|oblique/i.test(font.name ?? "")),
          measure: (text, size) => { context.font = `${size}px "${font.loadedName}"`; return context.measureText(text).width; } };
      } catch { /* Unavailable font metrics keep partial underlines on the visual path. */ }
    }
    if (op === OPS.save) stack.push([...matrix]);
    else if (op === OPS.restore) matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (op === OPS.transform) matrix = multiply(matrix, args);
    else if (op === OPS.setTextRenderingMode && [3, 7].includes(args[0])) invisibleText = true;
    else if ([OPS.paintImageXObject, OPS.paintInlineImageXObject].includes(op)) {
      const box = bounds(multiply(viewport.transform, matrix), 0, 0, 1, 1);
      if (box[2] * box[3] > viewport.width * viewport.height * .65) fullPageImage = true;
    } else if (op === OPS.constructPath && [OPS.stroke, OPS.fill, OPS.eoFill].includes(args[0]) && args[2]?.length === 4) {
      const [x, y, right, bottom] = args[2];
      const box = bounds(multiply(viewport.transform, matrix), x, y, right - x, bottom - y);
      if (box[2] >= 8 && box[3] <= 1.5) rules.push(box);
    }
  });
  return { transform: viewport.transform, width: viewport.width, height: viewport.height, rules, invisibleText, fullPageImage, fonts };
}

type PdfRun = { item: TextItem; x: number; y: number; height: number; width: number; math?: { prefix: string; latex: string } };
type PdfFormulaBand = { top: number; bottom: number; runs: PdfRun[]; rules: Set<number> };
const SCRIPT_TEXT = /^[A-Za-z0-9+\-−–()·.]{1,8}$/;
const FORMULA_TAIL = /[A-Za-z0-9.()[\]]+$/;
const FORMULA_HEAD = /^[A-Za-z0-9]+/;
// Math structure needs its pixels. Greek letters, ∆ in ∆H, the minus sign, ⋅ in mol⋅L⁻¹, ∶ and ≡
// are ordinary text; equation-object letters (U+1D400–1D7FF) and unmapped glyphs (�) are not.
const FORMULA_SYMBOL = /[\u2200-\u2205\u2207-\u2211\u2213-\u2235\u2237-\u2260\u2262-\u22C4\u22C6-\u22FF\p{Co}\uFFFD\u0000-\u0008]|[\u{1D400}-\u{1D7FF}]/u;

/** The formula a script belongs to: no printed (2) subquestion number, and no bracket opened
 * outside it, so c(H⁺) keeps "c(" as text. */
function formulaToken(text: string): string {
  let token = text.match(FORMULA_TAIL)?.[0] ?? "";
  token = token.replace(/^\(\d{1,2}\)/, "");
  const open: number[] = [];
  [...token].forEach((character, index) => {
    if ("([".includes(character)) open.push(index);
    else if (")]".includes(character)) open.pop();
  });
  // A closing bracket may carry the script itself: [Cu(NH₃)₄]²⁺.
  return open.length ? token.slice(open.at(-1)! + 1) : token;
}

function formulaText(text: string, upright: boolean): string {
  const value = text.replace(/[−–]/g, "-").replace(/·/g, "\\cdot ");
  return upright && /[A-Za-z]/.test(value) ? `\\mathrm{${value}}` : value;
}

/** A printed sub- or superscript right after a formula run (NaNO₂, Na⁺, NO₂⁻, L⁻¹, N_A) is
 * already exact: rebuild it from glyph positions instead of recognizing the page again. */
function attachPdfScripts(runs: PdfRun[], geometry: PdfNativeGeometry): PdfRun[] {
  const upright = (run: PdfRun) => !(geometry.fonts?.[run.item.fontName]?.italic || Math.abs(run.item.transform[2]) > .01);
  const owners = new Map<PdfRun, { base: PdfRun; kind: "sub" | "sup" }>();
  for (const script of runs.filter(run => SCRIPT_TEXT.test(run.item.str.trim())).sort((a, b) => a.x - b.x)) {
    let best: { base: PdfRun; kind: "sub" | "sup"; gap: number } | undefined;
    for (const anchor of runs) {
      // Follows a formula run, or a script already attached to one (SO₄²⁻).
      const base = owners.get(anchor)?.base ?? anchor;
      if (anchor === script || base === script || owners.has(base) || !(script.height < base.height * .82)) continue;
      if (anchor === base && !formulaToken(base.item.str)) continue;
      const gap = Math.abs(script.x - anchor.x - anchor.width), dy = script.y - base.y;
      const kind = dy > base.height * .08 && dy < base.height * .6 ? "sub" : dy < -base.height * .15 && dy > -base.height * .75 ? "sup" : undefined;
      if (kind && gap < base.height * .5 && (!best || gap < best.gap)) best = { base, kind, gap };
    }
    if (best) owners.set(script, best);
  }
  const scripts = new Map<PdfRun, Record<"sub" | "sup", PdfRun[]>>();
  for (const [script, { base, kind }] of owners) {
    const entry = scripts.get(base) ?? { sub: [], sup: [] };
    entry[kind].push(script); scripts.set(base, entry);
  }
  return runs.filter(run => !owners.has(run)).map(run => {
    const entry = scripts.get(run);
    if (!entry) return run;
    const token = formulaToken(run.item.str);
    const part = (list: PdfRun[]) => list.sort((a, b) => a.x - b.x).map(script => formulaText(script.item.str.trim(), upright(script))).join("");
    const latex = formulaText(token, upright(run)) + (entry.sub.length ? `_{${part(entry.sub)}}` : "") + (entry.sup.length ? `^{${part(entry.sup)}}` : "");
    const right = Math.max(run.x + run.width, ...[...entry.sub, ...entry.sup].map(script => script.x + script.width));
    return { ...run, width: right - run.x, math: { prefix: run.item.str.slice(0, -token.length), latex } };
  });
}

const ARROWS: Record<string, string> = { "→": "xrightarrow", "⟶": "xrightarrow", "←": "xleftarrow", "⇌": "xrightleftharpoons", "⇋": "xrightleftharpoons", "⇄": "xrightleftharpoons", "=": "xlongequal", "═": "xlongequal" };

/** Reaction conditions printed small and centred over or under an arrow (干馏 over →,
 * 放电 and 充电 around ⇌) belong to that arrow; positions settle them exactly. */
function attachPdfArrowConditions(runs: PdfRun[], geometry: PdfNativeGeometry, body: number): PdfRun[] {
  const upright = (run: PdfRun) => !(geometry.fonts?.[run.item.fontName]?.italic || Math.abs(run.item.transform[2]) > .01);
  const taken = new Set<PdfRun>(), rebuilt = new Map<PdfRun, PdfRun>();
  const condition = (list: PdfRun[]) => list.sort((a, b) => a.x - b.x).map(run => run.math
    ? (run.math.prefix ? `\\text{${run.math.prefix.trim()}}` : "") + run.math.latex
    : /^[A-Za-z0-9.()+\-]+$/.test(run.item.str.trim()) ? formulaText(run.item.str.trim(), upright(run)) : `\\text{${run.item.str.trim()}}`).join("");
  for (const arrow of runs) {
    const command = ARROWS[arrow.item.str.trim()];
    if (!command || arrow.math || arrow.height < body * .9) continue;
    const middle = arrow.y - arrow.height / 2;
    const near = runs.filter(run => run !== arrow && !taken.has(run) && run.height < arrow.height * .82 && !/[\\{}$^~]/.test(run.item.str)
      && run.x + run.width / 2 > arrow.x - arrow.width * .5 && run.x + run.width / 2 < arrow.x + arrow.width * 1.5);
    const offset = (run: PdfRun) => (run.y - run.height / 2) - middle;
    const above = near.filter(run => -offset(run) > arrow.height * .4 && -offset(run) < arrow.height * 1.4);
    const below = near.filter(run => offset(run) > arrow.height * .4 && offset(run) < arrow.height * 1.4);
    if (!above.length && !below.length) continue;
    for (const run of [...above, ...below]) taken.add(run);
    // The arrow keeps its own position: spacing and overprint checks concern the printed line, not the conditions above it.
    rebuilt.set(arrow, { ...arrow, math: { prefix: "", latex: `\\${command}${below.length ? `[${condition(below)}]` : ""}{${condition(above)}}` } });
  }
  return runs.filter(run => !taken.has(run)).map(run => rebuilt.get(run) ?? run);
}

/** Formulas that glyph positions cannot settle (conditions over an arrow, fractions, left
 * scripts, math symbols) become strips recognized from their pixels; the rest of the page
 * keeps its exact native text. Too many strips leave the whole page to visual recognition. */
function pdfFormulaBands(runs: PdfRun[], geometry: PdfNativeGeometry, body: number): PdfFormulaBand[] | undefined {
  const top = (run: PdfRun) => run.y - run.height;
  const spans: [number, number][] = [];
  for (const run of runs) {
    // Small type over, under or beside a line, or full-size type stacked against it (a fraction whose bar is
    // drawn as a path): normal line spacing keeps the next line's centre well outside these windows.
    const scaled = run.height < body * .82, reach = scaled ? .75 : .5;
    const small = !/^[.,;:!?，。；：！？\s]+$/.test(run.item.str) && runs.some(line => line !== run && line.height >= body * .9
      && run.y - run.height / 2 > top(line) - line.height * reach && run.y - run.height / 2 < line.y + line.height * reach
      // Smaller type on the line's own baseline is ordinary text in the same row.
      && Math.abs(run.y - line.y) > (scaled ? Math.min(run.height, line.height) * .2 : line.height * .3)
      && run.x < line.x + line.width + line.height * .5 && run.x + run.width > line.x - line.height * .5);
    // Stacked parts often sit in the gap between lines without touching either line's box.
    if (small) spans.push([top(run) - body * .35, run.y + body * .35]);
    else if (FORMULA_SYMBOL.test(run.item.str)) spans.push([top(run), run.y]);
  }
  geometry.rules.forEach(rule => {
    if (rule[2] > geometry.width * .4) return;
    const inside = (run: PdfRun) => run.x >= rule[0] - 2 && run.x + run.width <= rule[0] + rule[2] + 2;
    if (runs.some(run => inside(run) && run.y <= rule[1] + .5 && run.y >= rule[1] - body * .7)
      && runs.some(run => inside(run) && top(run) >= rule[1] - .5 && top(run) <= rule[1] + body * .7)) spans.push([rule[1] - body * .7, rule[1] + body * .7]);
  });
  const bands: PdfFormulaBand[] = [];
  for (const span of spans.sort((a, b) => a[0] - b[0])) {
    let [from, to] = span;
    // A strip holds whole lines: a formula's own line and its stacked parts stay together.
    for (let changed = true; changed;) {
      changed = false;
      for (const run of runs) {
        if (Math.min(to, run.y) - Math.max(from, top(run)) > Math.min(1, run.height * .15) && (top(run) < from || run.y > to)) {
          from = Math.min(from, top(run)); to = Math.max(to, run.y); changed = true;
        }
      }
    }
    const last = bands.at(-1);
    if (last && from < last.bottom) { last.top = Math.min(last.top, from); last.bottom = Math.max(last.bottom, to); }
    else bands.push({ top: from, bottom: to, runs: [], rules: new Set() });
  }
  for (const band of bands) {
    band.runs = runs.filter(run => Math.min(band.bottom, run.y) - Math.max(band.top, top(run)) > Math.min(1, run.height * .15));
    geometry.rules.forEach((rule, index) => { if (rule[1] >= band.top - .5 && rule[1] <= band.bottom + .5) band.rules.add(index); });
  }
  if (bands.length > 12 || bands.reduce((count, band) => count + band.runs.length, 0) > runs.length * .6) return undefined;
  return bands.filter(band => band.runs.length);
}

/** Conservative, source-only eligibility. The model checks missing graphics,
 * tables and reading order separately before these references are accepted. */
export function extractPdfNativeText(content: Pick<TextContent, "items">, geometry: PdfNativeGeometry, pageNumber: number, images: ImportImage[] = []): NonNullable<ImportUnit["pdfText"]> {
  const result: NonNullable<ImportUnit["pdfText"]> = { candidate: false, reason: "文字层不足，使用视觉识别", blocks: [], lines: [], omittedMargins: [] };
  const items = content.items.filter((item): item is TextItem => "str" in item && !!item.str.trim()).filter(item => {
    const baseline = multiply(geometry.transform, item.transform)[5];
    if (baseline > geometry.height * .9 && /^学科网[（(]北京[）)]股份有限公司$/.test(item.str.replace(/\s/g, ""))) { result.omittedMargins.push(item.str); return false; }
    return true;
  });
  const plain = items.map(i => i.str).join("");
  if (plain.length < 100 || (plain.match(/[\p{Script=Han}A-Za-z]/gu)?.length ?? 0) < 50) return result;
  if (geometry.invisibleText || geometry.fullPageImage) return { ...result, reason: "整页图像或隐藏文字层，需核对扫描原稿" };
  const positioned = items.map(item => {
    const matrix = multiply(geometry.transform, item.transform);
    return { item, x: matrix[4], y: matrix[5], height: Math.hypot(matrix[2], matrix[3]), width: item.width };
  });
  // A horizontal baseline with a small shear is ordinary synthetic italic,
  // including punctuation. It does not change the page's reading order.
  if (Math.abs(geometry.transform[1]) > .01 || Math.abs(geometry.transform[2]) > .01 || items.some(i => i.dir !== "ltr" || Math.abs(i.transform[1]) > .01 || Math.abs(i.transform[2]) > Math.abs(i.transform[3]) * .5) || positioned.some(p => !Number.isFinite(p.x + p.y + p.width + p.height) || p.height < 4 || p.x < -1 || p.x + p.width > geometry.width + 2)) return { ...result, reason: "文字旋转、尺寸或坐标不可靠，使用视觉识别" };
  result.scriptRegions = positioned.flatMap(base => {
    if (!/^[A-Za-zΑ-Ωα-ω]{1,3}$/.test(base.item.str.trim())) return [];
    const left = positioned.filter(part => part !== base && part.height < base.height * .8
      && part.x < base.x && part.x > base.x - base.height * 3
      && Math.abs(part.x + part.width - base.x) < base.height * .4
      && Math.abs(part.y - base.y) < base.height
      && /^[A-Za-zΑ-Ωα-ω\d +−–-]+$/.test(part.item.str));
    const above = left.filter(part => part.y < base.y - base.height * .25);
    const below = left.filter(part => part.y >= base.y - base.height * .25);
    if (above.length !== 1 || below.length !== 1) return [];
    const x = Math.max(0, Math.min(above[0].x, below[0].x) - base.height);
    const top = Math.max(0, Math.min(...[base, ...left].map(part => part.y - part.height)) - base.height * .5);
    const right = Math.min(geometry.width, base.x + base.width + base.height);
    const bottom = Math.min(geometry.height, Math.max(...[base, ...left].map(part => part.y)) + base.height * .5);
    return [{ box: [x / geometry.width * 1000, top / geometry.height * 1000, (right - x) / geometry.width * 1000, (bottom - top) / geometry.height * 1000] as [number, number, number, number],
      base: base.item.str.trim(), aboveLeft: above[0].item.str.trim(), belowLeft: below[0].item.str.trim() }];
  }).slice(0, 16);
  if (/\d{1,3}\s*[-–—~～]\s*\d{1,3}\s*[A-H]{3,}/.test(plain)) return { ...result, reason: "集中答案表需要按题号展开，使用视觉识别" };
  const sizes = new Map<number, number>();
  for (const part of positioned) sizes.set(Math.round(part.height * 2) / 2, (sizes.get(Math.round(part.height * 2) / 2) ?? 0) + part.item.str.length);
  const body = [...sizes].sort((a, b) => b[1] - a[1])[0][0];
  const runs = attachPdfArrowConditions(attachPdfScripts(positioned, geometry), geometry, body);
  const bands = pdfFormulaBands(runs, geometry, body);
  if (!bands) return { ...result, reason: "本页公式较多，使用视觉识别" };
  const banded = new Set(bands.flatMap(band => band.runs)), bandRules = new Set(bands.flatMap(band => [...band.rules]));
  const rows: PdfRun[][] = [];
  for (const item of runs.filter(run => !banded.has(run)).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0].y - item.y) <= Math.min(row[0].height, item.height) * .2) row.push(item);
    else rows.push([item]);
  }
  // Some PDFs paint a full stop below the text baseline in a separate run.
  // Keep its horizontal position inside the sentence instead of appending
  // that punctuation-only physical row to the end of the preceding line.
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index];
    if (!row.every(part => /^[.,;:!?，。；：！？]+$/.test(part.item.str.trim()))) continue;
    const target = rows.filter(other => other !== row && other.some(part => /[\p{L}\p{N}]/u.test(part.item.str))
      && row.every(punctuation => Math.abs(other[0].y - punctuation.y) <= Math.max(other[0].height, punctuation.height) * 1.1
        && other.some(part => Math.abs(part.x + part.width - punctuation.x) <= punctuation.height * .6)))
      .sort((a, b) => Math.abs(a[0].y - row[0].y) - Math.abs(b[0].y - row[0].y))[0];
    if (target) { target.push(...row); rows.splice(index, 1); }
  }
  if (rows.length > 120) return { ...result, reason: "本页文字片段过于密集，使用视觉识别" };
  const usedRules = new Set<number>();
  const proseLeft = Math.min(...rows.filter(row => row.map(part => part.item.str).join("").length > 50).map(row => Math.min(...row.map(part => part.x))));
  let unhandledStyle = false;
  // Formula strips keep their reading position between the native rows.
  const bandRows = new Map<PdfRun[], PdfFormulaBand>();
  for (const band of bands) {
    const at = rows.findIndex(row => row.length > 0 && row[0].y > band.bottom), placeholder: PdfRun[] = [];
    bandRows.set(placeholder, band);
    rows.splice(at < 0 ? rows.length : at, 0, placeholder);
  }
  const regions: NonNullable<NonNullable<ImportUnit["pdfText"]>["regions"]> = [];
  for (const [index, row] of rows.entries()) {
    const band = bandRows.get(row);
    if (band) {
      // Every glyph of the strip, scripts included, in printed lines: the recognized formula must use exactly these.
      const parts = positioned.filter(part => part.y - part.height / 2 >= band.top - .5 && part.y - part.height / 2 <= band.bottom + .5).sort((a, b) => a.y - b.y);
      const printed: PdfRun[][] = [];
      for (const part of parts) {
        const line = printed.find(line => Math.abs(line[0].y - line[0].height / 2 - part.y + part.height / 2) <= body * .6);
        if (line) line.push(part); else printed.push([part]);
      }
      const text = printed.map(line => line.sort((a, b) => a.x - b.x).map(part => part.item.str).join(" ")).join("\n");
      const left = Math.max(0, Math.min(...parts.map(part => part.x)) - body * .5), right = Math.min(geometry.width, Math.max(...parts.map(part => part.x + part.width)) + body * .5);
      const from = Math.max(0, band.top - body * .3), to = Math.min(geometry.height, band.bottom + body * .3);
      const ref = `pdf_${pageNumber}_formula_${regions.length + 1}`;
      const box: Box = [left / geometry.width * 1000, from / geometry.height * 1000, (right - left) / geometry.width * 1000, (to - from) / geometry.height * 1000];
      result.blocks.push({ type: "paragraph", attrs: { id: ref, spaceAfterPt: 0 }, content: [{ type: "text", text }] });
      result.lines.push({ ref, text, box });
      regions.push({ ref, text, box });
      continue;
    }
    row.sort((a, b) => a.x - b.x);
    const x = row[0].x, right = Math.max(...row.map(i => i.x + i.width)), baseline = row[0].y, height = Math.max(...row.map(i => i.height));
    const text = row.map(i => i.item.str).join(" ");
    const marginText = text.replace(/\s+/g, " ").trim();
    if ((baseline > geometry.height * .9 && /^(?:第\s*\d+\s*页\s*(?:[/／]?\s*共\s*\d+\s*页)?|Page\s*\d+\s*(?:of\s*\d+)?|\d+\s*[/／]\s*\d+|学科网[（(]北京[）)]股份有限公司)$/i.test(marginText)) || (baseline > geometry.height * .93 && /^.{1,100}第\s*\d+\s*页\s*[/／]?\s*共\s*\d+\s*页$/.test(marginText))) {
      result.omittedMargins.push(text); continue;
    }
    const id = `pdf_${pageNumber}_line_${index + 1}`;
    const selectedRules = geometry.rules.map((box, i) => ({ box, i })).filter(({ box, i }) => !bandRules.has(i) && Math.abs(box[1] - baseline) <= height * .35 && box[0] < right + height && box[0] + box[2] > x - height);
    const blanks = selectedRules.flatMap(({ box, i }) => {
      const inside = row.filter(p => p.x + p.width > box[0] + .5 && p.x < box[0] + box[2] - .5);
      if (inside.length === 1 && /^\d{1,3}$/.test(inside[0].item.str.trim()) && box[2] > inside[0].width * 1.8) {
        usedRules.add(i); return [{ item: inside[0], box, label: inside[0].item.str.trim() }];
      }
      return [];
    });
    // An empty printed rule on the line is a fill-in blank (第______周期).
    const emptyRules = selectedRules.filter(({ box, i }) => !usedRules.has(i) && box[2] >= height * 1.2
      && !row.some(part => Math.min(part.x + part.width, box[0] + box[2]) - Math.max(part.x, box[0]) > 1)).sort((a, b) => a.box[0] - b.box[0]);
    const columns: { x: number; right: number; content: ChalkLeeInlineNode[] }[] = [{ x, right: x, content: [] }];
    let inline = columns[0].content;
    let optionLabel = row[0].item.str.match(/^\s*([A-G])(?:[.．、:：)）]|\s*$)/)?.[1];
    let end = -Infinity;
    let previous: typeof row[number] | undefined;
    const emptyBlank = ({ box, i }: { box: Box; i: number }) => {
      usedRules.add(i);
      inline.push({ type: "blank", attrs: { id: `${id}_blank_rule_${i + 1}`, widthPt: Math.min(160, Math.max(20, box[2])) } });
      end = Math.max(end, box[0] + box[2]);
      columns.at(-1)!.right = Math.max(columns.at(-1)!.right, end);
    };
    for (const part of row) {
      while (emptyRules.length && emptyRules[0].box[0] < part.x) emptyBlank(emptyRules.shift()!);
      // Font advances can overlap a neighboring punctuation glyph. Reject
      // duplicate/overprinted runs while allowing that small edge overlap.
      // Chinese layout squeezes adjacent punctuation (】（, ），) by up to half a character; that is not overprinting.
      const squeezed = /[】）」』，。、；：！？]$/.test(previous?.item.str ?? "") || /^[（【「『，。、；：]/.test(part.item.str);
      if (end - part.x > height * (squeezed ? .6 : .45) || previous && Math.abs(previous.x - part.x) < .1 && previous.item.str === part.item.str) unhandledStyle = true;
      previous = part;
      // A missing dot is common in positioned option columns. Require both a
      // wide physical gap and the next consecutive label; prose is not split.
      const nextLabel = part.item.str.match(/^\s*([B-H])(?:[.．、:：)）\s]|$)/)?.[1];
      if (optionLabel && nextLabel === String.fromCharCode(optionLabel.charCodeAt(0) + 1) && part.x - end > height * 2.5) {
        columns.push({ x: part.x, right: part.x, content: [] });
        inline = columns.at(-1)!.content;
        optionLabel = nextLabel;
      }
      const joined = part.x - end <= height * .12;
      if (inline.length && !joined && !/^[.,;:!?，。；：！？]/.test(part.item.str) && !/[\s]$/.test((inline.at(-1) as { text?: string }).text ?? "")) inline.push({ type: "text", text: " " });
      end = part.x + part.width;
      columns.at(-1)!.right = Math.max(columns.at(-1)!.right, end);
      const blank = blanks.find(b => b.item === part);
      if (blank) { inline.push({ type: "blank", attrs: { id: `${id}_blank_${blank.label}`, label: blank.label, widthPt: Math.min(160, Math.max(20, blank.box[2])) } }); continue; }
      const marks: ChalkLeeMark[] = [{ type: "textStyle", attrs: { fontSizePt: Math.min(40, Math.max(6, part.height)) } }];
      const font = geometry.fonts?.[part.item.fontName];
      if (font?.bold) marks.push({ type: "bold" });
      if (font?.italic || Math.abs(part.item.transform[2]) > .01) marks.push({ type: "italic" });
      const crossed = selectedRules.some(({ box }) => Math.min(part.x + part.width, box[0] + box[2]) - Math.max(part.x, box[0]) > 1);
      const formula = inline.at(-1);
      if (part.math) {
        // An underline across a rebuilt formula is not represented; leave the page to visual recognition.
        if (crossed) unhandledStyle = true;
        if (part.math.prefix) inline.push({ type: "text", text: part.math.prefix, marks });
        if (!part.math.prefix && joined && formula?.type === "mathInline") formula.attrs.latex += part.math.latex;
        else inline.push({ type: "mathInline", attrs: { latex: part.math.latex } });
        continue;
      }
      // A formula continues into the next run without a gap: H₂ then O.
      let text = part.item.str;
      const head = joined && formula?.type === "mathInline" ? text.match(FORMULA_HEAD)?.[0] : undefined;
      if (head) {
        if (formula?.type === "mathInline") formula.attrs.latex += formulaText(head, !(font?.italic || Math.abs(part.item.transform[2]) > .01));
        text = text.slice(head.length);
        if (crossed) unhandledStyle = true;
        if (!text) continue;
      }
      const partialRules: Box[] = [];
      for (const { box, i } of selectedRules) {
        if (usedRules.has(i) && blanks.some(b => b.box === box)) continue;
        const overlap = Math.min(part.x + part.width, box[0] + box[2]) - Math.max(part.x, box[0]);
        if (overlap > part.width * .85) { marks.push({ type: "underline" }); usedRules.add(i); }
        else if (overlap > 1) {
          if (font && font.measure(part.item.str, part.height) > 0) { partialRules.push(box); usedRules.add(i); }
          else unhandledStyle = true;
        }
      }
      if (!partialRules.length || text !== part.item.str) inline.push({ type: "text", text, marks });
      else {
        const scale = part.width / font!.measure(part.item.str, part.height);
        let previousEdge = part.x, offset = 0;
        for (const character of part.item.str) {
          offset += character.length;
          const edge = part.x + font!.measure(part.item.str.slice(0, offset), part.height) * scale;
          const underlined = partialRules.some(box => Math.min(edge, box[0] + box[2]) - Math.max(previousEdge, box[0]) > (edge - previousEdge) * .7);
          const charMarks = underlined ? [...marks, { type: "underline" as const }] : marks;
          const last = inline.at(-1);
          if (last?.type === "text" && JSON.stringify(last.marks) === JSON.stringify(charMarks)) last.text += character;
          else inline.push({ type: "text", text: character, marks: charMarks });
          previousEdge = edge;
        }
      }
    }
    for (const rule of emptyRules) emptyBlank(rule);
    let sequence = 0;
    const centered = columns.length === 1 && Math.abs((x + right) / 2 - geometry.width / 2) < 12 && right - x < geometry.width * .65;
    for (const [columnIndex, column] of columns.entries()) {
      const sourceId = columns.length === 1 ? id : `${id}_column_${columnIndex + 1}`;
      const writingLine = column.content.every(node => node.type === "text") && /^[_\s]{40,}$/.test(column.content.map(node => node.type === "text" ? node.text : "").join("")) && column.right - column.x > geometry.width * .35;
      const indent = x - proseLeft;
      const indented = columns.length === 1 && !centered && indent >= height && indent <= height * 3 && right - x > geometry.width * .4;
      const block: ChalkLeeBlockNode = writingLine ? { type: "answerLines", attrs: { id: sourceId }, content: [{ type: "answerLine", attrs: { id: `${sourceId}_line` } }] }
        : { type: "paragraph", attrs: { id: sourceId, ...(centered ? { textAlign: "center" } : {}), ...(indented ? { firstLineIndentPt: indent } : {}), spaceAfterPt: 0 }, content: normalizeNumberedBlanks(column.content, () => `${id}_blank_${++sequence}`, true) };
      const split = splitWordSourceBlocks([block]);
      result.blocks.push(...split);
      for (const part of split) result.lines.push({ ref: part.attrs.id, text: wordSourceText(part), box: [column.x / geometry.width * 1000, Math.max(0, baseline - height) / geometry.height * 1000, (column.right - column.x) / geometry.width * 1000, height / geometry.height * 1000] });
    }
  }
  // Unmatched rules may be tables, writing lines, fractions, or partial
  // underlines. Keep the visual path until their semantics can be preserved.
  const unhandledRules = geometry.rules.some((box, i) => !usedRules.has(i) && !bandRules.has(i) && box[1] > geometry.height * .08 && box[1] < geometry.height * .9);
  if (unhandledStyle || unhandledRules) return { ...result, reason: "存在未能可靠保留的线条、下划线或重叠文字，使用视觉识别" };
  if (images.length > 12 || images.some(image => !image.pageBounds)) return { ...result, reason: "原图数量或位置不能可靠对应，使用视觉识别" };
  // Preserve an explicit new paragraph, but join an unindented continuation
  // that starts in the middle of an English sentence before freezing refs.
  for (let index = 1; index < result.blocks.length; index++) {
    const previous = result.blocks[index - 1], current = result.blocks[index];
    const a = result.lines[index - 1].box, b = result.lines[index].box;
    if (previous.type !== "paragraph" || current.type !== "paragraph" || previous.attrs.textAlign || current.attrs.textAlign
      || regions.some(region => region.ref === previous.attrs.id || region.ref === current.attrs.id)
      || current.attrs.firstLineIndentPt || b[1] < a[1] + a[3] * .5 || b[1] - a[1] - a[3] > b[3] * 1.5) continue;
    const joined = joinWrappedLines([previous, current]);
    if (joined.length !== 1) continue;
    const left = Math.min(a[0], b[0]), top = a[1], right = Math.max(a[0] + a[2], b[0] + b[2]), bottom = b[1] + b[3];
    result.blocks.splice(index - 1, 2, joined[0]);
    result.lines.splice(index - 1, 2, { ref: joined[0].attrs.id, text: wordSourceText(joined[0]), box: [left, top, right - left, bottom - top] });
    index--;
  }
  for (const image of images) {
    const ref = `${image.id}_native`, scale = Math.min(1, 420 / image.widthPt);
    const block: ChalkLeeBlockNode = { type: "image", attrs: { id: ref, assetId: image.id, widthPt: image.widthPt * scale, heightPt: image.heightPt * scale } };
    const at = result.lines.findIndex(line => line.box[1] > image.pageBounds![1]);
    const index = at < 0 ? result.lines.length : at;
    result.blocks.splice(index, 0, block);
    result.lines.splice(index, 0, { ref, text: wordSourceText(block), box: image.pageBounds! });
  }
  // Strips still to recognize keep the page off every path that expects complete native text.
  result.candidate = result.blocks.length > 0 && !regions.length;
  result.reason = regions.length ? `有 ${regions.length} 处公式需要看图识别` : "原生文字及位置可用，等待版面核对";
  if (regions.length) result.regions = regions;
  return result;
}
