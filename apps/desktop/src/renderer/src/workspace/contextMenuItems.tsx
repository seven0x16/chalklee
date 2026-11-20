import { Copy, FilePlus2, Plus, FolderOpen, FolderPlus, Link, RefreshCw, FileInput, FileOutput, FileSearch, FileX, Undo2, Scissors, ClipboardPaste, Files, Pencil, Trash2, FolderRoot } from "lucide-react";
import type { WorkspaceDirectoryNode, WorkspaceFileNode, WorkspaceNode, WorkspaceFileClipboard } from "../../../shared/contracts";
import type { WorkspaceCreationKind } from "../../../shared/workspace/names";
import { workspaceOriginalsOf } from "../../../shared/workspace/paths";
import { canSkipConversion, isMarkdownKind } from "../../../shared/document/kinds";
import type { AppContextMenuItem } from "../ui/AppContextMenu";
import { workspaceCreationDirectory } from "./creation";
import { canPasteWorkspaceEntry } from "./mutations";

export interface WorkspaceTreeFileActions {
  clipboard: WorkspaceFileClipboard | null;
  busy: boolean;
  onCopy(node: WorkspaceNode, operation: "copy" | "cut"): void;
  onPaste(directoryPath: string): void;
  /** Dragged onto another folder, one entry or several selected: moved by the same rules as cut and paste. */
  onMove(nodes: WorkspaceNode[], directoryPath: string): void;
  onRename(node: WorkspaceNode): void;
  onDuplicate(node: WorkspaceNode): void;
  /** One entry, or several selected together. */
  onTrash(nodes: WorkspaceNode[]): void;
  onCancelCut(): void;
}

export interface WorkspaceContextMenuActions {
  naming?: boolean;
  fileActions?: WorkspaceTreeFileActions;
  /** `newTab` keeps the current tab and opens the file beside it. */
  onOpen(file: WorkspaceFileNode, newTab?: boolean): void;
  onCreate?(kind: WorkspaceCreationKind, targetPath: string): void;
  onRefresh?(): void;
  onReveal?(path: string): void;
  onCopyPath?(path: string, relative: boolean): void;
  /** Opens another local folder as the workspace; offered on the workspace itself. */
  onSwitchWorkspace?(): void;
  /** Converting the originals in a folder, or one original, to ChalkLee. */
  conversion?: WorkspaceTreeConversion;
}

export interface WorkspaceTreeConversion {
  /** How many originals here still need converting; the item shows only when some do. */
  count(node: WorkspaceNode): number;
  onConvert(node: WorkspaceNode): void;
  /** The same for several selected entries together, counted like a folder. */
  countEntries?(nodes: WorkspaceNode[]): number;
  onConvertEntries?(nodes: WorkspaceNode[]): void;
  /** Keeps an original for reading, out of conversion counts and batches (`needed` false), or brings it back. */
  onSetNeeded?(node: WorkspaceFileNode, needed: boolean): void;
}

