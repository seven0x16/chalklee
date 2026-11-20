import JSZip from "jszip";
import { chalkLeeAnswerLineRows, chalkLeeGraphicSvgFile, chalkLeeGroupContinuesNumbers, chalkLeeQuestionLabelText, chalkLeeQuestionNumberLook, chalkLeeQuestionNumberSlotPt, chalkLeeQuestionNumberText, chalkLeePageSize, chalkLeeStaticGraphicSvg, type ChalkLeeArchive, type ChalkLeeGraphicNode, type ChalkLeeBlockNode, type ChalkLeeImageAttrs, type ChalkLeeInlineNode, type ChalkLeeMark, type ChalkLeeParagraphAttrs, type ChalkLeeQuestionNode, type ChalkLeeQuestionGroupNode, type ChalkLeeTableNode } from "@chalklee/format";
import { docxMath, docxXml as xml } from "./docxMath";
import { outputSolutionEntries, outputSolutionHasContent, outputSolutionsTitle, type DocumentOutputOptions } from "./output";
import { chalkLeeDocumentBoxStyle, chalkLeeHeadingNumberer } from "./layouts";
import { chalkLeeAutoTableColumnWeights } from "./tableColumns";
import { chalkLeeQuestionPlaces } from "./numbering";
import { CHALKLEE_RUNNING_SLOTS, chalkLeeCoverLook, chalkLeeCoverPicture, chalkLeeCoverText, chalkLeeDocumentHeadings, chalkLeeHeaderFooter, chalkLeeTocEntries, chalkLeeTocLevels, chalkLeeTocLook, chalkLeeTocTitle, chalkLeeRunningLineVisible, chalkLeeRunningLook, chalkLeeRunningParts, type ChalkLeeBoxNode, type ChalkLeeRunningLine } from "@chalklee/format";

export type DocxExportOptions = DocumentOutputOptions;
export interface DocxImage { data: Uint8Array; mediaType: string; width: number; height: number }
type ImageReader = (data: Uint8Array, mediaType: string) => Promise<DocxImage>;
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const relType = (type: string) => `${R}/${type}`;
const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const twips = (pt: number) => Math.round(pt * 20);
const color = (value: string | undefined, fallback = "000000") => /^#[a-f\d]{6}$/i.test(value ?? "") ? value!.slice(1) : fallback;

