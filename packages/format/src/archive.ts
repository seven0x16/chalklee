import JSZip from "jszip";
import { chalkLeeAppearanceChanges, chalkLeeAppearanceFromSchema02, chalkLeeResolvedAppearance, type ChalkLeeStoredAppearance } from "./appearance";
import { validateChalkLeeBoxStyleCss, validateChalkLeeDesign } from "./design";
import { normalizeChalkLeeDocument } from "./normalize";
import {
  CHALKLEE_FORMAT_VERSION,
  CHALKLEE_MEDIA_TYPE,
  CHALKLEE_SCHEMA_VERSION,
  type ChalkLeeArchive,
  type ChalkLeeArchiveAssetInput,
  type ChalkLeeDocument,
  type ChalkLeeManifest
} from "./types";

/** Box styles' decoration CSS follows the same rules as document CSS. */
function validateBoxStyles(document: ChalkLeeDocument) {
  for (const [name, style] of Object.entries(document.appearance.boxStyles ?? {})) {
    if (!style.css) continue;
    try { validateChalkLeeBoxStyleCss(style.css); }
    catch (error) { throw new Error(`盒子样式 ${name}：${error instanceof Error ? error.message : String(error)}`); }
  }
}

const MIMETYPE_PATH = "mimetype";
const MANIFEST_PATH = "manifest.json";
const DOCUMENT_PATH = "document.json";
const COMPRESSED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const ZIP_STORE_METHOD = "\x00\x00";

interface ChalkLeeArchiveCreationOptions {
  /** Skip deflating compressed raster images in a temporary archive for export. */
  storeCompressedImages?: boolean;
}

interface PackedArchive {
  loadZip(): Promise<JSZip>;
  assetHashes: ReadonlyMap<string, string>;
  hasInputAssets: boolean;
}

type PackedZipEntry = JSZip.JSZipObject & { _data?: { compression?: { magic: string }; compressedContent?: Uint8Array } };

export interface EditableChalkLeeArchive {
  archive: ChalkLeeArchive;
  prepareSave(document: ChalkLeeDocument, assets: ChalkLeeArchiveAssetInput[]): Promise<{ data: ArrayBuffer; canonical: ChalkLeeArchive }>;
}

/** Keep a private copy of the packed archive so later text edits can reuse verified asset entries. */
export async function openChalkLeeArchiveForEditing(input: ArrayBuffer | Uint8Array): Promise<EditableChalkLeeArchive> {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input.slice(0)) : Uint8Array.from(input);
  const zip = await JSZip.loadAsync(bytes);
  const archive = await unpackChalkLeeArchive(await archiveReader(zip));
  let packed = packedArchive(zip, archive.manifest);
  return {
    archive,
    async prepareSave(document, assets) {
      const { data, manifestJson, documentJson } = await packChalkLeeArchive(document, assets, packed);
      const metadata = parseArchiveMetadata(parseJson<ChalkLeeManifest>(manifestJson, MANIFEST_PATH), documentJson);
      // These are the same bytes that were just written or matched by digest.
      const canonical = { ...metadata, assets: Object.fromEntries(assets.map(asset => [asset.id, asset.data])) };
      // Text edits keep using the already indexed compressed entries.
      const descriptors = canonical.manifest.assets;
      const reusePackedAssets = !packed.hasInputAssets && descriptors.length === packed.assetHashes.size
        && descriptors.every(asset => packed.assetHashes.get(asset.path) === asset.sha256);
      if (!reusePackedAssets) {
        // Index the new packed entries on demand, once another save needs them.
        packed = packedArchive(data, canonical.manifest);
      }
      // Copy only when the cached ZIP also retains views of the new output.
      const buffer = reusePackedAssets && data.buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
        ? data.buffer : data.slice().buffer;
      return { data: buffer, canonical };
    }
  };
}

