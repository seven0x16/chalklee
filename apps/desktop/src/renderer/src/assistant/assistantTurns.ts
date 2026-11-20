import type { AssistantApproval, AssistantChatMessage, AssistantToolDetails } from "../../../shared/agent/assistant";
import { isSkillsFolder, skillAt } from "../../../shared/skills";

export type AssistantStepStatus = "running" | "waiting" | "done" | "error" | "stopped";

export interface AssistantStep {
  id: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
  status: AssistantStepStatus;
  result?: string;
  details?: AssistantToolDetails;
}

export type AssistantBlock =
  | { kind: "text"; id: string; text: string; streaming: boolean }
  | { kind: "thinking"; id: string; text: string; streaming: boolean }
  | { kind: "steps"; id: string; steps: AssistantStep[] }
  /** A directory organisation: one card from confirmation through its undo. */
  | { kind: "organize"; id: string; step: AssistantStep };

export interface AssistantTurn {
  id: string;
  user: Extract<AssistantChatMessage, { role: "user" }> | null;
  blocks: AssistantBlock[];
  /** The newest turn of a running conversation. */
  active: boolean;
  stopped: boolean;
  error: string | null;
  /** When the request was made (or last retried) and when its reply ended, for the time it took. */
  startedAt: number | null;
  endedAt: number | null;
}

const fileName = (value: unknown) => typeof value === "string" ? value.split(/[\\/]/).filter(Boolean).pop()?.replace(/\.(chalklee|pdf|docx?|tex|md|markdown|html?)$/i, "") ?? value : "";
const quoted = (value: unknown) => `《${fileName(value)}》`;
const count = (value: unknown) => Array.isArray(value) ? value.length : 0;
/** A skill the step reads or writes, by its workspace-relative path; the model gets skills by these paths. */
const skillName = (value: unknown, skillFolders: readonly string[]) => typeof value === "string" ? skillAt(value, skillFolders)?.name : undefined;
const trash = () => typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "废纸篓" : "回收站";

/**
 * A short sentence for the step row, in the words a teacher would use. `skillFolders`: the workspace's folders with a
 * SKILL.md, whose other files are that skill's samples rather than skills.
 */
