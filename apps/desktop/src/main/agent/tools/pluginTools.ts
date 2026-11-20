import { Type } from "typebox";
import { PLUGIN_PERMISSIONS, PLUGIN_SAVE_EXTENSIONS, PLUGIN_SOURCE_LABELS, type PluginPermission, type PluginSource } from "../../../shared/plugins/manifest";
import { BOTH, PathParam, actorName, defineTool, output, requireApp, strict, type ChalkLeeTool, type ToolHost } from "./toolKit";

const permissionNames = Object.entries(PLUGIN_PERMISSIONS).map(([name, label]) => `${name}（${label}）`).join("、");

const GUIDE = `插件页面可用 window.chalklee（只在安装后存在，所以先写好未安装时的退路，如把数据先放在内存里）：
- chalklee.storage.get/set/remove/keys：保存插件自己的数据，随工作区隔离，不需要权限。
- chalklee.document.current()、document.questions({query,limit,offset})、document.show(questionId)、document.open(path,questionId)：读取当前文档的题目（id、number、section、text、kind、score、difficulty、tags），打开并定位，需要 document.read。
- chalklee.document.create({name,blocks})：新建 ChalkLee，需要 document.create。
- chalklee.bank.search({query,year,grade,type,difficulty,tags,limit})：搜索题库，需要 question-bank.read。
- chalklee.basket.add([{path,questionId}])：加入选题篮，需要 basket.write。
- chalklee.assistant.draft(text)：把一段话填进 ChalkLee AI 输入框由老师发送，需要 assistant.draft。
- chalklee.files.save(name, data)：弹出保存窗口，由老师选位置，把文字或字节（Blob、Uint8Array）存成文件，返回是否保存；只能在老师点击按钮后调用，不需要权限。文件名带扩展名，可用 ${PLUGIN_SAVE_EXTENSIONS.join("、")}。
- 颜色用 var(--chalklee-background/surface/text/muted/border/accent/on-accent/hover/selection)，随外观变化。
插件不能联网，不能打开外部链接，样式、脚本都写在这一个文件里。`;

const sourceLabel = (source: PluginSource) => PLUGIN_SOURCE_LABELS[source] ?? "内置";
const plugins = (host: ToolHost) => {
  const center = requireApp(host).plugins;
  if (!center) throw new Error("请在 ChalkLee 窗口中管理插件。");
  return center;
};
const installed = async (host: ToolHost, id: string | undefined) => {
  if (!id) throw new Error("请提供插件 id（用 list 查看）。");
  const plugin = (await plugins(host).list()).find(item => item.manifest.id === id);
  if (!plugin) throw new Error(`没有安装 id 为 ${id} 的插件，请先用 list 查看。`);
  return plugin;
};

export const PLUGIN_TOOLS: readonly ChalkLeeTool[] = [
  defineTool({
    name: "plugins", label: "插件", surfaces: BOTH, kind: "destructive",
    description: `管理插件中心里的插件，与插件中心的按钮相同。list 列出已安装的插件（id、名称、用途、来源、权限）和可以装回的内置插件；install 把工作区里一个单文件 HTML 网页安装为插件，老师试用满意并说要安装时才调用；remove 删除插件（移到废纸篓，它保存的数据保留，重新安装后恢复），会先请老师确认；restore 装回删除的内置插件；share 弹出保存窗口，由老师选位置把插件存成可以发给同事的分享文件。
install：新插件或权限增加时老师会看到确认框，由老师决定，你不能代替批准；同一 id 且权限没有增加时直接更新并刷新。只申请用得上的权限，可选：${permissionNames}。插件读写不了别的插件的数据，老师问待办、日历里的内容时请老师打开插件查看。\n${GUIDE}`,
    notes: { mcp: "remove 前先在对话中说明要删除哪个插件，用户同意后再调用。" },
    parameters: Type.Object({
      action: Type.Optional(Type.Union([Type.Literal("list"), Type.Literal("install"), Type.Literal("remove"), Type.Literal("restore"), Type.Literal("share")], { default: "list" })),
      id: Type.Optional(Type.String({ pattern: "^[a-z0-9]+(-[a-z0-9]+)*$", maxLength: 64, description: "插件的英文短名，如 random-picker；install 新插件时自己起，更新同一插件时保持不变；其他操作用 list 返回的 id" })),
      path: Type.Optional(PathParam),
      name: Type.Optional(Type.String({ minLength: 1, maxLength: 40, description: "install：老师看到的名称" })),
      summary: Type.Optional(Type.String({ minLength: 1, maxLength: 80, description: "install：一句话说明" })),
      description: Type.Optional(Type.String({ maxLength: 2000 })),
      permissions: Type.Optional(Type.Array(Type.Union(Object.keys(PLUGIN_PERMISSIONS).map(name => Type.Literal(name as PluginPermission))), { maxItems: 5 }))
    }, strict),
    confirm: async ({ action, id }, host) => {
      if (action !== "remove") return null;
      const plugin = await installed(host, id);
      return { title: `删除插件《${plugin.manifest.name}》`, detail: plugin.source === "builtin" ? "以后可以在插件中心的“发现”中装回，它保存的数据保留。" : "插件移到废纸篓，它保存的数据保留，重新安装后恢复。", action: "删除" };
    },
    execute: async ({ action, id, path: candidate, name, summary, description, permissions }, host) => {
      const center = plugins(host);
      if (action === "install") {
        if (!candidate || !id || !name || !summary) throw new Error("install 需要 path、id、name 和 summary。");
        const result = await center.installPage((await host.documents.info(candidate)).path, { id, name, summary, ...(description ? { description } : {}), permissions: permissions ?? [], author: actorName(host) });
        if (result.status === "declined") return output({ installed: false, note: "老师没有批准安装。不要重试，问问老师想怎么调整。" });
        return output({ installed: true, ...result, note: "已在插件中心生效，不用重启。" }, { summary: `已安装插件《${result.name}》` });
      }
      if (action === "remove") {
        const plugin = await installed(host, id);
        await center.remove(plugin.manifest.id);
        return output({ removed: plugin.manifest.name }, { summary: `已删除插件《${plugin.manifest.name}》` });
      }
      if (action === "restore") {
        if (!id) throw new Error("请提供要装回的内置插件 id（用 list 查看）。");
        const plugin = await center.restoreBuiltin(id);
        return output({ restored: plugin.manifest.name }, { summary: `已装回插件《${plugin.manifest.name}》` });
      }
      if (action === "share") {
        const plugin = await installed(host, id);
        const saved = await center.share(plugin.manifest.id);
        return output(saved ? { shared: plugin.manifest.name } : { shared: false, note: "老师取消了保存。" });
      }
      const [list, removed] = await Promise.all([center.list(), center.removedBuiltins()]);
      return output({
        installed: list.map(plugin => ({ id: plugin.manifest.id, name: plugin.manifest.name, summary: plugin.manifest.summary, source: sourceLabel(plugin.source),
          version: plugin.manifest.version, permissions: plugin.granted.map(permission => PLUGIN_PERMISSIONS[permission]) })),
        ...(removed.length ? { removedBuiltins: removed.map(manifest => ({ id: manifest.id, name: manifest.name, summary: manifest.summary })) } : {})
      }, { summary: `${list.length} 个插件` });
    }
  })
];
