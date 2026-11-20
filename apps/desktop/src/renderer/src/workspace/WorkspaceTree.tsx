import { isOriginalKind } from "../../../shared/document/kinds";
import { ChevronDown } from "lucide-react";
import { cloneElement, memo, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import type { DocumentKind, WorkspaceDirectoryNode, WorkspaceFileNode, WorkspaceNode } from "../../../shared/contracts";
import { documentFileIconReference, DocumentFileIconSprite } from "../ui/DocumentFileIcon";
import { SidebarOverlayScrollArea } from "../ui/SidebarOverlayScrollArea";
import { WorkspaceFolderIcon } from "../ui/WorkspaceFolderIcon";
import { SKILLS_FOLDER } from "../../../shared/skills";
import { WorkspaceTreeCreateRow, WorkspaceTreeRenameRow, type WorkspaceTreeCreationControls, type WorkspaceTreeRenameControls } from "./WorkspaceTreeCreateRow";
import { findWorkspaceDirectoryTrail, findWorkspaceNode } from "./breadcrumbs";
import { sortWorkspaceSiblings, type WorkspaceTreeSort } from "./sorting";
import type { WorkspaceCreationKind } from "../../../shared/workspace/names";
import { AppContextMenu } from "../ui/AppContextMenu";
import { workspaceCreationDirectory } from "./creation";
import { canPasteWorkspaceEntry } from "./mutations";
import { workspaceContextMenuItems, workspaceSelectionMenuItems, type WorkspaceTreeConversion, type WorkspaceTreeFileActions } from "./contextMenuItems";
import { sameWorkspaceDirectory, workspacePathContains } from "../../../shared/workspace/paths";
import { createTextHighlighter } from "../ui/highlightText";
import { TrashDialog } from "./TrashDialog";
import { WORKSPACE_ENTRY_DRAG_TYPE, writeWorkspaceEntryDrag } from "./drag";
import { outermostEntries, visibleTreeEntries, type VisibleTreeEntry } from "./selection";
import { useTreeFileViewport } from "./treeFileIcons";
export { sortNodes } from "./sorting";

export interface WorkspaceTreeRevealRequest {
  id: number;
  path: string;
  /** False when the item opens for editing, so the editor keeps the focus. */
  focus?: boolean;
}

interface WorkspaceTreeProps {
  root: WorkspaceDirectoryNode;
  expanded: Set<string>;
  activePath: string | null;
  query: string;
  sort: WorkspaceTreeSort;
  revealRequest: WorkspaceTreeRevealRequest | null;
  creationControls?: WorkspaceTreeCreationControls;
  renameControls?: WorkspaceTreeRenameControls;
  fileActions?: WorkspaceTreeFileActions;
  onSelectPath?(path: string): void;
  onCreate?(kind: WorkspaceCreationKind, targetPath: string): void;
  onRefresh?(): void;
  onReveal?(path: string): void;
  onCopyPath?(path: string, relative: boolean): void;
  onSwitchWorkspace?(): void;
  conversion?: WorkspaceTreeConversion;
  /** Files dropped from outside the app, copied into the folder under the pointer. */
  onImport?(paths: string[], directoryPath: string): void;
  onToggle(path: string): void;
  onOpen(file: WorkspaceFileNode, newTab?: boolean): void;
}

export function WorkspaceTree({ root, expanded, activePath, query, sort, revealRequest, creationControls, renameControls, fileActions, onSelectPath, onCreate, onRefresh, onReveal, onCopyPath, onSwitchWorkspace, conversion, onImport, onToggle, onOpen }: WorkspaceTreeProps) {
  const iconPrefix = useId();
  const treeRef = useRef<HTMLElement>(null);
  const contextOriginRef = useRef<HTMLElement | null>(null);
  const contextIdRef = useRef(0);
  /** `nodes` holds several entries when the menu is for a selection. */
  const [contextMenu, setContextMenu] = useState<{ id: number; node: WorkspaceNode; nodes?: WorkspaceNode[]; x: number; y: number } | null>(null);
  const [pendingTrash, setPendingTrash] = useState<WorkspaceNode[] | null>(null);
  const [dropDirectory, setDropDirectory] = useState<string | null>(null);
  /** The entries being dragged within the tree; a drag's data cannot be read until it drops. */
  const [dragging, setDragging] = useState<WorkspaceNode[] | null>(null);
  /** Rows picked with Shift- or ⌘／Ctrl-click; empty while the tree only shows the open file. */
  const [selection, setSelection] = useState<readonly string[]>([]);
  const anchorRef = useRef<string | null>(null);
  const requestedQuery = query.trim();
  const deferredQuery = useDeferredValue(requestedQuery);
  // Keep typing responsive while a broad match is rendered. Clearing the
  // filter and entering a name restore the unfiltered tree immediately.
  const visibleQuery = creationControls || renameControls || !requestedQuery ? "" : deferredQuery;
  const renamingPath = renameControls?.node.path;
  const forceExpanded = Boolean(visibleQuery);
  const matchedChildren = useMemo(() => visibleQuery ? filterNodes(root.children, visibleQuery.toLocaleLowerCase(), renamingPath) : root.children,
    [root.children, visibleQuery, renamingPath]);
  const listChildren = useMemo(() => {
    const lists = new WeakMap<WorkspaceNode[], WorkspaceNode[]>();
    return (nodes: WorkspaceNode[]) => {
      let ordered = lists.get(nodes);
      if (!ordered) {
        // A search has already filtered the whole tree. Otherwise only a level on screen needs filtering.
        const visible = forceExpanded ? nodes : nodes.filter(node => node.kind === "directory" || matchesTreeFile(node, "", renamingPath));
        ordered = sortWorkspaceSiblings(visible.length === nodes.length ? nodes : visible, sort);
        lists.set(nodes, ordered);
      }
      return ordered;
    };
  }, [sort, forceExpanded, renamingPath]);
  const visibleChildren = listChildren(matchedChildren);
  const highlightName = useMemo(() => createTextHighlighter(visibleQuery ? [visibleQuery] : []), [visibleQuery]);
  const creationPath = creationControls?.creation.directoryPath;
  const visibleExpanded = useMemo(() => creationPath
    ? new Set([...expanded, ...(findWorkspaceDirectoryTrail(root, creationPath) ?? [])])
    : expanded, [root, expanded, creationPath]);
  const { rows, byPath: rowsByPath } = useMemo(() => visibleTreeEntries(visibleChildren, root.path, visibleExpanded, forceExpanded, listChildren),
    [visibleChildren, root.path, visibleExpanded, forceExpanded, listChildren]);
  const largeTree = rows.length > 128;
  const largeFilter = forceExpanded && largeTree;
  const nearbyFiles = useTreeFileViewport(treeRef, largeTree ? rows : undefined, largeFilter);
  // Share the icon markup across rows of the same kind. Each row has its own SVG nodes.
  const fileIcon = useMemo(() => {
    const icons = new Map<DocumentKind, ReturnType<typeof documentFileIconReference>>();
    return (kind: DocumentKind) => {
      let icon = icons.get(kind);
      if (!icon) { icon = documentFileIconReference(kind, iconPrefix, largeTree && !largeFilter); icons.set(kind, icon); }
      return icon;
    };
  }, [iconPrefix, largeTree, largeFilter]);
  // A selection keeps only what is shown, so a collapsed folder or a search never hides what an action would touch.
  const selected = useMemo(() => selection
    .map(path => rowsByPath.get(path))
    .filter((entry): entry is VisibleTreeEntry => entry !== undefined)
    .sort((left, right) => left.index - right.index)
    .map(entry => entry.node), [rowsByPath, selection]);
  const selectedPaths = useMemo(() => new Set(selected.map(node => node.path)), [selected]);
  const multiple = selected.length > 1;
  const clearSelection = useCallback(() => setSelection(current => current.length ? [] : current), []);
  useEffect(() => {
    if (selected.length !== selection.length) setSelection(selected.map(node => node.path));
  });
  useEffect(() => { clearSelection(); anchorRef.current = null; }, [root.path, clearSelection]);
  useEffect(() => { if (creationControls || renameControls) clearSelection(); }, [creationControls, renameControls, clearSelection]);

  const closeContextMenu = useCallback((restoreFocus = false) => {
    setContextMenu(null);
    if (restoreFocus && contextOriginRef.current?.isConnected) contextOriginRef.current.focus({ preventScroll: true });
  }, []);

  useEffect(() => { closeContextMenu(); }, [root.path, expanded, query, sort, creationControls?.creation, renameControls?.id, closeContextMenu]);
  useEffect(() => {
    if (contextMenu && !findWorkspaceNode(root, contextMenu.node.path)) closeContextMenu();
  }, [root, contextMenu, closeContextMenu]);
  useEffect(() => { setPendingTrash(null); }, [root.path]);
  useEffect(() => {
    if (pendingTrash?.some(node => !findWorkspaceNode(root, node.path))) setPendingTrash(null);
  }, [root, pendingTrash]);

  function showContextMenu(target: EventTarget, point?: { x: number; y: number }) {
    const element = target as HTMLElement;
    if (element.closest(".workspace-tree-creation")) return;
    const row = element.closest<HTMLElement>("[data-workspace-path]");
    const node = row ? findWorkspaceNode(root, row.dataset.workspacePath!) : root;
    if (!node) return;
    const origin = row ?? treeRef.current!;
    const rect = origin.getBoundingClientRect();
    contextOriginRef.current = origin;
    onSelectPath?.(node.path);
    // Right-clicking within a selection acts on all of it; anywhere else drops the selection.
    const nodes = multiple && selectedPaths.has(node.path) ? selected : undefined;
    if (!nodes) clearSelection();
    setContextMenu({ id: ++contextIdRef.current, node, nodes, x: point?.x ?? rect.left + 24, y: point?.y ?? rect.bottom });
  }

  /** Every move to the trash from the tree is confirmed first, for one entry or a selection. */
  const requestTrash = (nodes: WorkspaceNode[]) => setPendingTrash(outermostEntries(nodes));
  const contextFileActions = fileActions ? { ...fileActions, onTrash: requestTrash } : undefined;
  const naming = Boolean(creationControls || renameControls);
  const contextConversion = conversion?.onConvertEntries ? { ...conversion, onConvertEntries: (nodes: WorkspaceNode[]) => { clearSelection(); conversion.onConvertEntries!(outermostEntries(nodes)); },
    countEntries: (nodes: WorkspaceNode[]) => conversion.countEntries?.(outermostEntries(nodes)) ?? 0 } : conversion;
  const contextItems = !contextMenu ? [] : contextMenu.nodes
    ? workspaceSelectionMenuItems({ nodes: contextMenu.nodes, naming, fileActions: contextFileActions, conversion: contextConversion })
    : workspaceContextMenuItems({ root, node: contextMenu.node, naming, fileActions: contextFileActions, onOpen, onCreate, onRefresh, onReveal, onCopyPath, onSwitchWorkspace, conversion });

  /** Plain clicks open as before; Shift picks a run of rows from the last one clicked, ⌘／Ctrl adds or removes one. */
  const clickRow = ({ node, index }: VisibleTreeEntry, event: React.MouseEvent) => {
    if (event.shiftKey) {
      event.preventDefault();
      const anchor = anchorRef.current ?? activePath;
      const from = (anchor ? rowsByPath.get(anchor)?.index : undefined) ?? index;
      setSelection(rows.slice(Math.min(from, index), Math.max(from, index) + 1).map(item => item.path));
      return;
    }
    if (window.chalkLee.platform === "darwin" ? event.metaKey : event.ctrlKey) {
      // The open file counts as already selected, as the one highlighted row.
      const current = selection.length ? selection : activePath && activePath !== node.path && rowsByPath.has(activePath) ? [activePath] : [];
      setSelection(current.includes(node.path) ? current.filter(path => path !== node.path) : [...current, node.path]);
      anchorRef.current = node.path;
      return;
    }
    clearSelection();
    anchorRef.current = node.path;
    if (node.kind === "file") onOpen(node);
    else onToggle(node.path);
  };

  const importing = Boolean(onImport && !fileActions?.busy && !creationControls && !renameControls);
  /** The folder a drop at this point lands in: a folder row itself, a file's folder, or the workspace. */
  const dropTarget = (target: EventTarget) => {
    const path = (target as HTMLElement).closest<HTMLElement>("[data-workspace-path]")?.dataset.workspacePath;
    const entry = path ? rowsByPath.get(path) : undefined;
    if (!entry) return root.path;
    return entry.node.kind === "directory" ? entry.node.path : entry.parentPath;
  };

  const moving = Boolean(fileActions && !fileActions.busy && !creationControls && !renameControls);
  /** Where a moving entry may land: not where it already is, and a folder not into itself. */
  const alreadyIn = (node: WorkspaceNode, directory: string) => sameWorkspaceDirectory(node.path, `${directory}/${node.name}`);
  /** Several entries move when none would go into itself; those already in the folder stay put. */
  const dragDestinations = useMemo(() => new Map<string, boolean>(), [dragging]);
  const canMoveInto = (directory: string) => {
    if (!dragging) return false;
    let allowed = dragDestinations.get(directory);
    if (allowed === undefined) {
      allowed = dragging.some(node => !alreadyIn(node, directory))
        && !dragging.some(node => node.kind === "directory" && workspacePathContains(node.path, directory));
      dragDestinations.set(directory, allowed);
    }
    return allowed;
  };
  const endDrag = () => { setDragging(null); setDropDirectory(null); };
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;
  const rowState: TreeRowState = {
    expanded: visibleExpanded, activePath: selection.length ? null : activePath, selectedPaths,
    contextPath: contextMenu && !contextMenu.nodes ? contextMenu.node.path : undefined,
    dropPath: dropDirectory, cutPath: fileActions?.clipboard?.operation === "cut" ? fileActions.clipboard.path : undefined,
    renameControls, creationControls, forceExpanded, listChildren, highlightName, nearbyFiles, fileIcon
  };
  // Hovering a closed folder while moving opens it, so deeper folders can be reached.
  useEffect(() => {
    if (!dragging || !dropDirectory || dropDirectory === root.path || expanded.has(dropDirectory)) return;
    const timer = window.setTimeout(() => toggleRef.current(dropDirectory), 700);
    return () => window.clearTimeout(timer);
  }, [dragging, dropDirectory, expanded, root.path]);

  useEffect(() => {
    if (!revealRequest || creationControls || renameControls) return;
    const frame = window.requestAnimationFrame(() => {
      const target = Array.from(treeRef.current?.querySelectorAll<HTMLElement>("[data-workspace-path]") ?? [])
        .find((element) => element.dataset.workspacePath === revealRequest.path);
      if (!target) return;
      target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      if (revealRequest.focus !== false) target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [revealRequest, creationControls, renameControls]);

  return (
    <><SidebarOverlayScrollArea ref={treeRef} as="nav" className={`workspace-tree${dropDirectory === root.path ? " drop-target" : ""}`} ariaLabel="文件夹目录" tabIndex={0} onDragStart={event => {
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-workspace-path]");
      const node = row ? findWorkspaceNode(root, row.dataset.workspacePath!) : null;
      if (!node || node.path === root.path) return;
      const nodes = multiple && selectedPaths.has(node.path) ? outermostEntries(selected) : [node];
      if (nodes.length === 1) clearSelection();
      writeWorkspaceEntryDrag(event.dataTransfer, nodes.map(item => ({ path: item.path, name: item.name, kind: item.kind === "directory" ? "directory" : item.extension })));
      setDragging(nodes);
    }} onDragEnd={endDrag} onDragOver={event => {
      if (dragging && event.dataTransfer.types.includes(WORKSPACE_ENTRY_DRAG_TYPE)) {
        const directory = dropTarget(event.target);
        if (!moving || !canMoveInto(directory)) { setDropDirectory(null); return; }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropDirectory(directory);
        return;
      }
      if (!importing || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDropDirectory(dropTarget(event.target));
    }} onDragLeave={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropDirectory(null);
    }} onDrop={event => {
      if (dragging && event.dataTransfer.types.includes(WORKSPACE_ENTRY_DRAG_TYPE)) {
        event.preventDefault();
        const directory = dropTarget(event.target);
        endDrag();
        if (moving && canMoveInto(directory)) { clearSelection(); fileActions!.onMove(dragging.filter(node => !alreadyIn(node, directory)), directory); }
        return;
      }
      if (!importing || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setDropDirectory(null);
      const paths = Array.from(event.dataTransfer.files, file => window.chalkLee.pathForFile(file)).filter(Boolean);
      if (paths.length) onImport!(paths, dropTarget(event.target));
    }} onClick={event => {
      const target = event.target as HTMLElement;
      if (target.closest(".workspace-tree-creation")) return;
      const path = target.closest<HTMLElement>("[data-workspace-path]")?.dataset.workspacePath;
      const row = path ? rowsByPath.get(path) : undefined;
      if (row) clickRow(row, event);
      else { clearSelection(); onSelectPath?.(root.path); }
    }} onMouseDown={event => {
      if (event.button === 1 && (event.target as HTMLElement).closest("button.tree-file")) event.preventDefault();
    }} onAuxClick={event => {
      if (event.button !== 1) return;
      const path = (event.target as HTMLElement).closest<HTMLElement>("button.tree-file")?.dataset.workspacePath;
      const file = path ? rowsByPath.get(path)?.node : undefined;
      if (file?.kind === "file") onOpen(file, true);
    }} onContextMenu={event => {
      if ((event.target as HTMLElement).closest(".workspace-tree-creation")) return;
      event.preventDefault(); event.stopPropagation();
      showContextMenu(event.target, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
    }} onKeyDown={event => {
      if ((event.target as HTMLElement).closest(".workspace-tree-creation")) return;
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault(); event.stopPropagation(); showContextMenu(event.target); return;
      }
      if (!fileActions || fileActions.busy || creationControls || renameControls || event.nativeEvent.isComposing || event.altKey) return;
      const row = (event.target as HTMLElement).closest<HTMLElement>("[data-workspace-path]");
      const node = row ? findWorkspaceNode(root, row.dataset.workspacePath!) : root;
      if (!node) return;
      const primary = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const mac = window.chalkLee.platform === "darwin";
      const trashKey = (mac && primary && key === "backspace") || (!mac && key === "delete");
      if (key === "escape" && selection.length) { event.preventDefault(); event.stopPropagation(); clearSelection(); return; }
      // Several selected rows: only moving them to the trash applies to all; one-entry shortcuts do nothing rather than pick one.
      if (multiple && (trashKey || (primary && ["c", "x", "d"].includes(key)) || key === "f2")) {
        event.preventDefault(); event.stopPropagation();
        if (trashKey) requestTrash(selected);
        return;
      }
      let action: (() => void) | undefined;
      if (primary && key === "v" && canPasteWorkspaceEntry(fileActions.clipboard, workspaceCreationDirectory(root, node.path).path)) action = () => fileActions.onPaste(workspaceCreationDirectory(root, node.path).path);
      if (key === "escape" && fileActions.clipboard?.operation === "cut") action = fileActions.onCancelCut;
      if (node.path !== root.path) {
        if (primary && (key === "c" || key === "x")) action = () => fileActions.onCopy(node, key === "c" ? "copy" : "cut");
        if (primary && key === "d") action = () => fileActions.onDuplicate(node);
        if (key === "f2") action = () => fileActions.onRename(node);
        if (trashKey) action = () => requestTrash([node]);
      }
      if (action) { event.preventDefault(); event.stopPropagation(); action(); }
    }}>
      <DocumentFileIconSprite prefix={iconPrefix} />
      {creationControls?.creation.directoryPath === root.path ? <WorkspaceTreeCreateRow key={creationControls.creation.id} {...creationControls} depth={0} /> : null}
      <TreeRows nodes={visibleChildren} {...rowState} />
      {visibleChildren.length === 0 && !creationControls ? <div className="tree-empty">没有找到 ChalkLee、Word、PDF 或 Markdown</div> : null}
    </SidebarOverlayScrollArea>
    {contextMenu && contextItems.length > 0 ? <AppContextMenu key={contextMenu.id} x={contextMenu.x} y={contextMenu.y} label={contextMenu.nodes ? `所选 ${contextMenu.nodes.length} 项的操作` : `${contextMenu.node.name}的操作`} items={contextItems} onClose={closeContextMenu} /> : null}
    {pendingTrash ? <TrashDialog root={root} entries={pendingTrash} onClose={() => setPendingTrash(null)} onConfirm={() => { clearSelection(); fileActions?.onTrash(pendingTrash); setPendingTrash(null); }} /> : null}</>
  );
}

interface TreeRowState {
  expanded: Set<string>;
  activePath: string | null;
  selectedPaths: ReadonlySet<string>;
  contextPath?: string;
  dropPath?: string | null;
  cutPath?: string;
  renameControls?: WorkspaceTreeRenameControls;
  creationControls?: WorkspaceTreeCreationControls;
  forceExpanded: boolean;
  listChildren(children: WorkspaceNode[]): WorkspaceNode[];
  highlightName: ReturnType<typeof createTextHighlighter>;
  nearbyFiles?: ReadonlySet<string>;
  fileIcon(kind: DocumentKind): ReturnType<typeof documentFileIconReference>;
}

const TreeRows = memo(function TreeRows({ nodes, depth = 0, ...state }: { nodes: WorkspaceNode[]; depth?: number } & TreeRowState) {
  const { activePath, selectedPaths, contextPath, cutPath, renameControls, highlightName, nearbyFiles, forceExpanded, fileIcon } = state;
  const showAllIcons = nearbyFiles === undefined;
  // Keep stable elements and keys for ordinary files while selection or a folder's drop target changes.
  const plainFiles = useMemo(() => nodes.map(node => node.kind === "file"
    ? <TreeFileRow key={node.id} path={node.path} name={node.name} extension={node.extension} icon={showAllIcons ? fileIcon(node.extension) : undefined} />
    : null), [nodes, fileIcon, showAllIcons]);
  const files = useMemo(() => plainFiles.map((row, index) => {
    if (!row) return null;
    const node = nodes[index];
    if (node.kind !== "file") return null;
    const { path } = node;
    if (renameControls?.node.path === path) return <WorkspaceTreeRenameRow key={row.key} {...renameControls} depth={depth} />;
    const active = activePath === path, selected = selectedPaths.has(path), contextTarget = contextPath === path;
    const cut = Boolean(cutPath && workspacePathContains(cutPath, path));
    const near = !nearbyFiles || nearbyFiles.has(path);
    const mark = forceExpanded && near ? highlightName : undefined;
    if (!active && !selected && !contextTarget && !cut && !mark) return row;
    return cloneElement(row, {
      active, selected, contextTarget, cut, highlightName: mark,
      icon: near ? fileIcon(node.extension) : undefined
    });
  }), [nodes, plainFiles, activePath, selectedPaths, contextPath, cutPath, renameControls, forceExpanded, highlightName, nearbyFiles, fileIcon, depth]);

  return <>{nodes[0]?.kind === "directory" ? nodes.map((node, index) => node.kind === "directory"
    ? <TreeFolder key={node.id} node={node} depth={depth} state={state} />
    : files[index]) : files}</>;
});

function TreeFolder({ node, depth, state }: { node: WorkspaceDirectoryNode; depth: number; state: TreeRowState }) {
  const { expanded, selectedPaths, contextPath, dropPath, cutPath, renameControls, creationControls, forceExpanded, highlightName } = state;
  const renaming = renameControls?.node.path === node.path;
  const cut = Boolean(cutPath && workspacePathContains(cutPath, node.path));
  const selected = selectedPaths.has(node.path);
  const contextTarget = contextPath === node.path;
  const isOpen = forceExpanded || expanded.has(node.path);
  return (
    <section className={`tree-folder${dropPath === node.path ? " drop-target" : ""}`} style={{ "--tree-depth": depth } as React.CSSProperties}>
      {renaming ? <WorkspaceTreeRenameRow {...renameControls!} depth={depth} open={isOpen} /> : <button
        type="button"
        className={`tree-folder-label tree-folder-button${selected ? " selected" : ""}${contextTarget ? " context-target" : ""}${cut ? " tree-cut" : ""}`}
        data-workspace-path={node.path}
        draggable
        aria-expanded={isOpen}
      >
        <ChevronDown size={13} className={isOpen ? "" : "collapsed"} />
        <WorkspaceFolderIcon open={isOpen} skills={depth === 0 && node.name === SKILLS_FOLDER} />
        <strong data-overflow-tooltip={node.name}>{highlightName(node.name)}</strong>
      </button>}
      {isOpen ? (
        <div className="tree-folder-children" style={{ "--tree-depth": depth + 1 } as React.CSSProperties}>
          {creationControls?.creation.directoryPath === node.path ? <WorkspaceTreeCreateRow key={creationControls.creation.id} {...creationControls} depth={depth + 1} /> : null}
          <TreeRows nodes={state.listChildren(node.children)} depth={depth + 1} {...state} />
        </div>
      ) : null}
    </section>
  );
}

const TreeFileRow = memo(function TreeFileRow({ path, name, extension, active, selected, contextTarget, cut, highlightName, icon }: {
  path: string; name: string; extension: DocumentKind;
  active?: boolean; selected?: boolean; contextTarget?: boolean; cut?: boolean;
  highlightName?: TreeRowState["highlightName"]; icon?: ReturnType<typeof documentFileIconReference>;
}) {
  return <button type="button" className={`tree-file source${active ? " active" : ""}${selected ? " selected" : ""}${contextTarget ? " context-target" : ""}${cut ? " tree-cut" : ""}`}
    aria-label={name} data-workspace-path={path} data-document-kind={extension} draggable>
    {icon}
    <span data-overflow-tooltip={name}>{highlightName ? highlightName(name) : name}</span>
  </button>;
});

function matchesTreeFile(node: WorkspaceFileNode, query: string, renamingPath?: string) {
  if (query && !node.name.toLocaleLowerCase().includes(query)) return false;
  // A converted original stays behind its ChalkLee, unless a search finds it by its own name and not the ChalkLee's.
  return node.path === renamingPath || !node.convertedTo?.length || !isOriginalKind(node.extension)
    || Boolean(query && !node.convertedTo.some(result => (result.split(/[\\/]/).pop() ?? "").toLocaleLowerCase().includes(query)));
}

export function filterNodes(nodes: WorkspaceNode[], query: string, renamingPath?: string): WorkspaceNode[] {
  const filtered: WorkspaceNode[] = [];
  let changedChildren = false;
  for (const node of nodes) {
    if (node.kind === "file") {
      if (matchesTreeFile(node, query, renamingPath)) filtered.push(node);
      continue;
    }
    const children = filterNodes(node.children, query, renamingPath);
    if (!query || children.length > 0 || node.name.toLocaleLowerCase().includes(query)) {
      if (children === node.children) filtered.push(node);
      else {
        changedChildren = true;
        filtered.push({ ...node, children });
      }
    }
  }
  return changedChildren || filtered.length !== nodes.length ? filtered : nodes;
}
