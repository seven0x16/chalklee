import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { parseWord } from "./parse";
import { Binary, openCompound, readCompound } from "./compound";
import { readDocPicture, readDocFloatingPictures } from "./docImages";
import { compoundFixture, docFixture, join, nativeEquationFixture, officeArt, pictureFixture, pngBlip, pngFixture, sprm } from "../test-fixtures/binaryDoc";
import type { WordDocument } from "./model";

const inlines = (doc: WordDocument) => doc.sections.flatMap(s => s.blocks).flatMap(b => b.kind === "paragraph" ? b.inlines : b.rows.flatMap(row => row.flatMap(cell => cell.blocks.flatMap(p => p.kind === "paragraph" ? p.inlines : []))));
const pictureProps = (at = 0) => join(sprm(0x0855, 1, 1), sprm(0x6a03, at, 4));
const oleProps = (id = 100) => join(sprm(0x080a, 1, 1), sprm(0x6a03, id, 4));
function embed(valid = true, preview = true, object = true) {
  const text = `前\x13 EMBED Equation.DSMT4 \x14${preview ? "\x01" : ""}\x15后\r`, sep = text.indexOf("\x14"), pic = text.indexOf("\x01");
  return docFixture(text, { [sep]: oleProps(), ...(pic >= 0 ? { [pic]: pictureProps() } : {}) }, preview ? pictureFixture() : new Uint8Array(),
    object ? { "ObjectPool/_100/Equation Native": nativeEquationFixture(valid) } : {});
}
function floatingFixture(delayed = false) {
  const png = pngBlip(), fbse = new Uint8Array(36), fv = new DataView(fbse.buffer);
  fv.setUint32(20, png.length, true); fv.setUint32(24, 1, true); fv.setUint32(28, delayed ? 0 : 0xffffffff, true);
  const group = officeArt(0xf000, officeArt(0xf001, officeArt(0xf007, delayed ? fbse : join(fbse, png), 6, 2), 1, 15), 0, 15);
  const fsp = new Uint8Array(8); new DataView(fsp.buffer).setUint32(0, 1025, true);
  const shape = officeArt(0xf004, join(officeArt(0xf00a, fsp, 75, 2), officeArt(0xf00b, sprm(0x4104, 1, 4), 1, 3)), 0, 15);
  const drawing = join(group, Uint8Array.of(0), officeArt(0xf002, officeArt(0xf003, shape, 0, 15), 0, 15));
  const anchors = new Uint8Array(34), av = new DataView(anchors.buffer);
  av.setUint32(0, 1, true); av.setUint32(4, 3, true); av.setUint32(8, 1025, true); av.setInt32(20, 1440, true); av.setInt32(24, 720, true);
  return { drawing, anchors, delay: png };
}

