import { lstat, open, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { readChalkLeeArchiveMetadata, type ChalkLeeDocument } from "@chalklee/format";
import { agentDocumentText } from "../../shared/agent/documentEditing";
import type { WorkspaceFileNode } from "../../shared/contracts";
import { SKILLS_FOLDER, firstLine, skillAt, skillDescription } from "../../shared/skills";

export interface WorkspaceSkill {
  name: string;
  /** Workspace-relative, with forward slashes. */
  path: string;
  description: string;
}

/** Enough of a page for its opening YAML or first line. */
const HEAD_BYTES = 16 * 1024;
export const MAX_SKILLS = 100;
const SKILL_MD = /^skill\.md$/i;

/**
 * What a ChalkLee skill is for: its first line of body text. A document opens with its title, which only repeats the
 * skill's name, so headings count only when there is nothing else.
 */
export function chalkLeeSkillDescription(document: ChalkLeeDocument): string {
  const lines = agentDocumentText(document, 4000).text.split("\n");
  return firstLine(lines.filter(line => !/^#{1,6}\s/.test(line))) || firstLine(lines);
}

/** A document is read whole, so its use is kept until the file changes. */
const documentDescriptions = new Map<string, { version: string; value: Promise<string> }>();

/** What a skill file says it is for: a page's first few kilobytes, or a document's first line. */
export async function readSkillDescription(file: string): Promise<string> {
  if (/\.chalklee$/i.test(file)) {
    const info = await stat(file), version = [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(":");
    const cached = documentDescriptions.get(file);
    if (cached?.version === version) return cached.value;
    const value = readFile(file).then(readChalkLeeArchiveMetadata).then(({ document }) => chalkLeeSkillDescription(document));
    documentDescriptions.set(file, { version, value });
    return value.catch(error => { if (documentDescriptions.get(file)?.value === value) documentDescriptions.delete(file); throw error; });
  }
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    // A page cut mid-character still reads; a binary file says nothing.
    const text = new TextDecoder("utf-8").decode(buffer.subarray(0, bytesRead));
    return text.includes("\0") ? "" : skillDescription(text);
  } finally {
    await handle.close();
  }
}

/** The skills in the workspace's "技能" folder, by path; none when there is no such folder. */
export async function readSkills(root: string): Promise<WorkspaceSkill[]> {
  const folder = path.join(root, SKILLS_FOLDER);
  const found: string[] = [];
  const visit = async (directory: string, depth: number) => {
    if (depth > 4 || found.length >= MAX_SKILLS) return;
    const entries = (await readdir(directory, { withFileTypes: true }).catch(() => []))
      .filter(entry => !entry.name.startsWith(".") && !entry.name.startsWith("~$") && !entry.isSymbolicLink());
    // A folder with a SKILL.md is one skill; the rest of it is that skill's materials.
    const standard = depth > 0 ? entries.find(entry => entry.isFile() && SKILL_MD.test(entry.name)) : undefined;
    if (standard) { found.push(path.join(directory, standard.name)); return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }))) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full, depth + 1);
      else if (entry.isFile() && found.length < MAX_SKILLS && skillAt(relativeTo(root, full))) found.push(full);
    }
  };
  const stats = await lstat(folder).catch(() => null);
  if (!stats?.isDirectory()) return [];
  await visit(folder, 0);
  const skills = await Promise.all(found.map(async file => {
    const relative = relativeTo(root, file);
    return { name: skillAt(relative)!.name, path: relative, description: await readSkillDescription(file).catch(() => "") };
  }));
  return skills;
}

/** Marks the scanned files that are skills with what they are for. */
export async function markSkills(root: string, files: WorkspaceFileNode[]): Promise<void> {
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  const skillPrefix = rootPrefix + SKILLS_FOLDER;
  const candidates: Array<{ file: WorkspaceFileNode; relative: string }> = [];
  for (const file of files) {
    // Scanned paths are absolute and normalized. Reconcile other spellings with path.relative below.
    if (file.path.startsWith(rootPrefix) && !file.path.startsWith(skillPrefix)) continue;
    const relative = relativeTo(root, file.path);
    if (skillAt(relative)) candidates.push({ file, relative });
  }
  const folders = await skillFoldersAbove(root, candidates.map(({ relative }) => relative));
  const skills = candidates.filter(({ relative }) => skillAt(relative, folders)).slice(0, MAX_SKILLS).map(({ file }) => file);
  for (const file of documentDescriptions.keys()) if (!skills.some(skill => skill.path === file)) documentDescriptions.delete(file);
  await Promise.all(skills.map(async file => { file.skill = { description: await readSkillDescription(file.path).catch(() => "") }; }));
}

/** Whether a workspace file is a skill, not a skill's sample or material. */
export async function isWorkspaceSkill(root: string, file: string): Promise<boolean> {
  const relative = relativeTo(root, file);
  return !!skillAt(relative) && !!skillAt(relative, await skillFoldersAbove(root, [relative]));
}

/**
 * The folders above these skill files that hold a SKILL.md, read from disk so that a listing of only part of the
 * workspace still knows them.
 */
async function skillFoldersAbove(root: string, relativePaths: readonly string[]): Promise<string[]> {
  const candidates = new Set<string>();
  for (const relative of relativePaths) {
    const parts = relative.split("/");
    for (let end = 2; end < parts.length; end++) candidates.add(parts.slice(0, end).join("/"));
  }
  const found = await Promise.all([...candidates].map(async folder =>
    (await readdir(path.join(root, ...folder.split("/"))).catch(() => [] as string[])).some(name => SKILL_MD.test(name)) ? folder : null));
  return found.filter((folder): folder is string => folder !== null);
}

export const relativeTo = (root: string, file: string) => path.relative(root, file).split(path.sep).join("/");
