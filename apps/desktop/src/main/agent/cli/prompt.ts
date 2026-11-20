import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { splitAssistantContext } from "../assistant/prompt";

/** Said to every tool on top of ChalkLee AI's own instructions. */
export function cliSystemPrompt(base: string, tool: string, memory: string, skills = "") {
  return [
    base,
    `运行方式：你通过本机的 ${tool} 运行，只能使用 chalklee 提供的工具（名称可能带有 mcp__chalklee__ 或 chalklee_ 前缀）。不要读写本机文件、不要运行命令或访问网络，工作区里的文件一律通过 chalklee 工具操作。这里没有 codemode，需要批量处理时直接多次调用工具。`,
    memory ? `助手记忆（老师要求记住的偏好，回答和操作时遵循）：\n${memory}` : "",
    skills
  ].filter(Boolean).join("\n\n");
}

const textOf = (content: unknown) => typeof content === "string" ? content
  : Array.isArray(content) ? content.flatMap(part => part?.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n") : "";
const imagesIn = (content: unknown) => Array.isArray(content) ? content.filter(part => part?.type === "image").length : 0;
const clip = (value: string, length: number) => value.length > length ? `${value.slice(0, length)}…` : value;

/** Older turns beyond this are left out; the latest request is always kept whole. */
const HISTORY_LIMIT = 60_000;

/**
 * The conversation for a tool that keeps no memory of its own: earlier turns as a record (steps named, results
 * shortened), then what to answer now — the latest messages from the teacher, or ChalkLee's note asking to continue.
 */
export function cliConversationPrompt(branch: readonly SessionEntry[]): string {
  const sections: string[] = [];
  let request: string[] = [];
  const flush = () => { if (request.length) { sections.push(`## 老师\n${request.join("\n\n")}`); request = []; } };
  // The trailing run of teacher messages and notes is the request; everything before it is history.
  let lastReply = -1;
  branch.forEach((entry, index) => {
    if (entry.type === "message" && ["assistant", "toolResult"].includes((entry.message as AgentMessage).role)) lastReply = index;
  });
  const current: string[] = [];
  branch.forEach((entry, index) => {
    const latest = index > lastReply;
    if (entry.type === "custom_message") {
      const note = textOf(entry.content);
      if (note) (latest ? current : request).push(`（ChalkLee 提示：${note}）`);
      return;
    }
    if (entry.type === "compaction") { flush(); sections.push(`## 较早对话的摘要\n${entry.summary}`); return; }
    if (entry.type !== "message") return;
    const message = entry.message as AgentMessage & { customType?: string };
    if (message.role === "user") {
      const images = imagesIn(message.content);
      // Earlier messages keep only what the teacher wrote; the interface state they carried is out of date.
      const said = latest ? textOf(message.content) : splitAssistantContext(textOf(message.content)).text;
      const body = `${said}${images ? `\n（附图 ${images} 张）` : ""}`;
      (latest ? current : request).push(body);
    } else if (message.role === "custom") {
      const note = textOf(message.content);
      if (note) (latest ? current : request).push(`（ChalkLee 提示：${note}）`);
    } else if (message.role === "assistant") {
      flush();
      const lines = message.content.flatMap(part => part.type === "text" && part.text.trim() ? [part.text.trim()]
        : part.type === "toolCall" ? [`[步骤 ${part.name} ${clip(JSON.stringify(part.arguments ?? {}), 300)}]`] : []);
      if (message.stopReason === "error" && message.errorMessage) lines.push(`[这次回答出错：${clip(message.errorMessage, 200)}]`);
      if (message.stopReason === "aborted") lines.push("[老师停止了这次回答]");
      if (lines.length) sections.push(`## ChalkLee AI\n${lines.join("\n")}`);
    } else if (message.role === "toolResult") {
      const result = clip(textOf(message.content).replace(/\s+/g, " "), 400);
      sections.push(`[结果 ${message.toolName}${message.isError ? "（失败）" : ""}：${result}]`);
    }
  });
  flush();
  let history = sections.join("\n\n");
  if (history.length > HISTORY_LIMIT) history = `……（更早的对话已省略）\n${history.slice(-HISTORY_LIMIT)}`;
  const now = current.join("\n\n") || "请继续完成上面老师的请求。";
  return history
    ? `以下是这段对话到目前为止的记录，其中的修改都已完成且仍然有效，不要重复执行：\n\n${history}\n\n---\n\n现在需要你回应的消息：\n\n${now}`
    : now;
}