describe("binary DOC pictures and equations", () => {
  it("extracts inline pictures in text order with exact original image bytes and display dimensions", async () => {
    const picture = pictureFixture(), bytes = docFixture("前\x01中\x01后\r", { 1: pictureProps(), 3: pictureProps(picture.length) }, join(picture, pictureFixture(pngBlip(pngFixture, true)))) , before = bytes.slice();
    const model = await parseWord(bytes, { includeEquations: true }), items = inlines(model);
    expect(items.map(i => i.kind)).toEqual(["text", "image", "text", "image", "text"]);
    expect(items[1]).toMatchObject({ width: 96, height: 48 });
    expect(model.assets.map(a => a.bytes)).toEqual([pngFixture, pngFixture]);
    expect(model.warnings).toEqual([]); expect(bytes).toEqual(before);
  });

  it("uses storage-qualified Equation Native streams and replaces each field result only once", async () => {
    const first = "\x13 EMBED Equation.DSMT4 \x14\x01\x15", text = `前${first}中${first}后\r`, other = nativeEquationFixture(); other[other.length - 4] = 121;
    const positions = [...text].flatMap((c, i) => c === "\x14" ? [[i, oleProps(i < 30 ? 100 : 200)]] : c === "\x01" ? [[i, pictureProps()]] : []);
    const bytes = docFixture(text, Object.fromEntries(positions), pictureFixture(), { "ObjectPool/_100/Equation Native": nativeEquationFixture(), "ObjectPool/_200/Equation Native": other }), before = bytes.slice();
    const model = await parseWord(bytes, { includeEquations: true });
    expect(inlines(model).filter(i => i.kind === "math").map(i => i.latex)).toEqual(["x", "y"]);
    expect(inlines(model).filter(i => i.kind === "text").map(i => i.text).join("")).toBe("前中后");
    expect(model.assets).toHaveLength(0); expect(bytes).toEqual(before);
    const preview = await parseWord(bytes);
    expect(inlines(preview).filter(i => i.kind === "image")).toHaveLength(2);
    expect(inlines(preview).filter(i => i.kind === "math")).toHaveLength(0);
  });

  it("retains the formula preview when native equation data is damaged or missing", async () => {
    for (const bytes of [embed(false), embed(true, true, false)]) {
      const model = await parseWord(bytes, { includeEquations: true });
      expect(inlines(model).filter(i => i.kind === "image")).toMatchObject([{ mathType: true }]);
      expect(model.assets[0]?.bytes).toEqual(pngFixture);
      expect(inlines(model).filter(i => i.kind === "math")).toHaveLength(0);
    }
    const missing = await parseWord(embed(false, false), { includeEquations: true });
    expect(inlines(missing)).toContainEqual({ kind: "image-placeholder", alt: "公式待核对", mathType: true });
    expect(missing.warnings.join()).toContain("缺少可用预览图");
  });

  it("isolates a broken embedded stream and keeps document text and its fallback picture", async () => {
    const bytes = embed(), streams = readCompound(bytes), bad = nativeEquationFixture();
    new DataView(bad.buffer).setUint32(8, 0xffffffff, true);
    const damaged = compoundFixture(Object.fromEntries([...streams, ["ObjectPool/_100/Equation Native", bad]]));
    const model = await parseWord(damaged, { includeEquations: true });
    expect(inlines(model).filter(i => i.kind === "text").map(i => i.text).join("")).toBe("前后");
    expect(model.assets[0]?.bytes).toEqual(pngFixture);
    const brokenChain = bytes.slice(), name = Buffer.from("Equation Native", "utf16le"), directoryAt = Buffer.from(brokenChain).indexOf(name);
    expect(directoryAt).toBeGreaterThan(0);
    new DataView(brokenChain.buffer).setUint32(directoryAt + 116, 0xfffffff0, true);
    const fallback = await parseWord(brokenChain, { includeEquations: true });
    expect(fallback.assets[0]?.bytes).toEqual(pngFixture);
    expect(inlines(fallback).filter(i => i.kind === "text").map(i => i.text).join("")).toBe("前后");
  });

  it("preserves visible placeholders for missing, unsupported or binary objects without inventing images", async () => {
    const bytes = docFixture("前\x01中\x01后\r", { 1: pictureProps(0xffff), 3: join(pictureProps(), sprm(0x0806, 1, 1)) }, pictureFixture());
    const model = await parseWord(bytes, { includeEquations: true });
    expect(inlines(model).filter(i => i.kind === "image-placeholder")).toHaveLength(2);
    expect(model.assets).toHaveLength(0); expect(model.warnings.join()).toContain("未能提取");
    expect(inlines(model).filter(i => i.kind === "text").map(i => i.text).join("")).toBe("前中后");
  });

  it("extracts floating pictures at their own anchors and reads delayed BLIPs from the Word stream", async () => {
    const f = floatingFixture(), bytes = docFixture("前\x08后\r", {}, new Uint8Array(), {}, { 40: f.anchors, 50: f.drawing }), before = bytes.slice();
    const model = await parseWord(bytes);
    expect(inlines(model).map(i => i.kind)).toEqual(["text", "image", "text"]); expect(model.assets[0]?.bytes).toEqual(pngFixture);
    expect(inlines(model)[1]).toMatchObject({ width: 96, height: 48 }); expect(model.warnings.join()).toContain("锚点"); expect(bytes).toEqual(before);
    const delayed = floatingFixture(true), result = await readDocFloatingPictures(new Binary(delayed.drawing), new Binary(delayed.anchors), new Binary(delayed.delay));
    expect(result.get(1)?.asset.bytes).toEqual(pngFixture);
  });

  it("adds a BMP file header to native DIB data and rejects truncated picture records", async () => {
    const dib = new Uint8Array(44), view = new DataView(dib.buffer); view.setUint32(0, 40, true); view.setInt32(4, 1, true); view.setInt32(8, 1, true); view.setUint16(12, 1, true); view.setUint16(14, 24, true);
    const result = await readDocPicture(pictureFixture(officeArt(0xf01f, join(new Uint8Array(17), dib), 0x7a8)), 0);
    expect(result?.asset.mime).toBe("image/bmp"); expect(result?.asset.bytes.slice(0, 2)).toEqual(Uint8Array.of(66, 77)); expect(result?.asset.bytes.slice(14)).toEqual(dib);
    await expect(readDocPicture(pictureFixture().subarray(0, 90), 0)).rejects.toThrow();
  });

  it("decodes compressed and uncompressed WMF previews and refuses mismatched decompression sizes", async () => {
    const wmf = new Uint8Array(44), view = new DataView(wmf.buffer);
    view.setUint16(0, 1, true); view.setUint16(2, 9, true); view.setUint16(4, 0x300, true); view.setUint32(6, 22, true);
    for (const [at, kind] of [[18, 0x0214], [28, 0x0213]]) {
      view.setUint32(at!, 5, true); view.setUint16(at! + 4, kind!, true);
    }
    view.setInt16(34, 100, true); view.setInt16(36, 100, true); view.setUint32(38, 3, true);
    for (const compressed of [true, false]) {
      const data = compressed ? deflateSync(wmf) : wmf, meta = new Uint8Array(34), mv = new DataView(meta.buffer);
      mv.setUint32(0, wmf.length, true); mv.setInt32(12, 100, true); mv.setInt32(16, 100, true); mv.setUint32(28, data.length, true); meta[32] = compressed ? 0 : 0xfe; meta[33] = 0xfe;
      const result = await readDocPicture(pictureFixture(officeArt(0xf01b, join(new Uint8Array(16), meta, data), 0x216)), 0);
      expect(result?.asset.mime).toBe("image/svg+xml");
      expect(new TextDecoder().decode(result?.asset.bytes)).toContain('<line x1="0" y1="0" x2="100" y2="100"');
      mv.setUint32(0, 1, true);
      const bad = pictureFixture(officeArt(0xf01b, join(new Uint8Array(16), meta, data), 0x216));
      if (compressed) await expect(readDocPicture(bad, 0)).rejects.toThrow("超过声明大小");
      else expect(await readDocPicture(bad, 0)).toBeUndefined();
    }
  });

  it("retains picture cropping, mirroring and rotation while preserving embedded image bytes", async () => {
    const plain = pictureFixture(), header = plain.slice(0, 68), fsp = new Uint8Array(8); new DataView(fsp.buffer).setUint32(4, 0x40, true);
    const shape = officeArt(0xf004, join(officeArt(0xf00a, fsp, 75, 2), officeArt(0xf00b, join(sprm(0x102, 16384, 4), sprm(4, 90 * 65536, 4)), 2, 3)), 0, 15);
    const picture = join(header, shape, pngBlip()); new DataView(picture.buffer).setUint32(0, picture.length, true);
    const before = picture.slice(), result = await readDocPicture(picture, 0);
    expect(result?.asset.mime).toBe("image/svg+xml"); expect(result?.width).toBeCloseTo(48); expect(result?.height).toBeCloseTo(96);
    expect(new TextDecoder().decode(result?.asset.bytes)).toContain(btoa(String.fromCharCode(...pngFixture))); expect(picture).toEqual(before);
  });

  it("keeps root streams and same-named streams in different embedded objects separate", () => {
    const bytes = compoundFixture({ WordDocument: Uint8Array.of(1), "ObjectPool/_100/WordDocument": Uint8Array.of(2), "ObjectPool/_100/Equation Native": nativeEquationFixture(), "ObjectPool/_200/Equation Native": nativeEquationFixture() });
    expect(readCompound(bytes).get("WordDocument")?.[0]).toBe(1);
    expect(openCompound(bytes).get("ObjectPool/_100/WordDocument")?.()[0]).toBe(2);
    expect([...openCompound(bytes).keys()].filter(p => p.endsWith("/Equation Native"))).toHaveLength(2);
  });
});
