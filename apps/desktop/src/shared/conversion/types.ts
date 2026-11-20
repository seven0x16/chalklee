import type { ChalkLeeBlockNode, ChalkLeePageAppearance } from "@chalklee/format";
import type { WorkspaceFileNode } from "../contracts";

/** The service conversion and the assistant currently use (see aiProviders for the full list). */
export interface AiSettings {
  baseUrl: string;
  model: string;
  structureModel?: string;
  hasApiKey: boolean;
  /** An active service with its key (or a keyless local service) and a model. */
  ready: boolean;
  serviceName?: string;
}

export interface ImportImage {
  id: string;
  dataUrl: string;
  widthPt: number;
  heightPt: number;
  pageBounds?: [number, number, number, number];
  /** An isolated printed option marker omitted from the source-page crop. */
  prefixMask?: [number, number, number, number];
  role?: "formula-preview" | "inline-image";
}

export interface ImportUnit {
  id: string;
  label: string;
  page?: number;
  text?: string;
  /** Optional cached OCR data; never substitutes for original pixels or review. */
  ocrReference?: { status: "unverified-reference"; coordinateSystem: string; [key: string]: unknown };
  /** Positioned native PDF text. A candidate still needs an independent layout check. */
  pdfText?: { candidate: boolean; reason: string; blocks: ChalkLeeBlockNode[]; lines: { ref: string; text: string; box: [number, number, number, number] }[]; omittedMargins: string[];
    /** Visible native glyph positions are diagnostic clues, verified against the corresponding pixels. */
    scriptRegions?: { box: [number, number, number, number]; base: string; aboveLeft: string; belowLeft: string }[];
    /** Formula strips the glyph positions cannot settle, recognized from their pixels before the native text is used. */
    regions?: { ref: string; text: string; box: [number, number, number, number] }[] };
  /** Source content is fixed and must be referenced; includes recognized PDF content. */
  nativeReferences?: boolean;
  sourceRoles?: Record<string, "body" | "heading" | "answer" | "analysis">;
  /** A visually confirmed compact answer key can omit its printed answer title. */
  answerStartRef?: string;
  /** Computed across the source, so an answer continuation retains its owner. */
  sourceQuestionNumbers?: Record<string, string>;
  /** Derived from the already validated preceding unit, never from OCR guesses. */
  continuation?: { type: "question" | "questionGroup"; number: string; parentNumbers?: string[] };
  blocks: ChalkLeeBlockNode[];
  images: ImportImage[];
}

export interface PreparedImport {
  /** Existing import whose immutable source is being retried; its saved progress is reused. */
  retryOf?: string;
  /** The ChalkLee this result updates as a new version, merged with the teacher's edits, instead of a new file. */
  into?: string;
  sourcePath: string;
  /** Immutable source captured when a background conversion is submitted. */
  sourceSnapshotPath?: string;
  sourceHash: string;
  /** A separate cache for this conversion, instead of the one shared by every conversion of the same original. */
  cacheScope?: string;
  page: ChalkLeePageAppearance;
  units: ImportUnit[];
  warnings: string[];
  mathType?: { total: number; native: number };
}

export interface ImportProgress {
  sourcePath: string;
  completed: number;
  total: number;
  message: string;
  stage?: "finalizing" | "saving" | "reviewing";
  /** Sources whose current content passed the independent review, while proofreading. */
  reviewed?: number;
  sourcePreserved?: number;
}

export interface ImportNotice {
  message: string;
  page?: number;
  nodeId?: string;
  /** Verified question owners. nodeId alone can be only a page/part locator. */
  questionIds?: string[];
}

/** A local correction to a working source block; the original extraction stays intact. */
export interface SourceFragmentEdit {
  ref: string;
  /** Node path relative to the source block; only content/child-index pairs are allowed. */
  path: (string | number)[];
  kind: "typo" | "recognition" | "image-formula";
  before: string;
  after: string;
  reason: string;
  evidenceImageId?: string;
}
export interface SourceFragmentRevision extends SourceFragmentEdit {
  unitId: string;
  beforeHash: string;
  afterHash: string;
  evidenceHash?: string;
  /** The exact extracted block before its first revision. */
  originalBlock?: ChalkLeeBlockNode;
}

/** Explicit settings for a conversion run; omitted values retain the usual defaults. */
export interface ImportExecutionOptions {
  reasoningEffort?: "low" | "medium" | "high";
  requestTimeoutMs?: number;
  reviewTimeoutMs?: number;
  reviewApi?: "chat-completions" | "responses";
}

export interface ImportRecord {
  documentId: string;
  sourceName: string;
  sourcePath: string;
  sourceHash: string;
  model: string;
  createdAt: string;
  warnings: ImportNotice[];
  questionCount: number;
  unitCount: number;
  conversion?: { strategy: "staged-v1" | "autonomous-v1"; status?: "converted" | "draft";
    /** PDF recognition was frozen before the shared reference-based structuring stage. */
    sourceReferences?: boolean;
    sourceRevisions?: SourceFragmentRevision[];
    /** A whole first draft the teacher has not yet had proofread against the original ("pending"), or one that was ("done"). */
    proofread?: "pending" | "done";
    units?: ImportUnitResult[]; structureModel: string; execution?: ImportExecutionOptions; calls: ImportModelCall[]; cachedUnits: number; answers?: ImportAnswerReport; formulas?: { native: number; recognized: number; unresolved: number }; agent?: { rounds: number; resumed: boolean; actions: ImportReviewAction[]; previewPages: number }; reviews?: { unit: string; completed: boolean; actions: ImportReviewAction[] }[];
    /** Knowledge-point tags ChalkLee AI put on the delivered copy: the preset course it drew on, and how many questions got tags. */
    tags?: { course: string | null; questions: number };
    timing?: ImportTiming };
}

export interface ImportUnitResult {
  id: string;
  label: string;
  page?: number;
  status: "converted" | "source-preserved";
  stage?: "transcribe" | "review" | "structure" | "agent";
  reason?: string;
  nodeId?: string;
  recognition?: "native-text" | "visual";
  recognitionReason?: string;
}

export interface ImportAnswerReport {
  entries: number;
  matched: number;
  unmatched: number;
  conflicting: number;
  links: { sourceNodeId: string; questionNodeId: string; number: string; regions: string[] }[];
}

export interface ImportReviewAction { tool: string; args: Record<string, unknown>; ok: boolean; error?: string; report?: string }

export interface ImportModelCall {
  stage: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  totalTokens: number;
  /** From the start of the request to the end of the reply. */
  durationMs?: number;
  /** When the reply ended, in milliseconds since the epoch. */
  endedAt?: number;
  /** The page or part the call worked on, when it worked on one. */
  unit?: string;
}

/** Wall-clock time of a conversion's steps, for finding where it waits. */
export interface ImportTiming {
  /** Reading and recognizing the pages. */
  prepareMs?: number;
  /** Organizing questions and checking the rendered result. */
  assembleMs?: number;
  /** Rendering sharper figures, tagging and writing the file. */
  saveMs?: number;
}

export interface ImportResult {
  file: WorkspaceFileNode;
  record: ImportRecord;
}

export interface ImportHistory {
  record: ImportRecord;
  /** Absent once the original was changed or removed: ChalkLee keeps no copy of it. */
  source?: WorkspaceFileNode;
  /** A Markdown note still where it was converted from, edited since; the document does not follow it. */
  editedSource?: WorkspaceFileNode;
}
