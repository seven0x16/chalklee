import { createHash } from "node:crypto";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createChalkLeeArchive, openChalkLeeArchiveForEditing, openChalkLeeArchiveForReading, readChalkLeeArchive } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "./newDocument";

const image = (id: string, data: number[]) => ({
  id, path: `assets/figures/${id}.png`, mediaType: "image/png", data: Uint8Array.from(data)
});

function zipCompressionMethods(bytes: ArrayBuffer) {
  const zip = new DataView(bytes);
  const decoder = new TextDecoder();
  const methods = new Map<string, number>();
  for (let offset = 0; zip.getUint32(offset, true) === 0x04034b50;) {
    const nameOffset = offset + 30;
    const nameLength = zip.getUint16(offset + 26, true);
    const name = decoder.decode(new Uint8Array(bytes, nameOffset, nameLength));
    methods.set(name, zip.getUint16(offset + 8, true));
    offset = nameOffset + nameLength + zip.getUint16(offset + 28, true) + zip.getUint32(offset + 18, true);
  }
  return methods;
}

it("reads the same document and assets from a temporary export archive", async () => {
  const document = createEmptyChalkLeeDocument("试卷");
  const figure = image("figure", [1, 2, 3]);
  const diagram = { id: "diagram", path: "assets/figures/diagram.svg", mediaType: "image/svg+xml",
    data: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>') };
  const assets = [figure, diagram];
  const packed = await createChalkLeeArchive(document, assets);
  const temporary = await createChalkLeeArchive(document, assets, { storeCompressedImages: true });
  expect(await readChalkLeeArchive(temporary)).toEqual(await readChalkLeeArchive(packed));
});

it("checks an asset when selected for unpacking and still rejects corrupt archives when read in full", async () => {
  const document = createEmptyChalkLeeDocument("试卷");
  const figure = image("figure", [1, 2]);
  const damaged = image("damaged", [3, 4]);
  const zip = await JSZip.loadAsync(await createChalkLeeArchive(document, [figure, damaged]));
  zip.file(damaged.path, Uint8Array.from([4, 3]));
  const bytes = await zip.generateAsync({ type: "uint8array" });

  const reader = await openChalkLeeArchiveForReading(bytes);
  expect(reader.document.metadata.title).toBe("试卷");
  expect(await reader.readAsset(figure.id)).toEqual(figure.data);
  await expect(reader.readAsset(damaged.id)).rejects.toThrow(`素材校验失败：${damaged.path}`);
  await expect(readChalkLeeArchive(bytes)).rejects.toThrow(`素材校验失败：${damaged.path}`);
});

it.each([
  ["fixed", () => new ArrayBuffer(7)],
  ["shared", () => new SharedArrayBuffer(7)],
  ["resizable", () => Reflect.construct(ArrayBuffer, [7, { maxByteLength: 14 }]) as ArrayBuffer]
])("hashes only the asset's byte range in a %s backing buffer", async (_type, makeBuffer) => {
  const document = createEmptyChalkLeeDocument("试卷");
  const source = new Uint8Array(makeBuffer());
  source.set([9, 9, 4, 5, 6, 9, 9]);
  const figure = { ...image("figure", []), data: source.subarray(2, 5) };
  const opened = await openChalkLeeArchiveForEditing(await createChalkLeeArchive(document, [figure]));
  const expected = Uint8Array.of(4, 5, 6);
  const { data } = await opened.prepareSave(document, [figure]);
  const saved = await readChalkLeeArchive(data);
  expect(saved.assets.figure).toEqual(expected);
  expect(saved.manifest.assets[0].sha256).toBe(createHash("sha256").update(expected).digest("hex"));
});

describe("saving an editable ChalkLee archive", () => {
  it("keeps STORE and DEFLATE entries in a mixed archive across text edits", async () => {
    const document = createEmptyChalkLeeDocument("试卷");
    const figure = image("figure", [1, 2, 3]);
    const diagram = { ...image("diagram", [4, 5, 6]), path: "assets/figures/diagram.svg", mediaType: "image/svg+xml" };
    const input = await createChalkLeeArchive(document, [figure, diagram], { storeCompressedImages: true });
    const editor = await openChalkLeeArchiveForEditing(input);

    for (const title of ["第一次保存", "第二次保存"]) {
      const edited = { ...document, metadata: { ...document.metadata, title } };
      const { data, canonical } = await editor.prepareSave(edited, [figure, diagram]);
      const methods = zipCompressionMethods(data);
      expect(methods.get("mimetype")).toBe(0);
      expect(methods.get(figure.path)).toBe(0);
      expect(methods.get(diagram.path)).toBe(8);
      await expect(readChalkLeeArchive(data)).resolves.toEqual(canonical);
      await expect(JSZip.loadAsync(data, { checkCRC32: true })).resolves.toBeDefined();
    }
    const replacement = image(figure.id, [3, 2, 1]);
    const { data } = await editor.prepareSave(document, [replacement, diagram]);
    expect(zipCompressionMethods(data).get(figure.path)).toBe(8);
    expect((await readChalkLeeArchive(data)).assets[figure.id]).toEqual(replacement.data);
  });

  it("keeps unchanged nested images, replaces changed bytes and removes unused entries", async () => {
    const document = createEmptyChalkLeeDocument("试卷");
    const originalAssets = [image("unchanged", [1, 2]), image("replaced", [3, 4]), image("removed", [5])];
    const input = await JSZip.loadAsync(await createChalkLeeArchive(document, originalAssets));
    input.file("assets/figures/", "", { dir: true });
    input.file("extra.txt", "external metadata");
    const opened = await openChalkLeeArchiveForEditing(await input.generateAsync({ type: "uint8array", compression: "DEFLATE" }));

    const kept = { ...originalAssets[0], data: opened.archive.assets.unchanged };
    const replacement = image("replaced", [4, 3]);
    const added = image("added", [6]);
    const edited = { ...document, metadata: { ...document.metadata, title: "改过的试卷" } };
    const { data, canonical } = await opened.prepareSave(edited, [kept, replacement, added]);
    expect(await readChalkLeeArchive(data)).toEqual(canonical);
    expect(canonical.document.metadata.title).toBe("改过的试卷");
    expect(canonical.assets).toEqual({ unchanged: kept.data, replaced: replacement.data, added: added.data });
    const zip = await JSZip.loadAsync(data, { checkCRC32: true });
    expect(zip.file(originalAssets[2].path)).toBeNull();
    expect(zip.file("extra.txt")).toBeNull();
  });

  it("keeps its packed source independent of buffers handed to other callers", async () => {
    const document = createEmptyChalkLeeDocument("试卷");
    const figure = image("figure", [1, 2, 3]);
    const input = await createChalkLeeArchive(document, [figure]);
    const opened = await openChalkLeeArchiveForEditing(input);
    input.fill(0);
    const first = await opened.prepareSave(document, [figure]);
    new Uint8Array(first.data).fill(0);

    const next = await opened.prepareSave(document, [figure]);
    expect((await readChalkLeeArchive(next.data)).assets.figure).toEqual(figure.data);

    const replacement = image("figure", [3, 2, 1]);
    const changed = await opened.prepareSave(document, [replacement]);
    new Uint8Array(changed.data).fill(0);
    const reused = await opened.prepareSave(document, [replacement]);
    expect((await readChalkLeeArchive(reused.data)).assets.figure).toEqual(replacement.data);
  });

  it("keeps reused image entries independent across overlapping saves", async () => {
    const paper = createEmptyChalkLeeDocument("试卷");
    const figure = image("figure", [1, 2, 3]);
    const opened = await openChalkLeeArchiveForEditing(await createChalkLeeArchive(paper, [figure]));
    const documents = ["2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"].map(updatedAt => ({
      ...paper, metadata: { ...paper.metadata, updatedAt }
    }));
    const saved = await Promise.all(documents.map(document => opened.prepareSave(document, [figure])));
    for (const [index, output] of saved.entries()) {
      expect(await readChalkLeeArchive(output.data)).toEqual(output.canonical);
      const zip = await JSZip.loadAsync(output.data, { checkCRC32: true });
      expect(zip.file(figure.path)?.date.toISOString()).toBe(documents[index].metadata.updatedAt);
    }
  });

  it("rejects an archive with invalid image bytes before making it editable", async () => {
    const document = createEmptyChalkLeeDocument("试卷");
    const figure = image("figure", [1, 2]);
    const damaged = await JSZip.loadAsync(await createChalkLeeArchive(document, [figure]));
    damaged.file(figure.path, Uint8Array.from([2, 1]));
    await expect(openChalkLeeArchiveForEditing(await damaged.generateAsync({ type: "uint8array" }))).rejects.toThrow("素材校验失败");
  });
});
