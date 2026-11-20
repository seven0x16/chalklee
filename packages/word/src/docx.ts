import JSZip from "jszip";
import { defaultPage, paragraph, type ParagraphStyle, type TextStyle, type WordBlock, type WordDocument, type WordDrawing, type WordInline, type WordSection, type WordTabStop, type WordRowProperties, type WordCell } from "./model";
import { child, children, descendants, enabled, readXml, text, value, type XmlNode } from "./xml";
import { mathMl } from "./math";
import { ommlToLatex } from "./latex";
import { readMathTypeEquation, type MathTypeEquation } from "./mathtype";
import { imageDisplaySize } from "./imageSize";
import { formatChineseCounting, formatWordNumber, pageField, paragraphLineSpacing, wordNumberFormat } from "./format";
import { createThemeResolver, type WordTheme } from "./theme";
import { readBorders } from "./borders";
import { sanitizeSvg } from "./svg";
import { wmfTextSvg } from "./wmf";
import { readVmlGraphic } from "./vml";
import { readDrawingShapes } from "./drawingml";

const number = (s: string | undefined): number | undefined => s !== undefined && Number.isFinite(Number(s)) ? Number(s) : undefined;
const px = (s: string | undefined) => { const n = number(s); return n === undefined ? undefined : n / 15; };
const highlights: Record<string, string> = { black: "#000000", blue: "#0000ff", cyan: "#00ffff", green: "#00ff00", magenta: "#ff00ff", red: "#ff0000", yellow: "#ffff00", white: "#ffffff",
  darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", none: "none" };
function defined<T extends object>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T; }
function readRunProperties(n: XmlNode | undefined, theme: WordTheme): TextStyle {
  const font = child(n, "rFonts"), size = number(value(n, "sz"));
  const vertical = value(n, "vertAlign"), highlight = value(n, "highlight");
  return defined({ font: theme.font(font?.attrs.eastAsiaTheme, true, child(n, "lang")?.attrs.eastAsia) ?? font?.attrs.eastAsia,
    latinFont: theme.font(font?.attrs.asciiTheme, false) ?? font?.attrs.ascii ?? theme.font(font?.attrs.hAnsiTheme, false) ?? font?.attrs.hAnsi,
    size: size === undefined ? undefined : size * 2 / 3, bold: enabled(child(n, "b")), italic: enabled(child(n, "i")), underline: enabled(child(n, "u")), strike: enabled(child(n, "strike")),
    color: theme.color(child(n, "color")), background: theme.color(child(n, "shd"), true), highlight: highlight !== undefined && Object.hasOwn(highlights, highlight) ? highlights[highlight] : undefined, vertical: vertical === "subscript" ? "sub" : vertical === "superscript" ? "super" : undefined,
    offset: number(value(n, "position")) === undefined ? undefined : Number(value(n, "position")) * 2 / 3, spacing: px(value(n, "spacing")), hidden: enabled(child(n, "vanish")) });
}
function readParagraphProperties(n: XmlNode | undefined, theme: WordTheme, warn: () => void): ParagraphStyle {
  const spacing = child(n, "spacing"), indent = child(n, "ind"), align = value(n, "jc"), line = number(spacing?.attrs.line);
  const tabStops = child(n, "tabs") ? children(child(n, "tabs"), "tab").flatMap(t => {
    const position = px(t.attrs.pos), align = t.attrs.val ?? "left";
    if (position === undefined || !["left", "right", "center"].includes(align)) return [];
    const leader = t.attrs.leader;
    return [{ position, align: align as WordTabStop["align"], leader: leader && ["dot", "hyphen", "underscore", "heavy", "middleDot"].includes(leader) ? leader as WordTabStop["leader"] : undefined }];
  }).sort((a, b) => a.position - b.position) : undefined;
  return defined({ borders: readBorders(child(n, "pBdr"), theme, warn), align: align === "center" || align === "right" || align === "left" ? align : align === "both" || align === "distribute" ? "justify" : undefined,
    before: px(spacing?.attrs.before), after: px(spacing?.attrs.after), left: px(indent?.attrs.start ?? indent?.attrs.left), right: px(indent?.attrs.end ?? indent?.attrs.right),
    beforeLines: number(spacing?.attrs.beforeLines) === undefined ? undefined : Number(spacing!.attrs.beforeLines) / 100,
    afterLines: number(spacing?.attrs.afterLines) === undefined ? undefined : Number(spacing!.attrs.afterLines) / 100,
    contextualSpacing: enabled(child(n, "contextualSpacing")), snapToGrid: enabled(child(n, "snapToGrid")),
    indent: indent?.attrs.hanging !== undefined ? -(px(indent.attrs.hanging) ?? 0) : px(indent?.attrs.firstLine),
    lineValue: line, lineRule: ["auto", "exact", "atLeast"].includes(spacing?.attrs.lineRule ?? "") ? spacing!.attrs.lineRule as ParagraphStyle["lineRule"] : undefined,
    keepNext: enabled(child(n, "keepNext")), keepLines: enabled(child(n, "keepLines")), widowControl: enabled(child(n, "widowControl")),
    tabStops,
    tabs: child(n, "tabs") ? children(child(n, "tabs"), "tab").filter(t => !t.attrs.val || t.attrs.val === "left").map(t => px(t.attrs.pos)).filter((n): n is number => n !== undefined).sort((a, b) => a - b) : undefined });
}
function mergeParagraphStyle(...styles: ParagraphStyle[]): ParagraphStyle {
  const result = Object.assign({}, ...styles);
  if (styles.some(s => s.borders)) result.borders = Object.assign({}, ...styles.map(s => s.borders));
  return result;
}
function rowProperties(n: XmlNode | undefined): WordRowProperties {
  const height = child(n, "trHeight"), rule = height?.attrs.hRule;
  return defined({ height: px(height?.attrs.val), heightRule: height ? rule === "exact" || rule === "auto" ? rule : "atLeast" : undefined, cantSplit: enabled(child(n, "cantSplit")) });
}
function cellPadding(n: XmlNode | undefined): WordCell["padding"] {
  if (!n) return;
  return defined(Object.fromEntries((["top", "right", "bottom", "left"] as const).map(side => {
    const edge = child(n, side) ?? (side === "left" ? child(n, "start") : side === "right" ? child(n, "end") : undefined);
    return [side, edge?.attrs.type === "nil" ? 0 : edge && (!edge.attrs.type || edge.attrs.type === "dxa") ? px(edge.attrs.w) : undefined];
  })));
}
interface Style { basedOn?: string; p: ParagraphStyle; r: TextStyle; heading?: number; node: XmlNode }
interface Relation { part: string; external: boolean; type: string }
function resolvePart(owner: string, target: string): string {
  if (/[\\\0]|^[a-z][a-z0-9+.-]*:/i.test(target)) return "";
  const parts = target.startsWith("/") ? [] : owner.split("/").slice(0, -1);
  for (const item of target.split("/")) {
    if (!item || item === ".") continue;
    if (item === "..") { if (!parts.length) return ""; parts.pop(); } else parts.push(item);
  }
  return parts.join("/");
}

