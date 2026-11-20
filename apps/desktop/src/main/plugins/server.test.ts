import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPluginServer, pluginContentSecurityPolicy, withPluginSdk } from "./server";

const injected = (html: string) => withPluginSdk(new TextEncoder().encode(html)).toString("utf8");
const TAG = '<script src="/chalklee-plugin.js"></script>';

describe("plugin server", () => {
  let root: string, outside: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "plugin-server-"));
    outside = await mkdtemp(path.join(tmpdir(), "plugin-outside-"));
    await writeFile(path.join(root, "index.html"), "<!doctype html><html><head><title>页</title></head></html>");
    await writeFile(path.join(root, "data.json"), "{}");
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  const server = () => createPluginServer(async id => id === "one" ? root : null, "secret");

  it("puts the interface first without disturbing the page", () => {
    expect(injected("<!doctype html><html><head lang=x><title>页</title></head></html>")).toBe(`<!doctype html><html><head lang=x>${TAG}<title>页</title></head></html>`);
    expect(injected("<!DOCTYPE html><body>页</body>")).toBe(`<!DOCTYPE html>${TAG}<body>页</body>`);
    expect(injected("<header>页</header>")).toBe(`${TAG}<header>页</header>`);
  });

  it("allows nothing beyond the plugin's own files", () => {
    const policy = pluginContentSecurityPolicy("chalklee-plugin://abc");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src chalklee-plugin://abc;");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).not.toMatch(/https?:|\*|allow-same-origin|allow-popups/);
  });

  it("serves a page sandboxed, with the interface in it", async () => {
    const plugins = server(), response = await plugins.serve(new Request(`${plugins.origin("one")}/index.html`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain(TAG);
    expect(await (await plugins.serve(new Request(`${plugins.origin("one")}/chalklee-plugin.js`))).text()).toContain("window.chalklee");
  });

  it("gives each plugin its own origin that outsiders cannot guess", () => {
    const plugins = server();
    expect(plugins.origin("one")).not.toBe(plugins.origin("two"));
    expect(plugins.origin("one")).not.toBe(createPluginServer(async () => null, "another secret").origin("one"));
    expect(plugins.sameOrigin(`${plugins.origin("one")}/index.html`, `${plugins.origin("one")}/page.html`)).toBe(true);
    expect(plugins.sameOrigin(`${plugins.origin("one")}/index.html`, `${plugins.origin("two")}/index.html`)).toBe(false);
    expect(plugins.sameOrigin(`${plugins.origin("one")}/index.html`, "https://example.com/")).toBe(false);
  });

  it("answers nothing for unknown hosts, removed plugins, or paths out of the plugin", async () => {
    const plugins = server();
    await symlink(path.join(outside), path.join(root, "linked"));
    await writeFile(path.join(outside, "secret.txt"), "secret");
    const status = (url: string) => plugins.serve(new Request(url)).then(response => response.status);
    expect(await status("chalklee-plugin://0123/index.html")).toBe(404);
    expect(await status(`${plugins.origin("two")}/index.html`)).toBe(404);
    expect(await status(`${plugins.origin("one")}/%2e%2e/secret.txt`)).toBe(404);
    expect(await status(`${plugins.origin("one")}/linked/secret.txt`)).toBe(404);
  });
});
