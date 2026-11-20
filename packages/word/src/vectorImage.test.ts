import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./svg";
import { wmfTextSvg } from "./wmf";
import { parseWord } from "./parse";
import { readXml, child, descendants, text } from "./xml";

const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
function record(kind: number, data = Buffer.alloc(0)) {
  const result = Buffer.alloc(6 + data.length + data.length % 2);
  result.writeUInt32LE(result.length / 2, 0); result.writeUInt16LE(kind, 4); data.copy(result, 6); return result;
}
const word = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const pair = (x: number, y: number) => { const b = Buffer.alloc(4); b.writeInt16LE(y); b.writeInt16LE(x, 2); return b; };
function wmf(extra: Buffer[] = [], charset = 0, face = "Times New Roman", letters = Buffer.from(",.")) {
  const font = Buffer.alloc(50); font.writeInt16LE(-32); font.writeInt16LE(400, 8); font[13] = charset; font.write(face, 18);
  const move = Buffer.alloc(4); move.writeInt16LE(20); move.writeInt16LE(7, 2);
  const label = Buffer.alloc(14); label.writeInt16LE(900); label.writeInt16LE(900, 2); label.writeUInt16LE(2, 4); letters.copy(label, 8); label.writeInt16LE(16, 10); label.writeInt16LE(12, 12);
  const records = [record(0x0102, word(1)), record(0x012e, word(25)), record(0x0214, move), record(0x02fb, font), record(0x012d, word(0)), ...extra, record(0x0a32, label), record(0)];
  return metafile(records);
}
function metafile(records: Buffer[], objects = 1) {
  const header = Buffer.alloc(40); header.writeUInt32LE(0x9ac6cdd7); header.writeInt16LE(100, 10); header.writeInt16LE(100, 12); header.writeUInt16LE(1440, 14);
  let sum = 0; for (let i = 0; i < 20; i += 2) sum ^= header.readUInt16LE(i); header.writeUInt16LE(sum, 20);
  header.writeUInt16LE(1, 22); header.writeUInt16LE(9, 24); header.writeUInt16LE(0x300, 26); header.writeUInt32LE((18 + records.reduce((n, b) => n + b.length, 0)) / 2, 28); header.writeUInt16LE(objects, 32);
  return Buffer.concat([header, ...records]);
}
function fontRecord(width = 0, charset = 0) {
  const data = Buffer.alloc(50); data.writeInt16LE(-32); data.writeInt16LE(width, 2); data.writeInt16LE(400, 8); data[13] = charset; data.write("Times New Roman", 18);
  return record(0x02fb, data);
}
function textRecord(bytes: Buffer, dx: number[]) {
  const data = Buffer.alloc(8 + bytes.length + bytes.length % 2 + dx.length * 2); data.writeUInt16LE(bytes.length, 4); bytes.copy(data, 8);
  dx.forEach((n, i) => data.writeInt16LE(n, 8 + bytes.length + bytes.length % 2 + i * 2));
  return record(0x0a32, data);
}
function penRecord(width: number, style = 0) {
  const data = Buffer.alloc(10); data.writeUInt16LE(style); data.writeInt16LE(width, 2); data.writeUInt32LE(0x00563412, 6); return record(0x02fa, data);
}

