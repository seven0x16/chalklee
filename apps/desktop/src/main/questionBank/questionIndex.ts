import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { openChalkLeeArchiveForReading, type ChalkLeeArchiveReader, type ChalkLeeDocument } from "@chalklee/format";
import type { WorkspaceDirectoryNode, WorkspaceFileNode } from "../../shared/contracts";
import {
  assignDuplicateGroups,
  extractQuestionBankEntries,
  indexQuestionBankEntry,
  joinWorkspacePath,
  normalizeQuestionBankRequest,
  prepareQuestionBankSearch,
  publicQuestionBankEntry,
  questionContentHash,
  questionCopies,
  questionDuplicatePartition,
  questionSurroundings,
  summarizeQuestionBank,
  type IndexedQuestion,
  type PreparedQuestionBankSearch,
  type QuestionBankChange,
  type QuestionBankEntry,
  type QuestionBankIndexStatus,
  type QuestionBankOverview,
  type QuestionBankSearchRequest,
  type QuestionBankSearchResponse,
  type QuestionBasketItem,
  type QuestionBasketReference,
  type QuestionSnapshot,
  type QuestionThumbnail
} from "../../shared/questionBank/search";
import { figuresWithoutHeight, imageFileAspect } from "../../shared/questionBank/paperSize";
import { documentKind, inspectWorkspaceDocument } from "../workspace/files";
import { openWorkspaceArchiveValidationCache, type WorkspaceArchiveValidationCache } from "../workspace/archiveValidationCache";
import { workspaceStorageDirectory } from "../workspace/storage";
import { EMPTY_QUESTION_TAG_TREE, normalizeQuestionTagTree, type QuestionTagTree } from "../../shared/questionBank/tagTree";
import { figurePrintCandidateKeys, pictureFigurePrint, sameFigurePrint } from "./figurePrints";

// Bump when QuestionBankEntry changes shape or meaning so stale caches are re-indexed.
const CACHE_VERSION = 10;
const BASKET_VERSION = 1;
const TAG_TREE_VERSION = 1;
const MAX_BASKET_ITEMS = 300;
const INDEX_CONCURRENCY = 4;
/** Recently read papers, so a page of library cards from one paper parses it once. */
const ARCHIVE_CACHE = 6;
const ARCHIVE_ASSET_CACHE_BYTES = 4 * 1024 * 1024;
const ARCHIVE_CACHE_BYTES = 48 * 1024 * 1024;
const SEARCH_CACHE_SIZE = 4;
const SEARCH_CACHE_MATCHES = 80_000;
const SEARCH_CACHE_TAGS = 1_000;
const RECENT_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

type CachedEntry = Omit<QuestionBankEntry, "path">;
interface IndexedDocument {
  relativePath: string;
  size: number;
  modifiedAt: number;
  fingerprint?: string;
  createdAt?: number | Promise<number>;
  failed: boolean;
  questions: IndexedQuestion[];
  surroundings?: ReturnType<typeof questionSurroundings>;
}
type IndexUpdate = { path: string; root: string; generation: number; cancelled: boolean; done: Array<() => void> };
interface IndexCache {
  version: number;
  /** Identifies the base snapshot so an old overlay is ignored after compaction. */
  cacheId?: string;
  documents: CachedDocument[];
  /** Figure prints by figure id; null for a picture that cannot be compared by its look. */
  figures?: Record<string, string | null>;
  /** Height over width of pictures whose documents do not say, by sha256; null when the file could not be read. */
  aspects?: Record<string, number | null>;
}
type CachedDocument = { relativePath: string; size: number; modifiedAt: number; failed: boolean; entries: CachedEntry[] };
type IndexOverlay = {
  version: number; baseId: string;
  documents: CachedDocument[]; removed: string[];
  figures: Record<string, string | null>; aspects: Record<string, number | null>;
};
type CacheState = {
  baseId: string | null;
  changes: Map<string, CachedDocument | null>;
  figures: Map<string, string | null>;
  aspects: Map<string, number | null>;
  dirtyDocuments: Set<string>;
  dirtyFigures: Set<string>;
  dirtyAspects: Set<string>;
};
const emptyCacheState = (): CacheState => ({ baseId: null, changes: new Map(), figures: new Map(), aspects: new Map(),
  dirtyDocuments: new Set(), dirtyFigures: new Set(), dirtyAspects: new Set() });
const CACHE_OVERLAY_DOCUMENTS = 128;
const CACHE_OVERLAY_FIGURES = 2_000;

type JsonNode = { type?: string; attrs?: Record<string, any>; content?: JsonNode[] };

/**
 * Workspace-wide question index. Saved ChalkLee content only: unsaved editor
 * changes appear after the document is saved. Results are cached under
 * `.chalklee/question-bank/` and refreshed per file from watcher events.
 */
export class QuestionBankIndex {
  private root: string | null = null;
  private generation = 0;
  private opening: Promise<void> = Promise.resolve();
  private documents = new Map<string, IndexedDocument>();
  // Duplicate edges never cross partitions. A common unique numeric/formula
  // signature needs only one map entry rather than three temporary buckets.
  private partitions = new Map<string, IndexedQuestion | Set<IndexedQuestion>>();
  private dirtyPartitions = new Set<string>();
  private waitingFigurePartitions = new Set<string>();
  private questions: IndexedQuestion[] = [];
  private overviewCache?: { calculatedAt: number; expiresAt: number; value: QuestionBankOverview };
  private searches = new Map<string, PreparedQuestionBankSearch>();
  private revision = 0;
  private tagRevision = 0;
  private status: QuestionBankIndexStatus = { state: "idle", indexedDocuments: 0, totalDocuments: 0, questionCount: 0, failedDocuments: 0 };
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private cacheState = emptyCacheState();
  private cacheWrite: Promise<unknown> = Promise.resolve();
  private basketWrite: Promise<unknown> = Promise.resolve();
  private tagTree: QuestionTagTree = EMPTY_QUESTION_TAG_TREE;
  private tagTreeLoad: Promise<unknown> = Promise.resolve();
  private tagTreeWrite: Promise<unknown> = Promise.resolve();
  private archives = new Map<string, { fingerprint: string; bytes: number; pending: boolean; archive: Promise<ChalkLeeArchiveReader> }>();
  private pendingUpdates = new Map<string, IndexUpdate>();
  private activeUpdates = new Map<string, IndexUpdate>();
  private verifiedArchives?: Pick<WorkspaceArchiveValidationCache, "has">;
  /** How figures look, read only for questions whose wording already matches another paper's. */
  private figurePrints = new Map<string, string | null>();
  private figureAspects = new Map<string, number | null>();
  private printing: Promise<void> | null = null;

