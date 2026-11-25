import type { OcrBox, OcrLayout, OcrReference } from "./ocrReference";
import { placeTranscriptFigure, prefixMaskFits, type ImportTranscript, type TranscriptFigure } from "./transcript";
import { stripDistributorPromo } from "../../shared/conversion/promo";

// Running headers, footers, page numbers, margin logos and seals repeat on every page.
const PAGE_FURNITURE = new Set(["header", "footer", "number", "header_image", "footer_image", "seal"]);
const FIGURES = new Set(["image", "chart"]);
const TITLES = new Set(["doc_title", "paragraph_title"]);
// These stay in a block of their own instead of joining the row beside them.
const STANDALONE = new Set(["table", "display_formula", "figure_title", ...TITLES]);
/** A caption that only names the question a figure belongs to, e.g. “第6题图”. */
const QUESTION_CAPTION = /^[（(【]?\s*第\s*(\d{1,3})\s*(?:[—–-]\s*[ⅠⅡⅢⅣⅤIVX]{1,3}\s*)?题\s*(?:图\s*\d{0,2})?\s*[）)】]?$/;
/** An option letter printed alone, e.g. “A.” or “(B)”, before its figure. */
const OPTION_LABEL = /^[（(]?([A-Ha-hＡ-Ｈ])[)）]?[.．、]?$/;
const QUESTION_START = /^(\d{1,3})\s*[.．、]/;
/** A figure's own number printed under it, e.g. “图 1”, “图A”, “图3（a）”, “图 4 某城市工业用地变化”: the figure keeps it. */
const FIGURE_NUMBER = /^图\s*(?:\d{1,2}|[A-Ha-h甲乙丙丁])(?:\s*[（(][a-z\d][)）])?(?:\s+[^\n]{1,28})?$/;

interface Piece { layout: OcrLayout; text: string; caption?: string }

const verticalOverlap = (a: OcrBox, b: OcrBox) => Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
/** Pieces printed on one line, such as “A.” and its option figure, read as one source line. */
const sameLine = (left: Piece, right: Piece) => !STANDALONE.has(left.layout.type) && !STANDALONE.has(right.layout.type)
  && !left.text.includes("\n") && !right.text.includes("\n")
  && right.layout.box[0] > left.layout.box[0]
  && verticalOverlap(left.layout.box, right.layout.box) >= Math.min(left.layout.box[3], right.layout.box[3]) / 2;
const distance = (a: OcrBox, b: OcrBox) => Math.hypot(a[0] + a[2] / 2 - (b[0] + b[2] / 2), a[1] + a[3] / 2 - (b[1] + b[3] / 2));

