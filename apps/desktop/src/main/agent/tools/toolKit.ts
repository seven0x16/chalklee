import path from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { Type, type Static, type TSchema } from "typebox";
import type { AssistantApproval, AssistantToolDetails, AssistantUiAction } from "../../../shared/agent/assistant";
import type { ConversionBatchAction, ConversionTask } from "../../../shared/conversion/tasks";
import type { QuestionBankSearchRequest, QuestionBankSearchResponse } from "../../../shared/questionBank/search";
import type { QuestionTagTree } from "../../../shared/questionBank/tagTree";
import type { AgentWorkspaceService } from "../workspace";
import type { AssistantMemory } from "../assistant/memory";
import type { ExternalImportService } from "../../conversion/externalSession";
import type { WebSearchRequest, WebSearchResult } from "../../../shared/settings/webSearch";
import type { InstalledPlugin, PluginManifest } from "../../../shared/plugins/manifest";

/** Where a tool is offered: the built-in assistant (Pi), external agents over MCP, or plugins through the capabilities in `main/plugins`. */
export type ToolSurface = "assistant" | "mcp" | "plugin";

/**
 * Window-backed actions, so files, tabs and the basket change exactly as by hand. The built-in assistant and external
 * agents get the same window; `memory` and `webSearch` are the built-in assistant's own.
 */