  constructor(private readonly options: { changed?(change: QuestionBankChange): void; rebuildDelayMs?: number; persistDelayMs?: number } = {}) {}

  /** Start indexing a newly opened workspace; resolves once every document has been read. */
  open(root: string, tree: WorkspaceDirectoryNode, validationCacheDirectory?: string): Promise<void> {
    return this.opening = this.openWorkspace(root, tree, validationCacheDirectory);
  }

  private async openWorkspace(root: string, tree: WorkspaceDirectoryNode, validationCacheDirectory?: string): Promise<void> {
    const generation = ++this.generation;
    this.clearTimers();
    this.cancelUpdates();
    this.cacheState = emptyCacheState();
    this.root = root;
    this.documents.clear();
    this.partitions.clear();
    this.dirtyPartitions.clear();
    this.waitingFigurePartitions.clear();
    this.questions = [];
    this.overviewCache = undefined;
    this.searches.clear();
    this.archives.clear();
    this.verifiedArchives = undefined;
    this.figurePrints.clear();
    this.figureAspects.clear();
    this.tagTree = EMPTY_QUESTION_TAG_TREE;
    this.tagTreeLoad = this.loadTagTree(root).then(tagTree => this.updateTagTree(tagTree, generation));
    const files = chalkLeeFiles(tree);
    this.status = { state: "indexing", indexedDocuments: 0, totalDocuments: files.length, questionCount: 0, failedDocuments: 0 };
    const [{ documents: cache, figures, aspects, state }, , verifiedArchives] = await Promise.all([
      this.readCache(root), this.tagTreeLoad,
      validationCacheDirectory ? openWorkspaceArchiveValidationCache(validationCacheDirectory, root) : undefined
    ]);
    if (generation !== this.generation) return;
    this.verifiedArchives = verifiedArchives;
    this.cacheState = state;
    this.figurePrints = figures;
    this.figureAspects = aspects;
    const pending: WorkspaceFileNode[] = [];
    for (const file of files) {
      const relativePath = this.relative(file.path);
      const cached = cache.get(relativePath);
      if (cached && !cached.failed && cached.size === file.size && cached.modifiedAt === file.modifiedAt) {
        this.setIndexedDocument(file.path, { relativePath, size: cached.size, modifiedAt: cached.modifiedAt, createdAt: file.createdAt, failed: cached.failed,
          questions: cached.entries.map(entry => indexQuestionBankEntry({ ...entry, path: file.path, relativePath })) }, false);
      } else {
        pending.push(file);
        state.dirtyDocuments.add(relativePath);
      }
      cache.delete(relativePath);
    }
    for (const relativePath of cache.keys()) state.dirtyDocuments.add(relativePath);
    this.status = { state: pending.length ? "indexing" : "ready", indexedDocuments: files.length - pending.length, totalDocuments: files.length, questionCount: 0, failedDocuments: 0 };
    this.rebuild();
    if (!pending.length) { if (state.dirtyDocuments.size) this.schedulePersist(); return; }
    let next = 0;
    const worker = async () => {
      while (next < pending.length && generation === this.generation) {
        const file = pending[next++];
        await this.indexFile(root, file.path, generation);
        if (generation !== this.generation) return;
        this.status = { ...this.status, indexedDocuments: this.status.indexedDocuments + 1 };
        this.scheduleRebuild();
      }
    };
    await Promise.all(Array.from({ length: Math.min(INDEX_CONCURRENCY, pending.length) }, worker));
    if (generation !== this.generation) return;
    this.status = { ...this.status, state: "ready" };
    this.rebuild();
    if (pending.length) this.schedulePersist();
  }

  close() {
    this.generation++;
    this.clearTimers();
    this.cancelUpdates();
    this.cacheState = emptyCacheState();
    this.root = null;
    this.documents.clear();
    this.partitions.clear();
    this.dirtyPartitions.clear();
    this.waitingFigurePartitions.clear();
    this.questions = [];
    this.overviewCache = undefined;
    this.searches.clear();
    this.archives.clear();
    this.verifiedArchives = undefined;
    this.figurePrints.clear();
    this.figureAspects.clear();
    this.tagTree = EMPTY_QUESTION_TAG_TREE;
    this.status = { state: "idle", indexedDocuments: 0, totalDocuments: 0, questionCount: 0, failedDocuments: 0 };
  }

  /** Re-read one ChalkLee after it was added, saved or changed on disk. */
  async update(filePath: string): Promise<void> {
    const root = this.root, generation = this.generation;
    if (!root || documentKind(filePath) !== "chalklee" || isInternalPath(root, filePath)) return;
    await this.opening;
    if (generation !== this.generation) return;
    return new Promise<void>(resolve => {
      let job = this.pendingUpdates.get(filePath);
      if (!job) {
        job = { path: filePath, root, generation, cancelled: false, done: [] };
        this.pendingUpdates.set(filePath, job);
      }
      job.done.push(resolve);
      this.pumpUpdates();
    });
  }

