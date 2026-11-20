/** Automatic versions of a ChalkLee, shared by the main process and the version list. */

/** What overwrote the content a version keeps: an edit in the window, an agent's edit, or a restore. */
/** "proofread": the paper just before a proofread against the original was written into it. */
/** "conversion": the paper just before a continued or repeated conversion of its original was written into it. */
export type DocumentVersionReason = "edit" | "assistant" | "restore" | "proofread" | "conversion";

export interface DocumentVersion {
  id: string;
  createdAt: number;
  reason: DocumentVersionReason;
  /** One line for the teacher, e.g. "ChalkLee AI 修改前". */
  label: string;
  /** Workspace path of the file when saved; copies of a paper share its history. */
  file: string;
  size: number;
  questionCount: number;
}

export interface DocumentVersions {
  /** Null for a document without a usable id; it then has no history. */
  documentId: string | null;
  /** Newest first. */
  versions: DocumentVersion[];
  /** The first conversion, kept since the paper was converted. */
  initial?: { createdAt: number; model?: string; questionCount?: number };
}
