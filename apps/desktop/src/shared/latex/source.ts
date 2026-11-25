/** Reading .tex originals: shared by the main process (collecting the files a source uses) and the conversion worker. */

export const LATEX_MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const INPUT_COMMAND = /\\(?:input|include|subfile|subfileinclude|InputIfFileExists)\s*\{([^{}]+)\}|\\input\s+([^\s{}\\%]+)|\\(?:sub)?import\s*\*?\s*\{([^{}]*)\}\s*\{([^{}]+)\}/g;
const GRAPHIC_COMMAND = /\\(?:includegraphics|includesvg)\s*\*?\s*(?:\[[^\]]*\]\s*)*\{([^{}]+)\}/g;
const VERBATIM = /^(?:verbatim\*?|Verbatim\*?|lstlisting|minted|comment)$/;

/** UTF-8 first, then GB18030: many older Chinese .tex files were saved as GBK. */
export function decodeLatexSource(data: Uint8Array): { text: string; encoding: "utf-8" | "gb18030" | "utf-16le" | "utf-16be" } {
  if (data.byteLength > LATEX_MAX_SOURCE_BYTES) throw new Error("目前支持 10 MB 以内的 LaTeX 文件，请按章节拆分后转换。");
  let text: string, encoding: "utf-8" | "gb18030" | "utf-16le" | "utf-16be";
  if (data[0] === 0xff && data[1] === 0xfe) { text = new TextDecoder("utf-16le").decode(data.subarray(2)); encoding = "utf-16le"; }
  else if (data[0] === 0xfe && data[1] === 0xff) { text = new TextDecoder("utf-16be").decode(data.subarray(2)); encoding = "utf-16be"; }
  else {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); encoding = "utf-8"; }
    catch {
      try { text = new TextDecoder("gb18030", { fatal: true }).decode(data); encoding = "gb18030"; }
      catch { throw new Error("无法识别这份 LaTeX 文件的编码，请另存为 UTF-8 后转换。"); }
    }
  }
  if (text.includes("\0")) throw new Error("文件含有二进制内容，不是 LaTeX 源码。");
  return { text: text.replace(/^﻿/, "").replace(/\r\n?/g, "\n"), encoding };
}

const escapedAt = (text: string, index: number) => {
  let slashes = 0;
  for (let at = index - 1; at >= 0 && text[at] === "\\"; at--) slashes++;
  return slashes % 2 === 1;
};

/** TeX drops a comment together with its line end and the next line's leading spaces. */
export function stripLatexComments(source: string): string {
  const lines = source.split("\n");
  let output = "", verbatim: string | null = null, joinNext = false;
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    if (joinNext) line = line.replace(/^[ \t]+/, "");
    joinNext = false;
    const newline = index < lines.length - 1 ? "\n" : "";
    if (verbatim) {
      output += line + newline;
      if (line.includes(`\\end{${verbatim}}`)) verbatim = null;
      continue;
    }
    const opened = line.match(/\\begin\s*\{([^}]+)\}/);
    if (opened && VERBATIM.test(opened[1]) && !line.includes(`\\end{${opened[1]}}`)) { verbatim = opened[1]; output += line + newline; continue; }
    let cut = -1;
    for (let at = 0; at < line.length; at++) {
      if (line.startsWith("\\verb", at) && !escapedAt(line, at) && !/[A-Za-z]/.test(line[at + 5] ?? "")) {
        const start = at + 5 + (line[at + 5] === "*" ? 1 : 0), delimiter = line[start];
        const end = delimiter ? line.indexOf(delimiter, start + 1) : -1;
        if (end > 0) { at = end; continue; }
      }
      if (line[at] === "%" && !escapedAt(line, at)) { cut = at; break; }
    }
    if (cut < 0) { output += line + newline; continue; }
    output += line.slice(0, cut);
    joinNext = true;
  }
  return output;
}

export interface LatexReferences { inputs: string[]; graphics: string[]; graphicsPaths: string[] }

/** The files a source names, read before it is parsed so that the worker never touches the disk. */
export function latexReferences(source: string): LatexReferences {
  const text = stripLatexComments(source);
  const inputs: string[] = [], graphics: string[] = [], graphicsPaths: string[] = [];
  for (const match of text.matchAll(INPUT_COMMAND)) {
    const reference = match[1] ?? match[2] ?? (match[4] !== undefined ? `${match[3] ?? ""}${match[4]}` : undefined);
    if (reference?.trim()) inputs.push(reference.trim());
  }
  for (const match of text.matchAll(GRAPHIC_COMMAND)) if (match[1].trim()) graphics.push(match[1].trim());
  for (const match of text.matchAll(/\\graphicspath\s*\{((?:\s*\{[^{}]*\})*)\s*\}/g))
    for (const item of match[1].matchAll(/\{([^{}]*)\}/g)) graphicsPaths.push(item[1].trim());
  return { inputs, graphics, graphicsPaths };
}

/** Workspace-relative POSIX form of a path written in a .tex file, relative to the main file's folder; null when it cannot be one. */
export function normalizeLatexPath(reference: string): string | null {
  const value = reference.trim().replace(/^"(.*)"$/, "$1").replace(/\\/g, "/");
  if (!value || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.startsWith("~")) return null;
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (parts.length && parts.at(-1) !== "..") parts.pop(); else parts.push(".."); continue; }
    parts.push(part);
  }
  return parts.length ? parts.join("/") : null;
}

const hasExtension = (reference: string) => /\.[A-Za-z0-9]{1,5}$/.test(reference.split("/").at(-1) ?? "");

export function latexInputCandidates(reference: string): string[] {
  const candidates = hasExtension(reference) && /\.tex$/i.test(reference) ? [reference] : [`${reference}.tex`, reference];
  return [...new Set(candidates.map(normalizeLatexPath).filter((item): item is string => !!item))];
}

/** EPS last: it is kept as a picture to add, so a PDF, bitmap or SVG of the same name is taken first. */
export const LATEX_GRAPHIC_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".svg", ".eps"];

export function latexGraphicCandidates(reference: string, graphicsPaths: readonly string[]): string[] {
  // "图1.1" names a picture with a dot in it, not one of type ".1": the name is tried as it is and with each picture type.
  const typed = /\.(?:pdf|png|jpe?g|svg|eps|gif|bmp|webp|tiff?)$/i.test(reference);
  const names = typed ? [reference] : [...(hasExtension(reference) ? [reference] : []), ...LATEX_GRAPHIC_EXTENSIONS.map(extension => reference + extension)];
  const folders = ["", ...graphicsPaths.map(folder => folder && !folder.endsWith("/") ? folder + "/" : folder)];
  return [...new Set(folders.flatMap(folder => names.map(name => normalizeLatexPath(folder + name))).filter((item): item is string => !!item))];
}

/** Find a referenced file among those collected, ignoring case only when nothing matches exactly (files written on Windows). */
export function findLatexFile(files: Readonly<Record<string, Uint8Array>>, candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) if (Object.hasOwn(files, candidate)) return candidate;
  const lower = new Map(Object.keys(files).map(key => [key.toLowerCase(), key]));
  for (const candidate of candidates) { const found = lower.get(candidate.toLowerCase()); if (found) return found; }
  return undefined;
}

/** A file with \documentclass is a main file; its \input files are read as part of it. */
export const isLatexMainSource = (source: string) => /\\documentclass\b/.test(stripLatexComments(source));
