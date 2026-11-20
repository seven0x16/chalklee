export type WorkspaceCreationKind = "chalklee" | "directory";

export function workspaceRenameName(requestedName: string, originalName: string, kind: "file" | "directory"): string {
  const name = workspaceEntryName(requestedName, "directory");
  if (kind === "directory") return name;
  const extension = originalName.slice(originalName.lastIndexOf("."));
  if (/\.(chalklee|docx|doc|pdf|md|markdown|html?)$/i.test(name) && !name.toLowerCase().endsWith(extension.toLowerCase())) {
    throw new Error(`请保留 ${extension} 扩展名，重命名不能转换文件格式。`);
  }
  return name.toLowerCase().endsWith(extension.toLowerCase()) ? name : `${name}${extension}`;
}

export function workspaceEntryName(requestedName: string, kind: WorkspaceCreationKind): string {
  const name = kind === "chalklee"
    ? requestedName.trim().replace(/\.chalklee$/i, "").trim()
    : requestedName.trim();
  const label = kind === "chalklee" ? "文档" : "文件夹";
  if (!name || /[\\/\0]/.test(name)) throw new Error(`请输入有效的${label}名称，不能包含 / 或 \\。`);
  if (name.startsWith(".") || name.startsWith("~$") || name === "Thumbs.db") {
    throw new Error(`${label}名称不能以 . 或 ~$ 开头，也不能使用 Thumbs.db。`);
  }
  return kind === "chalklee" ? `${name}.chalklee` : name;
}
