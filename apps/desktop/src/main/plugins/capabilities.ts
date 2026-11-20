import { chalkLeeTools, toolArguments } from "../agent/tools/catalog";
import type { ToolHost } from "../agent/tools/toolKit";
import type { AssistantUiAction } from "../../shared/agent/assistant";
import { PLUGIN_PERMISSIONS, PLUGIN_SAVE_EXTENSIONS, type InstalledPlugin, type PluginPermission } from "../../shared/plugins/manifest";
import type { PluginDataStore } from "./data";

/** What the window knows at the moment of a call. */
export interface PluginCallContext { documentPath?: string | null }

export interface PluginCapabilityHost {
  workspaceRoot(): string | null;
  data: PluginDataStore;
  /** Document and question-bank tools, acting under the plugin's name. */
  tools(root: string, plugin: InstalledPlugin): ToolHost;
  ui(action: AssistantUiAction): Promise<unknown>;
  /** Asks the teacher where to save; false when they cancel. */
  saveFile(plugin: InstalledPlugin, name: string, data: Uint8Array): Promise<boolean>;
}

const UNSAFE_FILE_NAME = /[\\/:*?"<>|\u0000-\u001f]/;

type Params = Record<string, unknown>;
interface Call { plugin: InstalledPlugin; params: Params; context: PluginCallContext; root: string; host: PluginCapabilityHost }
interface Capability { permission?: PluginPermission; run(call: Call): Promise<unknown> }

const key = (params: Params) => {
  if (typeof params.key !== "string") throw new Error("请提供数据的名称。");
  return params.key;
};
const currentDocument = ({ context }: Call) => {
  if (!context.documentPath) throw new Error("请先打开一份文档。");
  return context.documentPath;
};
/** Plugins run shared tools by name, so a document or question behaves as it does for ChalkLee AI. */
async function runTool(call: Call, name: string, input: Params) {
  const tool = chalkLeeTools("plugin").find(item => item.name === name);
  if (!tool) throw new Error(`工具不可用：${name}`);
  return (await tool.execute(toolArguments(tool, input), call.host.tools(call.root, call.plugin))).value as Record<string, unknown>;
}

/** The fields of a question a plugin relies on; other details of the tool's reply can change between versions. */
const question = (item: Record<string, any>) => ({
  id: item.id, ...(item.parentId ? { parentId: item.parentId } : {}), number: item.number, section: item.section, text: item.text,
  kind: item.attrs?.kind, score: item.attrs?.score ?? null, difficulty: item.attrs?.difficulty ?? null, tags: item.attrs?.tags ?? []
});

/** Text is written as UTF-8; a table also gets the mark Excel needs to read Chinese in it. */
function fileData(data: unknown, extension: string) {
  if (typeof data === "string") return new TextEncoder().encode((extension === "csv" || extension === "tsv") && !data.startsWith("\uFEFF") ? `\uFEFF${data}` : data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error("请提供要保存的内容：文字或字节。");
}

const CAPABILITIES: Record<string, Capability> = {
  "storage.get": { run: ({ plugin, params, root, host }) => host.data.get(root, plugin.manifest.id, key(params)) },
  "storage.set": { run: ({ plugin, params, root, host }) => host.data.set(root, plugin.manifest.id, key(params), params.value) },
  "storage.remove": { run: ({ plugin, params, root, host }) => host.data.remove(root, plugin.manifest.id, key(params)) },
  "storage.keys": { run: ({ plugin, root, host }) => host.data.keys(root, plugin.manifest.id) },
  "document.current": {
    permission: "document.read",
    run: async ({ context, root }) => {
      if (!context.documentPath) return null;
      const name = context.documentPath.split(/[\\/]/).pop() ?? "";
      return { name: name.replace(/\.chalklee$/i, ""), path: context.documentPath.startsWith(root) ? context.documentPath.slice(root.length).replace(/^[\\/]/, "") : name };
    }
  },
  "document.questions": {
    permission: "document.read",
    run: async call => {
      const { query, limit, offset } = call.params;
      const read = await runTool(call, "document_questions", { path: currentDocument(call), ...(query !== undefined ? { query } : {}), ...(limit !== undefined ? { limit } : {}), ...(offset !== undefined ? { offset } : {}) });
      return { total: read.total, truncated: read.truncated, questions: (read.questions as Array<Record<string, any>>).map(question) };
    }
  },
  "document.show": {
    permission: "document.read",
    run: async call => { await runTool(call, "document_show", { path: currentDocument(call), ...(typeof call.params.questionId === "string" ? { questionId: call.params.questionId } : {}) }); }
  },
  "document.open": {
    permission: "document.read",
    run: async call => {
      if (typeof call.params.path !== "string" || !call.params.path) throw new Error("请提供文档路径。");
      await runTool(call, "document_show", { path: call.params.path, ...(typeof call.params.questionId === "string" ? { questionId: call.params.questionId } : {}) });
    }
  },
  "document.create": {
    permission: "document.create",
    run: async call => { const { name, blocks } = call.params; return { path: (await runTool(call, "document_create", { name, ...(blocks !== undefined ? { blocks } : {}) })).created }; }
  },
  "bank.search": {
    permission: "question-bank.read",
    run: async call => {
      const { query, year, grade, type, difficulty, tags, limit } = call.params;
      const found = await runTool(call, "question_search", Object.fromEntries(Object.entries({ query, year, grade, type, difficulty, tags, limit }).filter(([, value]) => value !== undefined)));
      return { total: found.total, questions: found.questions };
    }
  },
  "basket.add": {
    permission: "basket.write",
    run: async call => { await runTool(call, "question_basket", { action: "add", questions: call.params.questions }); }
  },
  "files.save": {
    run: async ({ plugin, params, host }) => {
      const name = typeof params.name === "string" ? params.name.trim() : "";
      if (!name || name.length > 120 || UNSAFE_FILE_NAME.test(name) || name.startsWith(".")) throw new Error("请提供文件名，如“成绩.csv”。");
      const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
      if (!(PLUGIN_SAVE_EXTENSIONS as readonly string[]).includes(extension)) throw new Error(`不能保存这种文件，可用的类型：${PLUGIN_SAVE_EXTENSIONS.join("、")}。`);
      return host.saveFile(plugin, name, fileData(params.data, extension));
    }
  },
  "assistant.draft": {
    permission: "assistant.draft",
    run: async ({ params, host }) => {
      if (typeof params.text !== "string" || !params.text.trim() || params.text.length > 4000) throw new Error("请提供 4000 字以内的内容。");
      await host.ui({ action: "assistant-draft", text: params.text });
    }
  }
};

/** Every call from a plugin ends here: the method must exist and the teacher must have allowed it. */
export async function callPluginCapability(host: PluginCapabilityHost, plugin: InstalledPlugin, method: string, params: unknown, context: PluginCallContext) {
  const capability = Object.hasOwn(CAPABILITIES, method) ? CAPABILITIES[method] : undefined;
  if (!capability) throw new Error(`没有这个接口：${method}`);
  if (capability.permission && !plugin.granted.includes(capability.permission)) throw new Error(`《${plugin.manifest.name}》没有获得“${PLUGIN_PERMISSIONS[capability.permission]}”的权限。`);
  const root = host.workspaceRoot();
  if (!root) throw new Error("请先打开工作区。");
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("接口参数无效。");
  return (await capability.run({ plugin, params: params as Params, context, root, host })) ?? null;
}
