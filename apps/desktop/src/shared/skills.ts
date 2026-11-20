/**
 * Skills are the teacher's ways of working, taught to ChalkLee AI: one Markdown page or ChalkLee document each in the
 * "技能" folder at the workspace root. Only that folder counts, so a SKILL.md arriving with other material never
 * steers the assistant.
 */
export const SKILLS_FOLDER = "技能";

const SKILL_FILE = /\.(md|markdown|chalklee)$/i;
const SKILL_MD = /^skill\.md$/i;

/** Whether a workspace-relative directory is the skills folder itself ("技能", "./技能/"). */
export const isSkillsFolder = (directory: string | undefined) => normalized(directory ?? "") === SKILLS_FOLDER;

/**
 * The skill a workspace-relative path holds, or null. A page or document is named by its file; the standard layout
 * `技能/某名称/SKILL.md` is named by its folder, and everything else under that folder is the skill's samples and
 * materials, not a skill of its own. `skillFolders` are the folders that hold a SKILL.md (see `skillFoldersOf`).
 */
export function skillAt(relativePath: string, skillFolders: readonly string[] = []): { name: string } | null {
  const parts = normalized(relativePath).split("/");
  if (parts.length < 2 || parts[0] !== SKILLS_FOLDER || parts.some(part => !part || part.startsWith("."))) return null;
  const file = parts[parts.length - 1], folder = parts.slice(0, -1).join("/");
  if (!SKILL_FILE.test(file)) return null;
  const standard = SKILL_MD.test(file) && parts.length > 2;
  if (skillFolders.some(owner => `${folder}/`.startsWith(`${normalized(owner)}/`) && !(standard && folder === normalized(owner)))) return null;
  return { name: standard ? parts[parts.length - 2] : file.replace(SKILL_FILE, "") };
}

/** The folders under "技能" that hold a SKILL.md, among workspace-relative file paths. */
export function skillFoldersOf(relativePaths: Iterable<string>): string[] {
  const folders: string[] = [];
  for (const candidate of relativePaths) {
    const parts = normalized(candidate).split("/");
    if (parts.length > 2 && parts[0] === SKILLS_FOLDER && SKILL_MD.test(parts[parts.length - 1])) folders.push(parts.slice(0, -1).join("/"));
  }
  return folders;
}

const normalized = (value: string) => value.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");

/** What a skill is for: the `description` in its opening YAML, or else its first line of text. */
export function skillDescription(source: string, length = 300): string {
  const lines = source.replace(/^﻿/, "").split(/\r\n?|\n/);
  let body = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end > 0) {
      const found = yamlValue(lines.slice(1, end), "description");
      if (found) return clip(found, length);
      body = end + 1;
    }
  }
  return firstLine(lines.slice(body), length);
}

/** The first line of text, without its heading, list, number or quote marker; a rule between parts is not text. */
export function firstLine(lines: readonly string[], length = 300): string {
  for (const line of lines) {
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) continue;
    const text = line.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)/, "").trim();
    if (text) return clip(text, length);
  }
  return "";
}

/** One top-level scalar of simple YAML: plain, quoted, folded (`>`) or literal (`|`), read as one line. */
function yamlValue(lines: string[], key: string) {
  const index = lines.findIndex(line => new RegExp(`^${key}\\s*:`).test(line));
  if (index < 0) return "";
  const inline = lines[index].replace(new RegExp(`^${key}\\s*:\\s*`), "").replace(/\s+#.*$/, "").trim();
  const more: string[] = [];
  for (const line of lines.slice(index + 1)) { if (!/^\s+\S/.test(line) && line.trim()) break; more.push(line.trim()); }
  if (/^[>|][+-]?$/.test(inline)) return more.filter(Boolean).join(" ");
  const quoted = /^(["'])([\s\S]*)\1$/.exec(inline);
  return quoted ? quoted[2] : [inline, ...more].filter(Boolean).join(" ");
}

const clip = (text: string, length: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length)}…` : flat;
};
