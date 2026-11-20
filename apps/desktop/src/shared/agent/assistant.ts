import type { PluginReview } from "../plugins/manifest";
import { DOCUMENT_KINDS, type DocumentKind } from "../document/kinds";
/** Built-in assistant: conversation view models shared by the main process and the panel. */
import type { QuestionBankType, QuestionDifficulty } from "../questionBank/search";
import type { WebSearchSource } from "../settings/webSearch";

export interface AssistantDocumentRef { path: string; name: string; kind: DocumentKind }

export type AssistantBlockKind = "paragraph" | "heading" | "image" | "graphic" | "formula" | "table" | "answerLines";
/** Where the caret or selection is in the open paper, so “这里”“这段”“这个框”“这页” need no description. */
export interface AssistantSelection {
  /** The page it is on, from 1. */
  page: number | null;
  box: { id: string; label: string | null } | null;
  /** The blocks it touches, each with its opening words; none inside a question, which is attached itself. */
  blocks: Array<{ id: string; kind: AssistantBlockKind; text: string }>;
  /** Text is selected, not just a caret. */
  range: boolean;
}
/** What the composer shows as selected besides a question: a box the caret is in, or selected text. */
export type AssistantPointedAt = { kind: "box"; id: string; label: string | null } | { kind: "text" };

/** What the user is looking at, attached to each message so "this paper" needs no lookup. */
export interface AssistantUiContext {
  workspaceRoot: string | null;
  activeDocument: (AssistantDocumentRef & { dirty: boolean }) | null;
  selectedQuestion: { id: string; label: string | null } | null;
  /** The panel's chip only; the full description is read from the paper when sending. */
  pointedAt?: AssistantPointedAt | null;
  /** Pages of the open paper, for the panel's suggestions only. */
  pageCount?: number;
  selection?: AssistantSelection | null;
  openDocuments: AssistantDocumentRef[];
  basketCount: number;
  /** What fills the middle; in the library "these questions" are the listed ones, not a paper. */
  place?: "documents" | "library";
  /** In the library: its conditions and the question picked there, unless the teacher detached them. */
  questionLibrary?: AssistantLibraryContext | null;
  /** Workspace files the teacher dragged onto the conversation for this message. */
  attachedFiles?: AssistantDocumentRef[];
}