  private pumpUpdates() {
    if (this.activeUpdates.size >= INDEX_CONCURRENCY) return;
    for (const [filePath, job] of this.pendingUpdates) {
      if (this.activeUpdates.size >= INDEX_CONCURRENCY) break;
      // Changes to a file are processed in order; one later read is enough
      // for all events that arrived while the current read was in flight.
      if (this.activeUpdates.has(filePath)) continue;
      this.pendingUpdates.delete(filePath);
      this.activeUpdates.set(filePath, job);
      const current = () => !job.cancelled && job.generation === this.generation;
      const known = this.documents.has(filePath);
      void this.indexFile(job.root, filePath, job.generation, current).then(changed => {
        if (!changed || !current()) return;
        const delta = Number(this.documents.has(filePath)) - Number(known);
        if (delta) this.status = { ...this.status, totalDocuments: this.status.totalDocuments + delta, indexedDocuments: this.status.indexedDocuments + delta };
        this.scheduleRebuild();
        this.schedulePersist();
      }).finally(() => {
        this.activeUpdates.delete(filePath);
        job.done.forEach(done => done());
        this.pumpUpdates();
      });
    }
  }

  private cancelUpdates(contains: (file: string) => boolean = () => true) {
    for (const [file, job] of this.pendingUpdates) if (contains(file)) {
      this.pendingUpdates.delete(file);
      job.cancelled = true;
      job.done.forEach(done => done());
    }
    for (const [file, job] of this.activeUpdates) if (contains(file)) job.cancelled = true;
  }

  /** Forget a removed file, or every file below a removed directory. */
  async remove(entryPath: string) {
    if (!this.root) return;
    const generation = this.generation;
    await this.opening;
    if (generation !== this.generation) return;
    const contains = (file: string) => file === entryPath || file.startsWith(`${entryPath}${path.sep}`);
    this.cancelUpdates(contains);
    let removed = 0;
    for (const filePath of [...this.documents.keys()]) {
      if (contains(filePath)) { this.setIndexedDocument(filePath, undefined); removed++; }
    }
    if (!removed) return;
    this.overviewCache = undefined;
    this.status = { ...this.status, totalDocuments: Math.max(0, this.status.totalDocuments - removed), indexedDocuments: Math.max(0, this.status.indexedDocuments - removed) };
    this.scheduleRebuild();
    this.schedulePersist();
  }

  search(input: QuestionBankSearchRequest | unknown): QuestionBankSearchResponse {
    const { limit, ...request } = normalizeQuestionBankRequest(input);
    const tagCount = request.tagUnits?.reduce((count, unit) => count + unit.length, 0) ?? 0;
    const key = tagCount <= SEARCH_CACHE_TAGS ? JSON.stringify(request) : null;
    let prepared = key === null ? undefined : this.searches.get(key);
    if (prepared && key !== null) {
      this.searches.delete(key);
      this.searches.set(key, prepared);
    } else {
      prepared = prepareQuestionBankSearch(this.questions, request, { tagTree: this.tagTree });
      if (key !== null && prepared.total <= SEARCH_CACHE_MATCHES) this.rememberSearch(key, prepared);
    }
    return { revision: this.revision, searchVersion: this.searchVersion, ...prepared.page(limit), status: this.status };
  }

  private get searchVersion() {
    return `${this.generation}:${this.revision}:${this.tagRevision}`;
  }

  searchIfChanged(input: unknown, knownVersion: string): QuestionBankSearchResponse | null {
    return this.status.state === "ready" && knownVersion === this.searchVersion ? null : this.search(input);
  }

  private rememberSearch(key: string, prepared: PreparedQuestionBankSearch) {
    let retained = prepared.total;
    for (const search of this.searches.values()) retained += search.total;
    for (const [oldest, search] of this.searches) {
      if (this.searches.size < SEARCH_CACHE_SIZE && retained <= SEARCH_CACHE_MATCHES) break;
      this.searches.delete(oldest);
      retained -= search.total;
    }
    this.searches.set(key, prepared);
  }

  /** Workspace totals; a ChalkLee counts as recent when its file was created within the last week. */
  async overview(now = Date.now()): Promise<QuestionBankOverview> {
    if (!this.root) return { documents: 0, questions: 0, tags: 0, recentDocuments: 0, recentQuestions: 0 };
    const cached = this.overviewCache;
    if (cached && now >= cached.calculatedAt && now < cached.expiresAt) return { ...cached.value };

    const documents = this.documents.size, questions = this.questions;
    const recent = new Set<string>(), pending: Promise<void>[] = [];
    const threshold = now - RECENT_PERIOD_MS;
    let expiresAt = Infinity;
    const countRecent = (filePath: string, createdAt: number) => {
      if (createdAt > threshold) {
        recent.add(filePath);
        expiresAt = Math.min(expiresAt, createdAt + RECENT_PERIOD_MS);
      }
    };
    for (const [filePath, document] of this.documents) {
      const createdAt = document.createdAt;
      if (typeof createdAt === "number") {
        countRecent(filePath, createdAt);
      } else {
        // A caller may supply a tree without creation times. Share that lookup and retry transient failures.
        const lookup = createdAt ?? (document.createdAt = stat(filePath).then(info => document.createdAt = info.birthtimeMs, () => {
          document.createdAt = undefined;
          return 0;
        }));
        pending.push(lookup.then(value => countRecent(filePath, value)));
      }
    }
    if (pending.length) await Promise.all(pending);
    const value = { documents, recentDocuments: recent.size, ...summarizeQuestionBank(questions, recent) };
    // Waiting for disk may overlap a workspace switch or an index change.
    if (!pending.length) this.overviewCache = { calculatedAt: now, expiresAt, value };
    return { ...value };
  }