/** A DOCX contains structured Word content, never screenshots or HTML import instructions. */
export async function createChalkLeeDocx(archive: ChalkLeeArchive, options: DocxExportOptions, readImage: ImageReader): Promise<Uint8Array> {
  const zip = new JSZip(), document = archive.document, body = document.appearance.body;
  const relationships: string[] = [], contentTypes = new Map<string, string>();
  let drawingId = 0;
  const relate = (type: string, target: string, external = false) => {
    const id = `rId${relationships.length + 1}`;
    relationships.push(`<Relationship Id="${id}" Type="${relType(type)}" Target="${xml(target)}"${external ? ' TargetMode="External"' : ""}/>`);
    return id;
  };
  const images = new Map<string, { id: string; width: number; height: number }>();
  const embed = async (key: string, data: Uint8Array, mediaType: string) => {
    let embedded = images.get(key);
    if (embedded) return embedded;
    const prepared = await readImage(data, mediaType);
    const extension = ({ "image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif", "image/svg+xml": "svg" } as Record<string, string>)[prepared.mediaType];
    if (!extension || !(prepared.width > 0 && prepared.height > 0)) throw new Error("这份文档中有无法导出的图片，请替换后重试。");
    const target = `media/image${images.size + 1}.${extension}`;
    zip.file(`word/${target}`, prepared.data);
    contentTypes.set(extension, prepared.mediaType);
    embedded = { id: relate("image", target), width: prepared.width * .75, height: prepared.height * .75 };
    images.set(key, embedded);
    return embedded;
  };
  const drawing = (embedded: { id: string; width: number; height: number }, attrs: { widthPt?: number; heightPt?: number; alt?: string }) => {
    const width = attrs.widthPt ?? (attrs.heightPt ? attrs.heightPt * embedded.width / embedded.height : Math.min(embedded.width, contentWidth));
    const height = attrs.heightPt ?? width * embedded.height / embedded.width;
    const cx = Math.round(width * 12700), cy = Math.round(height * 12700), id = ++drawingId;
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="图片 ${id}" descr="${xml(attrs.alt ?? "")}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="图片 ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${embedded.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  // Embed only referenced pictures; missing pictures fail the export without writing a partial document.
  const image = async (attrs: ChalkLeeImageAttrs): Promise<string> => {
    const asset = archive.manifest.assets.find(asset => asset.id === attrs.assetId), data = archive.assets[attrs.assetId];
    if (!asset || !data) throw new Error(`图片“${attrs.alt || attrs.assetId}”缺失，请补齐后再导出。`);
    return drawing(await embed(attrs.assetId, data, asset.mediaType), attrs);
  };
  // A drawing goes to Word as the picture it prints as, at its share of the text width.
  const graphic = async (attrs: ChalkLeeGraphicNode["attrs"], width: number): Promise<string> => {
    // Give the picture the viewBox's size, so it keeps its proportions when drawn as PNG.
    const file = chalkLeeGraphicSvgFile(chalkLeeStaticGraphicSvg(attrs)).replace(/^<svg\b([^>]*)>/i, (tag, attributes: string) => {
      const box = attributes.match(/\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
      return box ? `<svg${attributes.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "")} width="${box[1]}" height="${box[2]}">` : tag;
    });
    const data = new TextEncoder().encode(file);
    return drawing(await embed(`graphic:${attrs.id}`, data, "image/svg+xml"), { widthPt: width * (attrs.widthPercent ?? 100) / 100, alt: attrs.alt ?? attrs.caption });
  };
  const run = (text: string, marks: ChalkLeeMark[] = []) => {
    if (!text) return "";
    const properties = marks.map(mark => {
      switch (mark.type) {
        case "bold": return "<w:b/>";
        case "italic": return "<w:i/>";
        case "underline": return '<w:u w:val="single"/>';
        case "strike": return "<w:strike/>";
        case "superscript": case "subscript": return `<w:vertAlign w:val="${mark.type}"/>`;
        case "textStyle": {
          const { fontFamily, fontSizePt, color: foreground, backgroundColor, fontWeight } = mark.attrs;
          return (fontFamily ? `<w:rFonts w:ascii="${xml(fontFamily)}" w:hAnsi="${xml(fontFamily)}" w:eastAsia="${xml(fontFamily)}"/>` : "")
            // "Not bold" turns off the bold a heading's style gives it; Word expects it after the fonts.
            + (fontWeight === "normal" ? '<w:b w:val="0"/><w:bCs w:val="0"/>' : "")
            + (fontSizePt ? `<w:sz w:val="${Math.round(fontSizePt * 2)}"/><w:szCs w:val="${Math.round(fontSizePt * 2)}"/>` : "")
            + (foreground ? `<w:color w:val="${color(foreground)}"/>` : "") + (backgroundColor ? `<w:shd w:val="clear" w:fill="${color(backgroundColor, "FFFFFF")}"/>` : "");
        }
        default: return "";
      }
    }).join("");
    const content = text.split(/(\n|\t)/).map(part => part === "\n" ? "<w:br/>" : part === "\t" ? "<w:tab/>" : `<w:t xml:space="preserve">${xml(part)}</w:t>`).join("");
    const result = `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}${content}</w:r>`;
    const link = marks.find(mark => mark.type === "link");
    return link?.type === "link" && /^(https?:|mailto:)/i.test(link.attrs.href)
      ? `<w:hyperlink r:id="${relate("hyperlink", link.attrs.href, true)}">${result}</w:hyperlink>` : result;
  };
  const inline = async (nodes: ChalkLeeInlineNode[] = []): Promise<string> => {
    const parts: string[] = [];
    for (const node of nodes) {
      switch (node.type) {
        case "text": parts.push(run(node.text, node.marks)); break;
        case "hardBreak": parts.push("<w:r><w:br/></w:r>"); break;
        case "mathInline": parts.push(docxMath(node.attrs.latex)); break;
        case "imageInline": parts.push(await image(node.attrs)); break;
        case "blank": {
          const count = Math.max(3, Math.round((node.attrs.widthPt ?? 60) / (body.fontSizePt * .5)));
          const label = node.attrs.label ?? "", left = Math.max(0, Math.floor((count - label.length) / 2));
          parts.push(run("\u00a0".repeat(left) + label + "\u00a0".repeat(Math.max(0, count - label.length - left)), [{ type: "underline" }]));
          break;
        }
      }
    }
    return parts.join("");
  };
  let orderedNumber = 0;
  // As on the paper, only question numbers stand in the leftmost column: a list starts where a stem's text does,
  // its marker hanging before the item's text.
  const listMarkerPt = body.fontSizePt * 1.75;
  const listIndentPt = chalkLeeQuestionNumberSlotPt(document.appearance.questionNumbering) + listMarkerPt;
  const paragraph = (contents: string, attrs: Partial<ChalkLeeParagraphAttrs> = {}, extra = "") => {
    const indent = attrs.listType
      ? `<w:ind w:left="${twips((attrs.indentLeftPt ?? 0) + listIndentPt)}" w:right="${twips(attrs.indentRightPt ?? 0)}" w:hanging="${twips(listMarkerPt)}"/>`
      : `<w:ind w:left="${twips(attrs.indentLeftPt ?? 0)}" w:right="${twips(attrs.indentRightPt ?? 0)}" ${attrs.firstLineIndentPt && attrs.firstLineIndentPt < 0 ? `w:hanging="${twips(-attrs.firstLineIndentPt)}"` : `w:firstLine="${twips(attrs.firstLineIndentPt ?? 0)}"`}/>`;
    const properties = extra + (extra.includes("<w:spacing") ? "" : `<w:spacing w:before="${twips(attrs.spaceBeforePt ?? 0)}" w:after="${twips(attrs.spaceAfterPt ?? body.paragraphSpaceAfterPt ?? 0)}" w:line="${Math.round((attrs.lineHeight ?? body.lineHeight) * 240)}" w:lineRule="auto"/>`)
      + indent + `<w:jc w:val="${attrs.textAlign === "justify" ? "both" : attrs.textAlign ?? "left"}"/>`;
    let marker = "";
    if (attrs.listType === "ordered") { orderedNumber = attrs.listStart ?? orderedNumber + 1; marker = `${orderedNumber}.\t`; }
    else { orderedNumber = 0; if (attrs.listType === "bullet") marker = "•\t"; }
    return `<w:p><w:pPr>${properties}</w:pPr>${marker ? run(marker) : ""}${contents}</w:p>`;
  };
  const page = document.appearance.page;
  const { width: pageWidth, height: pageHeight } = chalkLeePageSize(page);
  const contentWidth = (pageWidth - page.marginsPt.left - page.marginsPt.right - ((page.columnCount ?? 1) - 1) * (page.columnGapPt ?? 24)) / (page.columnCount ?? 1);
  const headingNumber = chalkLeeHeadingNumberer(document.appearance.headingNumbering);
  // Questions are numbered through the whole document, boxes included, as on the paper.
  const places = chalkLeeQuestionPlaces(document.content.content);
  // A prefix is plain text, or runs already written, such as a question number in its own look.
  const runsOf = (prefix: string | { runs: string }) => typeof prefix === "string" ? run(prefix) : prefix.runs;
  const blocks = async (nodes: readonly ChalkLeeBlockNode[], prefix: string | { runs: string } = "", width = contentWidth): Promise<string> => {
    const parts: string[] = [];
    for (const node of nodes) {
      const leading = runsOf(prefix); prefix = "";
      if (leading && !["paragraph", "heading"].includes(node.type)) parts.push(paragraph(leading));
      switch (node.type) {
        case "paragraph": parts.push(paragraph(leading + await inline(node.content), node.attrs)); break;
        case "heading": {
          // Only body headings are numbered, as on the paper.
          const numbered = nodes === document.content.content ? headingNumber(node.attrs.level) : "";
          const label = numbered ? `${numbered}${/[、）.]$/.test(numbered) ? "" : " "}` : "";
          parts.push(paragraph(leading + run(label) + await inline(node.content), node.attrs, `<w:pStyle w:val="Heading${node.attrs.level}"/><w:keepNext/><w:keepLines/>`));
          break;
        }
        case "image": parts.push(paragraph(await image(node.attrs), node.attrs)); if (node.attrs.caption) parts.push(paragraph(run(node.attrs.caption), { textAlign: "center" })); break;
        case "graphic": parts.push(paragraph(await graphic(node.attrs, width), { textAlign: node.attrs.textAlign ?? "center" })); if (node.attrs.caption) parts.push(paragraph(run(node.attrs.caption), { textAlign: "center" })); break;
        case "blockMath": parts.push(paragraph(docxMath(node.attrs.latex, true), { textAlign: node.attrs.textAlign ?? "center" })); break;
        case "pageBreak": parts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); break;
        case "divider": parts.push(paragraph("", {}, '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="000000"/></w:pBdr>')); break;
        case "answerLines":
          for (const row of chalkLeeAnswerLineRows(node).content ?? []) parts.push(paragraph(await inline(row.content), {}, `<w:pBdr><w:bottom w:val="single" w:sz="4" w:color="000000"/><w:between w:val="single" w:sz="4" w:color="000000"/></w:pBdr><w:spacing w:line="${twips(node.attrs.spacingPt ?? 24)}" w:lineRule="exact"/>`));
          break;
        case "table": parts.push(await table(node, width)); break;
        case "box": parts.push(await box(node, width)); break;
        case "question": case "questionGroup": {
          const style = document.appearance.questionStyles[node.attrs.styleRef ?? document.appearance.defaults.questionStyleRef];
          // A question that starts a new page, unless it already opens the document.
          if (style?.breakBefore === "page" && parts.length) parts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
          parts.push(await question(node, width));
          break;
        }
      }
    }
    return parts.join("") || (runsOf(prefix) ? paragraph(runsOf(prefix)) : "");
  };
  const table = async (node: ChalkLeeTableNode, width: number): Promise<string> => {
    const columns = Math.max(...node.content.map(row => row.content.reduce((n, cell) => n + (cell.attrs.colspan ?? 1), 0)));
    // Columns share the table's width as on screen: saved widths in proportion, otherwise by their content.
    const saved = node.attrs.columnWidthsPt?.length === columns && node.attrs.columnWidthsPt.every(value => Number.isFinite(value) && value > 0) ? node.attrs.columnWidthsPt : null;
    const content = chalkLeeAutoTableColumnWeights(node);
    const weights = saved ?? (content.length === columns ? content : Array.from({ length: columns }, () => 1));
    const tableWidth = Math.min(node.attrs.widthPt ?? width, width), total = weights.reduce((sum, value) => sum + value, 0);
    const widths = weights.map(value => tableWidth * value / total);
    const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map(side => `<w:${side} w:val="single" w:sz="4" w:color="000000"/>`).join("");
    const spans = new Map<number, { remaining: number; colspan: number }>();
    const rows: string[] = [];
    for (const row of node.content) {
      const cells: string[] = []; let col = 0;
      const continuation = () => {
        const span = spans.get(col);
        if (!span) return false;
        cells.push(`<w:tc><w:tcPr><w:tcW w:w="${twips(widths.slice(col, col + span.colspan).reduce((a, b) => a + b, 0))}" w:type="dxa"/><w:gridSpan w:val="${span.colspan}"/><w:vMerge/></w:tcPr><w:p/></w:tc>`);
        span.remaining--; if (!span.remaining) spans.delete(col);
        col += span.colspan; return true;
      };
      for (const cell of row.content) {
        while (continuation()) { /* Skip columns occupied by a vertical merge. */ }
        const colspan = cell.attrs.colspan ?? 1, cellWidth = widths.slice(col, col + colspan).reduce((a, b) => a + b, 0);
        const rowspan = cell.attrs.rowspan ?? 1;
        if (rowspan > 1) spans.set(col, { remaining: rowspan - 1, colspan });
        const contents = await blocks(cell.content, "", cellWidth);
        cells.push(`<w:tc><w:tcPr><w:tcW w:w="${twips(cellWidth)}" w:type="dxa"/><w:gridSpan w:val="${colspan}"/>${rowspan > 1 ? '<w:vMerge w:val="restart"/>' : ""}<w:vAlign w:val="center"/></w:tcPr>${contents || "<w:p/>"}</w:tc>`);
        col += colspan;
      }
      while (continuation()) { /* Merged cells may finish the row. */ }
      rows.push(`<w:tr><w:trPr>${row.attrs.repeatAsHeader ? "<w:tblHeader/>" : ""}${row.attrs.heightPt ? `<w:trHeight w:val="${twips(row.attrs.heightPt)}" w:hRule="atLeast"/>` : ""}</w:trPr>${cells.join("")}</w:tr>`);
    }
    return `<w:tbl><w:tblPr><w:tblW w:w="${twips(widths.reduce((a, b) => a + b, 0))}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${widths.map(w => `<w:gridCol w:w="${twips(w)}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>`;
  };
  /** A one-cell table keeps the frame, tint and title of a box editable in Word. */
  const box = async (node: ChalkLeeBoxNode, width: number): Promise<string> => {
    const style = chalkLeeDocumentBoxStyle(document.appearance, node.attrs.styleRef);
    const label = typeof node.attrs.label === "string" ? node.attrs.label : style.frame?.label ?? "";
    const accent = style.frame?.accentColor ?? style.border?.color;
    const line = style.border && style.border.style !== "none"
      ? `w:val="${style.border.style === "dashed" ? "dashed" : style.border.style === "dotted" ? "dotted" : "single"}" w:sz="${Math.max(2, Math.round(style.border.widthPt * 8))}" w:color="${color(style.border.color)}"`
      : 'w:val="nil"';
    const padding = style.paddingPt ?? { top: 10, right: 12, bottom: 10, left: 12 };
    const inner = width - padding.left - padding.right;
    const title = label.trim() ? paragraph(run(label, [{ type: "bold" }, ...(accent ? [{ type: "textStyle" as const, attrs: { color: accent } }] : [])]), { spaceAfterPt: 4 }) : "";
    const contents = title + await blocks(node.content, "", inner);
    return `<w:tbl><w:tblPr><w:tblW w:w="${twips(width)}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right"].map(side => `<w:${side} ${line}/>`).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="${twips(padding.top)}" w:type="dxa"/><w:left w:w="${twips(padding.left)}" w:type="dxa"/><w:bottom w:w="${twips(padding.bottom)}" w:type="dxa"/><w:right w:w="${twips(padding.right)}" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${twips(width)}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${twips(width)}" w:type="dxa"/>${style.backgroundColor ? `<w:shd w:val="clear" w:color="auto" w:fill="${color(style.backgroundColor, "FFFFFF")}"/>` : ""}</w:tcPr>${contents || "<w:p/>"}</w:tc></w:tr></w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>`;
  };
  // Numbers are written and look as on the paper: the document's style, weight, colour and frame.
  const numbering = chalkLeeQuestionNumberLook(document.appearance.questionNumbering);
  // Subquestions of a group that continues the paper's numbers are written as the paper's questions are.
  const number = (node: ChalkLeeQuestionNode | ChalkLeeQuestionGroupNode, inGroup: boolean, continued: boolean) => {
    if (node.attrs.number.mode === "none" || chalkLeeGroupContinuesNumbers(node)) return "";
    const paperStyle = !inGroup || continued, style = paperStyle ? numbering.style : numbering.subStyle;
    const text = node.attrs.number.mode === "fixed" ? chalkLeeQuestionLabelText(style, node.attrs.number.label) : chalkLeeQuestionNumberText(style, places.get(node.attrs.id) ?? 0);
    if (!text) return "";
    const look = (numbering.fontWeight === "bold" ? "<w:b/><w:bCs/>" : "") + `<w:color w:val="${color(numbering.color)}"/>`
      + (numbering.frame && paperStyle ? '<w:bdr w:val="single" w:sz="4" w:space="0" w:color="auto"/>' : "");
    return { runs: `<w:r>${look ? `<w:rPr>${look}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>${run(" ")}` };
  };
  const solutions = async (node: ChalkLeeQuestionNode | ChalkLeeQuestionGroupNode, width = contentWidth) => {
    const parts: string[] = [];
    const children = node.type === "questionGroup" ? node.content.flatMap(part => part.type === "subQuestionList" ? part.content : []) : [];
    for (const type of ["questionAnswer", "questionAnalysis"] as const) {
      if (type === "questionAnswer" ? options.answers === false : options.analysis === false) continue;
      let heading = type === "questionAnswer" ? "答案：" : "解析：";
      const own = node.content.find(part => part.type === type);
      if (own?.type === type && outputSolutionHasContent(own)) { parts.push(await blocks(own.content, heading, width)); heading = ""; }
      for (let i = 0; i < children.length; i++) {
        const child = children[i], region = child.content.find(part => part.type === type);
        if (region?.type !== type || !outputSolutionHasContent(region)) continue;
        const label = child.attrs.number.mode === "fixed" ? child.attrs.number.label : String(places.get(child.attrs.id) ?? i + 1);
        parts.push(await blocks(region.content, `${heading}${label.replace(/^[（(]/, "").replace(/[）).．、]+$/, "")}) `, width));
        heading = "";
      }
    }
    return parts.join("");
  };
  // As on the paper, a question's answer and analysis share one thin light frame that starts where the stem's
  // text does, leaving the left column to the question numbers. A one-cell table, as a box is, stays editable.
  const solutionFrame = async (node: ChalkLeeQuestionNode | ChalkLeeQuestionGroupNode, width: number) => {
    const indent = Math.min(chalkLeeQuestionNumberSlotPt(document.appearance.questionNumbering), width / 4);
    const padding = { top: 3, right: 6, bottom: 3, left: 6 }, frameWidth = width - indent;
    const contents = await solutions(node, frameWidth - padding.left - padding.right);
    if (!contents) return "";
    const line = 'w:val="single" w:sz="4" w:color="CDCED6"';
    return `<w:tbl><w:tblPr><w:tblW w:w="${twips(frameWidth)}" w:type="dxa"/><w:tblInd w:w="${twips(indent)}" w:type="dxa"/><w:tblBorders>${["top", "left", "bottom", "right"].map(side => `<w:${side} ${line}/>`).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="${twips(padding.top)}" w:type="dxa"/><w:left w:w="${twips(padding.left)}" w:type="dxa"/><w:bottom w:w="${twips(padding.bottom)}" w:type="dxa"/><w:right w:w="${twips(padding.right)}" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="${twips(frameWidth)}"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="${twips(frameWidth)}" w:type="dxa"/></w:tcPr>${contents}</w:tc></w:tr></w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>`;
  };
  const question = async (node: ChalkLeeQuestionNode | ChalkLeeQuestionGroupNode, width: number, inGroup = false, continued = false): Promise<string> => {
    const parts: string[] = [];
    for (const part of node.content) {
      if (part.type === "questionStem" || part.type === "questionMaterial") {
        const linkedEmpty = node.attrs.sourceBlankId && !part.content.some(block => block.type !== "paragraph" || block.content?.length);
        if (!linkedEmpty) parts.push(await blocks(part.content, number(node, inGroup, continued), width));
      }
      else if (part.type === "optionGroup") {
        // A borderless Word table keeps the option columns aligned and editable.
        const style = document.appearance.optionStyles[part.attrs.styleRef ?? document.appearance.defaults.optionStyleRef];
        const layout = part.attrs.layout ?? style?.layout ?? "auto";
        const count = layout === "four-column" ? 4 : layout === "two-column" ? 2 : 1;
        const rows: string[] = [];
        for (let start = 0; start < part.content.length; start += count) {
          const cells: string[] = [];
          for (let i = 0; i < count; i++) {
            const option = part.content[start + i];
            const text = option ? await blocks(option.content, style?.marker === "none" ? "" : `${option.attrs.label}. `, width / count) : "<w:p/>";
            cells.push(`<w:tc><w:tcPr><w:tcW w:w="${twips(width / count)}" w:type="dxa"/></w:tcPr>${text || "<w:p/>"}</w:tc>`);
          }
          rows.push(`<w:tr>${cells.join("")}</w:tr>`);
        }
        parts.push(`<w:tbl><w:tblPr><w:tblW w:w="${twips(width)}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${Array.from({ length: count }, () => `<w:gridCol w:w="${twips(width / count)}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl><w:p/>`);
      } else if (part.type === "subQuestionList") {
        for (const child of part.content) parts.push(await question(child, width, true, chalkLeeGroupContinuesNumbers(node)));
      }
    }
    if (!inGroup && options.solutionPlacement !== "end") parts.push(await solutionFrame(node, width));
    return parts.join("");
  };
  let content = await blocks(document.content.content);
  if (options.solutionPlacement === "end") {
    const entries = outputSolutionEntries(document, options);
    if (entries.length) content += paragraph(run(outputSolutionsTitle(options)), {}, '<w:pStyle w:val="Heading2"/><w:keepNext/><w:pageBreakBefore/>');
    let sectionId: string | undefined;
    for (const entry of entries) {
      if (entry.section?.id !== sectionId && entry.section?.title) content += paragraph(run(entry.section.title), {}, '<w:pStyle w:val="Heading3"/><w:keepNext/>');
      sectionId = entry.section?.id;
      content += paragraph(run(entry.label), {}, '<w:pStyle w:val="Heading4"/><w:keepNext/>') + await solutions(entry.question);
    }
  }
  // A cover is a section of its own before the body: no header or footer, and the body's pages count from 1.
  const cover = document.appearance.cover;
  const coverSection = cover ? await (async () => {
    const look = chalkLeeCoverLook(cover.style);
    const fonts = look.fontFamilies?.[0] ? `<w:rFonts w:ascii="${xml(look.fontFamilies[0])}" w:hAnsi="${xml(look.fontFamilies[0])}" w:eastAsia="${xml(look.fontFamilies[0])}"/>` : "";
    const text = (value: string, sizePt: number, ink: string, bold = false, ownFonts = "") =>
      `<w:r><w:rPr>${ownFonts}${bold ? "<w:b/>" : ""}<w:sz w:val="${Math.round(sizePt * 2)}"/><w:color w:val="${color(ink, "1C2024")}"/></w:rPr><w:t xml:space="preserve">${xml(value)}</w:t></w:r>`;
    const width = pageWidth - page.marginsPt.left - page.marginsPt.right;
    const align = look.align === "left" ? "left" : "center";
    const framed = (frame: string, contents: string, afterPt: number) =>
      `<w:p><w:pPr><w:framePr w:w="${twips(width)}" w:hAnchor="margin" w:xAlign="${align}" ${frame}/><w:spacing w:before="0" w:after="${twips(afterPt)}"/><w:jc w:val="${align}"/></w:pPr>${contents}</w:p>`;
    const heading = `w:vAnchor="page" w:y="${twips(look.titleTop * pageHeight)}"`, foot = `w:vAnchor="margin" w:yAlign="bottom"`;
    const title = chalkLeeCoverText(cover, "title", document.metadata.title), subtitle = chalkLeeCoverText(cover, "subtitle", "");
    const details = (["subject", "author", "date"] as const).map(field => chalkLeeCoverText(cover, field, "")).filter(Boolean);
    let paragraphs = "";
    if (title) paragraphs += framed(heading, text(title, look.titleSizePt, look.titleColor, look.titleWeight === "bold", fonts), 12);
    if (subtitle) paragraphs += framed(heading, text(subtitle, 16, look.color), 0);
    for (const detail of details) paragraphs += framed(foot, text(detail, 12, look.color), 6);
    // The drawing lies behind the text over the whole sheet, margins included.
    const picture = chalkLeeCoverPicture(document.appearance, document.metadata.title);
    let background = "";
    if (picture) {
      const embedded = await embed("cover", new TextEncoder().encode(decodeURIComponent(picture.slice(picture.indexOf(",") + 1))), "image/svg+xml");
      const cx = Math.round(pageWidth * 12700), cy = Math.round(pageHeight * 12700), id = ++drawingId;
      background = `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="封面底图 ${id}"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="封面底图 ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${embedded.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
    }
    const sectionEnd = `<w:sectPr><w:pgSz w:w="${twips(pageWidth)}" w:h="${twips(pageHeight)}" w:orient="${page.orientation}"/><w:pgMar ${Object.entries(page.marginsPt).map(([side, pt]) => `w:${side}="${twips(pt)}"`).join(" ")} w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>`;
    return `${paragraphs}<w:p><w:pPr>${sectionEnd}</w:pPr>${background}</w:p>`;
  })() : "";
  // The contents is a section of its own after the cover: a Word contents field over the headings, which Word
  // updates with its own page numbers when the document opens; until then each entry is listed without one.
  const toc = document.appearance.tableOfContents;
  const tocLook = toc ? chalkLeeTocLook(toc.style) : null;
  const tocSection = toc && tocLook ? (() => {
    const entries = chalkLeeTocEntries(chalkLeeDocumentHeadings(document), toc, document.appearance.headingNumbering);
    const top = entries.length ? Math.min(...entries.map(entry => entry.level)) : 1;
    const title = chalkLeeTocTitle(toc);
    const heading = title ? `<w:p><w:pPr><w:spacing w:before="0" w:after="${twips(24)}"/><w:jc w:val="${tocLook.titleAlign === "left" ? "left" : "center"}"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="${color(tocLook.accentColor, "1C2024")}"/></w:rPr><w:t xml:space="preserve">${xml(title)}</w:t></w:r></w:p>` : "";
    const begin = `<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "${top}-${Math.min(9, top + chalkLeeTocLevels(toc) - 1)}" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
    const end = `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const rows = entries.length
      ? entries.map((entry, index) => `<w:p><w:pPr><w:pStyle w:val="TOC${entry.depth + 1}"/></w:pPr>${index ? "" : begin}${run(`${entry.number ? `${entry.number}${/[、）.]$/.test(entry.number) ? "" : " "}` : ""}${entry.text}`)}<w:r><w:tab/></w:r>${index === entries.length - 1 ? end : ""}</w:p>`).join("")
      : `<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>${begin}${end}</w:p>`;
    const sectionEnd = `<w:sectPr><w:pgSz w:w="${twips(pageWidth)}" w:h="${twips(pageHeight)}" w:orient="${page.orientation}"/><w:pgMar ${Object.entries(page.marginsPt).map(([side, pt]) => `w:${side}="${twips(pt)}"`).join(" ")} w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>`;
    return `${heading}${rows}<w:p><w:pPr>${sectionEnd}</w:pPr></w:p>`;
  })() : "";
  const front = Boolean(cover || toc);
  // The paper's header and footer, with Word's own page and page-count fields.
  const headerFooter = chalkLeeHeaderFooter(document.appearance);
  const pageContentWidth = pageWidth - page.marginsPt.left - page.marginsPt.right;
  const runningLine = (line: ChalkLeeRunningLine, edge: "top" | "bottom") => {
    const look = chalkLeeRunningLook(headerFooter, line);
    const runStyle = `<w:rPr>${look.fontWeight === "bold" ? "<w:b/>" : ""}${look.letterSpacingEm ? `<w:spacing w:val="${Math.round(look.letterSpacingEm * look.fontSizePt * 20)}"/>` : ""}<w:sz w:val="${Math.round(look.fontSizePt * 2)}"/><w:color w:val="${color(look.color, "1F2937")}"/></w:rPr>`;
    const text = (value = "") => chalkLeeRunningParts(value.trim()).map(part => typeof part !== "string"
      ? part.field === "title" ? run(document.metadata.title) : `<w:fldSimple w:instr="${part.field === "page" ? "PAGE" : front ? "SECTIONPAGES" : "NUMPAGES"}"><w:r><w:t>1</w:t></w:r></w:fldSimple>`
      : run(part)).join("");
    // Word measures borders in eighths of a point; its double border is two lines of that width.
    const border = (side: "top" | "bottom") => look.rule
      ? `<w:${side} w:val="${look.rule.style === "solid" ? "single" : look.rule.style}" w:sz="${Math.max(2, Math.min(96, Math.round(look.rule.widthPt * 8)))}" w:space="3" w:color="${color(look.rule.color, "374151")}"/>` : "";
    const near = edge === "top" ? "bottom" : "top";
    const rule = look.rule ? `<w:pBdr>${look.rule.bothSides ? border("top") + border("bottom") : border(near)}</w:pBdr>` : "";
    const tabs = `<w:tabs><w:tab w:val="center" w:pos="${twips(pageContentWidth / 2)}"/><w:tab w:val="right" w:pos="${twips(pageContentWidth)}"/></w:tabs>`;
    const parts = CHALKLEE_RUNNING_SLOTS.map(slot => text(line[slot]));
    return `<w:p><w:pPr>${rule}${tabs}<w:spacing w:before="0" w:after="0"/>${runStyle}</w:pPr>${parts[0]}<w:r><w:tab/></w:r>${parts[1]}<w:r><w:tab/></w:r>${parts[2]}</w:p>`
      .replace(/<w:r>(?:<w:rPr>)?/g, match => match === "<w:r>" ? `<w:r>${runStyle}` : match);
  };
  const references: string[] = [];
  for (const [place, tag, edge] of [["header", "hdr", "top"], ["footer", "ftr", "bottom"]] as const) {
    const line = headerFooter[place];
    if (!chalkLeeRunningLineVisible(line)) continue;
    const part = `${place}1.xml`;
    const id = relate(place, part);
    zip.file(`word/${part}`, header + `<w:${tag} xmlns:w="${W}" xmlns:r="${R}">${runningLine(line, edge)}</w:${tag}>`);
    contentTypes.set(`/word/${part}`, `application/vnd.openxmlformats-officedocument.wordprocessingml.${place}+xml`);
    references.push(`<w:${place}Reference w:type="default" r:id="${id}"/>`);
  }
  relate("styles", "styles.xml");
  const section = `<w:sectPr>${references.join("")}<w:pgSz w:w="${twips(pageWidth)}" w:h="${twips(pageHeight)}" w:orient="${page.orientation}"/><w:pgMar ${Object.entries(page.marginsPt).map(([side, pt]) => `w:${side}="${twips(pt)}"`).join(" ")} w:header="360" w:footer="360" w:gutter="0"/>${front ? '<w:pgNumType w:start="1"/>' : ""}<w:cols w:num="${page.columnCount ?? 1}" w:space="${twips(page.columnGapPt ?? 24)}"/>${headerFooter.differentFirstPage ? "<w:titlePg/>" : ""}</w:sectPr>`;
  zip.file("word/document.xml", header + `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${coverSection}${tocSection}${content}${section}</w:body></w:document>`);
  const font = xml(body.fontFamilies[0] ?? "宋体");
  zip.file("word/styles.xml", header + `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}"/><w:sz w:val="${Math.round(body.fontSizePt * 2)}"/><w:color w:val="${color(body.color)}"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${Array.from({ length: 6 }, (_, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${i}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.round((body.fontSizePt + (i === 0 ? 6 : 2)) * 2)}"/></w:rPr></w:style>`).join("")}${tocLook ? tocStyles(tocLook, pageContentWidth, body.fontSizePt) : ""}</w:styles>`);
  if (toc) {
    // Word asks to update fields on opening, which fills in the contents' page numbers.
    relate("settings", "settings.xml");
    zip.file("word/settings.xml", header + `<w:settings xmlns:w="${W}"><w:updateFields w:val="true"/></w:settings>`);
    contentTypes.set("/word/settings.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml");
  }
  zip.file("word/_rels/document.xml.rels", header + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join("")}</Relationships>`);
  zip.file("_rels/.rels", header + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relType("officeDocument")}" Target="word/document.xml"/></Relationships>`);
  zip.file("[Content_Types].xml", header + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...contentTypes].map(([extension, type]) => extension.startsWith("/") ? "" : `<Default Extension="${extension}" ContentType="${type}"/>`).join("")}${[...contentTypes].map(([part, type]) => part.startsWith("/") ? `<Override PartName="${part}" ContentType="${type}"/>` : "").join("")}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Word's own contents styles, one per level, with the leader to the page number at the right edge. */
function tocStyles(look: ReturnType<typeof chalkLeeTocLook>, widthPt: number, bodySizePt: number) {
  const leader = look.leader === "dots" ? "dot" : look.leader === "line" ? "underscore" : "none";
  return [0, 1, 2].map(depth => {
    const top = depth === 0;
    const ink = color(top ? look.accentColor : look.color, "1C2024");
    return `<w:style w:type="paragraph" w:styleId="TOC${depth + 1}"><w:name w:val="toc ${depth + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:leader="${leader}" w:pos="${twips(widthPt)}"/></w:tabs><w:spacing w:before="0" w:after="0" w:line="${twips(24)}" w:lineRule="exact"/><w:ind w:left="${twips(depth * bodySizePt * 2)}"/></w:pPr><w:rPr>${top && look.firstLevelBold ? "<w:b/>" : ""}<w:color w:val="${ink}"/></w:rPr></w:style>`;
  }).join("");
}