/** A picture pasted or dropped onto the message box, sent to the model with the message only. */
export interface AssistantImage { data: string; mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" }
export const ASSISTANT_IMAGE_LIMIT = 4;

/** The selected question as the teacher reads it: editors give "第 3 题" or "题组", others a bare number. */
export const assistantQuestionLabel = (label: string) => /^第|题/.test(label) ? label : `第 ${label} 题`;

export interface AssistantLibraryContext {
  /** e.g. ["关键词“函数”", "年级：初三", "标签：二次函数 或 一次函数"]; empty while every question is listed. */
  conditions: string[];
  total: number | null;
  selected: { path: string; questionId: string; number: string; document: string } | null;
}

/** A question_search the library can list again under the same conditions. */
export interface AssistantQuestionSearch {
  query?: string;
  year?: number;
  grade?: number;
  type?: QuestionBankType;
  difficulty?: QuestionDifficulty;
  /** Every one of them, as in question_search. */
  tags?: string[];
  total: number;
}

export type AssistantContentPart =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

export type AssistantChatMessage =
  | { role: "user"; id: string; text: string; context?: { document?: string; library?: string; question?: string; files?: string[]; images?: number }; timestamp: number }
  | {
    role: "assistant"; id: string; content: AssistantContentPart[]; stopReason?: string; errorMessage?: string; timestamp: number;
    /** When the message ended, and for the first reply after a retry, when the retry asked again. */
    completedAt?: number; requestedAt?: number;
  }
  | { role: "toolResult"; id: string; toolCallId: string; toolName: string; text: string; isError: boolean; details?: AssistantToolDetails; timestamp: number };

/** Structured hints a tool returns for the panel, such as documents the step touched. */
export interface AssistantToolDetails {
  documents?: Array<{ path: string; name: string; questionId?: string }>;
  summary?: string;
  images?: number;
  /** A finished directory organisation, so its card can show where things went and undo it. */
  organize?: { id: string; moved: number; folders: number; lines: string[] };
  questionSearch?: AssistantQuestionSearch;
  webSearch?: { sources: WebSearchSource[]; message?: string; settings?: boolean };
}

/** One directory organisation as the interface shows it, whoever ran or undid it. */
export interface OrganizeRecord {
  id: string;
  createdAt: number;
  /** e.g. "ChalkLee AI" or the external agent's name. */
  by?: string;
  conversationId?: string;
  /** One file_move rather than a reviewed plan. */
  single?: boolean;
  /** Items as the teacher sees the tree; an original that went with its ChalkLee is part of it. */
  moved: number;
  lines: string[];
  undone: boolean;
  undo?: { restored: number; skipped?: string[]; keptFolders?: string[] };
}

export interface AssistantApproval {
  id: string;
  toolCallId: string;
  title: string;
  detail?: string;
  /** Wording of the confirming button, e.g. "移到废纸篓". */
  action: string;
  /** What will change, one line each, e.g. a folder and the files going into it. */
  lines?: string[];
  /** "primary" for a reviewed plan rather than a removal. */
  tone?: "danger" | "primary";
}

export interface AssistantConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface AssistantConversation extends AssistantConversationSummary {
  messages: AssistantChatMessage[];
  running: boolean;
  approval: AssistantApproval | null;
  error: string | null;
  /** What the harness is doing besides answering, e.g. compacting the context or waiting to retry. */
  activity: string | null;
  /** Documents the latest finished run changed that its reply can put back. */
  undoable?: string[] | null;
  /** While a run asks again without a new message (a retry, or notes the last run left), when it asked; its reply is timed from then. */
  requestedAt?: number | null;
}

export type AssistantEvent =
  | { type: "conversation"; conversation: AssistantConversation }
  | { type: "message"; conversationId: string; message: AssistantChatMessage }
  | { type: "status"; conversationId: string; running: boolean; error: string | null; activity: string | null; requestedAt?: number | null }
  | { type: "approval"; conversationId: string; approval: AssistantApproval | null }
  | { type: "list"; conversations: AssistantConversationSummary[] };

export interface AssistantSendRequest {
  /** With `create`, the id the panel chose for a new conversation, so it can follow its events at once. */
  conversationId?: string;
  create?: boolean;
  text: string;
  context: AssistantUiContext;
  images?: AssistantImage[];
}

export interface AssistantStatus {
  configured: boolean;
  model: string | null;
}

/** Interface actions the assistant performs through the window, keeping tabs and editors in step. */
export type AssistantUiAction =
  | { action: "open"; path: string; questionId?: string; page?: number }
  | { action: "file"; operation: "rename" | "move" | "copy" | "trash"; path: string; name?: string; directory?: string }
  | { action: "basket"; operation: "list" | "add" | "remove" | "clear" | "order"; questions?: Array<{ path: string; questionId: string }> }
  | { action: "conversion-mark"; path: string; needed: boolean }
  | { action: "insert-bank-questions"; path: string; questions: Array<{ path: string; questionId: string }>; afterQuestionId?: string }
  | { action: "version"; operation: "list" | "copy" | "restore"; path: string; versionId?: string }
  | { action: "assistant-draft"; text: string }
  | { action: "plugin-review"; review: PluginReview };

export type AssistantUiRequest = AssistantUiAction & { requestId: string };
export interface AssistantUiReply { requestId: string; value?: unknown; error?: string }

/** Marks the context block in a user message; the panel shows only the user's own words. */
export const ASSISTANT_CONTEXT_TAG = "chalklee-context";

const KINDS = DOCUMENT_KINDS;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const image = (value: unknown): AssistantImage | null => {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const data = text(item?.data, 8_000_000);
  return data && /^[A-Za-z0-9+/]+=*$/.test(data) && IMAGE_TYPES.includes(item!.mimeType as AssistantImage["mimeType"]) ? { data, mimeType: item!.mimeType as AssistantImage["mimeType"] } : null;
};
const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max ? value : null;
const documentRef = (value: unknown): AssistantDocumentRef | null => {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const file = text(item?.path, 4096), name = text(item?.name, 400);
  return file && name && KINDS.includes(item!.kind as typeof KINDS[number]) ? { path: file, name, kind: item!.kind as AssistantDocumentRef["kind"] } : null;
};

const library = (value: unknown): AssistantLibraryContext | null => {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!item || !Array.isArray(item.conditions)) return null;
  const selected = item.selected && typeof item.selected === "object" ? item.selected as Record<string, unknown> : null;
  const path = text(selected?.path, 4096), questionId = text(selected?.questionId, 200), number = text(selected?.number, 40), document = text(selected?.document, 400);
  return {
    conditions: item.conditions.slice(0, 30).flatMap(condition => text(condition, 400) ?? []),
    total: Number.isInteger(item.total) && (item.total as number) >= 0 ? item.total as number : null,
    selected: path && questionId && number !== null && document !== null ? { path, questionId, number, document } : null
  };
};