  /** The saved question with its referenced images, read fresh from disk for preview or insertion. */
  async snapshot(filePath: string, questionId: string, includeSolutionAssets = true): Promise<QuestionSnapshot> {
    const root = this.requireRoot();
    if (documentKind(filePath) !== "chalklee") throw new Error("只能从 ChalkLee 中读取题目。");
    const archive = await this.readArchive(root, filePath);
    const node = findQuestionNode(archive.document.content.content as JsonNode[], questionId);
    if (!node) throw new Error("题目已不存在，可能已被删除，请重新搜索。");
    const number = this.findEntry(filePath, questionId)?.number ?? "";
    const contentHash = questionContentHash(node);
    const location = { path: filePath, relativePath: this.relative(filePath), documentTitle: documentTitle(filePath), questionId, number, contentHash };
    const assetIds = new Set<string>();
    const visibleAssetIds = includeSolutionAssets ? undefined : new Set<string>();
    collectAssetIds(node, assetIds, visibleAssetIds);
    const assets: QuestionSnapshot["assets"] = [];
    const deferredAssetIds: string[] = [];
    for (const asset of archive.manifest.assets) {
      if (!assetIds.has(asset.id)) continue;
      if (visibleAssetIds && !visibleAssetIds.has(asset.id)) { deferredAssetIds.push(asset.id); continue; }
      const data = await archive.readAsset(asset.id);
      assets.push({ id: asset.id, path: asset.path, mediaType: asset.mediaType, sha256: asset.sha256, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer });
    }
    const copy = structuredClone(node) as QuestionSnapshot["node"];
    const { provenance: _provenance, ...shell } = archive.document;
    return {
      location,
      contentHash,
      node: copy,
      assets,
      document: { ...shell, content: { ...shell.content, content: [copy] } } as ChalkLeeDocument,
      paper: { fontFamilies: archive.document.appearance.body.fontFamilies, fontSizePt: archive.document.appearance.body.fontSizePt },
      ...(deferredAssetIds.length ? { deferredAssetIds } : {})
    };
  }

  /** The question's first figure, stem first, for compact basket rows; null when it has none. */
  async thumbnail(filePath: string, questionId: string): Promise<QuestionThumbnail | null> {
    const root = this.requireRoot();
    if (documentKind(filePath) !== "chalklee") return null;
    const archive = await this.readArchive(root, filePath);
    const node = findQuestionNode(archive.document.content.content as JsonNode[], questionId);
    if (!node) return null;
    const assetId = firstImageAssetId(node);
    if (!assetId) return null;
    const asset = archive.manifest.assets.find(candidate => candidate.id === assetId);
    if (!asset) return null;
    const data = await archive.readAsset(assetId);
    return { mediaType: asset.mediaType, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer };
  }

  /** The saved copies the library shows as one question with this one, this one first; empty when it is not indexed. */
  copies(filePath: string, questionId: string): QuestionBankEntry[] {
    this.requireRoot();
    // Group by what is saved now, not by the last debounced rebuild.
    if (this.rebuildTimer) this.rebuild();
    return questionCopies(this.questions, filePath, questionId).map(publicQuestionBankEntry);
  }

  async entry(filePath: string, questionId: string): Promise<QuestionBankEntry | null> {
    this.requireRoot();
    await this.update(filePath);
    const question = this.findEntry(filePath, questionId);
    return question ? publicQuestionBankEntry(question) : null;
  }

  async readBasket(): Promise<QuestionBasketItem[]> {
    const root = this.requireRoot();
    await this.basketWrite;
    let references: QuestionBasketReference[] = [];
    try {
      const file = path.join(await workspaceStorageDirectory(root, ["question-bank"], false), "basket.json");
      const parsed = JSON.parse(await readFile(file, "utf8"));
      if (parsed?.version === BASKET_VERSION && Array.isArray(parsed.items)) references = sanitizeBasket(parsed.items);
    } catch { /* No basket yet, or an unreadable one: start empty. */ }
    return references.map(reference => this.resolveBasketItem(reference));
  }

  async writeBasket(items: unknown): Promise<QuestionBasketItem[]> {
    const root = this.requireRoot();
    const references = sanitizeBasket(items);
    const write = this.basketWrite.then(async () => {
      const directory = await workspaceStorageDirectory(root, ["question-bank"], true);
      await writeAtomic(path.join(directory, "basket.json"), JSON.stringify({ version: BASKET_VERSION, items: references }));
    });
    this.basketWrite = write.catch(() => undefined);
    await write;
    return references.map(reference => this.resolveBasketItem(reference));
  }

  /** Documents with questions carrying any of these tags, as last indexed, and how many such questions each has. */
  documentsWithTags(tags: readonly string[]): Array<{ path: string; questions: number }> {
    const wanted = new Set(tags);
    return [...this.documents].flatMap(([filePath, document]) => {
      const questions = document.questions.filter(question => question.tags.some(tag => wanted.has(tag))).length;
      return questions ? [{ path: filePath, questions }] : [];
    });
  }

  /** The teacher's tag groups for this workspace; empty until any is made. */
  async readTagTree(): Promise<QuestionTagTree> {
    this.requireRoot();
    await this.tagTreeLoad;
    await this.tagTreeWrite;
    return this.tagTree;
  }

  async writeTagTree(input: unknown): Promise<QuestionTagTree> {
    const root = this.requireRoot();
    const generation = this.generation;
    const tagTree = normalizeQuestionTagTree(input);
    // After the initial load, so a slow read cannot replace what was just written.
    const write = Promise.all([this.tagTreeLoad, this.tagTreeWrite]).then(async () => {
      await writeWorkspaceTagTree(root, tagTree);
      this.updateTagTree(tagTree, generation);
    });
    this.tagTreeWrite = write.catch(() => undefined);
    await write;
    return tagTree;
  }

  private loadTagTree(root: string): Promise<QuestionTagTree> { return readWorkspaceTagTree(root); }

  private updateTagTree(tagTree: QuestionTagTree, generation: number) {
    if (generation !== this.generation) return;
    this.tagTree = tagTree;
    this.searches.clear();
    this.tagRevision++;
  }

  private resolveBasketItem(reference: QuestionBasketReference): QuestionBasketItem {
    // Per-document lookup sees a just re-indexed file before the debounced rebuild.
    const exact = this.findEntry(joinWorkspacePath(this.root ?? "", reference.relativePath), reference.questionId);
    // Renamed or moved documents keep their question IDs: follow the same content.
    const moved = exact ? undefined : [...this.documents.values()].flatMap(document => document.questions)
      .find(question => question.questionId === reference.questionId && question.contentHash === reference.contentHash);
    const question = exact ?? moved;
    if (!question) return { ...reference, status: this.status.state === "ready" ? "missing" : "pending", entry: null };
    return {
      ...reference,
      relativePath: question.relativePath,
      status: question.contentHash === reference.contentHash ? "ready" : "changed",
      entry: publicQuestionBankEntry(question)
    };
  }

