import { createPortal } from "react-dom";
import type { WorkspaceDirectoryNode, WorkspaceFileNode, WorkspaceNode } from "../../../shared/contracts";
import { sameWorkspaceDirectory } from "../../../shared/workspace/paths";
import { ImportDialog } from "../conversion/SingleImport";

/** Confirms moving tree entries to the trash and, for ChalkLee among them, says what happens to their originals. */
export function TrashDialog({ root, entries, onConfirm, onClose }: {
  root: WorkspaceDirectoryNode;
  entries: readonly WorkspaceNode[];
  onConfirm(): void;
  onClose(): void;
}) {
  const mac = window.chalkLee.platform === "darwin";
  const trash = mac ? "废纸篓" : "回收站";
  const manager = mac ? "Finder" : window.chalkLee.platform === "win32" ? "文件资源管理器" : "文件管理器";
  const trashed = new Set(entries.map(entry => entry.path));
  const results = entries.filter((entry): entry is WorkspaceFileNode => entry.kind === "file" && entry.extension === "chalklee");
  const originals: WorkspaceFileNode[] = [];
  const visit = (nodes: WorkspaceDirectoryNode["children"]) => {
    for (const node of nodes) {
      if (node.kind === "directory") visit(node.children);
      else if (!trashed.has(node.path) && results.some(file => sameWorkspaceDirectory(node.path, file.path) && node.convertedTo?.includes(file.path))) originals.push(node);
    }
  };
  visit(root.children);
  const single = entries.length === 1 ? entries[0] : null;
  const subject = !single ? ` ${entries.length} 项` : single.kind === "directory" ? "文件夹" : single.extension === "chalklee" ? " ChalkLee " : "文件";
  const target = !single ? `所选 ${entries.length} 项` : single.kind === "directory" && single.children.length ? `《${single.name}》及其中的全部内容` : `《${single.name}》`;

  return createPortal(<ImportDialog title={`将${subject}移到${trash}？`} onClose={onClose}>
    <p>{target}将移到{trash}，可在 {manager} 中恢复。</p>
    {originals.length ? <div className="chalklee-trash-originals" aria-label="关联原稿">
      {originals.map(original => <p key={original.path}>原稿《{original.name}》不会被删除；{original.convertedTo!.every(result => trashed.has(result) || !sameWorkspaceDirectory(original.path, result))
        ? "删除 ChalkLee 后，它会重新显示在目录中。"
        : "目录中仍会保留它的其他 ChalkLee 转换结果。"}</p>)}
    </div> : null}
    <footer>
      <button type="button" onClick={onClose}>取消</button>
      <button type="button" className="danger" onClick={onConfirm}>移到{trash}</button>
    </footer>
  </ImportDialog>, document.body);
}