export function assistantStepLabel(name: string, args: Record<string, any>, skillFolders: readonly string[] = []): string {
  switch (name) {
    case "workspace_list": return args.directory && args.directory !== "." ? `查看文件夹“${fileName(args.directory)}”` : "查看工作区目录";
    case "workspace_search": return `查找文件“${args.query ?? ""}”`;
    case "workspace_create_folder": return `新建文件夹“${args.name ?? ""}”`;
    case "document_show": return args.questionId ? `打开${quoted(args.path)}并定位题目` : `打开${quoted(args.path)}`;
    case "document_outline": return `阅读${quoted(args.path)}的结构`;
    case "document_questions": return count(args.questionIds) ? `读取${quoted(args.path)}的 ${count(args.questionIds)} 道题` : args.query ? `在${quoted(args.path)}中查找“${args.query}”` : `读取${quoted(args.path)}的题目`;
    case "document_create":
      if (args.markdown !== undefined && isSkillsFolder(args.directory)) return `存成技能${quoted(args.name)}`;
      return `新建${args.html === undefined ? "" : "网页"}${quoted(args.name)}`;
    case "html_update": {
      const skill = skillName(args.path, skillFolders);
      return skill ? `修改技能《${skill}》` : `修改${/\.(md|markdown)$/i.test(String(args.path ?? "")) ? "" : "网页"}${quoted(args.path)}`;
    }
    case "content_insert": return `向${quoted(args.path)}插入 ${count(args.blocks) || ""} 项内容`.replace("  ", " ");
    case "question_update": return `修改${quoted(args.path)}的 ${count(args.edits)} 道题`;
    case "content_update": {
      const edits = Array.isArray(args.edits) ? args.edits : [];
      const only = edits.length === 1 && typeof edits[0]?.find === "string" ? edits[0] : null;
      return only ? `将${quoted(args.path)}中的“${String(only.find).slice(0, 20)}”改为“${String(only.replace ?? "").slice(0, 20)}”` : `修改${quoted(args.path)}的 ${edits.length} 处内容`;
    }
    case "content_delete": return `从${quoted(args.path)}删除 ${count(args.ids)} 项内容`;
    case "content_move": return `调整${quoted(args.path)}的顺序`;
    case "document_style_read": return `查看${quoted(args.path)}的排版`;
    case "document_style_update": return args.metadata && !args.design && !args.cssEdits && !args.appendCss && !args.page ? `设置${quoted(args.path)}的年份和年级` : `调整${quoted(args.path)}的排版`;
    case "document_versions": return args.action === "restore" ? `将${quoted(args.path)}恢复到之前的版本` : args.action === "copy" ? `把${quoted(args.path)}的旧版本另存为副本` : `查看${quoted(args.path)}的版本历史`;
    case "document_preview": {
      const skill = skillName(args.path, skillFolders);
      if (skill) return `按技能《${skill}》`;
      return `${/\.(pdf|docx?)$/i.test(String(args.path ?? "")) ? "查看原稿" : /\.(md|markdown)$/i.test(String(args.path ?? "")) ? "查看" : /\.html?$/i.test(String(args.path ?? "")) ? "查看网页" : "预览"}${quoted(args.path)}${count(args.pages) ? `第 ${(args.pages as number[]).join("、")} 页` : ""}`;
    }
    case "document_export": return `导出${quoted(args.path)}的${args.answers === false && args.analysis === false ? "学生版 " : ""}${args.format === "docx" ? "Word" : "PDF"}`;
    case "file_move": {
      const to = args.directory === undefined ? "" : `移到“${args.directory === "." ? "工作区根目录" : fileName(args.directory)}”`;
      return `将“${fileName(args.path)}”${to}${args.name ? `${to ? "并" : ""}改名为“${args.name}”` : ""}`;
    }
    case "file_organize": return args.undo ? "撤销目录整理" : `整理目录（${count(args.moves)} 项）`;
    case "file_copy": return `复制“${fileName(args.path)}”`;
    case "file_trash": return `将“${fileName(args.path)}”移到${trash()}`;
    case "web_search": return args.url ? "阅读网页中的题目与资料" : `联网搜索“${String(args.query ?? "").slice(0, 60)}”`;
    case "question_search": {
      const filters = [args.year && `${args.year} 年`, args.grade && `${args.grade} 年级`, args.difficulty && ({ easy: "容易", medium: "中等", hard: "较难" } as Record<string, string>)[args.difficulty], args.tag && `#${args.tag}`].filter(Boolean);
      return `搜索题库${args.query ? `“${args.query}”` : ""}${filters.length ? `（${filters.join("、")}）` : ""}`;
    }
    case "question_basket": return args.action === "add" ? `将 ${count(args.questions)} 道题加入选题篮` : args.action === "remove" ? `从选题篮移出 ${count(args.questions)} 道题` : args.action === "clear" ? "清空选题篮" : "查看选题篮";
    case "question_tags": {
      if (args.action === "undo") return "撤销标签整理";
      if (args.action !== "edit") return "查看标签分组";
      const renames = Array.isArray(args.rename) ? args.rename as Array<{ tags?: unknown[]; to?: string }> : [];
      const only = renames.length === 1 && Array.isArray(renames[0].tags) ? renames[0] : null;
      return only ? `将${(only.tags as string[]).map(tag => `“${tag}”`).join("")}${only.tags!.length > 1 ? "合并为" : "改名为"}“${only.to ?? ""}”` : renames.length ? "整理标签（改名与合并）" : "整理标签分组";
    }
    case "question_insert": return `向${quoted(args.path)}插入 ${count(args.questions)} 道题`;
    case "conversion_start": {
      const paths = Array.isArray(args.paths) ? args.paths as string[] : [];
      const single = args.path ?? (paths.length === 1 ? paths[0] : undefined);
      const target = paths.length > 1 ? `${paths.length} 份原稿`
        : single && !/\.(pdf|docx?|tex|md|markdown)$/i.test(String(single)) ? `“${single === "." ? "工作区" : fileName(single)}”中的原稿` : quoted(single);
      return `${args.reconvert ? "重新" : ""}将${target}转换为 ChalkLee`;
    }
    // Earlier conversations recorded the read-only conversion_status.
    case "conversion_status": return "查看转换任务";
    case "conversion_tasks": {
      const paths = Array.isArray(args.paths) ? args.paths as string[] : [];
      const target = paths.length === 1 ? quoted(paths[0]) : paths.length > 1 ? ` ${paths.length} 份原稿的` : "";
      return ({ stop: `停止${target}转换`, resume: `继续${target}转换`, proofread: `用 ChalkLee AI 校对${target}初稿`, "skip-proofread": `保留${target}初稿，不校对` } as Record<string, string>)[String(args.action)] ?? "查看转换任务";
    }
    case "codemode": return "运行批处理脚本";
    case "memory": return args.action === "add" ? `记住“${String(args.text ?? "").slice(0, 40)}”` : args.action === "remove" ? "删除一条记忆" : "查看记忆";
    default: return name;
  }
}