  /** Verify the path and file fingerprint before reusing a parsed paper. Callers copy what they return. */
  private async readArchive(root: string, filePath: string) {
    const verifiedArchives = this.verifiedArchives;
    const { canonicalFile, fileStats } = await inspectWorkspaceDocument(root, filePath);
    const { dev, ino, size, mtimeMs, ctimeMs } = fileStats;
    const fingerprint = `${dev}:${ino}:${size}:${mtimeMs}:${ctimeMs}`;
    const cached = this.archives.get(canonicalFile);
    if (cached?.fingerprint === fingerprint) {
      this.archives.delete(canonicalFile);
      this.archives.set(canonicalFile, cached);
      return cached.archive;
    }
    const archive = readFile(canonicalFile).then(async (bytes): Promise<ChalkLeeArchiveReader> => {
      // The scan verified the entire archive. Compare the bytes we actually read,
      // including when a file was replaced between stat and readFile.
      const reader = cachePreviewAssets(await openChalkLeeArchiveForReading(bytes));
      if (!verifiedArchives?.has(createHash("sha256").update(bytes).digest("hex"))) {
        // A new or changed archive must still pass every asset check before
        // previewing. Discard inflated bytes as we go instead of keeping an
        // entire paper's pictures in the preview cache.
        for (const asset of reader.manifest.assets) await reader.readAsset(asset.id);
      }
      return reader;
    });
    const entry = { fingerprint, archive, bytes: size + ARCHIVE_ASSET_CACHE_BYTES, pending: true };
    this.archives.set(canonicalFile, entry);
    this.trimArchives();
    void archive.then(() => {
      entry.pending = false;
      if (this.archives.get(canonicalFile) === entry) this.trimArchives();
    }, () => { if (this.archives.get(canonicalFile) === entry) this.archives.delete(canonicalFile); });
    return archive;
  }

  private trimArchives() {
    let retained = [...this.archives.values()].reduce((total, entry) => total + entry.bytes, 0);
    for (const [key, entry] of this.archives) {
      if (this.archives.size <= ARCHIVE_CACHE && retained <= ARCHIVE_CACHE_BYTES) break;
      // While a large paper is being verified, concurrent requests share the
      // same read. Once settled it can be dropped even if no other entry fits.
      if (entry.pending) continue;
      this.archives.delete(key);
      retained -= entry.bytes;
    }
  }

