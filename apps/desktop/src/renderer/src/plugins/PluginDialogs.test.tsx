import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PluginManifest, PluginReview } from "../../../shared/plugins/manifest";
import { PluginReviewDialog } from "./PluginDialogs";

const manifest: PluginManifest = { id: "li.picker", publisher: "li", name: "随机点名", version: "1.1.0", apiVersion: 1, summary: "上课点名", author: "李老师", entry: "index.html", permissions: ["document.read", "basket.write"] };
const review = (extra: Partial<PluginReview> = {}): PluginReview => ({ ticket: "t", manifest, source: "shared", files: 2, bytes: 10, installedVersion: null, installedAuthor: null, addedPermissions: manifest.permissions, ...extra });
const render = (value: PluginReview) => renderToStaticMarkup(<PluginReviewDialog review={value} onConfirm={vi.fn()} onCancel={vi.fn()} />);

describe("plugin review", () => {
  it("lists every permission in the teacher's words and warns about unreviewed plugins", () => {
    const html = render(review());
    for (const text of ["安装《随机点名》", "读取当前打开的文档", "把题目加入选题篮", "未经审核"]) expect(html).toContain(text);
    expect(html).not.toContain("plugin-dialog-new");
  });

  it("marks only what an update adds", () => {
    const html = render(review({ installedVersion: "1.0.0", installedAuthor: "李老师", addedPermissions: ["basket.write"] }));
    expect(html).toContain("1.0.0 更新到 1.1.0");
    expect(html.match(/plugin-dialog-new/g)).toHaveLength(1);
    expect(html).toContain('把题目加入选题篮<span class="plugin-dialog-new">新增</span>');
    expect(html).not.toContain("plugin-dialog-warning");
  });

  it("warns when an update under another author would inherit the plugin's data", () => {
    expect(render(review({ installedVersion: "1.0.0", installedAuthor: "别人", addedPermissions: [] }))).toContain("沿用原插件的数据");
  });
});
