import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { PLUGIN_SANDBOX_FLAGS } from "../../shared/document/kinds";
import { PLUGIN_SDK_FILE, safePluginPath } from "../../shared/plugins/manifest";
import { PLUGIN_SDK_SOURCE } from "./sdk";

export const PLUGIN_SCHEME = "chalklee-plugin";
export const PLUGIN_SCHEME_PRIVILEGES = { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } };

const TYPES: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4", ".webm": "video/webm",
  ".txt": "text/plain", ".md": "text/plain"
};

/** Everything a plugin page may load: its own files and nothing else, so what it reads has no way out. */
export const pluginContentSecurityPolicy = (origin: string) => [
  `sandbox ${PLUGIN_SANDBOX_FLAGS}`, "default-src 'none'", `script-src ${origin} 'unsafe-inline'`, `style-src ${origin} 'unsafe-inline'`,
  `img-src ${origin} data: blob:`, `font-src ${origin} data:`, `media-src ${origin} data: blob:`, `connect-src ${origin}`,
  "frame-src 'none'", "object-src 'none'", "worker-src 'none'", "form-action 'none'", "base-uri 'none'"
].join("; ");

/** The app's interface goes in first, wherever the page's head is; the rest of the page is left byte for byte. */
export function withPluginSdk(page: Uint8Array) {
  const text = Buffer.from(page).toString("latin1");
  const tag = `<script src="/${PLUGIN_SDK_FILE}"></script>`;
  const head = /<head(\s[^>]*)?>/i.exec(text), doctype = /^\s*(?:﻿|\xEF\xBB\xBF)?<!doctype[^>]*>/i.exec(text);
  const at = head ? head.index + head[0].length : doctype ? doctype[0].length : 0;
  return Buffer.from(text.slice(0, at) + tag + text.slice(at), "latin1");
}

export interface PluginServer {
  origin(id: string): string;
  isPluginUrl(url: string): boolean;
  /** Whether `url` belongs to the same plugin as the page at `pageUrl`. */
  sameOrigin(pageUrl: string, url: string): boolean;
  serve(request: Request): Promise<Response>;
}

/**
 * Each plugin has its own host, derived from a secret made at launch: plugins cannot name each other's
 * addresses, and nothing outside the app can guess them.
 */
export function createPluginServer(rootOf: (id: string) => Promise<string | null>, secret: string = randomUUID()): PluginServer {
  const hosts = new Map<string, string>();
  const hostOf = (id: string) => {
    const host = createHash("sha256").update(`${secret}:${id}`).digest("hex").slice(0, 32);
    hosts.set(host, id);
    return host;
  };
  const originOf = (host: string) => `${PLUGIN_SCHEME}://${host}`;
  const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return {
    origin: id => originOf(hostOf(id)),
    isPluginUrl: url => url.startsWith(`${PLUGIN_SCHEME}://`),
    sameOrigin(pageUrl, url) {
      // A custom scheme's URL.origin is always "null", so the host is what tells two plugins apart.
      try {
        const page = new URL(pageUrl), target = new URL(url);
        return target.protocol === `${PLUGIN_SCHEME}:` && page.protocol === target.protocol && Boolean(target.host) && page.host === target.host;
      } catch { return false; }
    },
    async serve(request) {
      try {
        const url = new URL(request.url), id = hosts.get(url.host);
        if (url.protocol !== `${PLUGIN_SCHEME}:` || !id) return notFound();
        const origin = originOf(url.host);
        const headers = new Headers({
          "Content-Security-Policy": pluginContentSecurityPolicy(origin), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
          "X-DNS-Prefetch-Control": "off", "Referrer-Policy": "no-referrer", "Access-Control-Allow-Origin": "null"
        });
        const relative = url.pathname.split("/").filter(Boolean).map(decodeURIComponent).join("/");
        if (relative === PLUGIN_SDK_FILE) {
          headers.set("content-type", "text/javascript; charset=utf-8");
          return new Response(PLUGIN_SDK_SOURCE, { headers });
        }
        const rootPath = await rootOf(id);
        if (!rootPath || !relative || !safePluginPath(relative)) return notFound();
        const root = await realpath(rootPath), file = await realpath(path.join(root, ...relative.split("/")));
        if (!file.startsWith(`${root}${path.sep}`) || !(await stat(file)).isFile()) return notFound();
        const type = TYPES[path.extname(file).toLowerCase()];
        if (!type) return notFound();
        const data = new Uint8Array(await readFile(file));
        headers.set("content-type", type);
        return new Response(type === "text/html" ? withPluginSdk(data) : data, { headers });
      } catch { return notFound(); }
    }
  };
}