  private async indexFile(root: string, filePath: string, generation: number, current = () => generation === this.generation): Promise<boolean> {
    const relativePath = this.relative(filePath);
    let createdAt: number | undefined;
    try {
      const { canonicalFile, fileStats } = await inspectWorkspaceDocument(root, filePath);
      if (!current()) return false;
      const fingerprint = `${fileStats.dev}:${fileStats.ino}:${fileStats.size}:${fileStats.mtimeMs}:${fileStats.ctimeMs}`;
      if (this.documents.get(filePath)?.fingerprint === fingerprint) return false;
      createdAt = fileStats.birthtimeMs;
      const archive = await openChalkLeeArchiveForReading(await readFile(canonicalFile));
      if (!current()) return false;
      const { document, manifest } = archive;
      const assetHashes = new Map(manifest.assets.map(asset => [asset.id, asset.sha256]));
      const assetAspects = new Map<string, number>();
      for (const id of figuresWithoutHeight(document.content.content as never)) {
        const sha256 = assetHashes.get(id);
        if (!sha256) continue;
        // A picture that cannot be read only makes its card's reserved height a guess.
        if (!this.figureAspects.has(sha256)) {
          const aspect = await archive.readAsset(id).then(imageFileAspect, () => null);
          if (!current()) return false;
          this.figureAspects.set(sha256, aspect);
          this.cacheState.dirtyAspects.add(sha256);
        }
        const aspect = this.figureAspects.get(sha256);
        if (aspect) assetAspects.set(id, aspect);
      }
      const entries = extractQuestionBankEntries(document, { path: filePath, relativePath, documentTitle: documentTitle(filePath), assetHashes, assetAspects });
      if (!current()) return false;
      this.setIndexedDocument(filePath, { relativePath, size: fileStats.size, modifiedAt: fileStats.mtimeMs, fingerprint, createdAt, failed: false, questions: entries.map(indexQuestionBankEntry) });
    } catch (error) {
      if (!current()) return false;
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !this.documents.has(filePath)) return false;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") this.setIndexedDocument(filePath, undefined);
      else this.setIndexedDocument(filePath, { relativePath, size: -1, modifiedAt: -1, createdAt, failed: true, questions: [] });
    }
    this.overviewCache = undefined;
    return true;
  }

  private findEntry(filePath: string, questionId: string) {
    const document = this.documents.get(filePath);
    return document?.questions.find(question => question.questionId === questionId);
  }

  private setIndexedDocument(filePath: string, document: IndexedDocument | undefined, dirty = true) {
    const before = this.documents.get(filePath);
    if (dirty) this.cacheState.dirtyDocuments.add(document?.relativePath ?? before?.relativePath ?? this.relative(filePath));
    for (const question of before?.questions ?? []) {
      const key = questionDuplicatePartition(question), partition = this.partitions.get(key);
      if (partition instanceof Set) {
        this.dirtyPartitions.add(key);
        partition.delete(question);
        if (partition.size === 1) this.partitions.set(key, partition.values().next().value!);
        else if (!partition.size) this.partitions.delete(key);
      } else {
        this.partitions.delete(key);
        this.dirtyPartitions.delete(key);
      }
    }
    if (!document) { this.documents.delete(filePath); return; }
    this.documents.set(filePath, document);
    for (const question of document.questions) {
      const key = questionDuplicatePartition(question), partition = this.partitions.get(key);
      // A new question with no candidate already has its own group id. No
      // need to enqueue all the unique questions during a warm open.
      if (partition) this.dirtyPartitions.add(key);
      if (partition instanceof Set) partition.add(question);
      else this.partitions.set(key, partition ? new Set([partition, question]) : question);
    }
  }

  private rebuild() {
    if (this.rebuildTimer) { clearTimeout(this.rebuildTimer); this.rebuildTimer = null; }
    const questions = [...this.documents.values()].flatMap(document => document.questions);
    // Figures that differ in bytes are compared by look once read; until then the questions stay apart.
    const unread = new Set<string>();
    const figureKeys = new Map<string, string[]>();
    for (const key of this.dirtyPartitions) {
      const partition = this.partitions.get(key);
      if (!partition) continue;
      if (!(partition instanceof Set)) { partition.duplicateGroup = partition.key; continue; }
      const consider = (figure: string) => {
        if (!this.figurePrints.has(figure) && figure.startsWith("sha256:")) {
          unread.add(figure);
          this.waitingFigurePartitions.add(key);
        }
      };
      assignDuplicateGroups([...partition], (left, right) => {
        consider(left); consider(right);
        const a = this.figurePrints.get(left), b = this.figurePrints.get(right);
        return a != null && b != null && sameFigurePrint(a, b);
      }, question => {
        const document = this.documents.get(question.path);
        if (!document) return undefined;
        document.surroundings ??= questionSurroundings(document.questions);
        return document.surroundings.get(question.key);
      }, { consider, keys: figure => {
        let keys = figureKeys.get(figure);
        if (!keys) {
          const print = this.figurePrints.get(figure);
          keys = print == null ? [] : figurePrintCandidateKeys(print);
          figureKeys.set(figure, keys);
        }
        return keys;
      } });
    }
    this.dirtyPartitions.clear();
    this.questions = questions;
    this.overviewCache = undefined;
    this.searches.clear();
    if (unread.size) this.printFigures(unread, questions);
    this.revision++;
    const failedDocuments = [...this.documents.values()].filter(document => document.failed).length;
    this.status = { ...this.status, questionCount: questions.length, failedDocuments };
    this.options.changed?.({ revision: this.revision, status: this.status });
  }

  /** Reads how these figures look from a paper holding each, then regroups; one batch at a time. */
  private printFigures(figures: ReadonlySet<string>, questions: readonly IndexedQuestion[]) {
    const root = this.root, generation = this.generation;
    if (this.printing || !root) return;
    const papers = new Map<string, Set<string>>(), assigned = new Set<string>();
    for (const question of questions) for (const figure of question.figures) {
      if (!figures.has(figure) || assigned.has(figure)) continue;
      assigned.add(figure);
      papers.set(question.path, (papers.get(question.path) ?? new Set()).add(figure));
    }
    this.printing = (async () => {
      for (const [filePath, needed] of papers) {
        const archive = await this.readArchive(root, filePath).catch(() => null);
        if (generation !== this.generation) return;
        if (archive) for (const asset of archive.manifest.assets) {
          const figure = `sha256:${asset.sha256}`;
          if (!needed.has(figure)) continue;
          const data = await archive.readAsset(asset.id).catch(() => undefined);
          if (generation !== this.generation) return;
          this.figurePrints.set(figure, pictureFigurePrint(asset.mediaType, data));
          this.cacheState.dirtyFigures.add(figure);
        }
        // A paper that cannot be read leaves its figures apart from every other.
        for (const figure of needed) if (!this.figurePrints.has(figure)) {
          this.figurePrints.set(figure, null);
          this.cacheState.dirtyFigures.add(figure);
        }
      }
    })().finally(() => {
      this.printing = null;
      for (const key of this.waitingFigurePartitions) this.dirtyPartitions.add(key);
      this.waitingFigurePartitions.clear();
      if (this.root && this.dirtyPartitions.size) this.scheduleRebuild();
      if (generation === this.generation) this.schedulePersist();
    });
  }

  private scheduleRebuild() {
    if (this.rebuildTimer) return;
    this.rebuildTimer = setTimeout(() => this.rebuild(), this.options.rebuildDelayMs ?? 250);
  }

  private schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    const root = this.root, generation = this.generation;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      // The initial cache, or a delta, should contain the completed indexing
      // batch rather than be rewritten again as its figures finish.
      if (this.status.state === "indexing" || this.printing) return;
      if (root && generation === this.generation) void this.persist(root, generation).catch(() => undefined);
    }, this.options.persistDelayMs ?? 1500);
  }

  /** Flush pending index work; used by tests and before quitting. */
  async flush() {
    await Promise.all([...this.activeUpdates.values(), ...this.pendingUpdates.values()].map(job => new Promise<void>(resolve => job.done.push(resolve))));
    if (this.rebuildTimer) this.rebuild();
    while (this.printing) {
      await this.printing;
      if (this.rebuildTimer) this.rebuild();
    }
    if (this.root && (this.persistTimer || this.cacheState.dirtyDocuments.size || this.cacheState.dirtyFigures.size || this.cacheState.dirtyAspects.size)) {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.persistTimer = null;
      await this.persist(this.root, this.generation);
    }
    await this.cacheWrite;
    await this.basketWrite;
    await this.tagTreeWrite;
  }

  /** User-authored basket and tag changes must finish. An unfinished search index
   * or image comparison is disposable: rebuilding it next time is safe. */
  async shutdown() {
    this.clearTimers();
    try {
      // Keep the useful completed batch when this costs no further indexing.
      if (this.root && this.status.state === "ready" && !this.activeUpdates.size && !this.pendingUpdates.size && !this.printing
        && (this.cacheState.dirtyDocuments.size || this.cacheState.dirtyFigures.size || this.cacheState.dirtyAspects.size)) {
        await this.persist(this.root, this.generation);
      }
    } finally {
      this.close();
      await Promise.all([this.cacheWrite, this.basketWrite, this.tagTreeWrite]);
    }
  }

  private async readCache(root: string) {
    const documents = new Map<string, CachedDocument>(), figures = new Map<string, string | null>(), aspects = new Map<string, number | null>();
    const state = emptyCacheState();
    const empty = () => ({ documents: new Map<string, CachedDocument>(), figures: new Map<string, string | null>(),
      aspects: new Map<string, number | null>(), state: emptyCacheState() });
    const readDocument = (document: CachedDocument) => {
      if (typeof document?.relativePath === "string" && Array.isArray(document.entries)) documents.set(document.relativePath, document);
    };
    try {
      const directory = await workspaceStorageDirectory(root, ["question-bank"], false);
      const cache = JSON.parse(await readFile(path.join(directory, "index.json"), "utf8")) as IndexCache;
      if (cache?.version !== CACHE_VERSION || !Array.isArray(cache.documents)) return empty();
      state.baseId = typeof cache.cacheId === "string" ? cache.cacheId : "";
      for (const document of cache.documents) readDocument(document);
      for (const [figure, print] of Object.entries(cache.figures ?? {})) if (typeof print === "string" || print === null) figures.set(figure, print);
      for (const [sha256, aspect] of Object.entries(cache.aspects ?? {})) if (typeof aspect === "number" || aspect === null) aspects.set(sha256, aspect);
      // Only overlays written against this base can supersede it. A damaged
      // overlay is not a reason to trust potentially older cached entries.
      const overlayText = await readFile(path.join(directory, "index-changes.json"), "utf8").catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      });
      if (overlayText !== undefined) {
        const overlay = JSON.parse(overlayText) as IndexOverlay;
        if (overlay?.version === CACHE_VERSION && overlay.baseId === state.baseId) {
          if (!Array.isArray(overlay.documents) || !Array.isArray(overlay.removed)) return empty();
          for (const document of overlay.documents) {
            if (typeof document?.relativePath !== "string" || !Array.isArray(document.entries)) return empty();
            readDocument(document);
            state.changes.set(document.relativePath, document);
          }
          for (const relativePath of overlay.removed) {
            if (typeof relativePath !== "string") return empty();
            documents.delete(relativePath);
            state.changes.set(relativePath, null);
          }
          for (const [figure, print] of Object.entries(overlay.figures ?? {})) if (typeof print === "string" || print === null) {
            figures.set(figure, print); state.figures.set(figure, print);
          }
          for (const [sha256, aspect] of Object.entries(overlay.aspects ?? {})) if (typeof aspect === "number" || aspect === null) {
            aspects.set(sha256, aspect); state.aspects.set(sha256, aspect);
          }
        }
      }
      return { documents, figures, aspects, state };
    } catch { return empty(); }
  }

  private persist(root: string, generation: number) {
    const write = this.cacheWrite.then(() => generation === this.generation ? this.writeCache(root) : undefined);
    this.cacheWrite = write.catch(() => undefined);
    return write;
  }

  private cachedDocument(document: IndexedDocument): CachedDocument {
    return {
      relativePath: document.relativePath, size: document.size, modifiedAt: document.modifiedAt, failed: document.failed,
      entries: document.questions.map(question => {
        const { path: _path, ...entry } = publicQuestionBankEntry(question);
        return entry;
      })
    };
  }

  private async writeCache(root: string) {
    const state = this.cacheState;
    const { dirtyDocuments, dirtyFigures, dirtyAspects } = state;
    if (!dirtyDocuments.size && !dirtyFigures.size && !dirtyAspects.size && state.baseId !== null) return;
    // New updates may arrive while this atomic write is in flight.
    state.dirtyDocuments = new Set(); state.dirtyFigures = new Set(); state.dirtyAspects = new Set();
    try {
      const compact = state.baseId === null
        || new Set([...state.changes.keys(), ...dirtyDocuments]).size > CACHE_OVERLAY_DOCUMENTS
        || new Set([...state.figures.keys(), ...dirtyFigures, ...state.aspects.keys(), ...dirtyAspects]).size > CACHE_OVERLAY_FIGURES;
      const directory = await workspaceStorageDirectory(root, ["question-bank"], true);
      if (state !== this.cacheState) return;
      if (compact) {
        const used = new Set<string>();
        for (const document of this.documents.values()) for (const question of document.questions) for (const figure of question.figures) used.add(figure);
        const cache: IndexCache = {
          version: CACHE_VERSION, cacheId: randomUUID(),
          documents: [...this.documents.values()].filter(document => document.size >= 0).map(document => this.cachedDocument(document)),
          figures: Object.fromEntries([...this.figurePrints].filter(([figure]) => used.has(figure))),
          aspects: Object.fromEntries([...this.figureAspects].filter(([sha256]) => used.has(`sha256:${sha256}`)))
        };
        await writeAtomic(path.join(directory, "index.json"), JSON.stringify(cache));
        // Even if interrupted here, the former overlay has another base id.
        state.baseId = cache.cacheId!;
        state.changes.clear(); state.figures.clear(); state.aspects.clear();
        await unlink(path.join(directory, "index-changes.json")).catch(() => undefined);
      } else {
        const changes = new Map(state.changes), figures = new Map(state.figures), aspects = new Map(state.aspects);
        for (const relativePath of dirtyDocuments) {
          const document = this.documents.get(joinWorkspacePath(root, relativePath));
          changes.set(relativePath, document && document.size >= 0 ? this.cachedDocument(document) : null);
        }
        for (const figure of dirtyFigures) if (this.figurePrints.has(figure)) figures.set(figure, this.figurePrints.get(figure)!);
        for (const hash of dirtyAspects) if (this.figureAspects.has(hash)) aspects.set(hash, this.figureAspects.get(hash)!);
        const overlay: IndexOverlay = {
          version: CACHE_VERSION, baseId: state.baseId!,
          documents: [...changes.values()].filter((document): document is CachedDocument => document !== null),
          removed: [...changes].flatMap(([relativePath, document]) => document === null ? [relativePath] : []),
          figures: Object.fromEntries(figures), aspects: Object.fromEntries(aspects)
        };
        await writeAtomic(path.join(directory, "index-changes.json"), JSON.stringify(overlay));
        state.changes = changes; state.figures = figures; state.aspects = aspects;
      }
    } catch (error) {
      for (const relativePath of dirtyDocuments) state.dirtyDocuments.add(relativePath);
      for (const figure of dirtyFigures) state.dirtyFigures.add(figure);
      for (const hash of dirtyAspects) state.dirtyAspects.add(hash);
      throw error;
    }
  }

  private requireRoot() {
    if (!this.root) throw new Error("尚未打开工作区。");
    return this.root;
  }

  private relative(filePath: string) {
    return path.relative(this.root ?? "", filePath).split(path.sep).join("/");
  }

  private clearTimers() {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.rebuildTimer = this.persistTimer = null;
  }
}

