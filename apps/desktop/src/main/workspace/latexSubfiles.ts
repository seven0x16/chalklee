import { readFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceFileNode, WorkspaceNode } from "../../shared/contracts";
import { decodeLatexSource, isLatexMainSource, LATEX_MAX_SOURCE_BYTES, latexInputCandidates, latexReferences } from "../../shared/latex/source";

interface Scanned { key: string; main: boolean; inputs: string[] }
const scanned = new Map<string, Scanned>();

async function scan(file: WorkspaceFileNode): Promise<Scanned | null> {
  const key = `${file.size}:${file.modifiedAt}`;
  const known = scanned.get(file.path);
  if (known?.key === key) return known;
  if (file.size > LATEX_MAX_SOURCE_BYTES) return null;
  try {
    const text = decodeLatexSource(new Uint8Array(await readFile(file.path))).text;
    const result = { key, main: isLatexMainSource(text), inputs: latexReferences(text).inputs };
    scanned.set(file.path, result);
    return result;
  } catch { return null; }
}

/**
 * The .tex files another .tex in the workspace reads with \input, \include or \subfile: they are part of
 * that file, converted with it, and not listed on their own. Paths resolve from the main file's folder, as in TeX;
 * a main file that another one includes (the subfiles package) belongs to that one too.
 */
export async function latexSubfiles(files: readonly WorkspaceFileNode[]): Promise<Set<string>> {
  const tex = files.filter(file => file.extension === "tex");
  const included = new Set<string>();
  if (tex.length < 2) return included;
  const byPath = new Map(tex.map(file => [path.normalize(file.path), file]));
  const results = new Map<string, Scanned | null>();
  await Promise.all(tex.map(async file => results.set(path.normalize(file.path), await scan(file))));
  const follow = (from: string, folder: string, seen: Set<string>) => {
    for (const reference of results.get(from)?.inputs ?? []) {
      for (const candidate of latexInputCandidates(reference)) {
        const target = path.normalize(path.join(folder, ...candidate.split("/")));
        if (!byPath.has(target)) continue;
        if (target !== from) included.add(target);
        if (!seen.has(target)) { seen.add(target); follow(target, folder, seen); }
        break;
      }
    }
  };
  for (const [file, result] of results) {
    if (!result?.inputs.length) continue;
    follow(file, path.dirname(file), new Set([file]));
  }
  return included;
}

/** Remove the given files from a scanned tree. */
export function pruneWorkspaceNodes(nodes: WorkspaceNode[], hidden: ReadonlySet<string>): WorkspaceNode[] {
  return nodes.filter(node => node.kind !== "file" || !hidden.has(path.normalize(node.path)))
    .map(node => node.kind === "directory" ? { ...node, children: pruneWorkspaceNodes(node.children, hidden) } : node);
}