/** Turns one recognized page into the same transcript a model returns, so text-layer checks and source refs stay shared. */
export function ocrPageTranscript(page: OcrReference): ImportTranscript {
  const tables = new Map(page.tables.map(table => table as { id?: string; markdown?: string }).filter(table => table.id && table.markdown).map(table => [table.id!, table.markdown!]));
  const figures: (TranscriptFigure & { crop: OcrBox })[] = [];
  const pieces: Piece[] = [];
  const figureOf = new Map<Piece, TranscriptFigure>();
  // OCR sometimes returns a figure twice, a whole map and a part of it (or the same box twice). The figure check
  // then asked for a repair round to keep the whole one; keep it here. A box holding several smaller figures, such
  // as figure options, is left as it is.
  const figureLayouts = page.layouts.filter(layout => FIGURES.has(layout.type));
  const area = (box: OcrBox) => box[2] * box[3];
  const overlap = (a: OcrBox, b: OcrBox) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const within = (small: OcrLayout, big: OcrLayout) => small !== big && area(small.box) > 0 && overlap(small.box, big.box) >= area(small.box) * .95;
  const repeated = new Set<OcrLayout>();
  // Option letters inside a box mean its smaller figures are the options; otherwise the whole one is kept.
  const lettered = (big: OcrLayout) => page.layouts.some(layout => OPTION_LABEL.test((layout.text ?? "").trim()) && area(layout.box) > 0 && overlap(layout.box, big.box) >= area(layout.box) * .8);
  for (const small of figureLayouts) {
    const holders = figureLayouts.filter(big => !repeated.has(big) && within(small, big) && (area(big.box) > area(small.box) || figureLayouts.indexOf(big) < figureLayouts.indexOf(small)));
    if (holders.length === 1 && (figureLayouts.filter(other => within(other, holders[0])).length === 1 || !lettered(holders[0]))) repeated.add(small);
  }
  for (const layout of page.layouts) {
    if (PAGE_FURNITURE.has(layout.type) || repeated.has(layout)) continue;
    const text = stripDistributorPromo(layout.text ?? "").trim();
    if (FIGURES.has(layout.type)) {
      const figure = { id: `figure_${figures.length + 1}`, crop: layout.box, alt: "" };
      figures.push(figure);
      const piece = { layout, text: `[[${figure.id}]]` };
      figureOf.set(piece, figure);
      pieces.push(piece);
      continue;
    }
    if (!text && layout.type !== "table") continue;
    const caption = layout.type === "figure_title" ? text.match(QUESTION_CAPTION)?.[1] : undefined;
    const content = layout.type === "table" ? (tables.get(layout.id) ?? text).trim()
      : TITLES.has(layout.type) ? `## ${text.split("\n").map(line => line.replace(/^\s*#{1,6}\s+/, "").trim()).filter(Boolean).join(" ")}`
      : text;
    if (content) pieces.push({ layout, text: content, ...(caption ? { caption } : {}) });
  }
  // A figure number printed right under its figure belongs in the crop, as the figure checks require; OCR reads it
  // as a line of its own, and every such page then took a repair round to take it in.
  // Several labels on one row under one drawing ("图A" … "图D" under four plots) all go with it.
  const taken = new Set<Piece>(), widened = new Map<TranscriptFigure, { row: number; bottom: number }>();
  for (const piece of pieces) {
    if (!["figure_title", "text"].includes(piece.layout.type) || piece.caption || !FIGURE_NUMBER.test(piece.text)) continue;
    const [left, top, width] = piece.layout.box, middle = left + width / 2;
    const figure = figures.filter(item => (!widened.has(item) || Math.abs(widened.get(item)!.row - top) < 10) && middle >= item.crop[0] - 10 && middle <= item.crop[0] + item.crop[2] + 10)
      .map(item => ({ item, gap: top - (widened.get(item)?.bottom ?? item.crop[1] + item.crop[3]) })).filter(({ gap }) => gap >= -5 && gap <= 35).sort((a, b) => a.gap - b.gap)[0]?.item;
    if (!figure) continue;
    const box = piece.layout.box, crop = figure.crop;
    if (!widened.has(figure)) widened.set(figure, { row: top, bottom: crop[1] + crop[3] });
    const x = Math.min(crop[0], box[0]), y = Math.min(crop[1], box[1]);
    figure.crop = [x, y, Math.max(crop[0] + crop[2], box[0] + box[2]) - x, Math.max(crop[1] + crop[3], box[1] + box[3]) - y];
    taken.add(piece);
  }
  for (let i = pieces.length - 1; i >= 0; i--) if (taken.has(pieces[i])) pieces.splice(i, 1);
  // A caption naming only the question ("第14—Ⅱ题图2") stays out of the figure; OCR sometimes boxes it into the figure's
  // bottom edge, which then took a repair round to cut away.
  for (const piece of pieces.filter(piece => piece.caption)) {
    const box = piece.layout.box;
    for (const figure of figures) {
      const crop = figure.crop, bottom = crop[1] + crop[3];
      if (area(box) > 0 && overlap(box, crop) >= area(box) * .8 && box[1] >= crop[1] + crop[3] * .75 && box[1] - crop[1] > 5)
        figure.crop = [crop[0], crop[1], crop[2], Math.min(bottom, box[1] - 1) - crop[1]];
    }
  }
  // A caption naming a question tells which question its nearest figure belongs to.
  const captions = pieces.filter(piece => piece.caption);
  const owners = new Map<Piece, TranscriptFigure>();
  for (const caption of captions) {
    const figure = figures.filter(item => !item.questionNumber).sort((a, b) => distance(a.crop, caption.layout.box) - distance(b.crop, caption.layout.box))[0];
    if (!figure) continue;
    figure.questionNumber = caption.caption;
    figure.alt = `第${caption.caption}题图`;
    owners.set(caption, figure);
  }
  // An option letter OCR boxed inside its figure ("A." in the figure's top-left corner) goes right before that figure
  // and on its line, so the figure becomes that option's figure; the letter is masked out of the crop below.
  const boxedLetters = new Map<Piece, Piece>();
  for (const letter of pieces.filter(piece => OPTION_LABEL.test(piece.text))) {
    const holder = pieces.find(piece => figureOf.has(piece) && !boxedLetters.has(piece) && boxedInFigure(letter.layout.box, piece.layout.box));
    if (!holder) continue;
    boxedLetters.set(holder, letter);
    pieces.splice(pieces.indexOf(letter), 1);
    pieces.splice(pieces.indexOf(holder), 0, letter);
  }
  const lines: string[] = [];
  let row: Piece[] = [];
  let question: string | undefined;
  const flush = () => {
    if (!row.length) return;
    // Figures after an option letter are that option's figures: each option goes on a line of
    // its own and the figure records its option, and its question where the page shows it.
    const options: Piece[][] = [];
    let label: string | undefined, letterPiece: Piece | undefined;
    for (const piece of row) {
      const letter = piece.text.match(OPTION_LABEL)?.[1];
      const figure = figureOf.get(piece);
      if (letter) { label = letter.normalize("NFKC").toUpperCase(); letterPiece = piece; options.push([piece]); }
      else if (figure && label) {
        figure.optionLabel = label; if (question) figure.questionNumber = question; options[options.length - 1].push(piece);
        // OCR often boxes the option figure together with its letter; the letter's own box then masks it out,
        // as the figure check would otherwise ask a repair round to do.
        const mask = letterPiece && boxedLetters.get(piece) === letterPiece ? optionPrefixMask(letterPiece.layout.box, (figure as TranscriptFigure & { crop: OcrBox }).crop) : undefined;
        if (mask) figure.prefixMask = mask;
      }
      else { label = undefined; options.push([piece]); }
    }
    const grouped = row.some(piece => figureOf.get(piece)?.optionLabel);
    for (const line of grouped ? options : [row]) {
      lines.push(line.map(piece => piece.text).join("  "));
      question = lines[lines.length - 1].match(QUESTION_START)?.[1] ?? question;
    }
    row = [];
  };
  for (const piece of pieces) {
    if (owners.has(piece)) continue;
    if (row.length && (sameLine(row[row.length - 1], piece) || boxedLetters.get(piece) === row[row.length - 1])) row.push(piece);
    else { flush(); row = [piece]; }
  }
  flush();
  let markdown = lines.join("\n\n");
  // Move an owned figure into its question, as model transcription does; keep the caption if that is not certain.
  for (const [caption, figure] of owners) {
    try {
      markdown = placeTranscriptFigure(markdown, figure).replace(new RegExp(`\\s*\\[\\[${figure.id}\\]\\]\\s*`), `\n\n[[${figure.id}]]\n\n`);
    }
    catch { markdown = markdown.replace(`[[${figure.id}]]`, `[[${figure.id}]]\n\n${caption.text}`); }
  }
  return { markdown: markdown.replace(/\n{3,}/g, "\n\n").trim(), figures: figures.map(figure => ({ ...figure })), uncertainties: [], warnings: [] };
}

