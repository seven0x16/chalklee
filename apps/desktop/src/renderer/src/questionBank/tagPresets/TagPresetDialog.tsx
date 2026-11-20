import { Check, ChevronDown, LoaderCircle, Minus, X } from "lucide-react";
import { ListChevronsDownUp, ListChevronsUpDown } from "../../ui/lucideBackports";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { QuestionTagTree } from "../../../../shared/questionBank/tagTree";
import { AppSelect } from "../../ui/AppSelect";
import { planPresetMerge, presetNodeKey, presetNodeName, type PresetMergePlan, type PresetNode, type PresetOutcome, type PresetPart } from "../../../../shared/questionBank/tagPresets/tagPresetMerge";
import { loadPresetCourse, PRESET_COURSES, PRESET_SOURCE, PRESET_STAGES, presetSubjectLabel, type PresetCourseData, type PresetStage } from "../../../../shared/questionBank/tagPresets/tagPresets";

type Mode = "knowledge" | "textbook";
/** `volumes` null: the version's first volume. */
interface Choice { stage: PresetStage; course: string; mode: Mode; version: string | null; volumes: string[] | null }
export interface PresetAddition { label: string; parts: PresetPart[]; excluded: Set<string> }

const CHOICE_KEY = "chalklee.question-library.tag-preset";

function loadChoice(fallbackStage: PresetStage): Choice {
  try {
    const value = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "null") as Partial<Choice> | null;
    const course = PRESET_COURSES.find(item => item.id === value?.course);
    if (course) return { stage: course.stage, course: course.id, mode: value?.mode === "textbook" || !course.knowledge ? "textbook" : "knowledge", version: typeof value?.version === "string" ? value.version : null, volumes: Array.isArray(value?.volumes) ? value.volumes.filter((item): item is string => typeof item === "string") : null };
  } catch { /* Preference only. */ }
  const course = PRESET_COURSES.find(item => item.stage === fallbackStage && item.subject === "数学")!;
  return { stage: course.stage, course: course.id, mode: "knowledge", version: null, volumes: null };
}

/** The parts a choice adds: the knowledge tree, or each chosen volume as its own group. */
function choiceParts(choice: Choice, data: PresetCourseData | null): PresetPart[] {
  if (!data) return [];
  if (choice.mode === "knowledge") return data.knowledge.length ? [{ path: [choice.course, "知识点"], nodes: data.knowledge }] : [];
  return data.textbooks
    .filter(book => book.version === choice.version && choice.volumes?.includes(book.volume))
    .map(book => ({ path: [choice.course, `${book.version} ${book.volume}`], nodes: book.tree, volume: book.volume }));
}

interface PreviewRow { key: string; name: string; depth: number; group: boolean; part: number; path: number[]; leaves: string[]; outcome?: PresetOutcome; open: boolean; header?: boolean }

/**
 * Picks a preset tag system and shows, before anything changes, where it goes and
 * which of the teacher's own tags it takes in. Unchecked branches stay out.
 */
