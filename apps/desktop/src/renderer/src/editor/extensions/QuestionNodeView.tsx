import type { Editor } from "@tiptap/core";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { ChalkLeeNodeViewContent } from "../ChalkLeeNodeViewContent";
import { ChalkLeeObjectActions } from "../ChalkLeeObjectActions";
import { chalkLeeMoveQuestionOutOfBoxTransaction, chalkLeePutQuestionInBoxTransaction } from "./boxNodes";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ArrowDown, ArrowUp, Check, Copy, CopyPlus, GripVertical, PanelTop, PenLine, SquareArrowOutUpRight, Plus, Settings2, ShoppingBasket, Trash2, TrendingDown, TrendingUp, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { chalkLeeChoiceAnswerLabels } from "../editing";
import { CHALKLEE_ACTIVE_QUESTION_EVENT, chalkLeeQuestionRegionTransaction, findChalkLeeQuestionContext, selectedChalkLeeQuestionContext, type ChalkLeeQuestionContext } from "../editorContext";
import { useChalkLeePropertiesToggle } from "../inspectorContext";
import { useChalkLeeQuestionBasket } from "../questionBasket";
import { useChalkLeeQuestionAssistant, type QuestionAssistantAction } from "../questionAssistant";
import { useChalkLeeQuestionDrag } from "../questionDrag";
import { CHALKLEE_CIRCLED_NUMBER_MAX, chalkLeeQuestionLabelValue, type ChalkLeeQuestionFrame, type ChalkLeeQuestionNumbering } from "@chalklee/format";
import { ChalkLeeQuestionNumberingStyles } from "../ChalkLeeQuestionNumbering";
import { chalkLeeAutoNumberValue } from "../autoNumbers";
import { resolveChalkLeeQuestionFrame } from "../questionAppearance";
import { chalkLeeGroupAnswerColumns, chalkLeeQuestionWithSolutions, chalkLeeSolutionForQuestion } from "../groupSolutions";
import { ChalkLeeQuestionFrameLabel } from "../ChalkLeeQuestionFrameLabel";
import { AppSelect } from "../../ui/AppSelect";
import { ChalkLeeQuestionTags } from "../ChalkLeeQuestionTags";
import { chalkLeeQuestionTagsTransaction, type ChalkLeeTagChange } from "../tags";
import { CHALKLEE_REVEAL_QUESTION_REGION_META, chalkLeeOptionPreview, dispatchChalkLeeFreeAuthoringStatus } from "./authoringShared";
import { chalkLeeAddOptionTransaction, chalkLeeQuestionReorderTransaction, moveQuestion, questionOutsideGapPosition, selectQuestionOutsideGap, questionMoveAvailability, setQuestionRegion, duplicateQuestion, deleteQuestion, setQuestionOptionLayout, addQuestionOption, moveQuestionOption, deleteQuestionOption, setQuestionChoiceAnswer, chalkLeeChoiceAnswerIsMultiple } from "./questionCommands";

export function chalkLeeQuestionStemPresentation(node: ProseMirrorNode) {
  const sourceBlankId = typeof node.attrs.sourceBlankId === "string" ? node.attrs.sourceBlankId : "";
  let ownsSourceBlank = false;
  node.descendants((child) => {
    if (child.type.name === "blank" && child.attrs.id === sourceBlankId) ownsSourceBlank = true;
  });
  const hasOptions = node.content.content.some((child) => child.type.name === "optionGroup" && child.childCount > 0);
  const stem = node.content.content.find((child) => child.type.name === "questionStem");
  const stemEmpty = !stem?.textContent.trim()
    && !stem?.content.content.some((child) => child.type.name !== "paragraph" || child.childCount > 0);
  const hasSourceBlank = Boolean(sourceBlankId);
  return {
    sourceBlankId,
    hasSourceBlank,
    ownsSourceBlank,
    hasOptions,
    stemEmpty,
    linkedPlaceholder: hasSourceBlank && stemEmpty && !hasOptions
  };
}

