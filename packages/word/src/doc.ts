import { Binary, openCompound } from "./compound";
import { defaultPage, paragraph, type TextStyle, type WordCell, type WordDocument, type WordParagraph, type WordTable, type WordNumberFormat, type WordSection } from "./model";
import { pageField, paragraphLineSpacing } from "./format";
import { createDocNumbering } from "./docNumbering";
import { properties, paragraphProperties, type DocProperty as Property } from "./docProperties";
import { readDocTableRow, finishDocTable, type DocTableRow } from "./docTable";
import { addDocPicture, readDocPicture, readDocFloatingPictures } from "./docImages";
import { equationNativeData } from "./mathtype";
import { mtefToLatex } from "./mtef";
interface FormatRange { from: number; to: number; styleId: number; props: Property[] }
const palette = ["000000", "000000", "0000ff", "00ffff", "00ff00", "ff00ff", "ff0000", "ffff00", "ffffff", "000080", "008080", "008000", "800080", "800000", "808000", "808080", "c0c0c0"];
const color = (data: Binary) => `#${[0, 1, 2].map(i => data.u8(i).toString(16).padStart(2, "0")).join("")}`;
function applyText(style: TextStyle, props: Property[], fonts: string[]): TextStyle {
  const result = { ...style };
  for (const { code, data: d } of props) {
    const toggle = (old: boolean | undefined) => d.u8(0) === 128 ? old : d.u8(0) === 129 ? !old : d.u8(0) === 1;
    switch (code) {
      case 0x0835: result.bold = toggle(result.bold); break;
      case 0x0836: result.italic = toggle(result.italic); break;
      case 0x0837: result.strike = toggle(result.strike); break;
      case 0x2a3e: result.underline = d.u8(0) > 0; break;
      case 0x4a43: result.size = d.u16(0) * 2 / 3; break;
      case 0x4a4f: case 0x4a50: case 0x4a51: if (fonts[d.u16(0)]) result.font = fonts[d.u16(0)]; break;
      case 0x2a42: result.color = `#${palette[d.u8(0)] ?? "000000"}`; break;
      case 0x6870: result.color = color(d); break;
      case 0x2a48: result.vertical = d.u8(0) === 1 ? "super" : d.u8(0) === 2 ? "sub" : undefined; break;
      case 0x8840: result.spacing = d.i16(0) / 15; break;
    }
  }
  return result;
}