/** Share concurrent and recent reads without retaining a whole paper's inflated images. */
function cachePreviewAssets(archive: ChalkLeeArchiveReader): ChalkLeeArchiveReader {
  const sizes = new Map(archive.manifest.assets.map(asset => [asset.id, asset.byteLength]));
  const recent = new Map<string, { data: Promise<Uint8Array>; size: number }>();
  let total = 0;
  return {
    ...archive,
    readAsset(id) {
      const existing = recent.get(id);
      if (existing) {
        recent.delete(id);
        recent.set(id, existing);
        return existing.data;
      }
      const data = archive.readAsset(id);
      const size = sizes.get(id);
      if (size === undefined || size > ARCHIVE_ASSET_CACHE_BYTES) return data;
      const entry = { data, size };
      recent.set(id, entry);
      total += size;
      for (const [key, oldest] of recent) {
        if (total <= ARCHIVE_ASSET_CACHE_BYTES) break;
        recent.delete(key);
        total -= oldest.size;
      }
      void data.catch(() => {
        if (recent.get(id) !== entry) return;
        recent.delete(id);
        total -= size;
      });
      return data;
    }
  };
}

function chalkLeeFiles(directory: WorkspaceDirectoryNode): WorkspaceFileNode[] {
  return directory.children.flatMap(node => node.kind === "directory" ? chalkLeeFiles(node) : node.extension === "chalklee" ? [node] : []);
}

