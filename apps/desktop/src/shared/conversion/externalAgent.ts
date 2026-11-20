const qwenAdapter = /^quest-mcp-adaptor$/i;

/** A transport or SDK name does not identify the AI application using it. */
export function informativeAgentName(name?: string): string {
  const value = name?.trim() ?? "";
  return /chalk[\s._-]*lee/i.test(value) || /^(?:rmcp|mcp|mcp[-_ ]?(?:client|sdk)|rust[-_ ]?sdk|外部 Agent)$/i.test(value)
    || /(?:^|[-_ ])mcp[-_ ]adapt(?:o|e)r(?:$|[-_ ])/i.test(value) ? "" : value.slice(0, 100);
}

const apps: [RegExp, string][] = [
  [/workbuddy/i, "WorkBuddy"], [/codebuddy/i, "CodeBuddy"], [/doubao|豆包/i, "豆包工作"], [/qwen[\s_-]*work|千问办公/i, "千问办公"],
  [/codex/i, "Codex"], [/claude[\s_-]*code/i, "Claude Code"], [/claude/i, "Claude"], [/cursor/i, "Cursor"], [/trae/i, "Trae"]
];

/** Also normalizes old task records, which may contain an SDK name. */
export function externalAgentLabel(name?: string): string | undefined {
  // Qwen Work reports this adapter name; also recognize it in previously saved tasks.
  if (qwenAdapter.test(name?.trim() ?? "")) return "千问办公";
  const value = informativeAgentName(name);
  return apps.find(([pattern]) => pattern.test(value))?.[1] ?? (/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,23}$/u.test(value) ? value : undefined);
}