/** Only top-level questions and groups are basket entries; sub-questions travel with their group. */
function isNestedQuestion(editor: Editor, position: number) {
  const resolved = editor.state.doc.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth--) {
    const type = resolved.node(depth).type.name;
    if (type === "question" || type === "questionGroup") return true;
  }
  return false;
}

export function QuestionNodeView({ editor, node, getPos, selected, decorations }: NodeViewProps) {
  const inspector = useChalkLeePropertiesToggle();
  const basket = useChalkLeeQuestionBasket();
  const askAssistant = useChalkLeeQuestionAssistant();
  const resolvedPosition = typeof getPos === "function" ? getPos() : undefined;
  const position = typeof resolvedPosition === "number" ? resolvedPosition : false;
  const basketAvailable = Boolean(basket) && position !== false && !isNestedQuestion(editor, position);
  const inBasket = basketAvailable && basket!.has(String(node.attrs.id));
  const [basketBusy, setBasketBusy] = useState(false);
  const toggleBasket = () => {
    if (!basket || basketBusy) return;
    setBasketBusy(true);
    void basket.toggle(String(node.attrs.id)).finally(() => setBasketBusy(false));
  };
  const outsideGapPosition = position === false ? null : questionOutsideGapPosition(editor, position, node.nodeSize);
  const isGroup = node.type.name === "questionGroup";
  const frame = resolveChalkLeeQuestionFrame(node.attrs.runtimeFrame as ChalkLeeQuestionFrame | null, node.attrs.frameLabel);
  const numberMode = questionNumberMode(node.attrs.number, node.type.name === "questionGroup");
  const questionLabel = formatQuestionLabel(node.attrs.number, isGroup);
  const fixedNumber = numberMode === "fixed" && node.attrs.number && typeof node.attrs.number === "object"
    ? String((node.attrs.number as { label?: unknown }).label ?? "")
    : "";
  const {
    hasSourceBlank,
    ownsSourceBlank,
    stemEmpty,
    linkedPlaceholder
  } = chalkLeeQuestionStemPresentation(node);
  const showsHeadNumber = !isGroup && numberMode !== "none" && !ownsSourceBlank;
  // A teacher's own number, typed as "3", "(3)" or "③", is written in the paper's style; "例1" as it is.
  const fixedValue = numberMode === "fixed" ? chalkLeeQuestionLabelValue(fixedNumber) : null;
  const autoValue = numberMode === "auto" ? chalkLeeAutoNumberValue(decorations) : undefined;
  const numberStyle = numberMode !== "fixed" ? (autoValue === undefined ? {} : { "--chalklee-number-value": String(autoValue) })
    : fixedValue !== null ? { "--chalklee-number-value": String(fixedValue) }
      : { "--chalklee-number-text": JSON.stringify(fixedNumber.trim()) };
  const materialStart = isGroup ? node.content.content.find(child => child.type.name === "questionMaterial")?.firstChild?.textContent.trimStart() ?? "" : "";
  const materialHasNumber = isGroup && !!fixedNumber && [".", "．", "、"].some(mark => materialStart.startsWith(`${fixedNumber}${mark}`));
  const [actionsOpen, setActionsOpen] = useState(false);
  const moveAvailability = !actionsOpen || position === false
    ? null
    : questionMoveAvailability(editor, position);
  // A question on the page itself can go into a box; one in a box can come out. Subquestions stay in their group.
  const canPutInBox = actionsOpen && position !== false && !!editor.schema.nodes.box && editor.state.doc.resolve(position).depth === 0;
  const inBox = actionsOpen && position !== false && editor.state.doc.resolve(position).parent.type.name === "box";
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const questionDrag = useChalkLeeQuestionDrag(editor, String(node.attrs.id), (targetId, after) => {
    setActionsOpen(false);
    setConfirmDelete(false);
    const transaction = chalkLeeQuestionReorderTransaction(editor.state, String(node.attrs.id), targetId, after);
    if (!transaction) return;
    editor.view.dispatch(transaction);
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.view.focus();
  });
  useEffect(() => {
    const updateEditing = (event: Event) => {
      setEditing((event as CustomEvent<{ id: string | null }>).detail.id === node.attrs.id);
    };
    const dom = editor.view.dom;
    setEditing(dom.dataset.chalkleeActiveQuestion === node.attrs.id);
    dom.addEventListener(CHALKLEE_ACTIVE_QUESTION_EVENT, updateEditing);
    return () => {
      dom.removeEventListener(CHALKLEE_ACTIVE_QUESTION_EVENT, updateEditing);
    };
  }, [editor, node.attrs.id]);
  useEffect(() => {
    if (!actionsOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (controlsRef.current?.contains(event.target as globalThis.Node)) return;
      setActionsOpen(false);
      setConfirmDelete(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [actionsOpen]);
  // Options, answer and analysis are added here rather than recognized from typed text; the buttons
  // show only for the question being edited, so pointing around the paper leaves the margin quiet.
  // "选项" stays while more options fit.
  const offering = editing && !linkedPlaceholder;
  const solutions = offering ? chalkLeeQuestionWithSolutions(editor.state.doc, node) : node;
  const optionCount = solutions.content.content.find(child => child.type.name === "optionGroup")?.childCount ?? 0;
  const missingParts = offering ? ([
    ["optionGroup", "选项"], ["questionAnswer", "答案"], ["questionAnalysis", "解析"]
  ] as const).filter(([part]) => part === "optionGroup"
    ? !isGroup && optionCount < 8
    : !solutions.content.content.some(child => child.type.name === part)) : [];
  const nextOption = String.fromCharCode(65 + optionCount);
  // The label says what is added ("选项 A–D", "选项 E"), so the buttons need no tooltip.
  const addLabel = (part: (typeof missingParts)[number][0], label: string) => part !== "optionGroup" ? label
    : optionCount ? `${label} ${nextOption}` : `${label} A–D`;
  // Pointing at an add button marks where the new part will appear with a line across the question.
  const [addPreview, setAddPreview] = useState<number | null>(null);
  useEffect(() => { if (!offering) setAddPreview(null); }, [offering]);
  const previewAdd = (part: (typeof missingParts)[number][0]) => {
    setAddPreview(chalkLeeAddPreviewTop(controlsRef.current?.parentElement ?? null, part, Boolean(frame),
      part !== "optionGroup" && chalkLeeSolutionForQuestion(editor.state.doc, String(node.attrs.id)) !== null));
  };
  const addPart = (part: (typeof missingParts)[number][0]) => {
    setAddPreview(null);
    const id = String(node.attrs.id);
    const transaction = part === "optionGroup"
      ? chalkLeeAddOptionTransaction(editor.state, id)
      : chalkLeeQuestionRegionTransaction(editor.state, id, part)?.setMeta(CHALKLEE_REVEAL_QUESTION_REGION_META, part);
    if (!transaction) return;
    editor.view.dispatch(transaction);
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.view.focus();
    dispatchChalkLeeFreeAuthoringStatus(editor.view, part === "optionGroup" ? "options-added" : part === "questionAnswer" ? "answer-created" : "analysis-entered");
  };
  const run = (action: () => void, dismiss = false) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (dismiss) {
      setActionsOpen(false);
      setConfirmDelete(false);
    }
    action();
    if (dismiss) window.requestAnimationFrame(() => { if (!editor.isDestroyed) editor.view.focus(); });
  };

  return (
    <NodeViewWrapper
      as="section"
      className={`chalklee-question-object${selected ? " selected" : ""}${isGroup ? " group" : ""}${linkedPlaceholder ? " linked-placeholder" : ""}${actionsOpen ? " menu-open" : ""}${editing ? " is-editing" : ""}`}
      data-node-id={node.attrs.id}
      data-chalklee-question={isGroup ? undefined : ""}
      data-chalklee-question-group={isGroup ? "" : undefined}
      data-question-style={typeof node.attrs.styleRef === "string" ? node.attrs.styleRef : undefined}
      data-question-kind={String(node.attrs.kind ?? "general")}
      data-question-number-mode={numberMode}
      data-question-frame={frame ? (frame.labelPosition ?? "top-left") : undefined}
      data-frame-design={frame?.design}
      data-stem-empty={stemEmpty ? "true" : "false"}
      data-source-blank={hasSourceBlank ? "true" : "false"}
      data-inline-number={ownsSourceBlank ? "true" : "false"}
      data-material-number={materialHasNumber ? "true" : "false"}
      data-linked-placeholder={linkedPlaceholder ? "true" : "false"}
      data-answer-columns={isGroup ? chalkLeeGroupAnswerColumns(node) || undefined : undefined}
      data-number-large={(fixedValue ?? autoValue ?? 0) > CHALKLEE_CIRCLED_NUMBER_MAX ? "true" : undefined}
      style={{ ...node.attrs.runtimeStyle, ...numberStyle }}
    >
      {frame?.design ? <span className="chalklee-frame-decoration" aria-hidden="true" contentEditable={false} /> : null}
      {frame ? <ChalkLeeQuestionFrameLabel editor={editor} questionId={String(node.attrs.id)} frame={frame} /> : null}
      <div ref={controlsRef} className="chalklee-question-object-head" contentEditable={false} onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setActionsOpen(false);
          setConfirmDelete(false);
          editor.view.focus();
          return;
        }
        if (actionsOpen && (event.key === "Enter" || event.key === " ") && event.target instanceof HTMLButtonElement) {
          event.preventDefault();
          event.stopPropagation();
          event.target.click();
          return;
        }
        if (!actionsOpen || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...(controlsRef.current?.querySelectorAll<HTMLButtonElement>(".chalklee-question-object-actions button:not(:disabled)") ?? [])];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (current + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
        <span data-number-mode={numberMode}>{showsHeadNumber ? <span className="chalklee-question-number" data-chalklee-question-number="" /> : null}</span>
        {node.attrs.score != null ? <small>{node.attrs.score} 分</small> : null}
        <button
          type="button"
          className="chalklee-question-grip"
          draggable={false}
          onPointerDown={questionDrag.onPointerDown}
          onDragStart={(event) => event.preventDefault()}
          aria-label={`${questionLabel}操作，可拖动排序`}
          aria-expanded={actionsOpen}
          title="拖动排序，点击打开操作"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (questionDrag.suppressClick.current) return;
            if (selectedChalkLeeQuestionContext(editor.state)?.id !== node.attrs.id) {
              const transaction = chalkLeeQuestionRegionTransaction(editor.state, String(node.attrs.id), isGroup ? "questionMaterial" : "questionStem");
              if (transaction) editor.view.dispatch(transaction);
            }
            setActionsOpen((value) => !value);
            setConfirmDelete(false);
          }}
        ><GripVertical size={15} /></button>
        {basketAvailable ? <button
          type="button"
          className={`chalklee-question-basket-mark${inBasket ? " selected" : ""}`}
          title={inBasket ? "已在选题篮，点击移出" : "加入选题篮，之后可插入其他文档"}
          aria-label={inBasket ? "已在选题篮，点击移出" : "加入选题篮"}
          aria-pressed={inBasket}
          disabled={basketBusy}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); toggleBasket(); }}
        ><ShoppingBasket size={13} strokeWidth={2.2} /></button> : null}
        {missingParts.length ? <div className="chalklee-question-add" role="group" aria-label="添加题目内容"
          onMouseLeave={() => setAddPreview(null)}>
          {missingParts.map(([part, label]) => (
            <button key={part} type="button" aria-label={`添加${addLabel(part, label)}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => previewAdd(part)} onFocus={() => previewAdd(part)} onBlur={() => setAddPreview(null)}
              onClick={run(() => addPart(part))}><Plus size={13} strokeWidth={2.2} /><span>{addLabel(part, label)}</span></button>
          ))}
        </div> : null}
        {actionsOpen ? <ChalkLeeObjectActions label={`${questionLabel}操作`}>
          {inspector.propertiesAvailable !== false && !inspector.propertiesVisible ? <button
            type="button"
            title="题目属性"
            aria-label="题目属性"
            onClick={run(() => inspector.showProperties(), true)}><Settings2 size={14} /><span>属性</span></button> : null}
          <button type="button" title="整题上移" aria-label="整题上移" disabled={!moveAvailability?.up} onClick={run(() => position !== false && moveQuestion(editor, position, -1), true)}><ArrowUp size={14} /><span>上移</span></button>
          <button type="button" title="整题下移" aria-label="整题下移" disabled={!moveAvailability?.down} onClick={run(() => position !== false && moveQuestion(editor, position, 1), true)}><ArrowDown size={14} /><span>下移</span></button>
          <button type="button" title="复制整题" aria-label="复制整题" onClick={run(() => position !== false && duplicateQuestion(editor, position), true)}><Copy size={14} /><span>复制</span></button>
          {canPutInBox ? <button type="button" title="放进盒子" aria-label="放进盒子" onClick={run(() => {
            const transaction = chalkLeePutQuestionInBoxTransaction(editor.state, position);
            if (transaction) editor.view.dispatch(transaction);
          }, true)}><PanelTop size={14} /><span>放进盒子</span></button> : null}
          {inBox ? <button type="button" title="移出盒子" aria-label="移出盒子" onClick={run(() => {
            const transaction = chalkLeeMoveQuestionOutOfBoxTransaction(editor.state, position);
            if (transaction) editor.view.dispatch(transaction);
          }, true)}><SquareArrowOutUpRight size={14} /><span>移出盒子</span></button> : null}
          {confirmDelete ? (
            <>
              <button type="button" className="danger confirm" title="确认删除整题" aria-label="确认删除整题" onClick={run(() => {
                setConfirmDelete(false);
                setActionsOpen(false);
                if (position !== false) deleteQuestion(editor, position);
              }, true)}><Check size={14} /><span>确认删除</span></button>
              <button type="button" title="取消删除" aria-label="取消删除" onClick={run(() => setConfirmDelete(false))}><X size={14} /><span>取消</span></button>
            </>
          ) : <button type="button" className="danger" title="删除整题" aria-label="删除整题" onClick={run(() => setConfirmDelete(true))}><Trash2 size={14} /><span>删除</span></button>}
          {askAssistant && !confirmDelete ? (
            <div className="chalklee-question-assistant-actions" role="group" aria-label="ChalkLee AI">
              <small>ChalkLee AI</small>
              {([
                ["similar", CopyPlus, "出相似题"],
                ["easier", TrendingDown, "降低题目难度"],
                ["harder", TrendingUp, "提高题目难度"],
                ["solution", PenLine, "写答案与解析"]
              ] as const).map(([action, Icon, label]) => (
                <button key={action} type="button" title={`用 ChalkLee AI ${label}`} aria-label={`用 ChalkLee AI ${label}`}
                  onClick={run(() => askAssistant({ id: String(node.attrs.id), label: findChalkLeeQuestionContext(editor.state.doc, String(node.attrs.id))?.label ?? null }, action as QuestionAssistantAction), true)}>
                  <Icon size={14} /><span>{label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </ChalkLeeObjectActions> : null}
      </div>
      {addPreview !== null ? <span className="chalklee-question-add-preview" style={{ top: addPreview }} aria-hidden="true" contentEditable={false} /> : null}
      <ChalkLeeNodeViewContent nodeView={{ editor, node, getPos }} className="chalklee-question-object-content" />
      {outsideGapPosition !== null ? (
        <span
          className="chalklee-question-outside-gap-target"
          contentEditable={false}
          aria-hidden="true"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            selectQuestionOutsideGap(editor, outsideGapPosition);
          }}
        />
      ) : null}
    </NodeViewWrapper>
  );
}

/** One inspector per active editor, independent of the question's DOM node view. */
export function ChalkLeeQuestionProperties({ editor, context, numbering, onNumberingPreview }: {
  editor: Editor;
  context: ChalkLeeQuestionContext;
  /** The document's question numbers, chosen at the end of every question's properties. */
  numbering?: ChalkLeeQuestionNumbering;
  onNumberingPreview?(numbering: ChalkLeeQuestionNumbering | null): void;
}) {
  const withQuestion = (action: (position: number, node: ProseMirrorNode) => void) => {
    const current = findChalkLeeQuestionContext(editor.state.doc, context.id);
    if (current) action(current.position, current.node);
  };
  return <QuestionSettings
    ownerNodeId={context.id}
    node={chalkLeeQuestionWithSolutions(editor.state.doc, context.node)}
    isGroup={context.node.type.name === "questionGroup"}
    onChange={attributes => withQuestion((position, node) => editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, ...attributes })))}
    onTagsChange={change => {
      if (editor.isDestroyed) return;
      const transaction = chalkLeeQuestionTagsTransaction(editor.state, context.id, change);
      if (!transaction) return;
      editor.view.dispatch(closeHistory(transaction));
      editor.view.dispatch(closeHistory(editor.state.tr));
    }}
    onAnswerToggle={label => withQuestion(position => setQuestionChoiceAnswer(editor, position, label))}
    onRegionToggle={(region, present) => withQuestion(position => setQuestionRegion(editor, position, region, present))}
    onOptionLayoutChange={layout => withQuestion(position => setQuestionOptionLayout(editor, position, layout))}
    onOptionAdd={() => withQuestion(position => addQuestionOption(editor, position))}
    onOptionMove={(index, direction) => withQuestion(position => moveQuestionOption(editor, position, index, direction))}
    onOptionDelete={index => withQuestion(position => deleteQuestionOption(editor, position, index))}
    onReturnToEditor={() => editor.view.focus()}
    numberingStyles={<ChalkLeeQuestionNumberingStyles editor={editor} numbering={numbering} onPreview={onNumberingPreview ?? (() => undefined)} />}
  />;
}

function QuestionSettings({
  ownerNodeId,
  node,
  isGroup,
  onChange,
  onTagsChange,
  onAnswerToggle,
  onRegionToggle,
  onOptionLayoutChange,
  onOptionAdd,
  onOptionMove,
  onOptionDelete,
  onReturnToEditor,
  numberingStyles
}: {
  ownerNodeId: string;
  node: NodeViewProps["node"];
  isGroup: boolean;
  onChange(attributes: Record<string, unknown>): void;
  onTagsChange(change: ChalkLeeTagChange): void;
  onAnswerToggle(label: string): void;
  onRegionToggle(region: "questionAnswer" | "questionAnalysis", present: boolean): void;
  onOptionLayoutChange(layout: string): void;
  onOptionAdd(): void;
  onOptionMove(index: number, direction: -1 | 1): void;
  onOptionDelete(index: number): void;
  onReturnToEditor(): void;
  numberingStyles?: React.ReactNode;
}) {
  const [pendingRegionDelete, setPendingRegionDelete] = useState<"questionAnswer" | "questionAnalysis" | null>(null);
  const number = node.attrs.number && typeof node.attrs.number === "object"
    ? node.attrs.number as { mode: "auto" | "fixed" | "none" | "continue"; label?: string }
    : { mode: "auto" as const };
  const currentKind = String(node.attrs.kind ?? (isGroup ? "reading" : "single-choice"));
  const optionGroup = node.content.content.find((child) => child.type.name === "optionGroup");
  const optionItems: Array<{ label: string; preview: string }> = [];
  optionGroup?.forEach((option) => optionItems.push({
    label: String(option.attrs.label ?? ""),
    preview: chalkLeeOptionPreview(option)
  }));
  const optionLabels = optionItems.map((option) => option.label);
  const answerNode = node.content.content.find((child) => child.type.name === "questionAnswer");
  const analysisNode = node.content.content.find((child) => child.type.name === "questionAnalysis");
  const selectedAnswers = chalkLeeChoiceAnswerLabels(answerNode?.toJSON(), optionLabels);
  const toggleRegion = (region: "questionAnswer" | "questionAnalysis", present: boolean, hasContent: boolean) => {
    if (!present) {
      setPendingRegionDelete(null);
      onRegionToggle(region, true);
      return;
    }
    if (hasContent && pendingRegionDelete !== region) {
      setPendingRegionDelete(region);
      return;
    }
    setPendingRegionDelete(null);
    onRegionToggle(region, false);
  };
  return (
    <div
      className="chalklee-question-settings chalklee-question-settings-panel"
      data-question-settings-owner={ownerNodeId}
      role="group"
      aria-label={isGroup ? "题组属性" : "题目属性"}
      contentEditable={false}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setPendingRegionDelete(null);
        onReturnToEditor();
      }
    }}>
      <section className="chalklee-property-section chalklee-question-essential" aria-label="常用设置">
        <div className="chalklee-question-settings-row">
          <label><span>题号</span><AppSelect label="题号方式" value={number.mode} onChange={value => {
            const mode = value as "auto" | "fixed" | "none" | "continue";
            onChange({ number: mode === "fixed" ? { mode, label: number.label || "1" } : { mode } });
          }} options={[{ value: "auto", label: "自动编号" }, { value: "fixed", label: "手动编号" }, { value: "none", label: "不显示" },
            // A reading passage's questions run on from the paper's numbers.
            ...isGroup ? [{ value: "continue", label: "小题接着编号" }] : []]} /></label>
          {number.mode === "fixed" ? <label><span>编号</span><input aria-label="题目编号" value={number.label ?? ""} onChange={event => onChange({ number: { mode: "fixed", label: event.target.value } })} /></label> : null}
        </div>
        <div className="chalklee-question-settings-row">
          <label><span>难度</span><AppSelect label="题目难度" value={node.attrs.difficulty ?? ""} onChange={value => onChange({ difficulty: value || null })}
            options={[{ value: "", label: "未设置" }, { value: "easy", label: "简单" }, { value: "medium", label: "中等" }, { value: "hard", label: "困难" }]} /></label>
          <label><span>分值</span><span className="chalklee-score-input"><input aria-label="题目分值" type="number" min="0" step="0.5" value={node.attrs.score ?? ""} placeholder="—"
            onChange={event => onChange({ score: event.target.value === "" ? null : Math.max(0, Number(event.target.value)) })} /><span>分</span></span></label>
        </div>
        <ChalkLeeQuestionTags tags={Array.isArray(node.attrs.tags) ? node.attrs.tags : []} isGroup={isGroup} onChange={onTagsChange} />
      </section>
      {optionGroup ? <section className="chalklee-inspector-section chalklee-option-layout" aria-label="选项">
        <header><strong>选项</strong><AppSelect label="选项排列" value={optionGroup.attrs.layout ?? "auto"} onChange={onOptionLayoutChange}
          options={[{ value: "auto", label: "自动排列" }, { value: "inline", label: "行内排列" }, { value: "one-column", label: "一行一项" }, { value: "two-column", label: "一行两项" }, { value: "four-column", label: "一行四项" }]} /></header>
        <div className="chalklee-question-option-controls" role="group" aria-label="调整选项">
          <div className="chalklee-question-option-list">
            {optionItems.map((option, index) => (
              <div key={`${option.label}-${index}`} className="chalklee-question-option-row">
                <strong>{option.label}</strong>
                <span title={option.preview}>{option.preview || "待填写选项"}</span>
                <div>
                  <button type="button" title={`上移选项 ${option.label}`} aria-label={`上移选项 ${option.label}`} disabled={index === 0} onClick={() => onOptionMove(index, -1)}><ArrowUp size={11} /></button>
                  <button type="button" title={`下移选项 ${option.label}`} aria-label={`下移选项 ${option.label}`} disabled={index === optionItems.length - 1} onClick={() => onOptionMove(index, 1)}><ArrowDown size={11} /></button>
                  <button type="button" className="danger" title={`删除选项 ${option.label}`} aria-label={`删除选项 ${option.label}`} disabled={optionItems.length <= 2} onClick={() => onOptionDelete(index)}><Trash2 size={11} /></button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="chalklee-question-option-add" disabled={optionItems.length >= 8} onClick={onOptionAdd}><Plus size={12} />添加选项</button>
        </div>
      </section> : null}

      {/* Answers belong to the question, not to its options: a section of their own. */}
      <section className="chalklee-inspector-section chalklee-question-solution-section" aria-label="答案与解析">
        <header><strong>答案与解析</strong></header>
        <div className="chalklee-question-region-controls">
          <button
            type="button"
            className={answerNode ? "active" : ""}
            onClick={() => toggleRegion("questionAnswer", Boolean(answerNode), Boolean(answerNode?.textContent.trim()))}
          >{answerNode ? <Trash2 size={12} /> : <Plus size={12} />}{pendingRegionDelete === "questionAnswer" ? "确认删除答案" : answerNode ? "删除答案" : "添加答案"}</button>
          <button
            type="button"
            className={analysisNode ? "active" : ""}
            onClick={() => toggleRegion("questionAnalysis", Boolean(analysisNode), Boolean(analysisNode?.textContent.trim()))}
          >{analysisNode ? <Trash2 size={12} /> : <Plus size={12} />}{pendingRegionDelete === "questionAnalysis" ? "确认删除解析" : analysisNode ? "删除解析" : "添加解析"}</button>
        </div>
        {optionLabels.length ? (
          <div className="chalklee-answer-picker" role="group" aria-label="正确答案">
            <span>正确答案{chalkLeeChoiceAnswerIsMultiple(currentKind, selectedAnswers) ? "（可多选）" : ""}</span>
            <span className="chalklee-answer-picker-options">
              {optionLabels.map((label) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={selectedAnswers.includes(label.toLocaleUpperCase())}
                  className={selectedAnswers.includes(label.toLocaleUpperCase()) ? "active" : ""}
                  onClick={() => onAnswerToggle(label)}
                >{label}</button>
              ))}
            </span>
          </div>
        ) : null}
      </section>
      {numberingStyles}
    </div>
  );
}

function formatQuestionLabel(number: unknown, isGroup: boolean) {
  if (number && typeof number === "object" && "mode" in number) {
    const value = number as { mode: string; label?: string };
    if (value.mode === "fixed" && value.label) return isGroup ? `题组 ${value.label}` : `第 ${value.label} 题`;
    if (value.mode === "none") return isGroup ? "题组" : "题目";
  }
  return isGroup ? "题组" : "自动编号题";
}

/** A group may leave its numbers to its subquestions (`continue`); a question reads that as automatic. */
function questionNumberMode(number: unknown, isGroup: boolean): "auto" | "fixed" | "none" | "continue" {
  if (number && typeof number === "object" && "mode" in number) {
    const mode = (number as { mode?: unknown }).mode;
    if (mode === "fixed" || mode === "none") return mode;
    if (mode === "continue" && isGroup) return mode;
  }
  return "auto";
}

/**
 * Where a part added from the margin will appear, in the question's own (unzoomed) pixels: options
 * after the stem or the last option, an answer before the analysis, otherwise the end of the question.
 * Answers kept elsewhere (at the end of the paper, or in a group's summary) have no preview.
 */
function chalkLeeAddPreviewTop(question: HTMLElement | null, part: "optionGroup" | "questionAnswer" | "questionAnalysis", framed: boolean, solutionElsewhere: boolean) {
  const content = question?.querySelector<HTMLElement>(":scope > .chalklee-question-object-content > [data-node-view-content-react]");
  if (!question || !content || solutionElsewhere || question.parentElement?.closest(".chalklee-question-object")) return null;
  const box = question.getBoundingClientRect();
  const scale = box.height / (question.offsetHeight || 1) || 1;
  const offset = (y: number) => Math.round((y - box.top) / scale);
  const visible = [...content.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.getClientRects().length > 0);
  const summary = visible.find(child => child.classList.contains("chalklee-group-solution"));
  const own = visible.filter(child => !child.classList.contains("chalklee-group-solution"));
  const below = (element: HTMLElement | undefined) => element ? offset(element.getBoundingClientRect().bottom) + 4 : null;
  if (part === "optionGroup") return below(own.find(child => child.querySelector("[data-chalklee-options]")) ?? own[0]);
  const analysis = part === "questionAnswer" ? own.find(child => child.dataset.chalkleeRegion === "analysis") : undefined;
  const before = analysis ?? summary;
  if (before) return offset(before.getBoundingClientRect().top) - 4;
  // A framed question's first answer or analysis sits below its border.
  if (framed && !own.some(child => child.dataset.chalkleeRegion === "answer" || child.dataset.chalkleeRegion === "analysis")) return Math.round(question.offsetHeight) + 4;
  return below(own.at(-1));
}
