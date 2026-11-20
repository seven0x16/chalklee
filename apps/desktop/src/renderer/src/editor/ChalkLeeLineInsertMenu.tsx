import type { Editor } from "@tiptap/core";
import { Plus } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { appSelectMenuPosition } from "../ui/appSelectBehavior";
import { chalkLeeLineInsertTarget, resolveChalkLeeLineInsertTarget, type ChalkLeeLineInsertTarget } from "./lineInsert";
import { CHALKLEE_LINE_INSERT_COMMANDS, type ChalkLeeInsertCommandId } from "./insertCommands";
import { ChalkLeeTableSizePicker } from "./ChalkLeeTableSizePicker";
import { CHALKLEE_INSERT_PANEL_WIDTH, ChalkLeeInsertGrid, chalkLeeMenuGridKeyTarget } from "./ChalkLeeInsertGrid";

export function ChalkLeeLineInsertMenu({ editor, active, imageBusy, onInsert, onInsertTable }: {
  editor: Editor;
  active: boolean;
  imageBusy: boolean;
  onInsert(command: ChalkLeeInsertCommandId, target: ChalkLeeLineInsertTarget): void;
  onInsertTable(rows: number, columns: number, target: ChalkLeeLineInsertTarget): void;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; target: ChalkLeeLineInsertTarget } | null>(null);
  const [open, setOpen] = useState(false);
  const [tablePicking, setTablePicking] = useState(false);
  // Opened with the mouse, focus stays in the paper and the caret keeps showing the line; from the keyboard, the menu takes it.
  const byKeyboardRef = useRef(false);
  useEffect(() => { if (!open) setTablePicking(false); }, [open]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const shell = root?.parentElement;
    if (!root || !shell || !active) { setAnchor(null); setOpen(false); return; }
    let frame = 0;
    let question: HTMLElement | null = null;
    let targetId: string | null = null;
    const update = () => {
      question?.removeAttribute("data-line-insert-active");
      question = null;
      const target = chalkLeeLineInsertTarget(editor.state);
      const paragraph = target ? editor.view.nodeDOM(target.paragraphFrom) : null;
      if (!target || !(paragraph instanceof HTMLElement)
        || (!editor.isFocused && !root.contains(document.activeElement))) {
        targetId = null; setAnchor(null); setOpen(false); return;
      }
      if (targetId !== target.id) setOpen(false);
      targetId = target.id;
      const rect = paragraph.getBoundingClientRect();
      const bounds = shell.getBoundingClientRect();
      if (rect.bottom <= bounds.top || rect.top >= bounds.bottom || rect.left < bounds.left || rect.left > bounds.right) {
        setAnchor(null); setOpen(false); return;
      }
      question = target.questionId ? paragraph.closest<HTMLElement>(".chalklee-question-object") : null;
      const grip = question?.querySelector<HTMLElement>(".chalklee-question-grip")?.getBoundingClientRect();
      question?.setAttribute("data-line-insert-active", "true");
      const left = Math.max(2, (grip?.left ?? rect.left - 40) - bounds.left);
      const top = Math.max(0, rect.top - bounds.top + Math.min(6, (rect.height - 26) / 2));
      setAnchor(previous => previous?.left === left && previous.top === top && previous.target.from === target.from
        && previous.target.id === target.id ? previous : { left, top, target });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    editor.on("transaction", schedule).on("focus", schedule).on("blur", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const paper = editor.view.dom.closest(".chalklee-paper");
    paper?.addEventListener("chalklee:viewport-change", schedule);
    const resize = new ResizeObserver(schedule);
    resize.observe(editor.view.dom); resize.observe(shell);
    schedule();
    return () => {
      cancelAnimationFrame(frame); resize.disconnect();
      question?.removeAttribute("data-line-insert-active");
      editor.off("transaction", schedule).off("focus", schedule).off("blur", schedule);
      window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule);
      paper?.removeEventListener("chalklee:viewport-change", schedule);
    };
  }, [editor, active]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!open || !menu || !trigger) return;
    menu.popover = "manual";
    menu.showPopover();
    const position = () => {
      const rect = appSelectMenuPosition(trigger.getBoundingClientRect(), { width: innerWidth, height: innerHeight }, menu.scrollHeight, CHALKLEE_INSERT_PANEL_WIDTH, menu.scrollHeight);
      Object.assign(menu.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, maxHeight: `${rect.maxHeight}px` });
    };
    position();
    if (byKeyboardRef.current) menu.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const closeOnScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.contains(event.target)) { setOpen(false); editor.view.focus(); }
    };
    window.addEventListener("resize", position);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      if (menu.matches(":popover-open")) menu.hidePopover();
      window.removeEventListener("resize", position); window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [editor, open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const close = () => setOpen(false);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); editor.view.focus(); } };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true); window.removeEventListener("blur", close);
      window.removeEventListener("keydown", escape);
    };
  }, [editor, open]);

  const insertTable = (rows: number, columns: number) => {
    if (!anchor) return;
    const target = resolveChalkLeeLineInsertTarget(editor.state.doc, anchor.target);
    setOpen(false);
    if (target) onInsertTable(rows, columns, target);
  };

  const choose = (command: ChalkLeeInsertCommandId) => {
    if (!anchor) return;
    if (command === "table") { setTablePicking(true); return; }
    const target = resolveChalkLeeLineInsertTarget(editor.state.doc, anchor.target);
    setOpen(false);
    if (!target) return;
    editor.commands.setTextSelection(target.paragraphFrom + 1);
    onInsert(command, target);
  };

  return <div ref={rootRef} className="chalklee-line-insert" style={anchor ? { left: anchor.left, top: anchor.top } : { display: "none" }}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <button ref={triggerRef} type="button" className="chalklee-line-insert-trigger" aria-label="插入内容"
      title="插入内容" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onPointerDown={event => event.preventDefault()} onClick={event => { byKeyboardRef.current = event.detail === 0; setOpen(value => !value); if (open) editor.view.focus(); }}
      onKeyDown={event => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); byKeyboardRef.current = true; setOpen(true); }
      }}><Plus size={18} /></button>
    {open && anchor ? <div ref={menuRef} id={id} className="chalklee-line-insert-menu chalklee-insert-panel" role="menu" aria-label="插入内容"
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); editor.view.focus(); return; }
        if (event.key === "Tab") { setOpen(false); return; }
        const next = chalkLeeMenuGridKeyTarget(event.currentTarget, event.target as Element, event.key);
        if (!next) return;
        event.preventDefault(); event.stopPropagation();
        next.focus({ preventScroll: true }); next.scrollIntoView({ block: "nearest" });
      }}>
      {tablePicking ? <ChalkLeeTableSizePicker onPick={insertTable} onBack={() => setTablePicking(false)} />
        : <ChalkLeeInsertGrid commands={CHALKLEE_LINE_INSERT_COMMANDS} itemRole="menuitem" imageBusy={imageBusy} onPick={choose} />}
    </div> : null}
  </div>;
}
