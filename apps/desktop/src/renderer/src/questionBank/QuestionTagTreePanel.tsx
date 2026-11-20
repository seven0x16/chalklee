import { Check, ChevronDown, CircleDashed, FolderMinus, FolderPlus, FolderRoot, LibraryBig, Minus, Pencil, Search, Sparkles, Trash2, X } from "lucide-react";
import { ListChevronsDownUp, ListChevronsUpDown, TagPlus } from "../ui/lucideBackports";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  addTagGroup,
  isTagGroup,
  moveTag,
  moveTagGroup,
  removeTag,
  removeTagGroup,
  renameTagGroup,
  tagGroupIds,
  tagGroupNameProblem,
  tagNameProblem,
  tagsInGroup,
  type QuestionTagGroup,
  type QuestionTagNode,
  type QuestionTagTree
} from "../../../shared/questionBank/tagTree";
import { ImportDialog } from "../conversion/SingleImport";
import { AppContextMenu, type AppContextMenuItem } from "../ui/AppContextMenu";
import { highlightText } from "../ui/highlightText";
import { SidebarOverlayScrollArea } from "../ui/SidebarOverlayScrollArea";
import { ALL_QUESTIONS, nodeKey, refOf, tagSelectionStates, toggleTagNode, type TagNodeRef } from "./tagSelection";
import { loadTagTreeSort, sortTagNodes, TAG_TREE_SORT_KEY, type TagTreeSort } from "./tagTreeSorting";
import { TagTreeSortMenu } from "./TagTreeSortMenu";
import type { QuestionLibrary } from "./useQuestionLibrary";
import { TagPresetDialog, type PresetAddition } from "./tagPresets/TagPresetDialog";
import { planPresetMerge } from "../../../shared/questionBank/tagPresets/tagPresetMerge";
import type { PresetStage } from "../../../shared/questionBank/tagPresets/tagPresets";

const DRAG_TYPE = "application/x-chalklee-tag-node";

interface Row {
  key: string;
  ref: TagNodeRef;
  node: QuestionTagNode;
  name: string;
  depth: number;
  /** Group holding this row; null at the top level. */
  parentId: string | null;
  /** Position among the parent's children (top level: groups first, then tags outside every group). */
  index: number;
  count: number;
  open: boolean;
}

type Naming =
  | { kind: "group"; parentId: string | null }
  | { kind: "tag"; groupId: string | null }
  | { kind: "rename"; groupId: string };

type Drop = { key: string; position: "before" | "after" | "inside" };

/** After a preset is added: what it did, its undo while nothing else has changed the tree, and the tags still outside every group. */
interface PresetNotice { id: number; label: string; text: string; before: QuestionTagTree; after: QuestionTagTree; remaining: number; course: string }

/** The stage most of the workspace's questions are graded in. */
function likelyStage(grades: ReadonlyArray<{ value: number; count: number }>): PresetStage {
  const totals = { 小学: 0, 初中: 0, 高中: 0 };
  for (const { value, count } of grades) totals[value <= 6 ? "小学" : value <= 9 ? "初中" : "高中"] += count;
  const [stage, count] = (Object.entries(totals) as Array<[PresetStage, number]>).sort((left, right) => right[1] - left[1])[0];
  return count ? stage : "初中";
}