export function TagPresetDialog({ tagTree, usedTags, tagCounts, defaultStage, onAdd, onClose }: {
  tagTree: QuestionTagTree;
  usedTags: readonly string[];
  tagCounts: ReadonlyMap<string, number>;
  defaultStage: PresetStage;
  onAdd(addition: PresetAddition): void;
  onClose(): void;
}) {
  const [choice, setChoice] = useState(() => loadChoice(defaultStage));
  const [data, setData] = useState<{ course: string; value: PresetCourseData } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);

  const course = PRESET_COURSES.find(item => item.id === choice.course)!;
  const courseData = data?.course === choice.course ? data.value : null;
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    loadPresetCourse(choice.course)
      .then(value => { if (!cancelled) setData({ course: choice.course, value }); })
      .catch(reason => { if (!cancelled) setLoadError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [choice.course]);

  // A version and its first volume once the course's textbooks are known.
  const versions = useMemo(() => [...new Set(courseData?.textbooks.map(book => book.version) ?? [])], [courseData]);
  const version = choice.version && versions.includes(choice.version) ? choice.version : versions[0] ?? null;
  const volumes = useMemo(() => courseData?.textbooks.filter(book => book.version === version).map(book => book.volume) ?? [], [courseData, version]);
  const chosenVolumes = choice.volumes?.filter(volume => volumes.includes(volume)) ?? null;
  const effective: Choice & { volumes: string[] } = {
    ...choice, version,
    volumes: chosenVolumes === null || (!chosenVolumes.length && choice.volumes?.length) ? volumes.slice(0, 1) : chosenVolumes
  };
  const effectiveKey = JSON.stringify(effective);

  useEffect(() => { try { localStorage.setItem(CHOICE_KEY, effectiveKey); } catch { /* Preference only. */ } }, [effectiveKey]);
  // Another source starts fully checked, with its first level open.
  const sourceKey = `${effective.course}|${effective.mode}|${effective.version}`;
  useEffect(() => { setExcluded(new Set()); setOpened(new Set()); }, [sourceKey]);

  const parts = useMemo(() => choiceParts(effective, courseData), [effectiveKey, courseData]);
  const result = useMemo((): { plan: PresetMergePlan | null; error: string | null } => {
    if (!parts.length) return { plan: null, error: null };
    try { return { plan: planPresetMerge(tagTree, usedTags, parts, excluded), error: null }; }
    catch (reason) { return { plan: null, error: reason instanceof Error ? reason.message : String(reason) }; }
  }, [tagTree, usedTags, parts, excluded]);
  const plan = result.plan;

  // Every preset node with the tags below it, for checking and counting.
  const nodes = useMemo(() => {
    const all: Array<Omit<PreviewRow, "open" | "outcome">> = [];
    parts.forEach((part, partIndex) => {
      const multi = parts.length > 1;
      const visit = (list: PresetNode[], trail: number[], depth: number): string[] => list.flatMap((node, index) => {
        const path = [...trail, index];
        const key = presetNodeKey(partIndex, path);
        const row = { key, name: presetNodeName(node), depth, group: typeof node !== "string", part: partIndex, path, leaves: [] as string[] };
        all.push(row);
        row.leaves = typeof node === "string" ? [key] : visit(node[1], path, depth + 1);
        return row.leaves;
      });
      if (multi) {
        const header = { key: `${partIndex}:`, name: part.path.at(-1)!, depth: 0, group: true, part: partIndex, path: [], leaves: [] as string[], header: true };
        all.push(header);
        header.leaves = visit(part.nodes, [], 1);
      } else visit(part.nodes, [], 0);
    });
    return all;
  }, [parts]);
  const isOpen = (key: string, depth: number, header?: boolean) => header || (depth === 0 ? !opened.has(key) : opened.has(key));
  const rows: PreviewRow[] = [];
  {
    let hiddenBelow = Infinity;
    for (const node of nodes) {
      if (node.depth > hiddenBelow) continue;
      hiddenBelow = Infinity;
      const open = node.group && isOpen(node.key, node.depth, node.header);
      rows.push({ ...node, open, outcome: plan?.outcomes.get(node.key) });
      if (node.group && !open) hiddenBelow = node.depth;
    }
  }
  const anyGroupOpen = nodes.some(node => node.group && !node.header && isOpen(node.key, node.depth));
  const stateOf = (row: Pick<PreviewRow, "key" | "part" | "path" | "leaves">): "checked" | "mixed" | null => {
    const ancestorOut = row.path.some((_, index) => excluded.has(presetNodeKey(row.part, row.path.slice(0, index + 1)))) && row.path.length > 0;
    if (ancestorOut) return null;
    const isIn = (leaf: string) => {
      const [part, path] = leaf.split(":");
      const steps = path.split(".").map(Number);
      return !steps.some((_, index) => excluded.has(presetNodeKey(Number(part), steps.slice(0, index + 1))));
    };
    const inside = row.leaves.filter(isIn).length;
    return inside === row.leaves.length ? "checked" : inside ? "mixed" : null;
  };
  const toggle = (row: PreviewRow) => {
    const state = stateOf(row);
    setExcluded(current => {
      const next = new Set(current);
      // Clearing a branch's own marks first: checking it brings back everything below.
      const prefix = row.header ? `${row.part}:` : `${row.key}.`;
      for (const key of current) if (key.startsWith(prefix)) next.delete(key);
      if (row.header) { if (state) row.leaves.forEach(leaf => next.add(leaf)); return next; }
      if (state) next.add(row.key); else next.delete(row.key);
      // A branch picked from inside a left-out one: the rest of it stays out.
      for (let index = row.path.length - 1; index > 0; index--) {
        const ancestor = presetNodeKey(row.part, row.path.slice(0, index));
        if (!next.has(ancestor)) continue;
        next.delete(ancestor);
        nodes.filter(node => node.part === row.part && node.path.length === index + 1 && node.key.startsWith(`${ancestor}.`) && row.key !== node.key && !row.key.startsWith(`${node.key}.`))
          .forEach(node => next.add(node.key));
      }
      return next;
    });
  };
  const toggleOpen = (row: PreviewRow) => setOpened(current => {
    const next = new Set(current);
    if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
    return next;
  });
  const toggleAllOpen = () => setOpened(anyGroupOpen
    ? new Set(nodes.filter(node => node.group && node.depth === 0).map(node => node.key))
    : new Set(nodes.filter(node => node.group && node.depth > 0).map(node => node.key)));

  const update = (patch: Partial<Choice>) => setChoice(current => ({ ...current, ...effective, ...patch }));
  const pickStage = (stage: PresetStage) => {
    if (stage === course.stage) return;
    const same = PRESET_COURSES.find(item => item.stage === stage && item.subject === course.subject) ?? PRESET_COURSES.find(item => item.stage === stage)!;
    update({ stage, course: same.id, mode: same.knowledge ? effective.mode : "textbook", version: null, volumes: null });
  };
  const pickCourse = (id: string) => {
    const next = PRESET_COURSES.find(item => item.id === id)!;
    update({ course: id, mode: next.knowledge ? effective.mode : "textbook", version: null, volumes: null });
  };
  const toggleVolume = (volume: string) => {
    const current = effective.volumes;
    const next = current.includes(volume) ? current.filter(item => item !== volume) : volumes.filter(item => current.includes(item) || item === volume);
    update({ volumes: next });
  };

  const placed = plan ? plan.newTags + plan.merged.length : 0;
  const where = parts.length === 1 ? parts[0].path.join(" › ") : parts.length ? `${course.id} › ${parts.length} 册教材` : course.id;
  const summary = !courseData ? "" : result.error ? result.error
    : !parts.length ? (effective.mode === "textbook" ? "选择要添加的册次" : "这个学科暂无知识点目录")
    : !plan || (!placed && !plan.newGroups) ? "已全部在标签目录中"
    : [`新增 ${plan.newGroups ? `${plan.newGroups} 个分组、` : ""}${plan.newTags} 个标签`, plan.merged.length ? `并入你已有的 ${plan.merged.length} 个标签` : ""].filter(Boolean).join("，");
  const canAdd = Boolean(plan && (placed || plan.newGroups));
  const add = () => {
    if (!canAdd) return;
    onAdd({ label: where, parts, excluded: new Set(excluded) });
  };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(".tag-preset-option.selected")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  const subjects = PRESET_COURSES.filter(item => item.stage === course.stage);
  return createPortal(
    <div className="chalklee-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="tag-preset-dialog" role="dialog" aria-modal="true" aria-label="添加标签体系"
        onKeyDown={event => {
          if (event.key === "Escape" && !document.querySelector(".app-select-menu")) { event.preventDefault(); event.stopPropagation(); onClose(); }
          if (event.key === "Tab") {
            const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), [tabindex=\"0\"]") ?? []);
            const target = event.shiftKey && document.activeElement === items[0] ? items.at(-1) : !event.shiftKey && document.activeElement === items.at(-1) ? items[0] : null;
            if (target) { event.preventDefault(); target.focus(); }
          }
        }}>
        <header className="tag-preset-header">
          <strong>添加标签体系</strong>
          <button type="button" className="tag-preset-close" aria-label="关闭" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="tag-preset-choices">
          <ChoiceRow label="学段">
            {PRESET_STAGES.map(stage => <Option key={stage} selected={stage === course.stage} onClick={() => pickStage(stage)}>{stage}</Option>)}
          </ChoiceRow>
          <ChoiceRow label="学科">
            {subjects.map(item => <Option key={item.id} selected={item.id === course.id} onClick={() => pickCourse(item.id)}>{presetSubjectLabel(item.subject)}</Option>)}
          </ChoiceRow>
          <ChoiceRow label="目录">
            <Option selected={effective.mode === "knowledge"} disabled={!course.knowledge} title={course.knowledge ? undefined : "这个学科暂无知识点目录"}
              onClick={() => update({ mode: "knowledge" })}>知识点<em>{course.knowledge}</em></Option>
            <Option selected={effective.mode === "textbook"} onClick={() => update({ mode: "textbook" })}>教材章节<em>{course.textbooks} 册</em></Option>
            {effective.mode === "textbook" && versions.length ? (
              <AppSelect className="tag-preset-version" label="教材版本" value={version ?? ""} menuWidth={220}
                options={versions.map(item => ({ value: item, label: item }))} onChange={value => update({ version: value, volumes: null })} />
            ) : null}
          </ChoiceRow>
          {effective.mode === "textbook" && volumes.length ? (
            <ChoiceRow label="册次">
              {volumes.map(volume => (
                <Option key={volume} selected={effective.volumes.includes(volume)} multi onClick={() => toggleVolume(volume)}>
                  {effective.volumes.includes(volume) ? <Check size={12} strokeWidth={2.6} aria-hidden="true" /> : null}{volume}
                </Option>
              ))}
            </ChoiceRow>
          ) : null}
        </div>
        <section className="tag-preset-preview" aria-label="预览">
          <header>
            <span>添加到<strong>{where}</strong></span>
            <button type="button" className="tag-preset-icon-button" disabled={!nodes.some(node => node.group && !node.header)}
              title={anyGroupOpen ? "全部折叠" : "全部展开"} aria-label={anyGroupOpen ? "全部折叠" : "全部展开"} onClick={toggleAllOpen}>
              {anyGroupOpen ? <ListChevronsDownUp size={15} /> : <ListChevronsUpDown size={15} />}
            </button>
          </header>
          <div className="tag-preset-tree" role="tree" aria-label={where}>
            {loadError ? <div className="tag-preset-placeholder">{`未能读取：${loadError}`}</div>
              : !courseData ? <div className="tag-preset-placeholder"><LoaderCircle size={14} className="ai-import-spinner" aria-hidden="true" />正在读取</div>
              : !parts.length ? <div className="tag-preset-placeholder">{effective.mode === "textbook" ? "选择要添加的册次" : "这个学科暂无知识点目录"}</div>
              : rows.map(row => {
                const state = stateOf(row);
                return (
                  <div key={row.key} role="treeitem" aria-level={row.depth + 1} aria-expanded={row.group ? row.open : undefined} aria-selected={false}
                    className={`tag-preset-row${row.group ? " group" : ""}${row.header ? " header" : ""}${state ? "" : " off"}`}
                    style={{ "--tag-depth": row.depth } as CSSProperties}>
                    {row.group && !row.header ? (
                      <button type="button" className="tag-preset-twist" tabIndex={-1} aria-label={row.open ? `折叠“${row.name}”` : `展开“${row.name}”`} onClick={() => toggleOpen(row)}>
                        <ChevronDown size={13} className={row.open ? "" : "collapsed"} />
                      </button>
                    ) : <span className="tag-preset-twist" aria-hidden="true" />}
                    <button type="button" className={`question-tag-check${state ? ` ${state}` : ""}`} role="checkbox"
                      aria-checked={state === "checked" ? true : state === "mixed" ? "mixed" : false} aria-label={`添加“${row.name}”`} onClick={() => toggle(row)}>
                      {state === "checked" ? <Check size={10} strokeWidth={3.4} /> : state === "mixed" ? <Minus size={10} strokeWidth={3.4} /> : null}
                    </button>
                    <span className="tag-preset-name" title={row.name} onClick={() => row.group && !row.header ? toggleOpen(row) : toggle(row)}>
                      {row.outcome && "name" in row.outcome && !row.group ? row.outcome.name : row.name}
                    </span>
                    {state ? <OutcomeNote outcome={row.outcome} counts={tagCounts} leaves={row.group ? row.leaves.length : 0} /> : null}
                  </div>
                );
              })}
          </div>
        </section>
        <footer className="tag-preset-footer">
          <span className="tag-preset-summary" role="status">{summary}</span>
          <span className="tag-preset-source">{PRESET_SOURCE}</span>
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" className="primary" disabled={!canAdd} onClick={add}>添加</button>
        </footer>
      </div>
    </div>, document.body);
}

function ChoiceRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="tag-preset-choice" role="group" aria-label={label}><span className="tag-preset-choice-name">{label}</span><div className="tag-preset-options">{children}</div></div>;
}

function Option({ selected, multi = false, disabled, title, onClick, children }: { selected: boolean; multi?: boolean; disabled?: boolean; title?: string; onClick(): void; children: ReactNode }) {
  return <button type="button" className={`tag-preset-option${selected ? " selected" : ""}`} aria-pressed={selected} disabled={disabled} title={title}
    role={multi ? "checkbox" : undefined} aria-checked={multi ? selected : undefined} onClick={onClick}>{children}</button>;
}

function OutcomeNote({ outcome, counts, leaves }: { outcome?: PresetOutcome; counts: ReadonlyMap<string, number>; leaves: number }) {
  if (!outcome) return null;
  if (outcome.kind === "group") {
    if (outcome.mergedTag) return <small className="tag-preset-note merged" title={`你的标签“${outcome.mergedTag}”会放在这个分组的最前面`}>{`并入“${outcome.mergedTag}”`}</small>;
    return <small className="tag-preset-note">{leaves}</small>;
  }
  if (outcome.kind === "merged") {
    const count = counts.get(outcome.name) ?? 0;
    return <small className="tag-preset-note merged" title="你已有的标签，会移到这里">{count ? `已有 ${count} 题` : "已有"}</small>;
  }
  if (outcome.kind === "present") return <small className="tag-preset-note">已添加</small>;
  if (outcome.kind === "elsewhere") return <small className="tag-preset-note" title="这个标签保留在你放的分组中">{`在“${outcome.group}”中`}</small>;
  if (outcome.kind === "duplicate") return <small className="tag-preset-note" title="同名标签只放在一个位置">前面已有</small>;
  return null;
}