function packedArchive(source: JSZip | Uint8Array, manifest: ChalkLeeManifest): PackedArchive {
  let zip: Promise<JSZip> | undefined;
  return {
    loadZip: () => zip ??= source instanceof Uint8Array ? JSZip.loadAsync(source) : Promise.resolve(source),
    assetHashes: new Map(manifest.assets.map(asset => [asset.path, asset.sha256])),
    hasInputAssets: !(source instanceof Uint8Array) && manifest.assets.length > 0
  };
}

export async function createChalkLeeArchive(
  document: ChalkLeeDocument,
  assets: ChalkLeeArchiveAssetInput[] = [],
  options?: ChalkLeeArchiveCreationOptions
): Promise<Uint8Array> {
  return (await packChalkLeeArchive(document, assets, undefined, options)).data;
}

async function packChalkLeeArchive(
  document: ChalkLeeDocument,
  assets: ChalkLeeArchiveAssetInput[],
  previous?: PackedArchive,
  options?: ChalkLeeArchiveCreationOptions
) {
  if (document.appearance.design) validateChalkLeeDesign(document.appearance.design.css);
  validateBoxStyles(document);
  if (document.schemaVersion !== CHALKLEE_SCHEMA_VERSION) {
    throw new Error(`不支持的 ChalkLee 文档版本：${document.schemaVersion}`);
  }

  const sortedAssets = [...assets].sort((left, right) => left.path.localeCompare(right.path));
  assertArchiveAssetInputs(sortedAssets);

  const manifest: ChalkLeeManifest = {
    format: "chalklee",
    formatVersion: CHALKLEE_FORMAT_VERSION,
    mediaType: CHALKLEE_MEDIA_TYPE,
    documentPath: DOCUMENT_PATH,
    documentId: document.id,
    createdAt: document.metadata.createdAt,
    updatedAt: document.metadata.updatedAt,
    assets: await Promise.all(sortedAssets.map(async (asset) => ({
      id: asset.id,
      path: asset.path,
      mediaType: asset.mediaType,
      byteLength: asset.data.byteLength,
      sha256: await sha256Hex(asset.data)
    })))
  };

  const archiveDate = validArchiveDate(document.metadata.updatedAt);
  const packed = previous && manifest.assets.some(asset => previous.assetHashes.get(asset.path) === asset.sha256)
    ? await previous.loadZip() : null;
  const manifestJson = stableJson(manifest);
  const documentJson = stableJson(storedDocument(normalizeChalkLeeDocument(document)));
  const zip = new JSZip();
  zip.file(MIMETYPE_PATH, CHALKLEE_MEDIA_TYPE, { compression: "STORE", date: archiveDate });
  zip.file(MANIFEST_PATH, manifestJson, { date: archiveDate });
  zip.file(DOCUMENT_PATH, documentJson, { date: archiveDate });
  if (sortedAssets.length) {
    zip.file("assets/", new Uint8Array(), { compression: "STORE", createFolders: false, date: archiveDate, dir: true });
  }
  for (const [index, asset] of sortedAssets.entries()) {
    const entry = previous?.assetHashes.get(asset.path) === manifest.assets[index].sha256 ? packed?.file(asset.path) : null;
    // JSZip keeps the on-disk method on its packed data, independently of the write options.
    const packedData = (entry as PackedZipEntry | null | undefined)?._data;
    const storedBytes = packedData?.compression?.magic === ZIP_STORE_METHOD ? packedData.compressedContent : undefined;
    // Rebuild the CRC for STORE entries from the input using the digest-verified bytes.
    if (entry && !(storedBytes && previous?.hasInputAssets)) {
      // Share the compressed bytes, but keep each save's entry metadata private.
      zip.files[asset.path] = Object.assign(Object.create(Object.getPrototypeOf(entry)), entry, {
        date: archiveDate, comment: "", unixPermissions: null, dosPermissions: null,
        options: { ...entry.options, compression: storedBytes ? "STORE" : "DEFLATE" }
      });
    } else {
      const compression = storedBytes || (options?.storeCompressedImages && COMPRESSED_IMAGE_TYPES.has(asset.mediaType)) ? "STORE" : undefined;
      zip.file(asset.path, storedBytes ?? asset.data, { compression, createFolders: false, date: archiveDate });
    }
  }

  const data = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX"
  });
  return { data, manifestJson, documentJson };
}

