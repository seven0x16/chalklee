import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { appSelectMenuPosition } from "../ui/appSelectBehavior";
import { chalkLeeTagSuggestions, type ChalkLeeTagChange } from "./tags";
import { tagGroupNames } from "../../../shared/questionBank/tagTree";

export function ChalkLeeQuestionTags({ tags, isGroup = false, onChange }: { tags: string[]; isGroup?: boolean; onChange(change: ChalkLeeTagChange): void }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [workspaceTags, setWorkspaceTags] = useState<ReadonlyArray<{ value: string; count: number }>>([]);
  const [tagGroups, setTagGroups] = useState<ReadonlyMap<string, string>>();
  const suggestions = useMemo(() => chalkLeeTagSuggestions(draft, workspaceTags, tags, 8, tagGroups), [draft, workspaceTags, tags, tagGroups]);
  const open = focused && !dismissed && suggestions.length > 0;
  const label = isGroup ? "题组标签" : "题目标签";
  useEffect(() => {
    // Commit before selection replaces the current question's properties panel.
    const flushBeforeSelection = (event: PointerEvent) => {
      const input = inputRef.current;
      if (input && document.activeElement === input && event.target !== input && !menuRef.current?.contains(event.target as Node)) input.blur();
    };
    window.addEventListener("pointerdown", flushBeforeSelection, true);
    return () => window.removeEventListener("pointerdown", flushBeforeSelection, true);
  }, []);
  useLayoutEffect(() => {
    const menu = menuRef.current, input = inputRef.current;
    if (!open || !menu || !input) return;
    // The top layer keeps suggestions out of the sidebar's clipping.
    menu.popover = "manual";
    menu.showPopover();
    const position = () => {
      const rect = appSelectMenuPosition(input.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, menu.scrollHeight, 160, 280);
      Object.assign(menu.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, maxHeight: `${rect.maxHeight}px` });
    };
    position();
    const onScroll = (event: Event) => { if (!(event.target instanceof Node) || !menu.contains(event.target)) setDismissed(true); };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      if (menu.matches(":popover-open")) menu.hidePopover();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, suggestions]);
  const updateDraft = (value: string) => {
    draftRef.current = value;
    setDraft(value);
    setDismissed(false);
    setActiveIndex(-1);
  };
  const commitTags = (text = draftRef.current) => {
    updateDraft("");
    if (text.trim()) onChange({ add: text });
  };
  const loadWorkspaceTags = () => {
    // Saved questions only; enough to keep tags consistent across papers.
    window.chalkLee?.searchQuestionBank?.({ query: "", limit: 1 })
      .then(response => setWorkspaceTags(response.facets.tags), () => undefined);
    window.chalkLee?.readQuestionTagTree?.()
      .then(tree => setTagGroups(tagGroupNames(tree)), () => undefined);
  };
  return <section className="chalklee-question-tags" aria-label={label}>
    <header><strong>标签</strong></header>
    <div className="chalklee-tag-editor">
      {tags.map((tag, index) => <span className="chalklee-tag" key={`${tag}-${index}`}>
        <span title={tag}>{tag}</span>
        <button type="button" aria-label={`移除标签：${tag}`} title={`移除 ${tag}`} onMouseDown={event => event.preventDefault()}
          onClick={() => { onChange({ remove: tag }); inputRef.current?.focus({ preventScroll: true }); }}><X size={11} /></button>
      </span>)}
      <input ref={inputRef} data-chalklee-tags-draft="" aria-label={`添加${label}`} placeholder="输入标签，回车添加" value={draft}
        role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        onChange={event => updateDraft(event.target.value)}
        onFocus={() => { setFocused(true); loadWorkspaceTags(); }}
        onBlur={() => { setFocused(false); commitTags(); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault(); event.stopPropagation();
            // Cycles through the suggestions and back to the typed text (-1).
            const step = event.key === "ArrowDown" ? 1 : -1, states = suggestions.length + 1;
            setActiveIndex(index => ((index + 1 + step) % states + states) % states - 1);
            return;
          }
          if (event.key === "Enter" || event.key === "," || event.key === "，") {
            event.preventDefault(); event.stopPropagation();
            // Enter adds exactly what was typed unless a suggestion was picked with the arrow keys.
            commitTags(event.key === "Enter" && open && activeIndex >= 0 ? suggestions[activeIndex].tag : undefined);
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation();
            if (open) { setDismissed(true); return; }
            updateDraft(""); event.currentTarget.blur();
          }
        }} />
      {open ? <span ref={menuRef} id={`${id}-list`} className="app-select-menu chalklee-tag-suggestions" role="listbox" aria-label="已有标签"
        onMouseDown={event => event.preventDefault()}>
        {suggestions.map((suggestion, index) => <button key={suggestion.tag} type="button" role="option" id={`${id}-option-${index}`} tabIndex={-1}
          className="app-select-option" aria-selected={index === activeIndex} data-highlighted={index === activeIndex}
          onPointerMove={() => setActiveIndex(index)} onClick={() => { commitTags(suggestion.tag); inputRef.current?.focus({ preventScroll: true }); }}>
          <span>{suggestion.tag}</span><small className="app-select-meta">{suggestion.meta}</small>
        </button>)}
      </span> : null}
    </div>
  </section>;
}
