import { describe, expect, it, vi } from "vitest";
import { toolArguments } from "./catalog";
import { PLUGIN_TOOLS } from "./pluginTools";
import type { PluginHost, ToolHost } from "./toolKit";

const tool = PLUGIN_TOOLS[0];
const install = { action: "install", path: "点名.html", id: "random-picker", name: "随机点名", summary: "上课点名", permissions: ["document.read"] };
const plugin = (id: string, name: string, source: string) => ({ manifest: { id, name, summary: `${name}说明`, version: "1.0.0" }, source, granted: ["document.read"] });
const host = (center: Partial<PluginHost>) => ({ surface: "assistant", root: "/work", documents: { info: async () => ({ path: "/work/点名.html" }) },
  app: { plugins: { list: async () => [plugin("todo", "待办", "builtin"), plugin("random-picker", "随机点名", "assistant")], removedBuiltins: async () => [], ...center } } }) as unknown as ToolHost;
const run = (args: Record<string, unknown>, target: ToolHost) => tool.execute(toolArguments(tool, args), target);

describe("plugins", () => {
  it("hands a page over with what it asks for, and tells the model when the teacher said no", async () => {
    const installPage = vi.fn(async () => ({ status: "installed", name: "随机点名", version: "1.0.0" }));
    expect((await run(install, host({ installPage } as never))).value).toMatchObject({ installed: true, status: "installed" });
    expect(installPage).toHaveBeenCalledWith("/work/点名.html", { id: "random-picker", name: "随机点名", summary: "上课点名", permissions: ["document.read"], author: "ChalkLee AI" });
    // Made by an external agent, the plugin center names that application.
    await run(install, { ...host({ installPage } as never), surface: "mcp", external: { agent: "WorkBuddy" } } as unknown as ToolHost);
    expect(installPage).toHaveBeenLastCalledWith("/work/点名.html", expect.objectContaining({ author: "WorkBuddy" }));
    expect((await run(install, host({ installPage: async () => ({ status: "declined" }) } as never))).value).toMatchObject({ installed: false, note: expect.stringContaining("不要重试") });
    await expect(run({ action: "install", path: "点名.html" }, host({}))).rejects.toThrow("install 需要");
  });

  it("lists plugins in the teacher's words and removes one only after the teacher agrees", async () => {
    const remove = vi.fn(async () => {});
    const target = host({ remove });
    expect((await run({}, target)).value).toEqual({ installed: [
      { id: "todo", name: "待办", summary: "待办说明", source: "内置", version: "1.0.0", permissions: ["读取当前打开的文档"] },
      { id: "random-picker", name: "随机点名", summary: "随机点名说明", source: "本机制作", version: "1.0.0", permissions: ["读取当前打开的文档"] }
    ] });
    expect(await tool.confirm!(toolArguments(tool, { action: "remove", id: "todo" }), target)).toMatchObject({ title: "删除插件《待办》", detail: expect.stringContaining("“发现”中装回") });
    expect(await tool.confirm!(toolArguments(tool, { action: "list" }), target)).toBeNull();
    await run({ action: "remove", id: "random-picker" }, target);
    expect(remove).toHaveBeenCalledWith("random-picker");
    await expect(run({ action: "remove", id: "nothing" }, target)).rejects.toThrow("没有安装");
  });
});
