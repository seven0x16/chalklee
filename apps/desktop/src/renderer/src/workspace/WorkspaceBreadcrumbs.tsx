import { ChevronRight, Copy, FolderOpen, Link } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceDirectoryNode, WorkspaceFileNode } from "../../../shared/contracts";
import { buildWorkspaceBreadcrumbs, workspaceBreadcrumbTarget } from "./breadcrumbs";
import { AppContextMenu, type AppContextMenuItem } from "../ui/AppContextMenu";
import type { WorkspaceContextMenuActions } from "./contextMenuItems";

export function WorkspaceBreadcrumbs({ root, file, fileMissing = false, trailing, actions, onRevealPath }: {
  root: WorkspaceDirectoryNode | null;
  file: WorkspaceFileNode | null;
  fileMissing?: boolean;
  /** A last, unlinked part after the file, such as the question number. */
  trailing?: string;
  actions: Pick<WorkspaceContextMenuActions, "onReveal" | "onCopyPath">;
  onRevealPath(path: string): void;
}) {
  const parts = buildWorkspaceBreadcrumbs(root?.name ?? "本地工作区", root?.path ?? "", file);
  if (file && trailing) parts.push({ label: trailing, path: "" });
  const originRef = useRef<HTMLButtonElement | null>(null);
  const sequenceRef = useRef(0);
  const [menu, setMenu] = useState<{ path: string; x: number; y: number; id: number } | null>(null);
  const target = root && menu ? workspaceBreadcrumbTarget(root, menu.path, file, fileMissing) : null;
  const close = useCallback((restoreFocus = false) => {
    setMenu(null);
    if (restoreFocus && originRef.current?.isConnected) originRef.current.focus({ preventScroll: true });
  }, []);
  useEffect(() => { close(); }, [root?.path, file?.path, close]);
  useEffect(() => { if (menu && !target) close(); }, [menu, target, close]);

  function show(path: string, origin: HTMLButtonElement, point?: { x: number; y: number }) {
    if (!root || !workspaceBreadcrumbTarget(root, path, file, fileMissing)) return;
    const rect = origin.getBoundingClientRect();
    originRef.current = origin;
    setMenu({ path, x: point?.x ?? rect.left, y: point?.y ?? rect.top, id: ++sequenceRef.current });
  }

  const items: AppContextMenuItem[] = [];
  if (target) {
    const { node } = target;
    const { onReveal, onCopyPath } = actions;
    const manager = window.chalkLee.platform === "darwin" ? "Finder" : window.chalkLee.platform === "win32" ? "文件资源管理器" : "文件管理器";
    if (onReveal) items.push({ value: "reveal", label: `在 ${manager} 中${node.kind === "file" ? "显示" : "打开"}`,
      icon: <FolderOpen size={14} />, onSelect: () => onReveal(node.path) });
    if (onCopyPath) items.push(
      { value: "copy-path", label: "复制路径", icon: <Copy size={14} />, separatorBefore: items.length > 0, onSelect: () => onCopyPath(node.path, false) },
      { value: "copy-relative-path", label: "复制相对路径", icon: <Link size={14} />, onSelect: () => onCopyPath(node.path, true) }
    );
  }

  return <>
    <nav className="app-global-status-path" aria-label="文件路径">
      {parts.map((part, index) => <span key={part.path || `${part.label}-${index}`}>
        {index > 0 ? <ChevronRight size={11} aria-hidden="true" /> : null}
        {part.path ? <button type="button" data-breadcrumb-path={part.path} data-context-open={menu?.path === part.path}
          aria-current={index === parts.length - 1 ? "location" : undefined}
          aria-haspopup="menu" aria-expanded={menu?.path === part.path}
          onClick={() => onRevealPath(part.path)}
          onContextMenu={event => {
            event.preventDefault(); event.stopPropagation();
            show(part.path, event.currentTarget, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
          }}
          onKeyDown={event => {
            if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
              event.preventDefault(); event.stopPropagation(); show(part.path, event.currentTarget);
            }
          }}><span className="workspace-breadcrumb-label" data-overflow-tooltip={part.label}>{part.label}</span></button>
          : <em className="workspace-breadcrumb-label" data-overflow-tooltip={part.label}>{part.label}</em>}
      </span>)}
    </nav>
    {menu && target && items.length > 0 ? <AppContextMenu key={menu.id} x={menu.x} y={menu.y} label={`${target.node.name}的位置操作`}
      items={items} onClose={close} /> : null}
  </>;
}