export async function readChalkLeeArchive(input: ArrayBuffer | Uint8Array): Promise<ChalkLeeArchive> {
  return unpackChalkLeeArchive(await openChalkLeeArchiveForReading(input));
}

async function unpackChalkLeeArchive({ manifest, document, readAsset }: ChalkLeeArchiveReader): Promise<ChalkLeeArchive> {
  const assets: Record<string, Uint8Array> = {};
  for (const descriptor of manifest.assets) {
    assets[descriptor.id] = await readAsset(descriptor.id);
  }
  return { manifest, document, assets };
}

export interface ChalkLeeArchiveReader extends Pick<ChalkLeeArchive, "manifest" | "document"> {
  readAsset(id: string): Promise<Uint8Array>;
}

/** Read metadata once and verify each requested asset as it is unpacked. */
export async function openChalkLeeArchiveForReading(input: ArrayBuffer | Uint8Array): Promise<ChalkLeeArchiveReader> {
  return archiveReader(await JSZip.loadAsync(input));
}

async function archiveReader(zip: JSZip): Promise<ChalkLeeArchiveReader> {
  const metadata = await readArchiveMetadata(zip);
  const descriptors = new Map(metadata.manifest.assets.map(asset => [asset.id, asset]));
  return {
    ...metadata,
    async readAsset(id) {
      const descriptor = descriptors.get(id);
      if (!descriptor) throw new Error(`ChalkLee 缺少素材：${id}`);
      const data = await requiredFile(zip, descriptor.path).async("uint8array");
      if (data.byteLength !== descriptor.byteLength) throw new Error(`素材长度不匹配：${descriptor.path}`);
      if (await sha256Hex(data) !== descriptor.sha256) throw new Error(`素材校验失败：${descriptor.path}`);
      return data;
    }
  };
}

/** Read document metadata without decompressing or hashing image assets. */
export async function readChalkLeeArchiveMetadata(input: ArrayBuffer | Uint8Array): Promise<Pick<ChalkLeeArchive, "manifest" | "document">> {
  return readArchiveMetadata(await JSZip.loadAsync(input));
}

async function readArchiveMetadata(zip: JSZip): Promise<Pick<ChalkLeeArchive, "manifest" | "document">> {
  const mimetype = await requiredFile(zip, MIMETYPE_PATH).async("text");
  if (mimetype !== CHALKLEE_MEDIA_TYPE) {
    throw new Error(`不是有效的 ChalkLee 文件：mimetype 为 ${JSON.stringify(mimetype)}`);
  }

  const manifest = parseJson<ChalkLeeManifest>(await requiredFile(zip, MANIFEST_PATH).async("text"), MANIFEST_PATH);
  const documentJson = await requiredFile(zip, DOCUMENT_PATH).async("text");
  const metadata = parseArchiveMetadata(manifest, documentJson);
  for (const descriptor of manifest.assets) requiredFile(zip, descriptor.path);
  return metadata;
}

function parseArchiveMetadata(manifest: ChalkLeeManifest, documentJson: string) {
  const document = normalizeChalkLeeDocument(openedDocument(parseJson<StoredDocument>(documentJson, DOCUMENT_PATH)));
  assertManifestHeader(manifest, document);
  if (document.appearance.design) validateChalkLeeDesign(document.appearance.design.css);
  validateBoxStyles(document);
  assertManifestAssets(manifest);

  return { manifest, document };
}

type StoredDocument = Omit<ChalkLeeDocument, "schemaVersion" | "appearance"> & { schemaVersion: string; appearance?: ChalkLeeStoredAppearance };

/** A file keeps only the appearance items the document changed; the rest follows the standard appearance. */
function storedDocument(document: ChalkLeeDocument): StoredDocument {
  return { ...document, appearance: chalkLeeAppearanceChanges(document.appearance) };
}

