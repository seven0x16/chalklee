import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileChalkLeeDesign, compileChalkLeeDesignStyles, createChalkLeeArchive, readChalkLeeArchive } from "@chalklee/format";
import { AgentWorkspaceService } from "./workspace";
import { createEmptyChalkLeeDocument } from "../../shared/document/newDocument";
import type { AgentEditorBridge } from "./editorBridge";
import { agentDocumentRevision } from "../../shared/agent/editing";
import { CHALKLEE_RUNNING_PRESETS } from "../../shared/document/paperPresets";
import { parseHTML } from "linkedom";
import postcss from "postcss";

let root: string, file: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-design-"))); file = path.join(root, "设计.chalklee");
  const document = createEmptyChalkLeeDocument("设计");
  document.content.content = [{ type: "paragraph", attrs: { id: "body" }, content: [{ type: "text", text: "保留正文" }] }];
  await writeFile(file, await createChalkLeeArchive(document));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const service = (options: Partial<ConstructorParameters<typeof AgentWorkspaceService>[0]> = {}) => new AgentWorkspaceService({ workspace: async () => root, editorUrl: () => "url", changed: vi.fn(), ...options });

describe("document-owned CSS design", () => {
  it("parses rules, intersects all target selectors with one paper, and retains print rules and pseudo elements", () => {
    const css = ':root { --design-ink: #123; color: var(--design-ink) !important; } h1, body p, p + aside { border-color: red; } @media print { h1::first-letter { color: red; } }';
    const compiled = compileChalkLeeDesign(css, "doc-one");
    expect(compiled).toContain('#chalklee-print-root [data-chalklee-design="doc-one"] {');
    expect(compiled).toContain(':is([data-chalklee-design="doc-one"] .chalklee-editor-content, [data-chalklee-design="doc-one"] .chalklee-editor-content *):is( body p)');
    expect(compiled).toContain("@media print"); expect(compiled).toContain("::first-letter");
    expect(compileChalkLeeDesign(css, "doc-two")).not.toContain("doc-one");
  });
  it("keeps scoped paint rules and treats styles that can change measurements as layout rules", () => {
    const paint = ':root { color: #145; } p:empty { background-color: white; border-inline-start-color: blue; } @media print { p::first-letter { color: black; } }';
    expect(compileChalkLeeDesignStyles(paint, "doc-one")).toEqual({
      css: compileChalkLeeDesign(paint, "doc-one"),
      affectsLayout: false,
      measurementCss: ""
    });
    for (const css of [
      "p { color: red; line-height: 2; }",
      "p { border: 2px solid red; }",
      ":root { --design-size: 14pt; }",
      "p::before { content: '注'; }",
      "@media print { p { padding-left: 2pt; } }"
    ]) {
      expect(compileChalkLeeDesignStyles(css, "doc-one").affectsLayout).toBe(true);
    }
  });
  it("retains question-local typography and edges in the measurement sheet without reapplying root font rules", () => {
    const css = `:root { --design-gap: 8px; font-size: 112%; }
:root, p { line-height: 1.5; }
[data-chalklee-question] { padding: var(--design-gap); border: 1px solid red; }
.chalklee-question-object > [data-chalklee-region=stem] p { margin-bottom: .2em; }`;
    const result = compileChalkLeeDesignStyles(css, "doc-one");
    expect(result.css).toBe(compileChalkLeeDesign(css, "doc-one"));
    expect(result.affectsLayout).toBe(true);
    expect(result.measurementCss).toContain("line-height: 1.5");
    expect(result.measurementCss).toContain("padding: var(--design-gap)");
    expect(result.measurementCss).toContain("margin-bottom: .2em");
    expect(result.measurementCss).not.toContain("font-size: 112%");
    expect(result.measurementCss).not.toContain("--design-gap: 8px");
  });
  it("keeps a full layout when rules depend on surrounding elements, editing state or explicit sizing", () => {
    for (const css of [
      ".chalklee-question-object + .chalklee-question-object { padding-top: 1em; }",
      ".chalklee-question-object.is-editing p { font-size: 2em; }",
      "p:has(strong) { line-height: 2; }",
      "body p { font-size: 2em; }",
      ".chalklee-editor-content { padding: 1em; }",
      "p { min-width: 80%; }",
      "p { margin-left: anchor-size(--reference width); }"
    ]) {
      expect(compileChalkLeeDesignStyles(css, "doc-one").measurementCss).toBeNull();
    }
  });
  it("never matches another paper, application chrome, or editing controls through broad/ancestor/sibling selectors", () => {
    const { document } = parseHTML('<html><body><button id="app">工具栏</button><article data-chalklee-design="one"><div class="chalklee-editor-content"><h1 id="title">标题</h1><p id="body">正文</p><aside id="inside">说明</aside><div class="chalklee-question-object-head"><button id="control">操作</button></div></div><aside id="outside">侧栏</aside></article><article data-chalklee-design="two"><div class="chalklee-editor-content"><p id="other">另一文档</p></div></article></body></html>');
    const sheet = postcss.parse(compileChalkLeeDesign('* , body p, p + aside, article + article p { color: teal; }', "one"));
    const matches = new Set<string>();
    sheet.walkRules(rule => document.querySelectorAll(rule.selector).forEach(node => matches.add(node.id)));
    expect(matches.has("title")).toBe(true); expect(matches.has("body")).toBe(true); expect(matches.has("inside")).toBe(true);
    for (const id of ["app", "control", "outside", "other"]) expect(matches.has(id)).toBe(false);
  });
  it.each([
    'h1 { color: red', '@import "https://example.org/font.css";', 'p { background: url(https://example.org/x); }',
    ':root { --chalklee-page-height: 0; }', ':root { padding: 0; }', 'p { position: fixed; }', 'p { position: sticky; }', 'p { z-index: 9; }', 'p { content: "替换正文"; }',
    'p { float: left; }', 'p::before { content: url(https://example.org/x.svg); }', 'p { overflow: scroll; }',
    'h1 { --design-image: URL(https://example.org/x); }', 'p { background: u\\72l(x); }', 'p { & span { color: red; } }',
    '@font-face { font-family: custom; src: url(x); }', '@keyframes fade { from { opacity: 0; } }',
    '@layer chalklee-visibility { [data-chalklee-region="answer"] { display: block !important; } }'
  ])("rejects invalid or unsupported CSS without modifying archive bytes: %s", async css => {
    const api = service(), original = await readFile(file), { revision } = await api.readStyle(file);
    await expect(api.updateStyle(file, revision, { design: { css } })).rejects.toThrow();
    expect(await readFile(file)).toEqual(original);
  });
  it("lets decorations draw their own text, shapes and inline pictures", () => {
    const css = `h2 { position: relative; overflow: hidden; }
h2::before { content: "★ " counter(chalklee-heading-1); position: absolute; left: -14pt; z-index: -1; transform: rotate(-6deg); }
[data-role="subtitle"]::after { content: ""; display: block; height: 6pt; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='6'%3E%3Cpath d='M0 3h40' stroke='%231d4f91'/%3E%3C/svg%3E") repeat-x; }
li::marker, p::marker { content: "▸ "; }
.chalklee-box::after { content: ""; float: right; }`;
    const compiled = compileChalkLeeDesign(css, "doc-one");
    expect(compiled).toContain('content: "★ " counter(chalklee-heading-1)');
    expect(compiled).toContain("data:image/svg+xml");
    expect(compiled).toContain('[data-role="subtitle"]');
  });
  it("saves/reopens an independent style and page patch, preserves content and assets, and clears styles", async () => {
    const old = await readChalkLeeArchive(await readFile(file));
    const asset = { id: "image", path: "assets/image.png", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) };
    await writeFile(file, await createChalkLeeArchive(old.document, [asset]));
    const api = service(), initial = await api.readStyle(file);
    const design = { name: "蓝色讲义", css: 'h1 { color: #123456; } .chalklee-question-object { border-radius: 8pt; }' };
    const updated = await api.updateStyle(file, initial.revision, { design, page: { marginsPt: { top: 42 }, columnCount: 2 } });
    const saved = await readChalkLeeArchive(await readFile(file));
    expect(saved.document.content).toEqual(old.document.content); expect(saved.assets.image).toEqual(asset.data);
    expect(saved.document.appearance.design).toEqual(design);
    expect(saved.document.appearance.page.marginsPt).toEqual({ ...old.document.appearance.page.marginsPt, top: 42 });
    expect(saved.document.appearance.body).toEqual(old.document.appearance.body);
    await expect(api.updateStyle(file, initial.revision, { design: null })).rejects.toThrow("版本已变化");
    await expect(api.updateStyle(file, updated.revision, { page: { columnCount: 12, marginsPt: { left: 350 } } })).rejects.toThrow("纸张设置无效");
    await api.updateStyle(file, updated.revision, { design: null });
    expect((await api.readStyle(file)).design).toBeNull();
    expect((await readChalkLeeArchive(await readFile(file))).document.appearance.page.columnCount).toBe(2);
  });
  it("styles the header by preset name, keeping its words", async () => {
    const api = service();
    await api.updateStyle(file, undefined, {
      headerFooter: { header: { left: "{标题}", style: "双线" }, footer: { center: "{page}" } }
    });
    const style = await api.readStyle(file);
    expect(style.headerFooter?.header).toEqual({ left: "{title}", style: CHALKLEE_RUNNING_PRESETS.find(item => item.name === "双线")!.style });
    await expect(api.updateStyle(file, undefined, { headerFooter: { header: { left: "x", style: "彩虹" } } })).rejects.toThrow("不是预设名");
  });
  it("sets the year and grade the question bank filters by, and returns them to automatic", async () => {
    const api = service();
    expect((await api.readStyle(file)).metadata).toEqual({ year: null, grade: null });
    const updated = await api.updateStyle(file, undefined, { metadata: { year: 2025, grade: 9 } });
    expect((await readChalkLeeArchive(await readFile(file))).document.metadata).toMatchObject({ year: 2025, grade: 9 });
    await expect(api.updateStyle(file, updated.revision, { metadata: { grade: 13 } })).rejects.toThrow("年级无效");
    await api.updateStyle(file, updated.revision, { metadata: { grade: null } });
    expect((await api.readStyle(file)).metadata).toEqual({ year: 2025, grade: null });
  });
  it("changes a few rules without rewriting the whole CSS", async () => {
    const api = service();
    const first = await api.updateStyle(file, undefined, { appendCss: "h1 { font-size: 20pt; }" });
    expect((await api.readStyle(file)).design).toEqual({ css: "h1 { font-size: 20pt; }\n" });
    await api.updateStyle(file, first.revision, { cssEdits: [{ find: "font-size: 20pt", replace: "font-size: 24pt" }], appendCss: "p { line-height: 1.8; }" });
    expect((await api.readStyle(file)).design?.css).toBe("h1 { font-size: 24pt; }\np { line-height: 1.8; }\n");
    await expect(api.updateStyle(file, undefined, { cssEdits: [{ find: "font-size: 99pt", replace: "x" }] })).rejects.toThrow("找不到");
    await expect(api.updateStyle(file, undefined, { cssEdits: [{ find: "; }", replace: "}" }] })).rejects.toThrow("出现了 2 次");
    await expect(api.updateStyle(file, undefined, { appendCss: "p { position: fixed; }" })).rejects.toThrow();
    await expect(api.updateStyle(file, undefined, { design: null, appendCss: "p { color: red; }" })).rejects.toThrow("不能与");
    // Rules the sheet already has are refused rather than piled up again.
    await expect(api.updateStyle(file, undefined, { appendCss: "p {\n  line-height: 1.8;\n}" })).rejects.toThrow("已经在文档中");
    expect((await api.readStyle(file)).design?.css).toBe("h1 { font-size: 24pt; }\np { line-height: 1.8; }\n");
  });
  it("previews unsaved editor content and newly added resources without saving, with revision checks", async () => {
    const archive = await readChalkLeeArchive(await readFile(file)), api = service();
    const document = structuredClone(archive.document);
    document.appearance.design = { css: "p { color: red; }" };
    document.content.content.push({ type: "image", attrs: { id: "new-image", assetId: "new-asset" } });
    const editor = { read: vi.fn(async () => [{ document, dirty: true, modifiedAt: (await api.info(file)).modifiedAt,
      assets: [{ id: "new-asset", path: "assets/new.png", mediaType: "image/png", dataBase64: "AQID" }] }]) } as unknown as AgentEditorBridge;
    const renderPreview = vi.fn(async (bytes: Uint8Array, pages?: number[]) => {
      const rendered = await readChalkLeeArchive(bytes);
      expect(rendered.document).toEqual(document); expect(rendered.assets["new-asset"]).toEqual(new Uint8Array([1, 2, 3]));
      expect(pages).toEqual([1]); return { pageCount: 1, images: [{ page: 1, dataUrl: "png" }], renderedHtml: "<p>保留正文</p>" };
    });
    const previewApi = service({ editors: editor, renderPreview }), original = await readFile(file);
    const revision = await agentDocumentRevision(document);
    expect(await previewApi.previewDocument(file, [1], revision)).toMatchObject({ revision, source: "editor", pageCount: 1 });
    expect(editor.read).toHaveBeenCalledWith(file, true); expect(await readFile(file)).toEqual(original);
    await expect(previewApi.previewDocument(file, [1], "wrong")).rejects.toThrow("版本已变化");
    await expect(previewApi.previewDocument(file, [0])).rejects.toThrow("页码"); expect(renderPreview).toHaveBeenCalledOnce();
  });
  it("commits live styles through the editor bridge after saving unrelated user changes", async () => {
    const api = service(), live = (await readChalkLeeArchive(await readFile(file))).document;
    live.content.content[0] = { type: "paragraph", attrs: { id: "user" }, content: [{ type: "text", text: "尚未保存的输入" }] };
    const commit = vi.fn(async () => []), release = vi.fn(async () => {});
    const snapshot = { document: live, dirty: true, modifiedAt: (await api.info(file)).modifiedAt };
    const editors = { read: async () => [snapshot], prepare: async () => ({ snapshots: [snapshot], assertLease: () => {},
      save: async () => { await writeFile(file, await createChalkLeeArchive(live)); }, commit, release }) } as unknown as AgentEditorBridge;
    const liveApi = service({ editors }), revision = (await liveApi.readStyle(file)).revision;
    await liveApi.updateStyle(file, revision, { design: { css: "p { color: blue; }" } });
    expect((await readChalkLeeArchive(await readFile(file))).document.content).toEqual(live.content);
    expect(commit).toHaveBeenCalledWith(expect.anything(), expect.anything(), [], "appearance", {}); expect(release).toHaveBeenCalledOnce();
  });
});