export async function parseDocx(bytes: Uint8Array, options: { includeEquations?: boolean } = {}): Promise<WordDocument> {
  const zip = await JSZip.loadAsync(bytes);
  // Bound decompression before asking JSZip to allocate part buffers.
  let uncompressed = 0;
  for (const entry of Object.values(zip.files)) {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof size === "number") uncompressed += size;
  }
  if (uncompressed > 128 * 1024 * 1024 || Object.keys(zip.files).length > 20000) throw new Error("Word 解包后的内容过大。");
  const warnings = new Set<string>(), assets: WordDocument["assets"] = [], assetIds = new Map<string, number>();
  const equations = new Map<string, Promise<MathTypeEquation>>();
  const xmlCache = new Map<string, Promise<XmlNode | undefined>>();
  const xml = (part: string) => {
    if (!xmlCache.has(part)) xmlCache.set(part, (async () => {
      const file = zip.file(part); return file ? readXml(await file.async("string")) : undefined;
    })());
    return xmlCache.get(part)!;
  };
  const rootRelations = await xml("_rels/.rels");
  const mainRel = descendants(rootRelations, "Relationship").find(n => n.attrs.Type?.endsWith("/officeDocument"));
  const main = mainRel ? mainRel.attrs.TargetMode === "External" ? "" : resolvePart("", mainRel.attrs.Target ?? "") : "word/document.xml";
  const source = main ? await xml(main) : undefined;
  const body = child(child(source, "document"), "body");
  if (!body) throw new Error("无法读取 DOCX 正文，文件可能已损坏或加密。");
  async function relations(part: string): Promise<Map<string, Relation>> {
    const path = part.split("/"), name = path.pop();
    const source = await xml([...path, "_rels", `${name}.rels`].join("/"));
    return new Map(descendants(source, "Relationship").map(n => [n.attrs.Id!, { part: resolvePart(part, n.attrs.Target ?? ""), external: n.attrs.TargetMode === "External", type: n.attrs.Type ?? "" }]));
  }
  const mainRelations = await relations(main);
  const relatedPart = (type: string, fallback: string) => [...mainRelations.values()].find(r => !r.external && r.type.endsWith(`/${type}`))?.part ?? resolvePart(main, fallback);
  const settings = child(await xml(relatedPart("settings", "settings.xml")), "settings");
  const theme = createThemeResolver(await xml(relatedPart("theme", "theme/theme1.xml")), settings);
  const runProperties = (n: XmlNode | undefined) => readRunProperties(n, theme);
  const warnBorder = () => warnings.add("部分特殊边框线型暂按普通线显示");
  const paragraphProperties = (n: XmlNode | undefined) => readParagraphProperties(n, theme, warnBorder);
  const styleRoot = child(await xml(relatedPart("styles", "styles.xml")), "styles");
  const defaults = child(styleRoot, "docDefaults"), defaultR = runProperties(child(child(defaults, "rPrDefault"), "rPr")), defaultP = paragraphProperties(child(child(defaults, "pPrDefault"), "pPr"));
  defaultP.defaultTab = px(value(settings, "defaultTabStop")) ?? 48;
  const styles = new Map<string, Style>(); let defaultStyle: string | undefined, defaultTableStyle: string | undefined;
  for (const n of children(styleRoot, "style")) {
    if (n.attrs.type === "paragraph" && ["1", "true", "on"].includes(n.attrs.default ?? "")) defaultStyle = n.attrs.styleId;
    if (n.attrs.type === "table" && ["1", "true", "on"].includes(n.attrs.default ?? "")) defaultTableStyle = n.attrs.styleId;
    const outline = number(value(child(n, "pPr"), "outlineLvl"));
    styles.set(n.attrs.styleId!, { basedOn: value(n, "basedOn"), p: paragraphProperties(child(n, "pPr")), r: runProperties(child(n, "rPr")), heading: outline !== undefined && outline < 9 ? outline + 1 : undefined, node: n });
  }
  function style(id: string | undefined, seen = new Set<string>()): Omit<Style, "node"> {
    const s = id ? styles.get(id) : undefined;
    if (!s || seen.has(id!)) return { p: {}, r: {} };
    seen.add(id!); const base = style(s.basedOn, seen);
    return { p: mergeParagraphStyle(base.p, s.p), r: { ...base.r, ...s.r }, heading: s.heading ?? base.heading };
  }
  function tableStyleNodes(id: string | undefined, seen = new Set<string>()): XmlNode[] {
    const s = id ? styles.get(id) : undefined;
    if (!s || seen.has(id!)) return [];
    seen.add(id!); return [...tableStyleNodes(s.basedOn, seen), s.node];
  }
  const numbering = child(await xml(relatedPart("numbering", "numbering.xml")), "numbering");
  const nums = new Map(children(numbering, "num").map(n => [n.attrs.numId!, n]));
  const abstracts = new Map(children(numbering, "abstractNum").map(n => [n.attrs.abstractNumId!, n]));
  const counters = new Map<string, (number | undefined)[]>();
  function listMarker(n: XmlNode | undefined): { marker: string; follow?: "space" | "nothing" | "tab" } | undefined {
    const id = value(n, "numId"); if (!id || id === "0") return;
    const level = Math.min(8, Math.max(0, number(value(n, "ilvl")) ?? 0));
    const num = nums.get(id), abstract = abstracts.get(value(num, "abstractNumId") ?? "");
    const levelDefinition = (index: number) => {
      const override = children(num, "lvlOverride").find(n => Number(n.attrs.ilvl) === index);
      return { override, lvl: child(override, "lvl") ?? children(abstract, "lvl").find(n => Number(n.attrs.ilvl) === index) };
    };
    const { override, lvl } = levelDefinition(level);
    if (!lvl) { warnings.add("部分列表编号暂未还原"); return { marker: "•" }; }
    const counts = counters.get(id) ?? [];
    counts[level] = counts[level] === undefined ? number(value(override, "startOverride")) ?? number(value(lvl, "start")) ?? 1 : counts[level]! + 1;
    for (let deeper = level + 1; deeper < counts.length; deeper++) {
      const restart = number(value(levelDefinition(deeper).lvl, "lvlRestart")) ?? deeper;
      if (restart && level < restart) counts[deeper] = undefined;
    }
    counters.set(id, counts);
    const format = value(lvl, "numFmt");
    const label = value(lvl, "lvlText") ?? "%1.";
    const suffix = value(lvl, "suff"), follow = suffix === "space" || suffix === "nothing" || suffix === "tab" ? suffix : undefined;
    if (format === "bullet") return { marker: label, follow };
    if (format === "none") return;
    const marker = label.replace(/%([1-9])/g, (_, digit) => {
      const index = Number(digit) - 1, definition = levelDefinition(index);
      const count = counts[index] ?? number(value(definition.override, "startOverride")) ?? number(value(definition.lvl, "start")) ?? 1;
      const format = value(definition.lvl, "numFmt") ?? "decimal";
      if (format === "chineseCounting") {
        const chinese = formatChineseCounting(count); if (chinese !== undefined) return chinese;
        warnings.add("部分中文编号范围暂以数字显示");
      }
      const mapped = wordNumberFormat(format);
      if (!mapped && format !== "chineseCounting") warnings.add("部分编号样式暂以数字显示");
      return formatWordNumber(count, mapped ?? "decimal");
    });
    return { marker, follow };
  }
  let serial = 0;
  const imageCache = new Map<string, Promise<{ bytes: Uint8Array; mime: string; partial?: boolean } | undefined>>();
  const imageKey = (part: string, stretch: boolean) => stretch && /\.svg$/i.test(part) ? `${part}#stretch` : part;
  function readImage(part: string, stretch: boolean) {
    const key = imageKey(part, stretch);
    if (!imageCache.has(key)) imageCache.set(key, (async () => {
      const file = zip.file(part); if (!file) return;
      const ext = part.split(".").pop()?.toLowerCase();
      const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp" } as Record<string, string>)[ext ?? ""];
      if (!mime && !["svg", "wmf"].includes(ext ?? "")) return;
      const bytes = await file.async("uint8array");
      if (mime) return { bytes, mime };
      if (ext === "svg") { const result = sanitizeSvg(bytes, stretch); return result ? { ...result, mime: "image/svg+xml" } : undefined; }
      const converted = wmfTextSvg(bytes);
      return converted ? { bytes: converted, mime: "image/svg+xml" } : undefined;
    })());
    return imageCache.get(key)!;
  }
  async function imageSource(node: XmlNode, rels: Map<string, Relation>) {
    const refs = [...descendants(node, "svgBlip"), ...descendants(node, "blip"), ...descendants(node, "imagedata")];
    const stretch = descendants(node, "stretch").length > 0 || descendants(node, "imagedata").length > 0;
    let partial: { part: string; key: string; data: NonNullable<Awaited<ReturnType<typeof readImage>>> } | undefined;
    for (const ref of refs) {
      const rel = rels.get(ref.attrs.embed ?? ref.attrs.id ?? "");
      if (!rel || rel.external || !rel.part) continue;
      const data = await readImage(rel.part, stretch); if (!data) continue;
      // A complete raster preview is preferable to a vector with omitted features.
      if (data.partial) partial ??= { part: rel.part, key: imageKey(rel.part, stretch), data }; else return { part: rel.part, key: imageKey(rel.part, stretch), data };
    }
    return partial;
  }
  const vmlGraphics = new WeakMap<XmlNode, ReturnType<typeof readVmlGraphic>>();
  function vmlGraphic(node: XmlNode) {
    if (!vmlGraphics.has(node)) vmlGraphics.set(node, readVmlGraphic(node));
    return vmlGraphics.get(node);
  }
  const shapeCache = new WeakMap<XmlNode, ReturnType<typeof readDrawingShapes>>();
  function drawingShapes(anchor: XmlNode) {
    if (!shapeCache.has(anchor)) shapeCache.set(anchor, readDrawingShapes(anchor, theme));
    return shapeCache.get(anchor);
  }
  function shapeAsset(bytes: Uint8Array): number {
    const key = `drawing:${new TextDecoder().decode(bytes)}`;
    let asset = assetIds.get(key);
    if (asset === undefined) { asset = assets.length; assets.push({ bytes, mime: "image/svg+xml" }); assetIds.set(key, asset); }
    return asset;
  }
  async function supportedBranch(node: XmlNode, rels: Map<string, Relation>): Promise<boolean> {
    // Textboxes already use the independent block reader. Do not reject them for
    // having no picture, or parse their paragraphs twice during this probe.
    if (descendants(node, "txbxContent").length) return true;
    const pictures = [...descendants(node, "drawing"), ...descendants(node, "pict"), ...descendants(node, "object")];
    if (!pictures.length) return false;
    for (const picture of pictures) {
      const anchor = descendants(picture, "anchor")[0];
      if (!await imageSource(picture, rels) && !vmlGraphic(picture) && !(anchor && drawingShapes(anchor))) return false;
    }
    return true;
  }
  async function picture(node: XmlNode, rels: Map<string, Relation>): Promise<WordInline | null> {
    const blip = descendants(node, "blip")[0] ?? descendants(node, "svgBlip")[0], vml = descendants(node, "imagedata")[0];
    const object = options.includeEquations ? descendants(node, "OLEObject").find(n => /^(Equation\.|MathType)/i.test(n.attrs.ProgID ?? "")) : undefined;
    if (object) {
      const rel = rels.get(object.attrs.id ?? "");
      if (rel && !rel.external && zip.file(rel.part)) {
        if (!equations.has(rel.part)) equations.set(rel.part, zip.file(rel.part)!.async("uint8array").then(readMathTypeEquation));
        const equation = await equations.get(rel.part)!;
        if ("latex" in equation) return { kind: "math", mathml: "", latex: equation.latex, source: "mathtype" };
      }
      warnings.add("有一个旧版公式未能可靠提取，请对照原稿核对。");
    }
    // Vector text/watermark shapes without a picture aren't broken image references.
    if (!blip && !vml && !object) { warnings.add("部分矢量图形或水印尚未还原"); return null; }
    const alt = object ? "公式原图（尚不可编辑）" : descendants(node, "docPr")[0]?.attrs.descr ?? "配图";
    const equationFallback = object ? { mathType: true } : {};
    const placeholder = (): WordInline => ({ kind: "image-placeholder", alt, ...imageDisplaySize(node), ...equationFallback });
    const source = await imageSource(node, rels);
    if (!source) {
      const rel = rels.get(blip?.attrs.embed ?? vml?.attrs.id ?? "");
      warnings.add(!rel || rel.external || !rel.part ? "外链图片或缺失的配图未加载" : !zip.file(rel.part) ? "原稿中有缺失的配图" : "部分矢量图片、旧版公式或图片格式暂未还原");
      return placeholder();
    }
    if (source.data.partial) warnings.add("部分 SVG 效果或外部资源尚未还原");
    let asset = assetIds.get(source.key);
    if (asset === undefined) {
      asset = assets.length; assets.push({ bytes: source.data.bytes, mime: source.data.mime }); assetIds.set(source.key, asset);
    }
    return { kind: "image", asset, alt, ...imageDisplaySize(node), ...equationFallback };
  }
  async function blocks(parent: XmlNode, rels: Map<string, Relation>, depth = 0): Promise<WordBlock[]> {
    if (depth > 32) throw new Error("Word 表格嵌套过深。");
    const result: WordBlock[] = [];
    for (const n of parent.children) {
      if (n.name === "p") {
        const prop = child(n, "pPr"), s = style(value(prop, "pStyle") ?? defaultStyle), outline = number(value(prop, "outlineLvl"));
        const p = paragraph(`word-${serial++}`); p.style = paragraphLineSpacing(mergeParagraphStyle(defaultP, s.p, paragraphProperties(prop))); p.textStyle = { size: 16, ...defaultR, ...s.r };
        p.styleId = value(prop, "pStyle") ?? defaultStyle ?? "";
        p.markStyle = { ...p.textStyle, ...runProperties(child(prop, "rPr")) };
        p.heading = outline !== undefined ? outline < 9 ? outline + 1 : undefined : s.heading;
        p.pageBreakBefore = enabled(child(prop, "pageBreakBefore"));
        const styleNode = styles.get(value(prop, "pStyle") ?? defaultStyle ?? "")?.node;
        const marker = listMarker(child(prop, "numPr") ?? child(child(styleNode, "pPr"), "numPr"));
        p.marker = marker?.marker; p.markerFollow = marker?.follow;
        let active = p;
        const fields: { instruction: string; result: boolean; emitted: boolean }[] = [];
        async function inline(node: XmlNode, run: TextStyle): Promise<void> {
          if (node.name.endsWith("Pr") || node.name === "del" || node.name === "moveFrom") return;
          const current = fields.at(-1);
          if (node.name === "fldChar") {
            if (node.attrs.fldCharType === "begin") fields.push({ instruction: "", result: false, emitted: false });
            if (node.attrs.fldCharType === "separate" && current) current.result = true;
            if (node.attrs.fldCharType === "end") {
              const field = current && pageField(current.instruction);
              if (field && !current!.emitted) active.inlines.push({ ...field, style: run });
              fields.pop();
            }
            return;
          }
          if (node.name === "instrText") { if (current) current.instruction += text(node); return; }
          if (node.name === "t") {
            if (current && !current.result) return;
            const field = current && pageField(current.instruction);
            if (field) { if (!current!.emitted) active.inlines.push({ ...field, style: run }); current!.emitted = true; }
            else active.inlines.push({ kind: "text", text: text(node), style: run });
          } else if (node.name === "tab") active.inlines.push({ kind: "text", text: "\t", style: run });
          else if (node.name === "br" || node.name === "cr") {
            if (node.attrs.type === "page") {
              active.pageBreakAfter = true; result.push(active);
              active = { ...p, id: `word-${serial++}`, inlines: [], drawings: undefined, marker: undefined, heading: undefined, pageBreakBefore: false, pageBreakAfter: false };
            } else active.inlines.push({ kind: "text", text: "\n", style: run });
          } else if (node.name === "drawing" || node.name === "pict" || node.name === "object") {
            const anchor = descendants(node, "anchor")[0], textbox = descendants(node, "txbxContent")[0];
            if (anchor) {
              const extent = child(anchor, "extent"), emu = (s: string | undefined) => (number(s) ?? 0) / 9525;
              const axis = (name: string): WordDrawing["x"] => {
                const pos = child(anchor, name);
                return { relative: pos?.attrs.relativeFrom ?? "margin", offset: emu(text(child(pos, "posOffset"))), align: child(pos, "align") ? text(child(pos, "align")) : undefined };
              };
              const shapes = drawingShapes(anchor);
              if (shapes) {
                const width = emu(extent?.attrs.cx), height = emu(extent?.attrs.cy);
                for (const shape of shapes) {
                  if (shape.partial) warnings.add("部分图形的三维或特殊效果尚未完整还原");
                  if (!shape.textbox && !shape.decoration) continue;
                  const prop = shape.body, decoration = shape.decoration ? shapeAsset(shape.decoration) : undefined;
                  const content: WordDrawing["content"] = shape.textbox ? { kind: "textbox", blocks: await blocks(shape.textbox, rels, depth + 1), decoration,
                    fitToText: prop?.attrs.wrap === "none" && !!child(prop, "spAutoFit") || undefined,
                    inset: { left: emu(prop?.attrs.lIns ?? "91440"), right: emu(prop?.attrs.rIns ?? "91440"), top: emu(prop?.attrs.tIns ?? "45720"), bottom: emu(prop?.attrs.bIns ?? "45720") },
                    vertical: prop?.attrs.anchor === "ctr" ? "center" : prop?.attrs.anchor === "b" ? "bottom" : "top" }
                    : { kind: "image", asset: decoration!, alt: "图形", width: shape.width, height: shape.height };
                  (active.drawings ??= []).push({ x: axis("positionH"), y: axis("positionV"), width: shape.width, height: shape.height,
                    group: { width, height, left: shape.left, top: shape.top },
                    behind: ["1", "true"].includes(anchor.attrs.behindDoc ?? ""), order: number(anchor.attrs.relativeHeight) ?? 0, content });
                }
                return;
              }
              let content: WordDrawing["content"] | undefined;
              if (textbox) {
                const prop = descendants(node, "bodyPr")[0];
                content = { kind: "textbox", blocks: await blocks(textbox, rels, depth + 1),
                  fitToText: prop?.attrs.wrap === "none" && !!child(prop, "spAutoFit") || undefined,
                  inset: { left: emu(prop?.attrs.lIns ?? "91440"), right: emu(prop?.attrs.rIns ?? "91440"), top: emu(prop?.attrs.tIns ?? "45720"), bottom: emu(prop?.attrs.bIns ?? "45720") },
                  vertical: prop?.attrs.anchor === "ctr" ? "center" : prop?.attrs.anchor === "b" ? "bottom" : "top" };
              } else {
                const image = await picture(node, rels);
                if (image?.kind === "image" || image?.kind === "image-placeholder") content = image;
                else if (image) active.inlines.push(image);
              }
              if (content) {
                (active.drawings ??= []).push({ x: axis("positionH"), y: axis("positionV"), width: emu(extent?.attrs.cx), height: emu(extent?.attrs.cy),
                  behind: ["1", "true"].includes(anchor.attrs.behindDoc ?? ""), order: number(anchor.attrs.relativeHeight) ?? 0, content });
                if (!child(anchor, "wrapNone")) warnings.add("浮动对象的正文环绕尚未完整还原");
              }
            } else if (textbox) {
              warnings.add("旧式文字框暂按正文顺序排列");
              const content = await blocks(textbox, rels, depth + 1);
              result.push(active, ...content); active = { ...p, id: `word-${serial++}`, inlines: [], drawings: undefined };
            } else {
              const graphic = vmlGraphic(node);
              if (graphic) {
                const key = `vml:${new TextDecoder().decode(graphic.bytes)}`;
                let asset = assetIds.get(key);
                if (asset === undefined) { asset = assets.length; assets.push({ bytes: graphic.bytes, mime: "image/svg+xml" }); assetIds.set(key, asset); }
                const image: Extract<WordInline, { kind: "image" }> = { kind: "image", asset, width: graphic.width, height: graphic.height, alt: "框线" };
                if (graphic.floating) (active.drawings ??= []).push({ x: graphic.x, y: graphic.y, width: graphic.width, height: graphic.height, behind: graphic.behind, order: graphic.order, content: image });
                else active.inlines.push(image);
              } else { const image = await picture(node, rels); if (image) active.inlines.push(image); }
            }
          }
          else if (node.name === "oMath" || node.name === "oMathPara") active.inlines.push({
            kind: "math", mathml: mathMl(node, () => warnings.add("部分公式结构尚未完整还原")),
            ...(options.includeEquations ? { latex: ommlToLatex(node), source: "omml" as const } : {})
          });
          else if (node.name === "sym") { const code = parseInt(node.attrs.char ?? "", 16); if (Number.isInteger(code) && code <= 0x10ffff) active.inlines.push({ kind: "text", text: String.fromCodePoint(code), style: { ...run, font: node.attrs.font } }); }
          else if (node.name === "footnoteReference" || node.name === "endnoteReference") { active.inlines.push({ kind: "text", text: "〔注释〕", style: { vertical: "super" } }); warnings.add("脚注与尾注正文暂未还原"); }
          else if (node.name === "fldSimple" && pageField(node.attrs.instr ?? "")) active.inlines.push({ ...pageField(node.attrs.instr ?? "")!, style: run });
          else if (node.name === "AlternateContent") {
            let selected: XmlNode | undefined;
            for (const candidate of children(node, "Choice")) if (await supportedBranch(candidate, rels)) { selected = candidate; break; }
            selected ??= child(node, "Fallback") ?? child(node, "Choice");
            if (selected) for (const c of selected.children) await inline(c, run);
          }
          else {
            const r = child(node, "rPr"), runStyle = node.name === "r" ? { ...run, ...style(value(r, "rStyle")).r, ...runProperties(r) } : run;
            if (runStyle.hidden) return;
            for (const c of node.children) await inline(c, runStyle);
          }
        }
        for (const c of n.children) await inline(c, p.textStyle);
        active.sectionBreakAfter = !!child(prop, "sectPr");
        result.push(active);
      } else if (n.name === "tbl") {
        const tablePr = child(n, "tblPr"), tableWidth = child(tablePr, "tblW"), align = value(tablePr, "jc"), margin = child(tablePr, "tblCellMar");
        const tableStyles = tableStyleNodes(value(tablePr, "tblStyle") ?? defaultTableStyle);
        const borders = Object.assign({}, ...tableStyles.map(s => readBorders(child(child(s, "tblPr"), "tblBorders"), theme, warnBorder)), readBorders(child(tablePr, "tblBorders"), theme, warnBorder));
        const styledCells = Object.assign({}, ...tableStyles.map(s => readBorders(child(child(s, "tcPr"), "tcBorders"), theme, warnBorder)));
        if (tableStyles.some(s => children(s, "tblStylePr").length)) warnings.add("表格的条件样式尚未完整还原");
        const rows: WordCellRows = [];
        const rowSettings: WordRowProperties[] = [];
        const defaultRow = Object.assign({}, ...tableStyles.map(s => rowProperties(child(s, "trPr"))));
        const defaultCellPadding = Object.assign({}, ...tableStyles.map(s => cellPadding(child(child(s, "tcPr"), "tcMar"))));
        const defaultVertical = tableStyles.map(s => value(child(s, "tcPr"), "vAlign")).filter(Boolean).at(-1);
        let headerRows = 0;
        for (const row of children(n, "tr")) {
          const trPr = child(row, "trPr");
          if (rows.length === headerRows && enabled(child(trPr, "tblHeader"))) headerRows++;
          rowSettings.push({ ...defaultRow, ...rowProperties(trPr) });
          const cells: WordCell[] = [];
          for (const cell of children(row, "tc")) {
            const pr = child(cell, "tcPr"), merge = child(pr, "vMerge");
            const vertical = value(pr, "vAlign") ?? defaultVertical;
            cells.push({ blocks: await blocks(cell, rels, depth + 1), span: Math.max(1, Math.min(64, number(value(pr, "gridSpan")) ?? 1)),
              merge: merge ? merge.attrs.val === "restart" ? "start" as const : "continue" as const : undefined,
              width: child(pr, "tcW")?.attrs.type === "dxa" ? px(child(pr, "tcW")?.attrs.w) : undefined, background: theme.color(child(pr, "shd"), true),
              borders: { ...styledCells, ...readBorders(child(pr, "tcBorders"), theme, warnBorder) },
              vertical: vertical === "top" || vertical === "center" || vertical === "bottom" ? vertical : undefined,
              padding: { ...defaultCellPadding, ...cellPadding(child(pr, "tcMar")) } });
          }
          rows.push(cells);
        }
        const widths = children(child(n, "tblGrid"), "gridCol").map(c => px(c.attrs.w) ?? 0);
        result.push({ kind: "table", id: `word-${serial++}`, rows, widths, headerRows, borders, rowProperties: rowSettings,
          width: tableWidth?.attrs.type === "dxa" && (px(tableWidth.attrs.w) ?? 0) > 0 ? px(tableWidth?.attrs.w) : widths.reduce((sum, width) => sum + width, 0) || undefined,
          align: align === "center" || align === "right" ? align : "left",
          padding: margin ? { top: px(child(margin, "top")?.attrs.w) ?? 0, right: px(child(margin, "right")?.attrs.w) ?? 0, bottom: px(child(margin, "bottom")?.attrs.w) ?? 0, left: px(child(margin, "left")?.attrs.w) ?? 0 } : undefined });
        warnings.add("表格边框冲突、条件样式和复杂跨页合并尚未完整还原");
      } else if (n.name === "sdt") { const content = child(n, "sdtContent"); if (content) result.push(...await blocks(content, rels, depth + 1)); }
      else if (n.name === "ins" || n.name === "customXml") result.push(...await blocks(n, rels, depth + 1));
      else if (n.name === "altChunk") warnings.add("嵌入的外部文档尚未显示");
    }
    return result;
  }
  type WordCellRows = Extract<WordBlock, { kind: "table" }>["rows"];
  const sections: WordSection[] = []; let pending: XmlNode[] = [];
  const inherited: Pick<WordSection, "header" | "footer" | "firstHeader" | "evenHeader" | "firstFooter" | "evenFooter"> = { header: [], footer: [] };
  const headerCache = new Map<string, WordBlock[]>();
  let numberFormat: WordSection["pageNumberFormat"];
  async function finish(pr: XmlNode | undefined) {
    const page = defaultPage(), size = child(pr, "pgSz"), margins = child(pr, "pgMar");
    page.width = px(size?.attrs.w) ?? page.width; page.height = px(size?.attrs.h) ?? page.height;
    for (const key of ["top", "right", "bottom", "left"] as const) page[key] = Math.abs(px(margins?.attrs[key]) ?? page[key]);
    page.fixedTop = (number(margins?.attrs.top) ?? 0) < 0;
    page.fixedBottom = (number(margins?.attrs.bottom) ?? 0) < 0;
    page.header = px(margins?.attrs.header); page.footer = px(margins?.attrs.footer);
    const grid = child(pr, "docGrid"), pitch = px(grid?.attrs.linePitch), gridType = grid?.attrs.type;
    if (pitch && pitch > 0 && pitch <= page.height && ["lines", "linesAndChars", "snapToChars"].includes(gridType ?? "")) {
      page.grid = { type: gridType as NonNullable<typeof page.grid>["type"], linePitch: pitch };
      if (gridType !== "lines") warnings.add("字符网格暂按行网格对齐，逐字对齐尚未还原");
    }
    if ((number(child(pr, "cols")?.attrs.num) ?? 1) > 1) warnings.add("分栏暂按单栏排列");
    const sectionType = value(pr, "type");
    const breakType = sectionType === "continuous" || sectionType === "evenPage" || sectionType === "oddPage" ? sectionType : "nextPage";
    if (sectionType === "nextColumn") warnings.add("分栏符暂从新页开始");
    for (const type of ["header", "footer"] as const) {
      for (const ref of children(pr, `${type}Reference`)) {
        const key = ref.attrs.type === "first" ? type === "header" ? "firstHeader" : "firstFooter"
          : ref.attrs.type === "even" ? type === "header" ? "evenHeader" : "evenFooter"
          : ref.attrs.type === "default" ? type : undefined;
        if (!key) continue;
        const rel = mainRelations.get(ref.attrs.id ?? "");
        if (!rel || rel.external) continue;
        if (!headerCache.has(rel.part)) {
          const root = child(await xml(rel.part), type === "header" ? "hdr" : "ftr");
          headerCache.set(rel.part, root ? await blocks(root, await relations(rel.part)) : []);
        }
        inherited[key] = headerCache.get(rel.part)!;
      }
    }
    const numbering = child(pr, "pgNumType");
    numberFormat = wordNumberFormat(numbering?.attrs.fmt) ?? numberFormat;
    if (numbering?.attrs.fmt && !wordNumberFormat(numbering.attrs.fmt)) warnings.add("部分页码编号格式暂以数字显示");
    sections.push({ page, blocks: await blocks({ name: "body", attrs: {}, text: "", children: pending }, mainRelations), ...inherited,
      titlePage: enabled(child(pr, "titlePg")) ?? false, evenAndOddHeaders: enabled(child(settings, "evenAndOddHeaders")) ?? false,
      pageNumberStart: number(numbering?.attrs.start), pageNumberFormat: numberFormat, breakType }); pending = [];
  }
  for (const n of body.children) {
    if (n.name === "sectPr") { await finish(n); continue; }
    pending.push(n);
    const pr = n.name === "p" ? child(child(n, "pPr"), "sectPr") : undefined;
    if (pr) await finish(pr);
  }
  if (pending.length || !sections.length) await finish(undefined);
  return { format: "docx", sections, assets, warnings: [...warnings] };
}