const BLOCK_KINDS = new Set<AssistantBlockKind>(["paragraph", "heading", "image", "graphic", "formula", "table", "answerLines"]);
const selection = (input: unknown): AssistantSelection | null => {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>, box = value.box && typeof value.box === "object" ? value.box as Record<string, unknown> : null;
  const boxId = text(box?.id, 200);
  const page = Number.isInteger(value.page) && (value.page as number) > 0 && (value.page as number) < 10_000 ? value.page as number : null;
  return {
    page, box: boxId ? { id: boxId, label: text(box?.label, 60) } : null, range: value.range === true,
    blocks: Array.isArray(value.blocks) ? value.blocks.slice(0, 6).flatMap(item => {
      const block = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const id = text(block.id, 200);
      return id && BLOCK_KINDS.has(block.kind as AssistantBlockKind) ? [{ id, kind: block.kind as AssistantBlockKind, text: text(block.text, 40) ?? "" }] : [];
    }) : []
  };
};

const BLOCK_NAMES: Record<AssistantBlockKind, string> = { paragraph: "段落", heading: "标题", image: "图片", graphic: "图形", formula: "公式", table: "表格", answerLines: "作答横线" };
/** e.g. 第 3 页，“注意”盒子（id box_1）中，段落“a ≠ 0 是必要条件”（id p_7） */
export function assistantSelectionText(selection: AssistantSelection): string {
  return [
    selection.page ? `第 ${selection.page} 页` : "",
    selection.box ? `${selection.box.label ? `“${selection.box.label}”` : ""}盒子（id ${selection.box.id}）中` : "",
    selection.blocks.map(block => `${BLOCK_NAMES[block.kind]}${block.text ? `“${block.text}”` : ""}（id ${block.id}）`).join("、")
  ].filter(Boolean).join("，");
}

/** IPC input is untrusted: keep only known, bounded fields. */
export function normalizeAssistantSendRequest(input: unknown): AssistantSendRequest {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const context = (value.context && typeof value.context === "object" ? value.context : {}) as Record<string, unknown>;
  const active = documentRef(context.activeDocument);
  const selected = context.selectedQuestion && typeof context.selectedQuestion === "object" ? context.selectedQuestion as Record<string, unknown> : null;
  const selectedId = text(selected?.id, 200);
  return {
    conversationId: text(value.conversationId, 64) ?? undefined,
    create: value.create === true,
    text: text(value.text, 40_000) ?? "",
    images: Array.isArray(value.images) ? value.images.slice(0, ASSISTANT_IMAGE_LIMIT).flatMap(item => image(item) ?? []) : [],
    context: {
      workspaceRoot: text(context.workspaceRoot, 4096),
      activeDocument: active ? { ...active, dirty: (context.activeDocument as Record<string, unknown>).dirty === true } : null,
      selectedQuestion: selectedId ? { id: selectedId, label: text(selected?.label, 80) } : null,
      selection: selection(context.selection),
      openDocuments: Array.isArray(context.openDocuments) ? context.openDocuments.slice(0, 50).flatMap(item => documentRef(item) ?? []) : [],
      attachedFiles: Array.isArray(context.attachedFiles) ? context.attachedFiles.slice(0, 20).flatMap(item => documentRef(item) ?? []) : [],
      basketCount: Number.isInteger(context.basketCount) && (context.basketCount as number) >= 0 ? context.basketCount as number : 0,
      place: context.place === "library" ? "library" : "documents",
      questionLibrary: library(context.questionLibrary)
    }
  };
}