describe("independent vector image previews", () => {
  it("preserves SVG paths, local paint references and the order of mixed text without changing source bytes", () => {
    const source = encode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="30" viewBox="0 0 100 30"><defs><linearGradient id="ink"><stop offset="0" stop-color="#123456"/></linearGradient></defs><path d="M0 0L100 30" fill="url(#ink)"/><text>A<tspan>B</tspan>C &amp; D</text></svg>');
    const before = source.slice(), result = sanitizeSvg(source)!;
    expect(source).toEqual(before); expect(result.partial).toBe(false);
    const svg = readXml(decode(result.bytes));
    expect(child(svg, "svg")?.attrs.viewBox).toBe("0 0 100 30");
    expect(descendants(svg, "path")[0]?.attrs.fill).toBe("url(#ink)");
    expect(decode(result.bytes)).toContain('<text>A<tspan>B</tspan>C &amp; D</text>');
    const stretched = sanitizeSvg(source, true)!;
    expect(child(readXml(decode(stretched.bytes)), "svg")?.attrs.preserveAspectRatio).toBe("none");
    expect(stretched.partial).toBe(false);
  });

  it("removes active content and external resource references, and rejects entity declarations or malformed SVG", () => {
    const source = encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><div>HTML</div></foreignObject><image href="https://example.com/a.png"/><path d="M0 0L1 1" style="stroke:url(https://example.com/a.svg);fill:#123456"/><use href="#safe"/></svg>');
    const result = sanitizeSvg(source)!;
    expect(result.partial).toBe(true);
    const svg = readXml(decode(result.bytes));
    expect(descendants(svg, "script")).toEqual([]); expect(descendants(svg, "foreignObject")).toEqual([]);
    expect(child(svg, "svg")?.attrs.onload).toBeUndefined();
    expect(descendants(svg, "image")[0]?.attrs.href).toBeUndefined();
    expect(descendants(svg, "use")[0]?.attrs.href).toBe("#safe");
    expect(decode(result.bytes)).not.toContain("https:");
    expect(sanitizeSvg(encode('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>'))).toBeUndefined();
    expect(sanitizeSvg(encode("<svg><path>"))).toBeUndefined();
  });

  it("converts WMF text at its current baseline with recorded character advances, ignoring non-painting comments", () => {
    const comment = Buffer.concat([word(15), word(8), Buffer.from("MathType")]);
    const source = wmf([record(0x0626, comment)]), before = Buffer.from(source), result = wmfTextSvg(source)!;
    expect(source.equals(before)).toBe(true);
    const svg = readXml(decode(result)), label = descendants(svg, "text")[0]!;
    expect(child(svg, "svg")?.attrs.viewBox).toBe("0 0 100 100");
    expect(label.attrs).toMatchObject({ x: "7", y: "20", "font-family": "Times New Roman", "font-size": "32", "dominant-baseline": "alphabetic" });
    expect(descendants(svg, "tspan").map(n => ({ x: n.attrs.x, text: text(n) }))).toEqual([{ x: "7", text: "," }, { x: "23", text: "." }]);
    expect(decode(result)).not.toContain("MathType");
  });

  it("rejects unsupported WMF drawing records, symbol encodings, invalid checksums and truncated record streams", () => {
    expect(wmfTextSvg(wmf([record(0x0325, Buffer.alloc(4))]))).toBeUndefined();
    expect(wmfTextSvg(wmf([], 2))).toBeUndefined();
    const bad = wmf(); bad[20]! ^= 1;
    expect(wmfTextSvg(bad)).toBeUndefined();
    expect(wmfTextSvg(wmf().subarray(0, -2))).toBeUndefined();
    const size = wmf(); size.writeUInt32LE(0x7fffffff, 40);
    expect(wmfTextSvg(size)).toBeUndefined();
  });

  it.each([[10, 11, 12, 13, 14, 15], [10, 23, 27, 15]])("positions mixed GBK text with byte-based or character-based advances (%j)", (...dx) => {
    const glyphs = Buffer.from([0x41, 0xb4, 0xdf, 0xbb, 0xaf, 0x42]); // A催化B
    const source = wmf([textRecord(glyphs, dx)], 134), before = Buffer.from(source);
    const svg = readXml(decode(wmfTextSvg(source)!));
    expect(descendants(svg, "tspan").map(n => ({ text: text(n), x: Number(n.attrs.x) }))).toEqual([
      { text: "A", x: 7 }, { text: "催", x: 17 }, { text: "化", x: 40 }, { text: "B", x: 67 }, { text: ",", x: 82 }, { text: ".", x: 98 },
    ]);
    expect(source.equals(before)).toBe(true);
  });

  it("rejects incomplete multibyte characters and advances that cannot be assigned to the decoded characters", () => {
    expect(wmfTextSvg(wmf([textRecord(Buffer.from([0xb4]), [10])], 134))).toBeUndefined();
    expect(wmfTextSvg(wmf([textRecord(Buffer.from([0x41, 0xb4, 0xdf, 0xbb, 0xaf, 0x42]), [10, 20])], 134))).toBeUndefined();
  });

  it("scales width-constrained glyphs while preserving recorded origins and refuses missing font metrics", () => {
    const source = metafile([record(0x0102, word(1)), record(0x012e, word(25)), record(0x0214, pair(7, 20)), fontRecord(8), record(0x012d, word(0)), textRecord(Buffer.from("AB"), [16, 12]), record(0)]);
    const svg = readXml(decode(wmfTextSvg(source, () => 16)!)), label = descendants(svg, "text")[0]!;
    const scale = Number(label.attrs.transform!.match(/scale\(([^ ]+)/)![1]);
    expect(scale).toBe(.5);
    expect(descendants(svg, "tspan").map(t => Number(t.attrs.x) * scale)).toEqual([7, 23]);
    expect(Number(label.attrs.y)).toBe(20);
    expect(wmfTextSvg(source, () => undefined)).toBeUndefined();
    expect(wmfTextSvg(source, () => 0)).toBeUndefined();
  });

  it("shares font and pen slots while keeping their selected states independent, including text/line current position", () => {
    const source = metafile([record(0x0102, word(1)), record(0x012e, word(25)), fontRecord(), penRecord(3), record(0x012d, word(0)), record(0x012d, word(1)),
      record(0x0214, pair(7, 20)), record(0x0213, pair(30, 40)), textRecord(Buffer.from("AB"), [16, 12]), record(0x0213, pair(60, 50)),
      record(0x012d, word(0x8008)), record(0x01f0, word(1)), fontRecord(), record(0x012d, word(1)), textRecord(Buffer.from("C"), [5]), record(0)], 2);
    const before = Buffer.from(source), svg = readXml(decode(wmfTextSvg(source)!));
    expect(descendants(svg, "line").map(l => [l.attrs.x1, l.attrs.y1, l.attrs.x2, l.attrs.y2, l.attrs.stroke, l.attrs["stroke-width"]])).toEqual([
      ["7", "20", "30", "40", "#123456", "3"], ["58", "40", "60", "50", "#123456", "3"],
    ]);
    expect(descendants(svg, "text").map(t => [t.attrs.x, t.attrs.y, text(t)])).toEqual([["30", "40", "AB"], ["60", "50", "C"]]);
    expect(source.equals(before)).toBe(true);
  });

  it("keeps already painted text when an old producer understates the object-slot count", () => {
    const source = metafile([record(0x0102, word(1)), record(0x012e, word(25)), fontRecord(), record(0x012d, word(0)), textRecord(Buffer.from("A"), [16]),
      fontRecord(), record(0x012d, word(1)), record(0x01f0, word(0)), record(0)], 1);
    expect(descendants(readXml(decode(wmfTextSvg(source)!)), "text").map(text)).toEqual(["A"]);
    expect(wmfTextSvg(metafile([record(0x012d, word(123)), record(0)], 1))).toBeUndefined();
  });

  it("reads a complete WMF payload with appended producer bytes while enforcing its declared end and EOF", () => {
    const plain = wmf(), source = Buffer.concat([plain, Buffer.from("trailing producer data"), record(0x0325)]), before = Buffer.from(source);
    expect(wmfTextSvg(source)).toEqual(wmfTextSvg(plain));
    expect(source.equals(before)).toBe(true);
    const short = Buffer.from(plain); short.writeUInt32LE(short.readUInt32LE(28) - 1, 28);
    expect(wmfTextSvg(short)).toBeUndefined();
    const earlyEnd = Buffer.from(source); earlyEnd.writeUInt32LE((earlyEnd.length - 22) / 2, 28);
    expect(wmfTextSvg(earlyEnd)).toBeUndefined();
  });

  it("advances through null-pen segments and draws hairlines, but rejects unsupported pen styles and unknown positions", () => {
    const source = metafile([record(0x012d, word(0x8008)), record(0x0214, pair(7, 20)), record(0x0213, pair(30, 40)), record(0x012d, word(0x8007)), record(0x0213, pair(60, 50)), record(0)], 0);
    const lines = descendants(readXml(decode(wmfTextSvg(source)!)), "line");
    expect(lines).toHaveLength(1); expect(lines[0]!.attrs).toMatchObject({ x1: "30", y1: "40", "stroke-width": "1", "vector-effect": "non-scaling-stroke" });
    expect(wmfTextSvg(wmf([penRecord(1, 1)]))).toBeUndefined();
    expect(wmfTextSvg(wmf([record(0x0213, word(1))]))).toBeUndefined();
    expect(wmfTextSvg(metafile([record(0x0102, word(1)), record(0x012e, word(25)), fontRecord(), record(0x012d, word(0)), textRecord(Buffer.from("A"), []), record(0x0213, pair(10, 10)), record(0)]))).toBeUndefined();
  });

  it("maps the window origin, viewport and nonuniform extents together with baseline and character advances", () => {
    const source = wmf([record(0x0103, word(8)), record(0x020b, pair(10, 20)), record(0x020c, pair(200, 50)),
      record(0x020d, pair(30, 40)), record(0x020e, pair(100, 200)), record(0x0214, pair(30, 25))]);
    const before = Buffer.from(source), result = readXml(decode(wmfTextSvg(source)!));
    const matrix = descendants(result, "g")[0]!.attrs.transform!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const [sx, , , sy, tx, ty] = matrix;
    const label = descendants(result, "text")[0]!;
    expect(Number(label.attrs.x) * sx! + tx!).toBe(40);
    expect(Number(label.attrs.y) * sy! + ty!).toBe(60);
    expect(Number(label.attrs["font-size"]) * sy!).toBe(128);
    expect(descendants(result, "tspan").map(n => Number(n.attrs.x) * sx! + tx!)).toEqual([40, 48]);
    expect(source.equals(before)).toBe(true);
  });

  it("freezes each painted run's mapping and rejects zero, mirrored or unsupported mapping modes", () => {
    const first = Buffer.alloc(14); first.writeUInt16LE(2, 4); first.write("ab", 8); first.writeInt16LE(16, 10); first.writeInt16LE(12, 12);
    const svg = child(readXml(decode(wmfTextSvg(wmf([record(0x0a32, first), record(0x020c, pair(200, 50))]))!)), "svg")!;
    expect(svg.children.map(c => c.name)).toEqual(["text", "g"]);
    expect(descendants(svg, "text").map(t => t.attrs.x)).toEqual(["7", "35"]);
    expect(wmfTextSvg(wmf([record(0x020c, pair(0, 10))]))).toBeUndefined();
    expect(wmfTextSvg(wmf([record(0x020e, pair(-100, 100))]))).toBeUndefined();
    expect(wmfTextSvg(wmf([record(0x0103, word(1))]))).toBeUndefined();
    expect(wmfTextSvg(wmf([record(0x020b, word(0))]))).toBeUndefined();
  });

  it("decodes Symbol glyphs by font name even with a Latin charset, and refuses unknown symbol-font glyphs", () => {
    const label = (codes: number[], face = "Symbol", charset = 1) => wmfTextSvg(wmf([], charset, face, Buffer.from(codes)));
    expect(descendants(readXml(decode(label([0xb4, 0xd7])!)), "text").map(text)).toEqual(["×⋅"]);
    expect(descendants(readXml(decode(label([0x44, 0x62], "Symbol", 2)!)), "text").map(text)).toEqual(["Δβ"]);
    expect(descendants(readXml(decode(label([0x2d, 0xae])!)), "text").map(text)).toEqual(["−→"]);
    expect(label([0xbe, 0x20])).toBeUndefined(); // Font-specific arrow extender, not the fraction ¾.
    expect(label([0x88, 0x86], "MT Extra")).toBeUndefined();
  });

  it("keeps unreadable inline/VML pictures at their display size and leaves missing anchored pictures attached to their anchor", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", '<w:document xmlns:w="w" xmlns:a="a" xmlns:wp="wp" xmlns:v="v" xmlns:r="r"><w:body><w:p><w:r><w:t>前</w:t><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><wp:docPr descr="公式 &amp; 图"/><a:blip r:embed="missing"/></wp:inline></w:drawing><w:pict><v:shape style="width:36pt;height:18pt"><v:imagedata r:id="missing"/></v:shape></w:pict><w:drawing><wp:anchor><wp:extent cx="914400" cy="457200"/><wp:wrapNone/><wp:positionH relativeFrom="margin"><wp:posOffset>95250</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>190500</wp:posOffset></wp:positionV><a:blip r:embed="missing"/></wp:anchor></w:drawing><w:t>后</w:t></w:r></w:p></w:body></w:document>');
    const bytes = await zip.generateAsync({ type: "uint8array" }), before = bytes.slice(), model = await parseWord(bytes);
    const p = model.sections[0]!.blocks[0]!; if (p.kind !== "paragraph") throw Error("missing paragraph");
    expect(p.inlines).toMatchObject([{ kind: "text", text: "前" }, { kind: "image-placeholder", width: 96, height: 48, alt: "公式 & 图" }, { kind: "image-placeholder", width: 48, height: 24 }, { kind: "text", text: "后" }]);
    expect(p.drawings).toMatchObject([{ width: 96, height: 48, x: { offset: 10 }, y: { offset: 20 }, content: { kind: "image-placeholder" } }]);
    expect(model.assets).toEqual([]);
    expect(model.warnings).toContain("外链图片或缺失的配图未加载");
    expect(bytes).toEqual(before);
  });

  it("uses a readable alternate picture once, prefers a native SVG extension, and preserves image dimensions and surrounding text", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", '<w:document xmlns:w="w" xmlns:a="a" xmlns:r="r" xmlns:wp="wp" xmlns:mc="mc" xmlns:v="v" xmlns:asvg="asvg"><w:body><w:p><w:r><w:t>前</w:t><mc:AlternateContent><mc:Choice><w:drawing><wp:extent cx="457200" cy="228600"/><a:blip r:embed="emf"/></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape style="width:36pt;height:18pt"><v:imagedata r:id="png"/></v:shape></w:pict></mc:Fallback></mc:AlternateContent><w:drawing><wp:extent cx="914400" cy="228600"/><a:blip r:embed="png"><a:extLst><a:ext><asvg:svgBlip r:embed="svg"/></a:ext></a:extLst></a:blip></w:drawing><w:drawing><wp:extent cx="50800" cy="88900"/><a:blip r:embed="wmf"/></w:drawing><w:t>后</w:t></w:r></w:p></w:body></w:document>');
    zip.file("word/_rels/document.xml.rels", '<Relationships>'+["png", "svg", "wmf", "emf"].map(ext => `<Relationship Id="${ext}" Target="media/image.${ext}"/>`).join("")+'</Relationships>');
    zip.file("word/media/image.png", new Uint8Array([137, 80, 78, 71]));
    zip.file("word/media/image.emf", new Uint8Array([0, 0, 0, 0]));
    zip.file("word/media/image.svg", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 25"><path d="M0 0L100 25"/></svg>');
    zip.file("word/media/image.wmf", wmf());
    const bytes = await zip.generateAsync({ type: "uint8array" }), before = bytes.slice(), model = await parseWord(bytes);
    expect(bytes).toEqual(before); expect(model.warnings).toEqual([]);
    const p = model.sections[0]!.blocks[0]!; if (p.kind !== "paragraph") throw Error("missing paragraph");
    expect(p.inlines).toMatchObject([{ kind: "text", text: "前" }, { kind: "image", width: 48, height: 24 }, { kind: "image", width: 96, height: 24 }, { kind: "image", width: 50800 / 9525, height: 88900 / 9525 }, { kind: "text", text: "后" }]);
    expect(model.assets.map(a => a.mime)).toEqual(["image/png", "image/svg+xml", "image/svg+xml"]);
  });
});