export function workspaceContextMenuItems({ root, node, canManage = true, naming, fileActions, onOpen, onCreate, onRefresh, onReveal, onCopyPath, onSwitchWorkspace, conversion }: WorkspaceContextMenuActions & {
  root: WorkspaceDirectoryNode; node: WorkspaceNode; canManage?: boolean;
}): AppContextMenuItem[] {
  const contextItems: AppContextMenuItem[] = [];
  const mac = window.chalkLee.platform === "darwin";
  const modifier = mac ? "⌘" : "Ctrl+";
  const editing = Boolean(naming || fileActions?.busy);
  const manager = window.chalkLee.platform === "darwin" ? "Finder" : window.chalkLee.platform === "win32" ? "文件资源管理器" : "文件管理器";
  if (node.kind === "file") contextItems.push(
    { value: "open", label: "打开", icon: <FileInput size={14} />, onSelect: () => onOpen(node) },
    { value: "open-new-tab", label: "在新标签页中打开", icon: <Plus size={14} />, onSelect: () => onOpen(node, true) }
  );
  // The originals this ChalkLee hides in the tree, opened beside it like "查看原稿" in its properties.
  if (node.kind === "file" && node.extension === "chalklee") {
    const files = (item: WorkspaceNode): WorkspaceFileNode[] => item.kind === "file" ? [item] : item.children.flatMap(files);
    const originals = workspaceOriginalsOf(files(root), node.path);
    contextItems.push(...originals.map(original => ({ value: `open-original:${original.path}`, label: originals.length > 1 ? `查看原稿《${original.name}》` : "查看原稿",
      icon: <FileSearch size={14} />, onSelect: () => onOpen(original, true) })));
  }
  if (canManage && node.kind === "directory" && onCreate) {
    contextItems.push(
      { value: "new-chalklee", label: "新建 ChalkLee", icon: <FilePlus2 size={14} />, disabled: editing, onSelect: () => onCreate("chalklee", node.path) },
      { value: "new-folder", label: "新建文件夹", icon: <FolderPlus size={14} />, disabled: editing, onSelect: () => onCreate("directory", node.path) }
    );
  }
  const converting = canManage && conversion && (node.kind === "directory" || node.extension !== "chalklee") ? conversion.count(node) : 0;
  if (converting) contextItems.push({ value: "convert", label: node.kind === "file" ? isMarkdownKind(node.extension) ? "转换为 ChalkLee" : "用 ChalkLee AI 转换" : `转换原稿（${converting} 份）`, icon: <FileOutput size={14} />,
    disabled: editing, onSelect: () => conversion!.onConvert(node) });
  // An original without a ChalkLee can be kept for reading, like a textbook, and brought back later.
  if (canManage && conversion?.onSetNeeded && node.kind === "file" && canSkipConversion(node.extension) && !node.convertedTo?.length && !node.earlierConversions?.length) {
    const needed = !!node.noConversion;
    contextItems.push({ value: "conversion-needed", label: needed ? "需要转换" : "不需要转换", icon: needed ? <Undo2 size={14} /> : <FileX size={14} />,
      disabled: editing, onSelect: () => conversion.onSetNeeded!(node, needed) });
  }
  if (canManage && fileActions) {
    const editable = node.path !== root.path;
    const directory = workspaceCreationDirectory(root, node.path);
    if (editable) contextItems.push(
      { value: "cut", label: "剪切", icon: <Scissors size={14} />, shortcut: `${modifier}X`, separatorBefore: true, disabled: editing, onSelect: () => fileActions.onCopy(node, "cut") },
      { value: "copy", label: "复制", icon: <Copy size={14} />, shortcut: `${modifier}C`, disabled: editing, onSelect: () => fileActions.onCopy(node, "copy") }
    );
    contextItems.push({ value: "paste", label: "粘贴", icon: <ClipboardPaste size={14} />, shortcut: `${modifier}V`, separatorBefore: !editable,
      disabled: editing || !canPasteWorkspaceEntry(fileActions.clipboard, directory.path), onSelect: () => fileActions.onPaste(directory.path) });
    if (editable) contextItems.push(
      { value: "duplicate", label: "创建副本", icon: <Files size={14} />, shortcut: `${modifier}D`, disabled: editing, onSelect: () => fileActions.onDuplicate(node) },
      { value: "rename", label: "重命名", icon: <Pencil size={14} />, shortcut: "F2", disabled: editing, onSelect: () => fileActions.onRename(node) }
    );
  }
  if (onReveal) contextItems.push({ value: "reveal", label: `在 ${manager} 中${node.kind === "file" ? "显示" : "打开"}`, icon: <FolderOpen size={14} />,
    separatorBefore: contextItems.length > 0, onSelect: () => onReveal(node.path) });
  if (onCopyPath) contextItems.push(
    { value: "copy-path", label: "复制路径", icon: <Copy size={14} />, onSelect: () => onCopyPath(node.path, false) },
    { value: "copy-relative-path", label: "复制相对路径", icon: <Link size={14} />, onSelect: () => onCopyPath(node.path, true) }
  );
  if (node.kind === "directory" && onRefresh) contextItems.push({ value: "refresh", label: "刷新目录", icon: <RefreshCw size={14} />,
    separatorBefore: true, onSelect: onRefresh });
  if (node.path === root.path && onSwitchWorkspace) contextItems.push({ value: "switch-workspace", label: "切换本地工作区", icon: <FolderRoot size={14} />,
    separatorBefore: !(node.kind === "directory" && onRefresh), disabled: editing, onSelect: onSwitchWorkspace });
  if (canManage && fileActions && node.path !== root.path) contextItems.push({ value: "trash", label: mac ? "移到废纸篓" : "移到回收站", icon: <Trash2 size={14} />,
    shortcut: mac ? "⌘⌫" : "Delete", tone: "danger", separatorBefore: node.kind === "file", disabled: editing, onSelect: () => fileActions.onTrash([node]) });

  return contextItems;
}

/** Several entries selected in the tree: only what can be done to them together. */
export function workspaceSelectionMenuItems({ nodes, naming, fileActions, conversion }: {
  nodes: WorkspaceNode[]; naming?: boolean; fileActions?: WorkspaceTreeFileActions; conversion?: WorkspaceTreeConversion;
}): AppContextMenuItem[] {
  const items: AppContextMenuItem[] = [];
  const mac = window.chalkLee.platform === "darwin";
  const editing = Boolean(naming || fileActions?.busy);
  const converting = conversion?.countEntries?.(nodes) ?? 0;
  if (converting) items.push({ value: "convert", label: `转换原稿（${converting} 份）`, icon: <FileOutput size={14} />,
    disabled: editing, onSelect: () => conversion!.onConvertEntries!(nodes) });
  if (fileActions) items.push({ value: "trash", label: mac ? "移到废纸篓" : "移到回收站", icon: <Trash2 size={14} />,
    shortcut: mac ? "⌘⌫" : "Delete", tone: "danger", separatorBefore: items.length > 0, disabled: editing, onSelect: () => fileActions.onTrash(nodes) });
  return items;
}