/** Documents in memory always carry their full appearance. `chalklee/0.2` files stored every item. */
function openedDocument(stored: StoredDocument): ChalkLeeDocument {
  if (stored.schemaVersion !== CHALKLEE_SCHEMA_VERSION && stored.schemaVersion !== "chalklee/0.2") {
    throw new Error(`ChalkLee document 版本不受支持：${stored.schemaVersion}`);
  }
  const own = stored.schemaVersion === "chalklee/0.2" ? chalkLeeAppearanceFromSchema02(chalkLeeResolvedAppearance(stored.appearance)) : stored.appearance;
  // Files from a development version may still carry a sealing line, which is no longer part of the format.
  const { sealingLine: _sealingLine, ...current } = (own ?? {}) as ChalkLeeStoredAppearance & { sealingLine?: unknown };
  return { ...stored, schemaVersion: CHALKLEE_SCHEMA_VERSION, appearance: chalkLeeResolvedAppearance(current) };
}

function assertManifestAssets(manifest: ChalkLeeManifest) {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const asset of manifest.assets) {
    assertSafeAssetPath(asset.path);
    if (ids.has(asset.id)) throw new Error(`manifest 中存在重复素材 id：${asset.id}`);
    if (paths.has(asset.path)) throw new Error(`manifest 中存在重复素材路径：${asset.path}`);
    ids.add(asset.id);
    paths.add(asset.path);
  }
}

function assertArchiveAssetInputs(assets: ChalkLeeArchiveAssetInput[]) {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const asset of assets) {
    if (!asset.id) throw new Error("ChalkLee 素材必须有稳定 id");
    if (ids.has(asset.id)) throw new Error(`重复的素材 id：${asset.id}`);
    if (paths.has(asset.path)) throw new Error(`重复的素材路径：${asset.path}`);
    assertSafeAssetPath(asset.path);
    ids.add(asset.id);
    paths.add(asset.path);
  }
}

function assertSafeAssetPath(assetPath: string) {
  if (!assetPath.startsWith("assets/") || assetPath.includes("\\") || assetPath.split("/").includes("..")) {
    throw new Error(`非法的 ChalkLee 素材路径：${assetPath}`);
  }
}

function assertManifestHeader(manifest: ChalkLeeManifest, document: ChalkLeeDocument) {
  if (
    manifest.format !== "chalklee" ||
    manifest.formatVersion !== CHALKLEE_FORMAT_VERSION ||
    manifest.mediaType !== CHALKLEE_MEDIA_TYPE ||
    manifest.documentPath !== DOCUMENT_PATH
  ) {
    throw new Error("ChalkLee manifest 版本或媒体类型不受支持");
  }
  if (document.schemaVersion !== CHALKLEE_SCHEMA_VERSION) {
    throw new Error(`ChalkLee document 版本不受支持：${document.schemaVersion}`);
  }
  if (manifest.documentId !== document.id) {
    throw new Error("ChalkLee manifest 与 document 的 id 不一致");
  }
}

function requiredFile(zip: JSZip, path: string) {
  const file = zip.file(path);
  if (!file) throw new Error(`ChalkLee 缺少 ${path}`);
  return file;
}

function parseJson<T>(source: string, path: string): T {
  try {
    return JSON.parse(source) as T;
  } catch {
    throw new Error(`ChalkLee 中的 ${path} 不是有效 JSON`);
  }
}

function stableJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validArchiveDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? new Date("2000-01-01T00:00:00.000Z") : date;
}

async function sha256Hex(data: Uint8Array) {
  const { buffer, byteOffset, byteLength } = data;
  // Web Crypto snapshots the bytes at the supplied offset. Copy only when
  // the backing buffer cannot be passed to a browser's digest implementation.
  const bytes = buffer instanceof ArrayBuffer && !("resizable" in buffer && buffer.resizable)
    ? new Uint8Array(buffer, byteOffset, byteLength)
    : Uint8Array.from(data);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
