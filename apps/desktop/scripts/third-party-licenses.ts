import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Plugin } from "vite";

interface BundledPackage {
  name: string;
  version: string;
  license: string;
  texts: string[];
}

const LEGAL_FILE = /^(licen[cs]e|copying|notice)([.-]|$)/i;
const ASSET_NOTICES = [
  { name: "Poppins font subset", file: "Poppins-OFL.txt" },
  { name: "Lobe Icons", file: "ai-providers/LICENSE" },
  { name: "External app brand artwork", file: "external-apps/README.md" }
];

/** Shared by the main, preload and renderer builds of one electron-vite run. */
const bundled = new Map<string, BundledPackage>();

function packageRoot(id: string): string | undefined {
  const path = id.replace(/^\0/, "").split("?")[0].replace(/\\/g, "/");
  const at = path.lastIndexOf("/node_modules/");
  if (at < 0) return undefined;
  const base = at + "/node_modules/".length;
  const parts = path.slice(base).split("/");
  return path.slice(0, base) + parts.slice(0, parts[0].startsWith("@") ? 2 : 1).join("/");
}

function licenseName(manifest: { license?: unknown; licenses?: unknown }): string {
  const value = manifest.license ?? manifest.licenses;
  if (typeof value === "string") return value;
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  const names = entries.map(entry => (entry as { type?: unknown })?.type).filter((type): type is string => typeof type === "string");
  return names.length ? names.join(" OR ") : "UNKNOWN";
}

function record(root: string): void {
  let manifest: { name?: string; version?: string; license?: unknown; licenses?: unknown };
  try { manifest = JSON.parse(readFileSync(`${root}/package.json`, "utf8")); } catch { return; }
  if (!manifest.name || manifest.name.startsWith("@chalklee/")) return;
  const key = `${manifest.name}@${manifest.version ?? ""}`;
  if (bundled.has(key)) return;
  const texts = readdirSync(root).filter(file => LEGAL_FILE.test(file)).sort()
    .map(file => readFileSync(`${root}/${file}`, "utf8").trim());
  bundled.set(key, { name: manifest.name, version: manifest.version ?? "", license: licenseName(manifest), texts });
}

function render(): string {
  const rule = "=".repeat(80);
  const packages = [...bundled.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return [
    "Third-party software and assets included with ChalkLee, with their",
    "license texts and attribution where available.",
    ...packages.map(item => [
      "",
      rule,
      `${item.name} ${item.version}`,
      `License: ${item.license}`,
      rule,
      ...(item.texts.length ? item.texts.flatMap(text => ["", text]) : ["", "This package does not include a separate license file."])
    ].join("\n")),
    ...ASSET_NOTICES.map(({ name, file }) => [
      "",
      rule,
      name,
      rule,
      "",
      readFileSync(`src/renderer/src/assets/${file}`, "utf8").trim()
    ].join("\n")),
    ""
  ].join("\n");
}

/** Writes the license notices for bundled npm packages and third-party assets. */
export function thirdPartyLicenses(output: string): Plugin {
  return {
    name: "chalklee-third-party-licenses",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk") continue;
        for (const id of Object.keys(file.modules)) {
          const root = packageRoot(id);
          if (root) record(root);
        }
      }
    },
    closeBundle() {
      writeFileSync(output, render());
    }
  };
}