export interface AppToolHost {
  webSearch?(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
  ui<T = unknown>(action: AssistantUiAction): Promise<T>;
  searchQuestions(request: QuestionBankSearchRequest): QuestionBankSearchResponse | Promise<QuestionBankSearchResponse>;
  /** Queues a conversion; `force` converts again an original whose conversion already finished. */
  /** `batch`: shared by the originals one request starts together. */
  /** `into`: the ChalkLee a repeated conversion updates instead of adding another file. */
  startConversion(path: string, options?: { force?: boolean; batch?: string; into?: string }): Promise<ConversionTask>;
  conversions(): ConversionTask[];
  /** One task's stop, continue, proofread or keep-the-draft, as its buttons in the task list. */
  conversionAction(id: string, action: ConversionBatchAction): Promise<unknown>;
  /** The question library's tag groups, and which papers use a tag; a written tree shows in the window at once. */
  tags: { tree(): Promise<QuestionTagTree>; writeTree(tree: QuestionTagTree): Promise<QuestionTagTree>; documentsWith(tags: readonly string[]): Array<{ path: string; questions: number }> | Promise<Array<{ path: string; questions: number }>> };
  memory?: AssistantMemory;
  plugins?: PluginHost;
}

/** The plugin center as the teacher uses it: installs and removals are reviewed or confirmed in the window. */
export interface PluginHost {
  /** Turns a workspace page into a plugin, after the teacher's approval when it asks for anything new. */
  installPage(file: string, plugin: PluginPageRequest): Promise<PluginInstallResult>;
  list(): Promise<InstalledPlugin[]>;
  /** Built-in plugins the teacher removed, which can be put back. */
  removedBuiltins(): Promise<PluginManifest[]>;
  restoreBuiltin(id: string): Promise<InstalledPlugin>;
  /** The plugin's code goes to the bin; its data stays, so installing it again brings it back. */
  remove(id: string): Promise<void>;
  /** The share file, saved where the teacher picks in the system save window; false when they cancel. */
  share(id: string): Promise<boolean>;
}

/** `author`: who made it, the built-in assistant or the external agent, shown in the plugin center. */
export interface PluginPageRequest { id: string; name: string; summary: string; description?: string; permissions: string[]; author: string }
export type PluginInstallResult = { status: "installed" | "updated"; name: string; version: string } | { status: "declined" };

/** Everything one call may use; `root` is the workspace the call works in. */
export interface ToolHost {
  surface: ToolSurface;
  root: string;
  documents: AgentWorkspaceService;
  app?: AppToolHost;
  /** External conversion sessions over MCP, named after the calling agent. */
  external?: { service: ExternalImportService; agent: string };
  /** The built-in assistant conversation making the call. */
  conversationId?: string;
  /** Pictures sent in that conversation, numbered from 1 as the messages list them. */
  attachment?(index: number): { data: string; mimeType: string } | undefined;
}

export interface BankInsertResult { inserted: number; skipped: number; questionIds: string[] }

export interface ToolOutput { value: unknown; images?: ImageContent[]; details?: AssistantToolDetails }
export type ToolConfirmation = Omit<AssistantApproval, "id" | "toolCallId">;

export interface ChalkLeeTool<S extends TSchema = TSchema> {
  name: string;
  /** Short Chinese name for the assistant's step list. */
  label: string;
  description: string;
  /** Appended to the description on one surface, for behaviour only that surface has. */
  notes?: Partial<Record<ToolSurface, string>>;
  parameters: S;
  surfaces: readonly ToolSurface[];
  kind: "read" | "write" | "destructive";
  /** Reaches outside the workspace (e.g. importing a local file). */
  openWorld?: boolean;
  /** The built-in assistant asks the person before running it. */
  confirm?(args: Static<S>, host: ToolHost): Promise<ToolConfirmation | null> | ToolConfirmation | null;
  execute(args: Static<S>, host: ToolHost, signal?: AbortSignal): Promise<ToolOutput>;
}

export const defineTool = <S extends TSchema>(tool: ChalkLeeTool<S>) => tool as unknown as ChalkLeeTool;
export const BOTH: readonly ToolSurface[] = ["assistant", "mcp"];
export const ASSISTANT: readonly ToolSurface[] = ["assistant"];
export const MCP: readonly ToolSurface[] = ["mcp"];
/** Shared tools a plugin may also use; `main/plugins/capabilities.ts` decides how, and under which permission. */
export const WITH_PLUGINS: readonly ToolSurface[] = ["assistant", "mcp", "plugin"];
export const ASSISTANT_AND_PLUGINS: readonly ToolSurface[] = ["assistant", "plugin"];

export const toolDescription = (tool: ChalkLeeTool, surface: ToolSurface) => tool.notes?.[surface] ? `${tool.description}${tool.notes[surface]}` : tool.description;
export const output = (value: unknown, details?: AssistantToolDetails, images?: ImageContent[]): ToolOutput => ({ value, ...(details ? { details } : {}), ...(images?.length ? { images } : {}) });

export const relative = (root: string, file: string) => path.relative(root, file).split(path.sep).join("/") || ".";
export const displayName = (file: string) => path.basename(file).replace(/\.(chalklee|pdf|docx?|tex|md|markdown|html?)$/i, "");
export const documentRef = (file: string, questionId?: string) => ({ path: file, name: displayName(file), ...(questionId ? { questionId } : {}) });

export function requireApp(host: ToolHost): AppToolHost {
  if (!host.app) throw new Error("该操作需要打开 ChalkLee 窗口。");
  return host.app;
}
export function requireExternal(host: ToolHost) {
  if (!host.external) throw new Error("转换会话只供外部 Agent 使用。");
  return host.external;
}

/** A write result as both surfaces report it; MCP also gets the browser editor URL. */
export function written(host: ToolHost, result: { path: string; revision: string; saved?: boolean; previewUrl?: string; syncWarnings?: string[]; updatedQuestionIds?: string[] }, extra: Record<string, unknown> = {}) {
  return {
    path: relative(host.root, result.path), revision: result.revision, saved: result.saved !== false, ...extra,
    ...(result.updatedQuestionIds?.length ? { updatedQuestionIds: result.updatedQuestionIds } : {}),
    ...(result.syncWarnings?.length ? { syncWarnings: result.syncWarnings } : {}),
    ...(host.surface === "mcp" && result.previewUrl ? { previewUrl: result.previewUrl } : {})
  };
}

/** Where an inserted picture may come from: the conversation's pictures, and for external agents image files outside the workspace too. */
export const pictureSources = (host: ToolHost) => ({ attachment: host.attachment, outside: host.surface === "mcp" });

/** Who a change is by, as the window and its records name it. */
export const actorName = (host: ToolHost) => host.surface === "mcp" ? host.external?.agent || "外部 Agent" : "ChalkLee AI";

export const PathParam = Type.String({ minLength: 1, description: "工作区相对路径（如 \"高一/期中.chalklee\"），也接受绝对路径" });
export const RevisionParam = Type.Optional(Type.String({ pattern: "^sha256:[a-f0-9]{64}$", description: "读取时返回的 revision；提供后若文档已被修改会拒绝写入" }));
export const strict = { additionalProperties: false } as const;