/** Word 97–2003, according to MS-CFB and MS-DOC. */
export async function parseDoc(bytes: Uint8Array, options: { includeEquations?: boolean } = {}): Promise<WordDocument> {
  const sources = openCompound(bytes), streams = new Map<string, Uint8Array>();
  for (const name of ["WordDocument", "0Table", "1Table", "Data", "EncryptionInfo", "EncryptedPackage"]) {
    const read = sources.get(name); if (read) streams.set(name, read());
  }
  if (streams.has("EncryptedPackage") || streams.has("EncryptionInfo")) throw new Error("这份 Word 文件有密码保护，暂时无法预览。");
  const wordBytes = streams.get("WordDocument"); if (!wordBytes) throw new Error("DOC 缺少正文数据流。");
  const word = new Binary(wordBytes);
  if (word.u16(0) !== 0xa5ec || word.u16(2) < 0xc1) throw new Error("目前支持 Word 97–2003 的 DOC 文件。");
  const flags = word.u16(10);
  if (flags & 0x8100) throw new Error("这份 DOC 有密码保护，暂时无法预览。");
  const tableBytes = streams.get(flags & 0x0200 ? "1Table" : "0Table");
  if (!tableBytes) throw new Error("DOC 缺少索引数据流。");
  const table = new Binary(tableBytes);
  const papProperties = paragraphProperties(streams.get("Data"));
  let offset = 32 + 2 + word.u16(32) * 2;
  const lw = offset + 2, lwCount = word.u16(offset); offset += 2 + lwCount * 4;
  const pairCount = word.u16(offset), pairs = offset + 2;
  if (lwCount < 4 || pairCount < 34) throw new Error("DOC 文件索引不完整。");
  const textLength = word.u32(lw + 3 * 4);
  if (textLength > 16 * 1024 * 1024) throw new Error("DOC 正文过大。");
  const pair = (index: number): Binary => {
    if (index >= pairCount) return new Binary(new Uint8Array());
    return new Binary(table.slice(word.u32(pairs + index * 8), word.u32(pairs + index * 8 + 4)));
  };
  const warnings = new Set<string>();
  // Unlike other FIB entries, lcbPlfLst covers only the LSTF headers. Its
  // variable LVLs follow them, bounded by the next declared Table-stream part.
  let listRegion: Uint8Array = new Uint8Array(), listHeaderLength = 0;
  if (pairCount > 73 && word.u32(pairs + 73 * 8 + 4)) {
    const first = word.u32(pairs + 73 * 8); listHeaderLength = word.u32(pairs + 73 * 8 + 4);
    let end = table.bytes.length;
    for (let i = 0; i < pairCount; i++) {
      const fc = word.u32(pairs + i * 8);
      if (word.u32(pairs + i * 8 + 4) && fc > first) end = Math.min(end, fc);
    }
    try { listRegion = table.slice(first, end - first); } catch { warnings.add("DOC 列表定义不完整，部分编号未还原"); }
  }
  let listOverrides: Uint8Array = new Uint8Array();
  try { listOverrides = pair(74).bytes; } catch { warnings.add("DOC 列表定义不完整，部分编号未还原"); }
  const numbering = createDocNumbering(listRegion, listHeaderLength, listOverrides, message => warnings.add(message));
  const clx = pair(33);
  let clxAt = 0;
  while (clx.u8(clxAt) === 1) clxAt += 3 + clx.u16(clxAt + 1);
  if (clx.u8(clxAt) !== 2) throw new Error("DOC 正文位置索引无效。");
  const plc = new Binary(clx.slice(clxAt + 5, clx.u32(clxAt + 1)));
  const count = (plc.bytes.length - 4) / 12;
  if (!Number.isInteger(count) || count < 1) throw new Error("DOC 正文位置索引无效。");
  const pieces: { cp: number; end: number; fc: number; step: number; text: string }[] = [];
  for (let i = 0; i < count; i++) {
    const cp = plc.u32(i * 4), end = plc.u32((i + 1) * 4), raw = plc.u32((count + 1) * 4 + i * 8 + 2);
    if (end < cp || (i > 0 && cp !== pieces[i - 1]!.end) || end - cp > 16 * 1024 * 1024) throw new Error("DOC 文字区间无效。");
    const step = raw & 0x40000000 ? 1 : 2, fc = (raw & 0x3fffffff) / (step === 1 ? 2 : 1);
    const content = word.slice(fc, (end - cp) * step);
    pieces.push({ cp, end, fc, step, text: new TextDecoder(step === 1 ? "windows-1252" : "utf-16le").decode(content) });
    if (plc.u16((count + 1) * 4 + i * 8 + 6)) warnings.add("部分旧版快速保存格式尚未还原");
  }
  if (pieces[0]?.cp !== 0 || pieces.at(-1)!.end < textLength) throw new Error("DOC 正文不完整。");
  const content = pieces.map(p => p.text).join("").slice(0, textLength);

  function formats(index: number, pap: boolean): FormatRange[] {
    const bte = pair(index), n = (bte.bytes.length - 4) / 8;
    if (!bte.bytes.length) return [];
    if (!Number.isInteger(n) || n < 0) throw new Error("DOC 格式索引无效。");
    const result: FormatRange[] = [];
    for (let i = 0; i < n; i++) {
      const page = new Binary(word.slice((bte.u32((n + 1) * 4 + i * 4) & 0x003fffff) * 512, 512));
      const runs = page.u8(511);
      if (runs > (pap ? 29 : 101)) throw new Error("DOC 格式页无效。");
      for (let j = 0; j < runs; j++) {
        const from = page.u32(j * 4), to = page.u32((j + 1) * 4), pos = page.u8((runs + 1) * 4 + j * (pap ? 13 : 1)) * 2;
        let data: Uint8Array = new Uint8Array(), styleId = 0;
        if (pos) {
          let start = pos + 1, length = page.u8(pos);
          if (pap) {
            if (length) length = length * 2 - 1;
            else { length = page.u8(start) * 2; start++; }
            if (length < 2) throw new Error("DOC 段落格式无效。");
            styleId = page.u16(start); start += 2; length -= 2;
          }
          data = page.slice(start, length);
        }
        result.push({ from, to, styleId, props: pap ? papProperties(data) : properties(data) });
      }
    }
    return result.sort((a, b) => a.from - b.from);
  }
  const chps = formats(12, false), paps = formats(13, true);
  const find = (ranges: FormatRange[], fc: number): FormatRange | undefined => {
    let low = 0, high = ranges.length;
    while (low < high) { const mid = (low + high) >>> 1; if (ranges[mid]!.from <= fc) low = mid + 1; else high = mid; }
    const item = ranges[low - 1]; return item && fc < item.to ? item : undefined;
  };
  const fonts: string[] = [];
  const ffn = pair(15);
  if (ffn.bytes.length >= 4) {
    const n = ffn.u16(0), extra = ffn.u16(2); let at = 4;
    for (let i = 0; i < n; i++) {
      const length = ffn.u8(at) + 1;
      if (length < 40) throw new Error("DOC 字体表无效。");
      fonts.push(new TextDecoder("utf-16le").decode(ffn.slice(at + 40, length - 40)).split("\0")[0]!);
      at += length + extra;
    }
  }
  // STSH styles: store property groups, resolve the based-on chain without cycles.
  const styles = new Map<number, { base: number; para: Property[]; run: Property[] }>();
  const stsh = pair(1);
  if (stsh.bytes.length >= 8) {
    const header = stsh.u16(0), n = stsh.u16(2), baseSize = stsh.u16(4); let at = 2 + header;
    for (let id = 0; id < n; id++) {
      const length = stsh.u16(at); at += 2; if (!length) continue;
      const std = new Binary(stsh.slice(at, length)); at += length;
      if (length < baseSize + 2 || baseSize < 6) continue;
      const kind = std.u16(2) & 15, base = std.u16(2) >>> 4, groups = std.u16(4) & 15;
      let cursor = baseSize + 2 + (std.u16(baseSize) + 1) * 2;
      const style = { base, para: [] as Property[], run: [] as Property[] };
      for (let g = 0; g < groups; g++) {
        if (cursor % 2) cursor++;
        const size = std.u16(cursor); cursor += 2;
        const data = std.slice(cursor, size); cursor += size;
        if (kind === 1 && g === 0) style.para = properties(data.subarray(2));
        else if ((kind === 1 && g === 1) || (kind === 2 && g === 0)) style.run = properties(data);
      }
      styles.set(id, style);
    }
  }
  function inherited(id: number, seen = new Set<number>()): { para: Property[]; run: Property[] } {
    const s = styles.get(id); if (!s || seen.has(id)) return { para: [], run: [] };
    seen.add(id); const parent = inherited(s.base, seen);
    return { para: [...parent.para, ...s.para], run: [...parent.run, ...s.run] };
  }
  const doc: WordDocument = { format: "doc", sections: [], assets: [], warnings: [] };
  let floating = new Map<number, Awaited<ReturnType<typeof readDocPicture>>>();
  try { if (pair(40).bytes.length) floating = await readDocFloatingPictures(pair(50), pair(40), word); }
  catch { warnings.add("DOC 部分浮动配图未能提取，请对照原稿核对。"); }
  const pictures = new Map<number, ReturnType<typeof readDocPicture>>();
  const picture = (location: number) => {
    if (!pictures.has(location)) pictures.set(location, readDocPicture(streams.get("Data"), location).catch(() => undefined));
    return pictures.get(location)!;
  };
  const sectionEnds: (Pick<WordSection, "page" | "pageNumberStart" | "pageNumberFormat" | "breakType"> & { end: number })[] = [];
  const sed = pair(6);
  if (sed.bytes.length) {
    const n = (sed.bytes.length - 4) / 16;
    if (!Number.isInteger(n) || n < 0) throw new Error("DOC 分节索引无效。");
    for (let i = 0; i < n; i++) {
      const page = defaultPage(), fc = sed.u32((n + 1) * 4 + i * 12 + 2);
      let restart = false, start = 0, numberFormat: WordNumberFormat | undefined;
      let breakType: WordSection["breakType"] = "nextPage";
      if (fc !== 0xffffffff) for (const { code, data: d } of properties(word.slice(fc + 2, word.u16(fc)))) {
        const key = ({ 0xb01f: "width", 0xb020: "height", 0xb021: "left", 0xb022: "right", 0x9023: "top", 0x9024: "bottom", 0xb017: "header", 0xb018: "footer" } as Record<number, "width" | "height" | "left" | "right" | "top" | "bottom" | "header" | "footer">)[code];
        if (key) page[key] = Math.abs(code === 0x9023 || code === 0x9024 ? d.i16(0) : d.u16(0)) / 15;
        if (code === 0x9023) page.fixedTop = d.i16(0) < 0;
        if (code === 0x9024) page.fixedBottom = d.i16(0) < 0;
        if (code === 0x3011) restart = d.u8(0) === 1;
        if (code === 0x501c || code === 0x7044) start = code === 0x7044 ? d.u32(0) : d.u16(0);
        if (code === 0x300e) numberFormat = (["decimal", "upperRoman", "lowerRoman", "upperLetter", "lowerLetter"] as const)[d.u8(0)];
        if (code === 0x3009) breakType = (["continuous", "nextPage", "nextPage", "evenPage", "oddPage"] as const)[d.u8(0)] ?? "nextPage";
        if (code === 0x500b && d.u16(0)) warnings.add("DOC 分栏暂按单栏排列");
      }
      sectionEnds.push({ end: sed.u32((i + 1) * 4), page, pageNumberStart: restart ? start : undefined, pageNumberFormat: numberFormat, breakType });
    }
  }
  if (!sectionEnds.length) sectionEnds.push({ end: textLength, page: defaultPage() });
  if (pair(11).bytes.length) warnings.add("DOC 页眉页脚暂未还原");
  if (pair(2).bytes.length || pair(4).bytes.length) warnings.add("DOC 脚注和批注暂未还原");
  let sectionIndex = 0, cp = 0, serial = 0;
  let section: WordSection = { ...sectionEnds[0]!, blocks: [], header: [], footer: [] };
  doc.sections.push(section);
  let currentTable: WordTable | undefined, cells: WordCell[] = [], cell: WordCell = { blocks: [], span: 1 };
  let tableRows: (DocTableRow | undefined)[] = [];
  const flushTable = () => {
    if (!currentTable) return;
    if (cell.blocks.length) { cells.push(cell); cell = { blocks: [], span: 1 }; }
    if (cells.length) { currentTable.rows.push(cells); tableRows.push(undefined); cells = []; }
    finishDocTable(currentTable, tableRows, message => warnings.add(message)); tableRows = [];
    currentTable = undefined;
  };
  const physical = (position: number) => {
    let low = 0, high = pieces.length;
    while (low < high) { const mid = (low + high) >>> 1; if (pieces[mid]!.cp <= position) low = mid + 1; else high = mid; }
    const p = pieces[Math.max(0, low - 1)]!;
    return p.fc + (position - p.cp) * p.step;
  };
  const fields: { instruction: string; result: boolean; emitted: boolean; equation?: boolean; suppress?: boolean }[] = [];
  while (cp < content.length) {
    let end = cp;
    while (end < content.length && !["\r", "\x07", "\x0c"].includes(content[end]!)) end++;
    const delimiter = content[end], markFc = physical(Math.min(end, content.length - 1));
    const pf = find(paps, markFc), base = inherited(pf?.styleId ?? 0), props = [...base.para, ...(pf?.props ?? [])];
    let ilfo = 0, depth = 0;
    for (const { code, data } of props) { if (code === 0x460b) ilfo = data.i16(0); if (code === 0x260a) depth = data.u8(0); }
    const emptySectionEnd = end === cp && delimiter === "\x0c"
      && end + 1 >= sectionEnds[sectionIndex]!.end && sectionIndex + 1 < sectionEnds.length;
    // A section mark can inherit list properties without being a numbered
    // paragraph. It must neither display nor consume the next list number.
    const list = emptySectionEnd ? undefined : numbering(ilfo, depth);
    const linked = list?.styleId === undefined ? { para: [], run: [] } : inherited(list.styleId);
    let listRun: Property[] = [];
    if (list) try {
      const listProps = [...linked.para, ...properties(list.paragraph)].filter(p => ilfo >= 0 || ![0x840e, 0x845d, 0x840f, 0x8460].includes(p.code));
      listRun = properties(list.character); props.push(...listProps);
    } catch { warnings.add("DOC 部分列表格式尚未还原"); }
    const p = paragraph(`doc-${serial++}`); p.textStyle = applyText({ size: 16, font: fonts[0] }, base.run, fonts);
    p.textStyle = applyText(p.textStyle, linked.run, fonts);
    if (list) { p.marker = list.marker; p.markerFollow = list.follow; }
    p.styleId = String(pf?.styleId ?? 0);
    let inTable = false, rowEnd = false;
    for (const { code, data: d } of props) {
      switch (code) {
        case 0x2403: case 0x2461: p.style.align = ["left", "center", "right", "justify", "justify"][d.u8(0)] as WordParagraph["style"]["align"]; break;
        case 0x840e: case 0x845d: p.style.left = d.i16(0) / 15; break;
        case 0x840f: case 0x8460: p.style.indent = d.i16(0) / 15; break;
        case 0x840d: case 0x845e: p.style.right = d.i16(0) / 15; break;
        case 0xa413: p.style.before = d.u16(0) / 15; break;
        case 0xa414: p.style.after = d.u16(0) / 15; break;
        case 0x6412: p.style.lineValue = Math.abs(d.i16(0)); p.style.lineRule = d.u16(2) ? "auto" : d.i16(0) < 0 ? "exact" : "atLeast"; break;
        case 0x2407: p.pageBreakBefore = d.u8(0) === 1; break;
        case 0x2406: p.style.keepNext = d.u8(0) === 1; break;
        case 0x2405: p.style.keepLines = d.u8(0) === 1; break;
        case 0x2431: p.style.widowControl = d.u8(0) === 1; break;
        case 0x246d: p.style.contextualSpacing = d.u8(0) === 1; break;
        case 0x2447: p.style.snapToGrid = d.u8(0) === 1; break;
        case 0x2416: inTable = d.u8(0) === 1; break;
        case 0x2417: rowEnd = d.u8(0) === 1; break;
        case 0xc60d: {
          try {
            let at = 0;
            const removed = d.u8(at++), tabs = [...(p.style.tabStops ?? [])];
            for (let i = 0; i < removed; i++) { const position = d.i16(at) / 15; at += 2; const index = tabs.findIndex(t => t.position === position); if (index >= 0) tabs.splice(index, 1); }
            const added = d.u8(at++), positions = Array.from({ length: added }, (_, i) => d.i16(at + i * 2) / 15); at += added * 2;
            for (const position of positions) {
              const descriptor = d.u8(at++), align = descriptor & 7;
              if (![0, 1, 2, 6].includes(align)) { warnings.add("DOC 部分制表位对齐尚未还原"); continue; }
              const index = tabs.findIndex(t => t.position === position); if (index >= 0) tabs.splice(index, 1);
              tabs.push({ position, align: align === 1 ? "center" : align === 2 ? "right" : "left", leader: ([undefined, "dot", "hyphen", "underscore", "heavy", "middleDot"] as const)[descriptor >>> 3 & 7] });
            }
            p.style.tabStops = tabs.sort((a, b) => a.position - b.position);
          } catch { warnings.add("DOC 部分制表位设置尚未还原"); }
          break;
        }
      }
    }
    p.style = paragraphLineSpacing(p.style);
    p.markStyle = applyText(p.textStyle, find(chps, markFc)?.props ?? [], fonts);
    if (list) p.markerStyle = applyText(p.markStyle, listRun, fonts);
    let runText = "", runStyle: TextStyle = p.textStyle;
    const flush = () => { if (runText) p.inlines.push({ kind: "text", text: runText, style: runStyle }); runText = ""; };
    for (let i = cp; i < end; i++) {
      const c = content[i]!, chp = find(chps, physical(i)), runProps = [...base.run, ...(chp?.props ?? [])], style = applyText(p.textStyle, chp?.props ?? [], fonts);
      const current = fields.at(-1);
      if (c === "\x13") { flush(); fields.push({ instruction: "", result: false, emitted: false }); continue; }
      if (c === "\x14") {
        flush();
        if (current) {
          current.result = true;
          const location = runProps.findLast(prop => prop.code === 0x6a03)?.data.u32(0);
          const ole = runProps.findLast(prop => prop.code === 0x080a)?.data.u8(0);
          if (ole === 1 && location !== undefined && !fields.some(f => f.suppress)) {
            const read = sources.get(`ObjectPool/_${location}/Equation Native`) ?? sources.get(`ObjectPool/_${location | 0}/Equation Native`);
            current.equation = Boolean(read) || /^\s*EMBED\s+(?:Equation\.|MathType)/i.test(current.instruction);
            if (current.equation && !read && options.includeEquations) warnings.add("DOC 有一个嵌入公式缺少可编辑数据，已优先保留公式预览图。");
            if (read && options.includeEquations) {
              try {
                const latex = mtefToLatex(equationNativeData(read()));
                if (!latex) throw Error("Empty equation");
                p.inlines.push({ kind: "math", mathml: "", latex, source: "mathtype" }); current.emitted = current.suppress = true;
              } catch { warnings.add("DOC 有一个嵌入公式未能可靠提取，已优先保留公式预览图。"); }
            }
          }
        }
        continue;
      }
      if (c === "\x15") {
        flush(); const field = current && pageField(current.instruction);
        if (field && !current!.emitted && !fields.some(f => f.suppress)) p.inlines.push({ ...field, style });
        if (current?.equation && !current.emitted) {
          p.inlines.push({ kind: "image-placeholder", alt: "公式待核对", mathType: true });
          warnings.add("DOC 有一个嵌入公式缺少可用预览图，请对照原稿核对。");
        }
        fields.pop(); continue;
      }
      if (current && !current.result) { current.instruction += c; continue; }
      if (fields.some(f => f.suppress)) continue;
      const field = current && pageField(current.instruction);
      if (field) { flush(); if (!current!.emitted) p.inlines.push({ ...field, style }); current!.emitted = true; continue; }
      if (JSON.stringify(style) !== JSON.stringify(runStyle)) { flush(); runStyle = style; }
      if (c === "\x01" || c === "\x08") {
        flush();
        const location = runProps.findLast(prop => prop.code === 0x6a03)?.data.u32(0);
        const binary = runProps.findLast(prop => prop.code === 0x0806)?.data.u8(0) === 1;
        const image = addDocPicture(c === "\x08" ? floating.get(i) : !binary && location !== undefined ? await picture(location) : undefined, doc.assets, current?.equation);
        p.inlines.push(image ?? { kind: "image-placeholder", alt: current?.equation ? "公式待核对" : "配图或嵌入对象待核对", ...(current?.equation ? { mathType: true } : {}) });
        if (image && c === "\x08") warnings.add("DOC 浮动配图已按正文锚点保留，文字环绕暂未还原。");
        if (!image) warnings.add("DOC 有配图或嵌入对象未能提取，请对照原稿核对。");
        if (current?.equation) current.emitted = true;
      } else if (c === "\x0b" || c === "\x0e") runText += "\n";
      else if (c >= " " || c === "\t") runText += c;
    }
    flush();
    if (delimiter === "\x0c") {
      if (end + 1 >= sectionEnds[sectionIndex]!.end && sectionIndex + 1 < sectionEnds.length) p.sectionBreakAfter = true;
      else p.pageBreakAfter = true;
    }
    if (inTable) {
      if (!currentTable) { currentTable = { kind: "table", id: `doc-table-${serial++}`, rows: [], widths: [], headerRows: 0, legacyGrid: true }; section.blocks.push(currentTable); }
      if (!rowEnd || p.inlines.length) cell.blocks.push(p);
      if (delimiter === "\x07" && !rowEnd) { cells.push(cell); cell = { blocks: [], span: 1 }; }
      if (rowEnd) {
        if (cell.blocks.length) cells.push(cell);
        tableRows.push(readDocTableRow(props, cells)); currentTable.rows.push(cells);
        cells = []; cell = { blocks: [], span: 1 };
      }
    } else { flushTable(); section.blocks.push(p); }
    cp = end + 1;
    if (cp >= sectionEnds[sectionIndex]!.end && sectionIndex + 1 < sectionEnds.length) {
      flushTable(); sectionIndex++;
      section = { ...sectionEnds[sectionIndex]!, blocks: [], header: [], footer: [] }; doc.sections.push(section);
    }
  }
  flushTable();
  doc.warnings = [...warnings]; return doc;
}