/** The library's left pane: the teacher's tag groups, tags outside every group, then untagged questions. */
export function QuestionTagTreePanel({ library, notify, workspaceName, onSwitchWorkspace, onAskAssistant }: { library: QuestionLibrary; notify(message: string): void; workspaceName: string | null; onSwitchWorkspace(): void; onAskAssistant?(text: string): void }) {
  const { tree, tagTree, selection, setSelection, collapsed, toggleCollapsed, setCollapsed, editTagTree, response } = library;
  const counts = response?.facets.tagTree;
  const usedTags = useMemo(() => new Set(counts?.used ?? []), [counts]);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [menu, setMenu] = useState<{ id: number; row: Row | null; x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<QuestionTagGroup | null>(null);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetNotice, setPresetNotice] = useState<PresetNotice | null>(null);
  const noticeIdRef = useRef(0);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [sort, setSort] = useState<TagTreeSort>(loadTagTreeSort);
  // The header turns into the tag-name filter while it is focused or still filtering.
  const [filter, setFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterShown = filterOpen || filter !== "";
  const filterInputRef = useRef<HTMLInputElement>(null);
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<Row | null>(null);
  const menuIdRef = useRef(0);
  const scrollRef = useRef<HTMLElement>(null);

  useEffect(() => { try { localStorage.setItem(TAG_TREE_SORT_KEY, JSON.stringify(sort)); } catch { /* Preference only. */ } }, [sort]);
  useEffect(() => { if (filterOpen) { filterInputRef.current?.focus(); filterInputRef.current?.select(); } }, [filterOpen]);

  const countOf = useMemo(() => {
    const groups = new Map((counts?.groups ?? []).map(entry => [entry.value, entry.count]));
    const tags = new Map((counts?.tags ?? []).map(entry => [entry.value, entry.count]));
    return (ref: TagNodeRef) => ref.kind === "tag" ? tags.get(ref.name) ?? 0 : groups.get(ref.id) ?? 0;
  }, [counts]);
  const states = tagSelectionStates(tree, selection);

  const query = filter.trim().toLocaleLowerCase();
  const highlightWords = query ? [filter.trim()] : [];
  const matchesQuery = (node: QuestionTagNode): boolean =>
    (isTagGroup(node) ? node.name : node).toLocaleLowerCase().includes(query)
    || (isTagGroup(node) && node.children.some(matchesQuery));

  const rows: Row[] = [];
  const visit = (node: QuestionTagNode, depth: number, parentId: string | null, index: number) => {
    if (query && !matchesQuery(node)) return;
    const ref = refOf(node);
    // Filtering expands every matching branch so hits stay visible.
    const open = isTagGroup(node) && (Boolean(query) || !collapsed.has(node.id));
    rows.push({ key: nodeKey(ref), ref, node, name: isTagGroup(node) ? node.name : node, depth, parentId, index, count: countOf(ref), open });
    if (isTagGroup(node) && open) sortTagNodes(node.children, sort, countOf).forEach((child, childIndex) => visit(child, depth + 1, node.id, childIndex));
  };
  sortTagNodes(tree.nodes, sort, countOf).forEach((node, index) => visit(node, 0, null, index));
  const firstTopTagKey = rows.find(row => row.depth === 0 && row.ref.kind === "tag")?.key ?? null;

  const allGroupIds = tree.nodes.filter(isTagGroup).flatMap(tagGroupIds);
  const anyOpen = allGroupIds.some(id => !collapsed.has(id));
  const empty = !tree.nodes.length;

  useEffect(() => { setMenu(null); }, [tagTree]);
  // The undo only holds while the tree is still as the add left it.
  useEffect(() => { if (presetNotice && tagTree !== presetNotice.after && tagTree !== presetNotice.before) setPresetNotice(null); }, [tagTree]);
  useEffect(() => { setPresetNotice(null); setPresetOpen(false); }, [library.workspaceRoot]);
  const tagCounts = useMemo(() => new Map((counts?.tags ?? []).map(entry => [entry.value, entry.count])), [counts]);
  const usedList = useMemo(() => counts?.used ?? [], [counts]);

  function addPreset(addition: PresetAddition) {
    let plan: ReturnType<typeof planPresetMerge> | null = null;
    const done = editTagTree(current => (plan = planPresetMerge(current, usedList, addition.parts, addition.excluded)).tree);
    if (!done || !plan) return;
    const result = plan as ReturnType<typeof planPresetMerge>;
    setPresetOpen(false);
    setFilter(""); setFilterOpen(false);
    // The path opens; the preset's own groups start folded so its first level reads at a glance.
    const pathIds = new Set(result.pathIds.flat());
    setCollapsed(new Set([...[...collapsed].filter(id => !pathIds.has(id)), ...result.createdGroupIds.filter(id => !pathIds.has(id))]));
    const grouped = new Set(result.tree.groups.flatMap(tagsInGroup));
    const remaining = usedList.filter(tag => !grouped.has(tag)).length;
    const parts = [`已添加“${addition.label}”`, result.merged.length ? `并入 ${result.merged.length} 个已有标签` : "", remaining && onAskAssistant ? `还有 ${remaining} 个未归组` : ""].filter(Boolean);
    setPresetNotice({ id: ++noticeIdRef.current, label: addition.label, text: parts.join("，"), before: result.before, after: result.tree, remaining, course: addition.parts[0]?.path[0] ?? addition.label });
    const top = result.pathIds[0]?.[0];
    if (top) window.requestAnimationFrame(() => scrollRef.current?.querySelector(`[data-tag-row="g:${CSS.escape(top)}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  function undoPreset(notice: PresetNotice) {
    setPresetNotice(null);
    editTagTree(current => {
      if (current !== notice.after) throw new Error("标签目录之后又改动过，无法撤销这次添加");
      return notice.before;
    });
  }

  /** Where header-made tags and groups land: the 只看 group, a 只看 tag's group, else the top level. */
  function newEntryParent(): string | null {
    if (selection.scope !== "tags" || selection.nodes.length !== 1) return null;
    const [ref] = selection.nodes;
    return ref.kind === "group" ? ref.id : findHolder(ref.name);
  }

  function startNaming(next: Naming) {
    setMenu(null);
    setFilter("");
    setFilterOpen(false);
    if (next.kind !== "rename" && "parentId" in next && next.parentId) toggleCollapsed(next.parentId, false);
    if (next.kind === "tag" && next.groupId) toggleCollapsed(next.groupId, false);
    setNaming(next);
  }

  function closeFilter() {
    setFilter("");
    setFilterOpen(false);
    window.requestAnimationFrame(() => filterToggleRef.current?.focus());
  }

  function submitNaming(value: string): string | null {
    if (!naming) return null;
    const name = value.trim();
    if (naming.kind === "group") {
      const problem = tagGroupNameProblem(tagTree, naming.parentId, name);
      if (problem) return problem;
      if (editTagTree(current => addTagGroup(current, naming.parentId, name).tree)) setNaming(null);
      return null;
    }
    if (naming.kind === "rename") {
      const group = findGroup(naming.groupId);
      if (group?.name === name) { setNaming(null); return null; }
      const problem = tagGroupNameProblem(tagTree, parentOf(naming.groupId), name, naming.groupId);
      if (problem) return problem;
      if (editTagTree(current => renameTagGroup(current, naming.groupId, name))) setNaming(null);
      return null;
    }
    const problem = tagNameProblem(name);
    if (problem) return problem;
    if (!naming.groupId && rows.some(row => row.depth === 0 && row.ref.kind === "tag" && row.ref.name === name)) return "已有同名标签";
    const from = findHolder(name);
    if (from && from !== naming.groupId) notify(`标签“${name}”原在“${groupPathName(from)}”，已移到这里`);
    if (editTagTree(current => moveTag(current, name, naming.groupId))) setNaming(null);
    return null;
  }

  function findGroup(id: string): QuestionTagGroup | null {
    let found: QuestionTagGroup | null = null;
    const visitGroup = (group: QuestionTagGroup) => { if (group.id === id) found = group; else group.children.forEach(child => { if (isTagGroup(child)) visitGroup(child); }); };
    tagTree.groups.forEach(visitGroup);
    return found;
  }
  function parentOf(id: string): string | null {
    const row = rows.find(candidate => candidate.ref.kind === "group" && candidate.ref.id === id);
    if (row) return row.parentId;
    let parent: string | null = null;
    const visitGroup = (group: QuestionTagGroup) => group.children.forEach(child => {
      if (isTagGroup(child)) { if (child.id === id) parent = group.id; visitGroup(child); }
    });
    tagTree.groups.forEach(visitGroup);
    return parent;
  }
  function findHolder(tag: string): string | null {
    let holder: string | null = null;
    const visitGroup = (group: QuestionTagGroup) => group.children.forEach(child => {
      if (isTagGroup(child)) visitGroup(child); else if (child === tag) holder = group.id;
    });
    tagTree.groups.forEach(visitGroup);
    return holder;
  }
  function groupPathName(id: string) {
    const names: string[] = [];
    for (let current: string | null = id; current; current = parentOf(current)) names.unshift(findGroup(current)?.name ?? "");
    return names.join(" › ");
  }

  function menuItems(row: Row | null): AppContextMenuItem[] {
    const newTop: AppContextMenuItem = { value: "new-group", label: "新建分组", icon: <FolderPlus size={14} />, onSelect: () => startNaming({ kind: "group", parentId: null }) };
    const newTag: AppContextMenuItem = { value: "new-tag", label: "新建标签", icon: <TagPlus size={14} />, onSelect: () => startNaming({ kind: "tag", groupId: null }) };
    const preset: AppContextMenuItem = { value: "add-preset", label: "添加标签体系", icon: <LibraryBig size={14} />, separatorBefore: true, onSelect: () => { setMenu(null); setPresetOpen(true); } };
    if (!row) return [newTag, newTop, preset];
    if (row.ref.kind === "group") {
      const group = row.node as QuestionTagGroup;
      return [
        { value: "new-sub", label: "新建子分组", icon: <FolderPlus size={14} />, onSelect: () => startNaming({ kind: "group", parentId: group.id }) },
        { value: "new-tag", label: "新建标签", icon: <TagPlus size={14} />, onSelect: () => startNaming({ kind: "tag", groupId: group.id }) },
        { value: "rename", label: "重命名", icon: <Pencil size={14} />, shortcut: "F2", separatorBefore: true, onSelect: () => startNaming({ kind: "rename", groupId: group.id }) },
        { value: "delete", label: "删除分组", icon: <Trash2 size={14} />, tone: "danger", onSelect: () => { setMenu(null); setPendingDelete(group); } }
      ];
    }
    const name = row.ref.name;
    if (row.parentId) {
      return [{ value: "ungroup", label: "移出分组", icon: <FolderMinus size={14} />, onSelect: () => { setMenu(null); editTagTree(current => moveTag(current, name, null)); } }];
    }
    const items: AppContextMenuItem[] = [newTop];
    // A used tag stays listed through its questions, so only an unused one can leave the tree.
    if (counts && !usedTags.has(name)) {
      items.push({ value: "remove-tag", label: "删除标签", icon: <Trash2 size={14} />, tone: "danger", separatorBefore: true, onSelect: () => { setMenu(null); editTagTree(current => removeTag(current, name)); } });
    }
    return items;
  }

  function openMenu(row: Row | null, target: EventTarget | null, point?: { x: number; y: number }) {
    const rect = (target instanceof Element ? target.closest("[data-tag-row]") ?? target : null)?.getBoundingClientRect();
    setMenu({ id: ++menuIdRef.current, row, x: point?.x ?? (rect ? rect.left + 24 : 80), y: point?.y ?? (rect ? rect.bottom : 120) });
  }

  /* ---------- drag to regroup ---------- */

  function dropTarget(row: Row, event: DragEvent<HTMLElement>): Drop["position"] {
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = (event.clientY - rect.top) / rect.height;
    if (row.ref.kind === "group") return offset < .25 ? "before" : offset > .75 ? "after" : "inside";
    return offset < .5 ? "before" : "after";
  }

  /** The edit a drop would make, or null when it is not allowed there. */
  function dropEdit(dragged: Row, row: Row, position: Drop["position"]) {
    if (dragged.key === row.key || query) return null;
    // Sorted levels place each row by the sort rule; only dropping into a group still works.
    if (sort.field !== "manual" && position !== "inside") return null;
    const into = position === "inside";
    const parentId = into ? (row.ref as { id: string }).id : row.parentId;
    const index = into ? undefined : row.index + (position === "after" ? 1 : 0);
    // Top-level tags always follow the groups in name order, so only they take top-level tags, and groups go between groups.
    if (parentId === null && (dragged.ref.kind === "tag") !== (row.ref.kind === "tag")) return null;
    if (dragged.ref.kind === "tag") {
      const tag = dragged.ref.name;
      if (parentId === null) return dragged.parentId === null ? null : () => editTagTree(current => moveTag(current, tag, null));
      return () => editTagTree(current => moveTag(current, tag, parentId, index));
    }
    const id = dragged.ref.id;
    return () => editTagTree(current => moveTagGroup(current, id, parentId, index));
  }

  function rowDragProps(row: Row) {
    return {
      draggable: !query,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        dragRef.current = row;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(DRAG_TYPE, row.key);
        event.dataTransfer.setData("text/plain", row.name);
      },
      onDragEnd: () => { dragRef.current = null; setDrop(null); },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        const dragged = dragRef.current;
        if (!dragged || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
        const position = dropTarget(row, event);
        if (!dropEdit(dragged, row, position)) { setDrop(null); return; }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (drop?.key !== row.key || drop.position !== position) setDrop({ key: row.key, position });
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && drop?.key === row.key) setDrop(null);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const dragged = dragRef.current;
        setDrop(null);
        if (!dragged) return;
        event.preventDefault();
        dropEdit(dragged, row, dropTarget(row, event))?.();
        dragRef.current = null;
      }
    };
  }

  const scope = selection.scope;
  /** The one node 只看 is on, if any; clicking it again lists every question. */
  const solo = scope === "tags" && selection.nodes.length === 1 ? nodeKey(selection.nodes[0]) : null;
  const topTagNaming = naming?.kind === "tag" && naming.groupId === null
    ? <NamingRow key="new-top-tag" depth={0} group={false} label="新建标签名称" initial="" onSubmit={submitNaming} onCancel={() => setNaming(null)} />
    : null;
  return (
    <section className="question-tag-tree" aria-label="标签">
      {filterShown ? (
        <header className="sidebar-pane-header question-tag-tree-header is-filtering" role="search">
          <label className="workspace-tree-filter">
            <Search size={15} aria-hidden="true" />
            <input ref={filterInputRef} type="search" value={filter} placeholder="搜索标签名" aria-label="搜索标签名"
              autoComplete="off" spellCheck={false} onChange={event => setFilter(event.target.value)}
              onFocus={() => setFilterOpen(true)} onBlur={() => { if (document.hasFocus()) setFilterOpen(false); }}
              onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); closeFilter(); } }} />
            <button type="button" className="question-bank-icon-button" title="清除搜索" aria-label="清除搜索" onClick={closeFilter}><X size={13} /></button>
          </label>
        </header>
      ) : (
        <header className="sidebar-pane-header question-tag-tree-header">
          <button type="button" className="sidebar-pane-workspace" title={workspaceName ? "切换本地工作区" : "打开本地文件夹"} onClick={onSwitchWorkspace}>
            <FolderRoot size={15} aria-hidden="true" />
            <strong>{workspaceName ?? "打开文件夹"}</strong>
          </button>
          <div className="sidebar-pane-actions">
            <button type="button" title="新建标签" aria-label="新建标签" disabled={!library.workspaceRoot}
              onMouseDown={event => event.preventDefault()} onClick={() => startNaming({ kind: "tag", groupId: newEntryParent() })}><TagPlus size={15} /></button>
            <button type="button" title="新建分组" aria-label="新建分组" disabled={!library.workspaceRoot}
              onMouseDown={event => event.preventDefault()} onClick={() => startNaming({ kind: "group", parentId: newEntryParent() })}><FolderPlus size={15} /></button>
            <TagTreeSortMenu sort={sort} disabled={!library.workspaceRoot} onChange={setSort} />
            <button type="button" title={anyOpen ? "全部折叠" : "全部展开"} aria-label={anyOpen ? "全部折叠" : "全部展开"} disabled={!allGroupIds.length}
              onClick={() => setCollapsed(anyOpen ? new Set([...collapsed, ...allGroupIds]) : new Set([...collapsed].filter(id => !allGroupIds.includes(id))))}>
              {anyOpen ? <ListChevronsDownUp size={15} /> : <ListChevronsUpDown size={15} />}
            </button>
            <button ref={filterToggleRef} type="button" title="搜索标签名" aria-label="搜索标签名" disabled={!library.workspaceRoot}
              onClick={() => setFilterOpen(true)}><Search size={15} /></button>
          </div>
        </header>
      )}
      <SidebarOverlayScrollArea ref={scrollRef} as="nav" className="question-tag-tree-scroll" ariaLabel="标签分组"
        onContextMenu={event => {
          if ((event.target as HTMLElement).closest(".question-tag-row, .question-tag-naming")) return;
          event.preventDefault();
          openMenu(null, event.target, { x: event.clientX, y: event.clientY });
        }}
        onDragOver={event => {
          // Below the last row: a group goes to the end of the groups, a tag out of its group.
          const dragged = dragRef.current;
          if (query || (event.target as HTMLElement).closest(".question-tag-row") || !dragged || (dragged.ref.kind === "tag" && dragged.parentId === null)) return;
          event.preventDefault();
        }}
        onDrop={event => {
          const dragged = dragRef.current;
          if (query || (event.target as HTMLElement).closest(".question-tag-row") || !dragged || (dragged.ref.kind === "tag" && dragged.parentId === null)) return;
          event.preventDefault();
          const ref = dragged.ref;
          editTagTree(current => ref.kind === "group" ? moveTagGroup(current, ref.id, null) : moveTag(current, ref.name, null));
          dragRef.current = null; setDrop(null);
        }}>
        {presetNotice && !query ? (
          <div key={presetNotice.id} className="question-tag-notice" role="status">
            <div className="question-tag-notice-text">
              <LibraryBig size={14} aria-hidden="true" />
              <span title={presetNotice.text}>{presetNotice.text}</span>
              <button type="button" className="question-tag-notice-close" aria-label="关闭提示" title="关闭" onClick={() => setPresetNotice(null)}><X size={13} /></button>
            </div>
            <div className="question-tag-notice-actions">
              <button type="button" title="移除这次添加的分组和标签，已有标签回到原处" onClick={() => undoPreset(presetNotice)}>撤销</button>
              {presetNotice.remaining && onAskAssistant ? (
                <button type="button" title={`把还没归组的 ${presetNotice.remaining} 个标签交给 ChalkLee AI：意思相同的并入体系中的标签，其余放进最合适的分组；改动题目前会先请你确认`}
                  onClick={() => { const notice = presetNotice; setPresetNotice(null); onAskAssistant(`把还没归组的 ${notice.remaining} 个标签整理进“${notice.course}”标签体系：意思相同的并入体系中的标签，其余放进最合适的分组`); }}>
                  <Sparkles size={12} aria-hidden="true" />用 ChalkLee AI 归入
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {naming?.kind === "group" && naming.parentId === null ? <NamingRow key="new-top" depth={0} group label="新建分组名称" initial="" onSubmit={submitNaming} onCancel={() => setNaming(null)} /> : null}
        {rows.map(row => {
          const state = states.get(row.key);
          const group = row.ref.kind === "group";
          const highlighted = state === "checked" && (row.parentId === null || states.get(`g:${row.parentId}`) !== "checked");
          if (naming?.kind === "rename" && group && naming.groupId === (row.ref as { id: string }).id) {
            return <NamingRow key={`rename:${row.key}`} depth={row.depth} group open={row.open} label="分组名称" initial={row.name} onSubmit={submitNaming} onCancel={() => setNaming(null)} />;
          }
          const dropping = drop?.key === row.key ? ` drop-${drop.position}` : "";
          const children = naming && naming.kind !== "rename" && group && (naming.kind === "group" ? naming.parentId : naming.groupId) === (row.ref as { id: string }).id
            ? <NamingRow key={`new:${row.key}`} depth={row.depth + 1} group={naming.kind === "group"} label={naming.kind === "group" ? "新建子分组名称" : "新建标签名称"} initial="" onSubmit={submitNaming} onCancel={() => setNaming(null)} />
            : null;
          return (
            <FragmentRow key={row.key} after={children} before={row.key === firstTopTagKey ? topTagNaming : null}>
              <div
                className={`question-tag-row${group ? " group" : ""}${group && row.depth === 0 ? " top" : ""}${highlighted ? " active" : ""}${row.count ? "" : " empty"}${menu?.row?.key === row.key ? " context-target" : ""}${dropping}`}
                style={{ "--tag-depth": row.depth } as CSSProperties}
                data-tag-row={row.key}
                onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openMenu(row, event.target, { x: event.clientX, y: event.clientY }); }}
                onKeyDown={event => {
                  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); openMenu(row, event.target); }
                  else if (event.key === "F2" && group) { event.preventDefault(); startNaming({ kind: "rename", groupId: (row.ref as { id: string }).id }); }
                  else if (group && ((window.chalkLee.platform === "darwin" && event.metaKey && event.key === "Backspace") || (window.chalkLee.platform !== "darwin" && event.key === "Delete"))) {
                    event.preventDefault(); setPendingDelete(row.node as QuestionTagGroup);
                  }
                }}
                {...rowDragProps(row)}
              >
                {group ? (
                  <button type="button" className="question-tag-twist" tabIndex={-1} aria-label={row.open ? `折叠“${row.name}”` : `展开“${row.name}”`} aria-expanded={row.open}
                    onClick={() => toggleCollapsed((row.ref as { id: string }).id)}>
                    <ChevronDown size={13} className={row.open ? "" : "collapsed"} />
                  </button>
                ) : <span className="question-tag-twist" aria-hidden="true" />}
                <button type="button" className={`question-tag-check${state ? ` ${state}` : ""}`} role="checkbox" aria-checked={state === "checked" ? true : state === "mixed" ? "mixed" : false}
                  aria-label={`同时选择“${row.name}”`} title="勾选可同时选多个" onClick={() => setSelection(current => toggleTagNode(tree, current, row.ref))}>
                  {state === "checked" ? <Check size={10} strokeWidth={3.4} /> : state === "mixed" ? <Minus size={10} strokeWidth={3.4} /> : null}
                </button>
                <button type="button" className="question-tag-name" aria-pressed={highlighted}
                  title={solo === row.key ? "再点一次显示全部题目" : group ? `只看“${row.name}”下的全部题目` : `只看“${row.name}”`}
                  onClick={() => setSelection(solo === row.key ? ALL_QUESTIONS : { scope: "tags", nodes: [row.ref] })}
                  onDoubleClick={() => { if (group) startNaming({ kind: "rename", groupId: (row.ref as { id: string }).id }); }}>
                  <span data-overflow-tooltip={row.name}>{highlightText(row.name, highlightWords)}</span>
                </button>
                <em>{counts ? row.count : ""}</em>
              </div>
            </FragmentRow>
          );
        })}
        {topTagNaming && firstTopTagKey === null ? topTagNaming : null}
        {query && !rows.length ? <div className="question-tag-no-match">没有匹配的标签或分组</div> : null}
        {empty || query ? null : (
          <>
            <div className="question-tag-divider" role="separator" />
            <div className={`question-tag-row untagged${scope === "untagged" ? " active" : ""}${counts?.untagged ? "" : " empty"}`}>
              <span className="question-tag-twist" aria-hidden="true" />
              <CircleDashed size={14} className="question-tag-untagged-icon" aria-hidden="true" />
              <button type="button" className="question-tag-name" aria-pressed={scope === "untagged"}
                title={scope === "untagged" ? "再点一次显示全部题目" : "还没有打标签的题目，可以逐题补上"}
                onClick={() => setSelection(scope === "untagged" ? ALL_QUESTIONS : { scope: "untagged", nodes: [] })}>
                <span>未打标签</span>
              </button>
              <em>{counts?.untagged ?? ""}</em>
            </div>
          </>
        )}
        {empty && !naming && !query ? (
          <div className="question-tag-empty">
            <strong>还没有标签</strong>
            <span>给题目打上知识点、解题方法或用途后，就能在这里按标签找题。</span>
            <span>可以先添加学科的知识点或教材章节，再在右侧题目属性中输入标签，或让 ChalkLee AI 打标签。</span>
            <div className="question-tag-empty-actions">
              <button type="button" className="primary" onClick={() => setPresetOpen(true)}><LibraryBig size={14} />添加标签体系</button>
              <button type="button" onClick={() => startNaming({ kind: "group", parentId: null })}><FolderPlus size={14} />新建分组</button>
            </div>
          </div>
        ) : null}
      </SidebarOverlayScrollArea>
      {menu ? <AppContextMenu key={menu.id} x={menu.x} y={menu.y} label={menu.row ? `${menu.row.name}的操作` : "标签操作"} items={menuItems(menu.row)} onClose={() => setMenu(null)} /> : null}
      {pendingDelete ? createPortal(
        <ImportDialog title={`删除分组“${pendingDelete.name}”？`} onClose={() => setPendingDelete(null)}>
          <p>{deleteNote(tagsInGroup(pendingDelete), usedTags)}</p>
          <footer>
            <button type="button" onClick={() => setPendingDelete(null)}>取消</button>
            <button type="button" className="danger" onClick={() => { const id = pendingDelete.id; setPendingDelete(null); editTagTree(current => removeTagGroup(current, id, usedTags)); }}>删除分组</button>
          </footer>
        </ImportDialog>, document.body) : null}
      {presetOpen ? <TagPresetDialog tagTree={tagTree} usedTags={usedList} tagCounts={tagCounts} defaultStage={likelyStage(response?.facets.grades ?? [])}
        onAdd={addPreset} onClose={() => setPresetOpen(false)} /> : null}
    </section>
  );
}

/** What deleting a group does to its tags: used ones move out, the rest go with it. */
function deleteNote(tags: string[], used: ReadonlySet<string>) {
  const kept = tags.filter(tag => used.has(tag)).length;
  const dropped = tags.length - kept;
  const parts = [kept ? `其中题目用到的 ${kept} 个标签会移到最外层` : "", dropped ? `${kept ? "其余" : "其中"} ${dropped} 个标签随分组删除` : ""].filter(Boolean);
  return `${parts.length ? `${parts.join("，")}；` : ""}题目上的标签保持不变。`;
}

function FragmentRow({ children, after, before }: { children: ReactNode; after: ReactNode; before?: ReactNode }) {
  return <>{before}{children}{after}</>;
}

/** Inline name input in the tree: Enter or leaving confirms, Esc cancels, IME composition never submits. */
function NamingRow({ depth, group, open = true, label, initial, onSubmit, onCancel }: {
  depth: number; group: boolean; open?: boolean; label: string; initial: string;
  onSubmit(name: string): string | null; onCancel(): void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const done = useRef(false);
  const errorId = useId();
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
    inputRef.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const submit = () => {
    if (done.current || composing.current) return;
    // Leaving an untouched new row just cancels it.
    if (!name.trim() && !initial) { done.current = true; onCancel(); return; }
    const problem = onSubmit(name);
    if (problem) { setError(problem); inputRef.current?.focus({ preventScroll: true }); }
    else done.current = true;
  };
  return (
    <div className="question-tag-naming" style={{ "--tag-depth": depth } as CSSProperties}>
      <div className="question-tag-naming-row">
        {group ? <ChevronDown size={13} className={open ? "" : "collapsed"} aria-hidden="true" /> : <span className="question-tag-twist" aria-hidden="true" />}
        <input ref={inputRef} value={name} maxLength={group ? 50 : 200} spellCheck={false} aria-label={label}
          aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
          onChange={event => { setName(event.target.value); setError(null); }}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onBlur={submit}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
            if (event.key === "Enter") { event.preventDefault(); submit(); }
            if (event.key === "Escape") { event.preventDefault(); done.current = true; onCancel(); }
          }} />
      </div>
      {error ? <div className="question-tag-naming-error" id={errorId} role="alert">{error}</div> : null}
    </div>
  );
}