/** What a finished (or partly finished) organisation step did, read from its result. */
export function organizeSummary(step: AssistantStep): { id: string; moved: number; folders: number; lines: string[] } | null {
  const recorded = step.details?.organize;
  if (recorded) return recorded;
  // A run that stopped midway names its record in the error, so the finished part can still be put back.
  const partial = step.result?.match(/undo:"(organize_[\w-]+)"/)?.[1];
  if (partial) return { id: partial, moved: Number(step.result!.match(/已完成 (\d+) 项/)?.[1] ?? 0), folders: 0, lines: [] };
  try {
    const value = JSON.parse(step.result ?? "") as { organizeId?: unknown; moved?: unknown; createdFolders?: unknown };
    return typeof value.organizeId === "string" ? { id: value.organizeId, moved: Number(value.moved) || 0, folders: Array.isArray(value.createdFolders) ? value.createdFolders.length : 0, lines: [] } : null;
  } catch { return null; }
}

/** Organisation records the conversation's cards need. */
export function organizeIds(turns: readonly AssistantTurn[]): string[] {
  return [...new Set(turns.flatMap(turn => turn.blocks.flatMap(block => block.kind === "organize" ? organizeSummary(block.step)?.id ?? [] : [])))];
}

/** Group a conversation into user turns; consecutive tool calls form one list of steps. */
export function assistantTurns(messages: readonly AssistantChatMessage[], running: boolean, approval: AssistantApproval | null, error: string | null, skillFolders: readonly string[] = []): AssistantTurn[] {
  const turns: AssistantTurn[] = [];
  const results = new Map(messages.flatMap(message => message.role === "toolResult" ? [[message.toolCallId, message] as const] : []));
  let current: AssistantTurn | null = null;
  const ensure = () => current ??= (turns.push({ id: "start", user: null, blocks: [], active: false, stopped: false, error: null, startedAt: null, endedAt: null }), turns.at(-1)!);
  const lastAssistant = messages.findLast(message => message.role === "assistant")?.id;
  for (const message of messages) {
    if (message.role === "user") {
      current = { id: message.id, user: message, blocks: [], active: false, stopped: false, error: null, startedAt: message.timestamp, endedAt: null };
      turns.push(current);
      continue;
    }
    if (message.role !== "assistant") {
      if (current) current.endedAt = Math.max(current.endedAt ?? 0, message.timestamp);
      continue;
    }
    const turn = ensure();
    if (message.requestedAt) turn.startedAt = message.requestedAt;
    turn.endedAt = Math.max(turn.endedAt ?? 0, message.completedAt ?? message.timestamp);
    const streaming = running && message.id === lastAssistant;
    message.content.forEach((part, index) => {
      const id = `${message.id}:${index}`;
      const last = turn.blocks.at(-1);
      if (part.type === "text") {
        if (!part.text.trim()) return;
        if (last?.kind === "text") { last.text += `\n\n${part.text}`; last.streaming = streaming; }
        else turn.blocks.push({ kind: "text", id, text: part.text, streaming });
      } else if (part.type === "thinking") {
        turn.blocks.push({ kind: "thinking", id, text: part.thinking, streaming: streaming && index === message.content.length - 1 });
      } else {
        const result = results.get(part.id);
        // A run stopped mid-step reports the abort as a tool error; it is a stop, not a failure.
        const status: AssistantStepStatus = result ? (result.isError ? (/^(operation )?abort(ed)?\b|request was aborted/i.test(result.text.trim()) ? "stopped" : "error") : "done")
          : approval?.toolCallId === part.id ? "waiting"
          : running ? "running" : "stopped";
        const step: AssistantStep = { id: part.id, name: part.name, label: assistantStepLabel(part.name, part.arguments as Record<string, any>, skillFolders), args: part.arguments, status, ...(result ? { result: result.text, details: result.details } : {}) };
        if (part.name === "file_organize" && !part.arguments.undo) turn.blocks.push({ kind: "organize", id, step });
        else if (last?.kind === "steps") last.steps.push(step);
        else turn.blocks.push({ kind: "steps", id, steps: [step] });
      }
    });
    if (message.stopReason === "aborted") turn.stopped = true;
    if (message.stopReason === "error" && message.errorMessage) turn.error = message.errorMessage;
  }
  const last = turns.at(-1);
  if (last) {
    last.active = running;
    if (error && !running) last.error = error;
  }
  return turns;
}