function isInternalPath(root: string, filePath: string) {
  return path.relative(root, filePath).split(path.sep).some(part => part.startsWith("."));
}

const documentTitle = (filePath: string) => path.basename(filePath).replace(/\.chalklee$/i, "");

function findQuestionNode(nodes: JsonNode[], questionId: string): JsonNode | null {
  for (const node of nodes) {
    if ((node.type === "question" || node.type === "questionGroup") && node.attrs?.id === questionId) return node;
    if (node.content) {
      const found = findQuestionNode(node.content, questionId);
      if (found) return found;
    }
  }
  return null;
}

function collectAssetIds(node: JsonNode, ids: Set<string>, visibleIds?: Set<string>) {
  if ((node.type === "image" || node.type === "imageInline") && typeof node.attrs?.assetId === "string") {
    ids.add(node.attrs.assetId);
    visibleIds?.add(node.attrs.assetId);
  }
  const childVisibleIds = node.type === "questionAnswer" || node.type === "questionAnalysis" ? undefined : visibleIds;
  node.content?.forEach(child => collectAssetIds(child, ids, childVisibleIds));
}

function findImageAssetId(node: JsonNode | undefined): string | null {
  if (!node) return null;
  if ((node.type === "image" || node.type === "imageInline") && typeof node.attrs?.assetId === "string") return node.attrs.assetId;
  for (const child of node.content ?? []) {
    const hit = findImageAssetId(child);
    if (hit) return hit;
  }
  return null;
}

/** The stem figure first, then any figure in the question, so the thumbnail says what the question is about. */
function firstImageAssetId(node: JsonNode): string | null {
  const stem = node.content?.find(child => child.type === "questionStem" || child.type === "questionMaterial");
  return findImageAssetId(stem) ?? findImageAssetId(node);
}

function sanitizeBasket(items: unknown): QuestionBasketReference[] {
  if (!Array.isArray(items)) throw new Error("选题篮内容无效。");
  const seen = new Set<string>();
  const result: QuestionBasketReference[] = [];
  for (const item of items.slice(0, MAX_BASKET_ITEMS)) {
    if (!item || typeof item !== "object") continue;
    const { relativePath, questionId, contentHash, addedAt, insertedInto } = item as Record<string, unknown>;
    if (typeof relativePath !== "string" || !relativePath || relativePath.length > 1000 || relativePath.split("/").includes("..") || path.isAbsolute(relativePath)) continue;
    if (typeof questionId !== "string" || !questionId || questionId.length > 200 || typeof contentHash !== "string" || contentHash.length > 64) continue;
    const key = `${relativePath}\u0000${questionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      relativePath, questionId, contentHash,
      addedAt: typeof addedAt === "number" && Number.isFinite(addedAt) ? addedAt : Date.now(),
      insertedInto: Array.isArray(insertedInto) ? [...new Set(insertedInto.filter((value): value is string => typeof value === "string" && value.length <= 1000))].slice(0, 50) : []
    });
  }
  return result;
}

/** A workspace's tag groups as saved, for when its index is not the open one. */
export async function readWorkspaceTagTree(root: string): Promise<QuestionTagTree> {
  try {
    const file = path.join(await workspaceStorageDirectory(root, ["question-bank"], false), "tags.json");
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (parsed?.version === TAG_TREE_VERSION) return normalizeQuestionTagTree(parsed);
  } catch { /* No groups yet, or an unreadable file: start without groups. */ }
  return EMPTY_QUESTION_TAG_TREE;
}

export async function writeWorkspaceTagTree(root: string, tagTree: QuestionTagTree): Promise<void> {
  const directory = await workspaceStorageDirectory(root, ["question-bank"], true);
  await writeAtomic(path.join(directory, "tags.json"), JSON.stringify({ version: TAG_TREE_VERSION, groups: tagTree.groups, tags: tagTree.tags }));
}

async function writeAtomic(filePath: string, text: string) {
  const temporary = `${filePath}.${randomUUID()}.next`;
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
