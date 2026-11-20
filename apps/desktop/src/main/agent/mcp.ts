import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { chalkLeeTools, toolArguments, toolJsonSchema } from "./tools/catalog";
import { EXTERNAL_AGENT_GUIDE } from "./tools/conversionSessionTools";
import { toolDescription, type AppToolHost } from "./tools/toolKit";
import type { ExternalImportService } from "../conversion/externalSession";
import { externalAgentLabel } from "../../shared/conversion/externalAgent";
import { skillsPrompt } from "./assistant/prompt";
import { readSkills } from "../workspace/skills";
import { version as desktopVersion } from "../../../package.json";

export { EXTERNAL_AGENT_GUIDE, EXTERNAL_AGENT_GUIDE_VERSION } from "./tools/conversionSessionTools";

const failure = (text: string): CallToolResult => ({ isError: true, content: [{ type: "text", text }] });

/** JSON text for the agent, with any embedded PNG data URLs lifted out as MCP image content. */
export function externalToolResult(value: unknown): CallToolResult & { content: CallToolResult["content"] } {
  const images: { type: "image"; data: string; mimeType: string }[] = [];
  const sanitize = (child: any): any => {
    if (Array.isArray(child)) return child.map(sanitize);
    if (child && typeof child === "object") return Object.fromEntries(Object.entries(child).map(([key, item]) => {
      if ((key === "dataUrl" || key === "contextDataUrl") && typeof item === "string" && item.startsWith("data:image/png;base64,")) {
        images.push({ type: "image", data: item.slice("data:image/png;base64,".length), mimeType: "image/png" });
        return [key === "contextDataUrl" ? "contextImage" : "image", images.length];
      }
      return [key, sanitize(item)];
    }));
    return child;
  };
  return { content: [{ type: "text", text: JSON.stringify(sanitize(value), null, 2) }, ...images] };
}

/** Display name for the client application, forwarded by the stdio bridge; HTTP clients stay generic. */
export function externalAgentName(clientName?: string) {
  return externalAgentLabel(clientName) ?? "外部 Agent";
}

/**
 * The workspace's skills as a client connects, for the instructions it reads once. MCP gives the server no say in
 * each conversation, so later changes reach the agent through workspace_list, which the instructions point to.
 */
export async function connectionSkills(service: ExternalImportService): Promise<string | null> {
  const listed = skillsPrompt(await readSkills(await service.workspaceService.root()).catch(() => []), 3000);
  return listed && `${listed}\n以上是连接时的清单，之后新增或修改的技能以 workspace_list 为准。`;
}

/**
 * `skills`: the list from connectionSkills, given when the client is connecting. `app`: the window's own actions for the
 * open workspace, the same ones the built-in assistant uses, so files, versions and the basket change as by hand.
 */
export function createChalkLeeMcp(service: ExternalImportService, context: { clientName?: string; connectionId?: string; requestSignal?: AbortSignal; skills?: string | null; app?(): AppToolHost } = {}) {
  const agent = externalAgentName(context.clientName);
  const server = new McpServer({ name: "chalklee", version: desktopVersion }, {
    instructions: `ChalkLee 是教学文档工作区，用于管理 PDF、DOC、DOCX、LaTeX、Markdown、HTML 网页和可编辑的 ChalkLee，支持题目、公式、表格及排版。HTML 网页（互动演示、课堂小游戏等）用 document_create 的 html 新建，document_preview 看截图和报错，html_update 修改。已有 ChalkLee 无需转换会话：document_outline 读取结构，question_update 修改题目，content_insert、content_update、content_move、content_delete 增改内容和调整顺序，document_style_read、document_style_update 修改独立 CSS，document_preview 查看真实页面 PNG（也可查看 PDF/DOC/DOCX/LaTeX/Markdown 原稿），document_export 导出 PDF 或 Word（format:docx）。搜题组卷用 question_search 在题库中找题，再用 question_insert 把题目插入 ChalkLee。整理工作区目录用 file_organize（先 preview:true 给用户看方案），单个文件改名、移动、复制、删除用 file_move、file_copy、file_trash，不要用命令行直接操作工作区文件：直接操作会丢掉已打开文档中未保存的修改，删除也不进废纸篓、无法撤销。文档改坏了用 document_versions 查看和恢复版本；选题篮、题库标签、转换任务、插件分别用 question_basket、question_tags、conversion_tasks、plugins，与 ChalkLee 界面上的操作相同，需要打开 ChalkLee 窗口。插入图片可用 content_insert 的 {"type":"image","path":"本机图片的绝对路径"}。文件名和相对路径以当前工作区为准。工具返回的浏览器 URL 可用于预览原稿或打开文档编辑器。工作区根目录“技能”文件夹中是老师教会的做法，每个技能一份 Markdown 或 ChalkLee（“技能/某名称/SKILL.md”文件夹中的其他文件是它的样板和资料），workspace_list 中带 skill（它的用途）。要做的事与某个技能的用途相符，或老师点名某个技能时，先用 document_preview 读完技能全文（其中链接的样板文档也要看）再照做。老师要把一套做法存成技能时，用 document_create 的 markdown 在 directory“技能”中新建，name 用中文技能名，开头 YAML 写 name（英文小写字母和连字符）和 description（一句话写清做什么、什么时候用），正文用老师看得懂的话写步骤和要求，不写工具名和参数；只写老师提过的要求和确实有效的做法。${context.skills ? `\n\n${context.skills}` : ""}`
  });
  // Tools come from the shared catalog, published as the JSON Schema they are already defined in.
  const tools = chalkLeeTools("mcp");
  server.server.registerCapabilities({ tools: { listChanged: false } });
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(tool => ({
      name: tool.name, description: toolDescription(tool, "mcp"), inputSchema: toolJsonSchema(tool),
      annotations: { readOnlyHint: tool.kind === "read", destructiveHint: tool.kind === "destructive", openWorldHint: Boolean(tool.openWorld) }
    }))
  }));
  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = tools.find(candidate => candidate.name === request.params.name);
    if (!tool) return failure(`没有名为 ${request.params.name} 的工具。`);
    try {
      const args = toolArguments(tool, request.params.arguments);
      const result = await service.withClient({ connectionId: context.connectionId, agent, signal: context.requestSignal ? AbortSignal.any([extra.signal, context.requestSignal]) : extra.signal }, async () => {
        const root = await service.workspaceService.root();
        return tool.execute(args, { surface: "mcp", root, documents: service.workspaceService, external: { service, agent }, ...(context.app ? { app: context.app() } : {}) });
      });
      const reply = externalToolResult(result.value);
      reply.content.push(...(result.images ?? []).map(image => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })));
      return reply;
    } catch (error) { return failure(error instanceof Error ? error.message : "操作失败。"); }
  });
  server.registerResource("authoring", "chalklee://authoring", { description: "外部 Agent 转换流程、结构化片段格式和原稿核对要求", mimeType: "text/markdown" }, async uri => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: EXTERNAL_AGENT_GUIDE }] }));
  server.registerPrompt("convert_document", { description: "使用 ChalkLee 转换 PDF/DOC/DOCX/LaTeX/Markdown 为 ChalkLee 并打开编辑器", argsSchema: { path: z.string() } }, async ({ path }) => ({ messages: [{ role: "user", content: { type: "text", text: `${EXTERNAL_AGENT_GUIDE}\n请转换这份文档：${path}` } }] }));
  return server;
}