/** Whether an option letter lies inside the left part of its option figure's crop, where OCR boxed it with the figure. */
function boxedInFigure(letter: OcrBox, crop: OcrBox): boolean {
  const inside = Math.max(0, Math.min(letter[0] + letter[2], crop[0] + crop[2]) - Math.max(letter[0], crop[0]))
    * Math.max(0, Math.min(letter[1] + letter[3], crop[1] + crop[3]) - Math.max(letter[1], crop[1]));
  return letter[2] * letter[3] > 0 && inside >= letter[2] * letter[3] * .8 && letter[0] + letter[2] / 2 <= crop[0] + crop[2] * .3;
}

/** The letter's box, a little wider, when it lies inside the left part of its option figure's crop. */
function optionPrefixMask(letter: OcrBox, crop: OcrBox): OcrBox | undefined {
  if (!boxedInFigure(letter, crop)) return;
  const x = Math.max(crop[0], letter[0] - 2), y = Math.max(crop[1], letter[1] - 2);
  const mask: OcrBox = [x, y, Math.min(crop[0] + crop[2], letter[0] + letter[2] + 2) - x, Math.min(crop[1] + crop[3], letter[1] + letter[3] + 2) - y];
  // A mask the crop cannot take would fail every figure check after it; the check asks for the letter's removal instead.
  return prefixMaskFits(crop, mask) ? mask : undefined;
}
