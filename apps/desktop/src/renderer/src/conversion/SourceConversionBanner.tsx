import { canSkipConversion, documentKindLabel } from "../../../shared/document/kinds";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { AlertCircle, ArrowRight, Check, Clock3, Copy, LoaderCircle, Unplug } from "lucide-react";
import type { McpSettingsView } from "../../../shared/settings/app";
import type { WorkspaceFileNode } from "../../../shared/contracts";
import { isKeptOriginal, sameWorkspaceDirectory } from "../../../shared/workspace/paths";
import { conversionActivity, conversionIdleText, conversionIsActive, conversionIsRunning, conversionNextStep, conversionStatusText, conversionUnfinished, proofreadPending, type ConversionTask, type StartConversionRequest } from "../../../shared/conversion/tasks";
import { DocumentFileIcon } from "../ui/DocumentFileIcon";
import { externalAgentLabel } from "../../../shared/conversion/externalAgent";
import { useConversionClock, useCopiedFlag } from "./hooks";

/** Teachers know other AI apps, not "agents"; "外部" keeps them apart from ChalkLee's own conversion. */
const EXTERNAL = "外部 AI 应用";

/** Chinese text spaces off Latin names but not Chinese ones: "交给 WorkBuddy", "交给外部 AI 应用". */
const phrase = (head: string, name: string, tail = "") =>
  `${head}${head && /^\w/.test(name) ? " " : ""}${name}${tail && /\w$/.test(name) ? " " : ""}${tail}`;

/** Whether an AI app outside ChalkLee can reach it now: the MCP switch is on and its server started. */
export type ExternalConnection = "ready" | "off" | "failed";
export const externalConnectionOf = (view: Pick<McpSettingsView, "enabled" | "error">): ExternalConnection => !view.enabled ? "off" : view.error ? "failed" : "ready";

/**
 * Two ways to convert, told apart by who does the work: "用 ChalkLee AI 转换" runs the built-in conversion on the model from
 * settings, "交给 WorkBuddy" copies an instruction for the person's own AI app, which converts through ChalkLee MCP.
 */
export function SourceConversionBanner({ file, task, resultAvailable = true, disabled, conversionModel, conversionModelId, onStart, onResume, onStop, onProofread, onSkipProofread, onOpenResult, onOpenDocument, onCheckConnection, onCopyInstruction, onEnableConnection, onSetUpAgent, onChooseModel, onSetConversionNeeded }: {
  file: WorkspaceFileNode; task?: ConversionTask; disabled: boolean;
  /** From a workspace scan after this task ended; history alone does not prove its result is usable. */
  resultAvailable?: boolean;
  /** The model the built-in conversion uses; absent until one is set up. */
  conversionModel?: string;
  /** That model's id, to tell whether a conversion that keeps stopping would now run on another one. */
  conversionModelId?: string;
  onStart(request: StartConversionRequest): Promise<void>;
  onResume(id: string): Promise<void>;
  onStop(id: string): Promise<void>;
  /** Proofreads the finished first draft against the original, or keeps it as it is. */
  onProofread(id: string): Promise<void>;
  onSkipProofread(id: string): Promise<void>;
  onOpenResult(task: ConversionTask): void;
  /** Opens a ChalkLee this original was converted to earlier, when no task records it. */
  onOpenDocument(path: string): void;
  /** Whether an outside AI app could reach ChalkLee now; asked before copying. */
  onCheckConnection(): Promise<ExternalConnection>;
  /** Copies a sentence for the person's own AI app, which converts through ChalkLee MCP. */
  onCopyInstruction(resume: boolean): Promise<void>;
  /** Turns the MCP connection on, when the person agrees to before copying. */
  onEnableConnection(): Promise<ExternalConnection>;
  /** Opens the MCP settings that explain connecting an AI app. */
  onSetUpAgent(): void;
  /** Opens the model settings, when the balance, the Key or the model itself is what stopped a conversion. */
  onChooseModel(): void;
  /** Keeps an original for reading, out of conversion counts and batches (`needed` false), or brings it back. */
  onSetConversionNeeded?(needed: boolean): Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copied, flashCopied] = useCopiedFlag();
  // Where to paste stays in view until something else happens here; only the button's check is brief.
  const [handedOff, setHandedOff] = useState(false);
  useEffect(() => setHandedOff(false), [task?.status, task?.agent]);
  // An instruction cannot reach ChalkLee while outside connections are off, so copying stops and asks first.
  const [prompt, setPrompt] = useState<Exclude<ExternalConnection, "ready"> | null>(null);
  const handOffRef = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const active = !!task && conversionIsActive(task);
  const agent = task?.agent;
  const now = useConversionClock(active);
  const activity = task ? conversionActivity(task, now) : undefined;
  // A first draft waiting for the teacher, or one whose proofread stopped, is a usable result too.
  const awaiting = !!task && proofreadPending(task);
  const proofreading = task?.phase === "proofread";
  const settled = !!task && (["completed", "draft", "drafted"].includes(task.status) || awaiting);
  const linkedResult = resultAvailable && !!task?.result && (isKeptOriginal(file.path) || sameWorkspaceDirectory(file.path, task.result.file.path));
  const unavailableResult = !!task?.result && settled && !linkedResult;
  const hasResult = !!task?.result && settled && linkedResult;
  // Told the same way whether the run left a document or nothing at all.
  const unfinished = task && task.phase !== "proofread" && (task.status === "failed" || hasResult && task.status === "draft") ? conversionUnfinished(task) : undefined;
  // An agent's interrupted session can still be picked up where it stopped.
  const resumeAgent = !!agent && task?.status === "interrupted";
  // Converted before any task this window remembers (another computer, or records cleared): open it rather than convert again.
  const existing = !task || unavailableResult ? file.convertedTo?.find(result => sameWorkspaceDirectory(file.path, result)) : undefined;
  // Converted before the teacher changed this file: the ChalkLee shows the earlier content, so it is not offered as new work.
  const earlier = !task && !existing ? file.earlierConversions?.find(result => sameWorkspaceDirectory(file.path, result)) : undefined;
  // The copy kept at conversion, shown when the teacher's own file was changed or left the workspace.
  const kept = (!task || unavailableResult) && isKeptOriginal(file.path);
  // Kept for reading, such as a textbook: nothing to convert until the teacher says otherwise.
  const notNeeded = !task && !existing && !earlier && !kept && !!file.noConversion;
  // Only the app currently working is named. Any connected app may pick up saved progress.
  const named = active ? externalAgentLabel(agent) : undefined;
  const helper = named ?? EXTERNAL;
  const status = error ? "暂时无法转换"
    : unavailableResult ? existing ? "已转换为 ChalkLee" : "转换结果不可用"
    : task ? conversionIsRunning(task) && task.status !== "stopping" ? proofreading ? "ChalkLee AI 正在校对" : phrase("", agent ? helper : "ChalkLee AI", "正在转换") : conversionStatusText(task)
    : submitting ? "正在开始转换" : existing ? "已转换为 ChalkLee" : earlier ? "转换后改过的原稿" : kept ? "转换时的原稿" : `${documentKindLabel(file.extension)} 原稿`;
  const pasteTo = resumeAgent ? "粘贴到任意已连接的外部 AI 应用中发送" : `粘贴到 WorkBuddy 等${EXTERNAL}中发送`;
  const description = error || (handedOff ? `已复制，${pasteTo}${resumeAgent ? "，从中断处接着转换" : "，进度会显示在这里"}`
    : active && agent ? [phrase("进度在", helper, "中查看"), conversionIdleText(task, now)].filter(Boolean).join("，")
    : task?.status === "queued" ? "前面的转换完成后开始，可切换文档"
    : task?.status === "stopping" ? proofreading ? "初稿保持不变，可稍后继续校对" : "已完成的部分会保留，可稍后继续转换"
    : unavailableResult && !existing ? "ChalkLee 已被删除、移到别处或无法读取，原稿保留"
    : activity ? `${activity.step}，${activity.time}`
    : active || submitting ? "可切换文档，转换在后台继续" : unfinished?.detail || task?.error || (hasResult
    ? task?.status === "drafted" ? "打开看看是否够用；需要时让 AI 对照原稿校对"
    : awaiting ? "初稿保持不变，可以继续校对，或不校对直接使用"
    : "打开 ChalkLee 编辑题目、公式和排版，原稿保留"
    : existing ? "原稿保留；重新转换会更新这份 ChalkLee，你改过的内容保留"
    : earlier ? "ChalkLee 按改动前的内容转换；重新转换会更新它，你改过的内容保留"
    : kept ? "原文件已更改或移出工作区，这是转换时保存的副本，仅供对照"
    : notNeeded ? "不需要转换，只用来阅读"
    : "转换为 ChalkLee 后可编辑题目、公式和排版，原稿保留"));
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setSubmitting(true); setError(""); setHandedOff(false);
    try { await action(); }
    catch (cause) { if (mounted.current) setError(errorText(cause, "转换未能启动，请重试。")); }
    finally { pending.current = false; if (mounted.current) setSubmitting(false); }
  };
  // Marking is not a conversion: the banner says nothing about starting one while it saves.
  const mark = (needed: boolean) => {
    if (pending.current || !onSetConversionNeeded) return;
    pending.current = true; setError("");
    onSetConversionNeeded(needed).catch(cause => { if (mounted.current) setError(errorText(cause, "未能保存，请重试。")); })
      .finally(() => { pending.current = false; });
  };
  const copy = () => {
    setError("");
    onCopyInstruction(resumeAgent).then(() => { if (mounted.current) { flashCopied(); setHandedOff(true); } }, cause => { if (mounted.current) setError(errorText(cause, "未能复制指令，请重试。")); });
  };
  const closePrompt = (refocus: boolean) => {
    setPrompt(null);
    if (refocus) handOffRef.current?.focus({ preventScroll: true });
  };
  const handOff = async () => {
    if (prompt) { closePrompt(true); return; }
    setError("");
    // A failed check copies anyway: the instruction still helps once the connection works.
    const connection = await onCheckConnection().catch((): ExternalConnection => "ready");
    if (!mounted.current) return;
    if (connection === "ready") copy();
    // An earlier "已复制" would contradict the prompt.
    else { setHandedOff(false); setPrompt(connection); }
  };
  const enable = async () => {
    const connection = await onEnableConnection();
    if (!mounted.current) return;
    if (connection === "ready") { closePrompt(true); copy(); } else setPrompt(connection);
  };
  const builtIn = conversionModel ? `ChalkLee AI 用“${conversionModel}”识别题目、公式和排版，可在“设置 → ChalkLee AI”中更换` : "需要先添加模型，点击后打开设置";
  const done = !active && !submitting && !error && !unfinished && (hasResult || !!existing);
  const nextStep = task && unfinished ? conversionNextStep(task, unfinished, conversionModelId) : "continue";
  // The steps fill the line, so leaving the page is said on hover; they change every minute, so screen readers are not told each one.
  const hint = activity ? `${description}\n可切换文档，${proofreading ? "校对" : "转换"}在后台继续` : description;
  return <div className={`source-conversion-banner${active || submitting ? " is-running" : ""}${error || unfinished || task?.status === "failed" ? " has-error" : ""}${done ? " is-done" : ""}${activity?.stalled ? " is-stalled" : ""}`} aria-label="文档转换">
    <span className="source-conversion-symbol" aria-hidden="true">{active || submitting ? task?.status === "queued" ? <Clock3 size={18} /> : activity?.stalled ? <AlertCircle size={18} /> : <LoaderCircle size={18} className="ai-import-spinner" /> : error || unfinished || task?.status === "failed" ? <AlertCircle size={18} /> : done ? <Check size={18} /> : <DocumentFileIcon kind={file.extension} size={20} />}</span>
    <div className="source-conversion-copy" role="status">
      <strong title={status}>{status}</strong>
      <span className="source-conversion-detail"><span title={hint} aria-live={activity ? "off" : undefined}>{description}</span>
        {/* Without a known app the instruction may have nowhere to go yet. */}
        {handedOff && !error && !named ? <button type="button" className="source-conversion-link" onClick={onSetUpAgent}>如何接入</button> : null}
      </span>
    </div>
    <div className="source-conversion-actions">
      {active ? <button type="button" disabled={submitting || ["saving", "stopping"].includes(task.status)} onClick={() => void run(() => onStop(task.id))}>{task.status === "queued" ? "取消等待" : proofreading ? "停止校对" : "停止转换"}</button>
        : hasResult && task.status === "draft" ? <>
          {nextStep === "settings" ? <button type="button" disabled={disabled || submitting} onClick={() => void run(() => onResume(task.id))}>继续转换</button>
            // Continuing is the one thing to do at first; what is done becomes a way out once it keeps stopping.
            : unfinished?.stuck && unfinished.usable ? <button type="button" onClick={() => onOpenResult(task)}>先用已转好的部分</button> : null}
          {nextStep === "continue" ? <button type="button" className="primary" disabled={disabled || submitting} title={builtIn} onClick={() => void run(() => onResume(task.id))}>{submitting ? "正在开始" : agent ? "改用 ChalkLee AI 转换" : "继续转换"}<ArrowRight size={14} aria-hidden="true" /></button>
            : <button type="button" className="primary" onClick={onChooseModel}>{nextStep === "model" ? "换个模型转换" : "打开模型设置"}<ArrowRight size={14} aria-hidden="true" /></button>}
        </>
        : hasResult ? <>
          {awaiting ? <>
            <button type="button" disabled={submitting} title="直接使用这份初稿，与校对完成后一样" onClick={() => void run(() => onSkipProofread(task.id))}>不校对</button>
            <button type="button" disabled={submitting} title="AI 逐页对照原稿找出差异并直接修改 ChalkLee；修改前的内容保存在版本历史中" onClick={() => void run(() => onProofread(task.id))}>{task.status === "drafted" ? "ChalkLee AI 校对" : "继续校对"}</button>
          </> : null}
          <button type="button" className="primary" onClick={() => onOpenResult(task)}>打开 ChalkLee<ArrowRight size={14} aria-hidden="true" /></button>
        </>
        : (existing || earlier) && !submitting ? <>
          <button type="button" disabled={disabled} title={`用 ChalkLee AI 再转换一次并更新这份 ChalkLee${conversionModel ? `（${conversionModel}）` : ""}；你改过的内容保留，更新前的内容保存在版本历史中`}
            onClick={() => void run(() => onStart({ sourcePath: file.path, expectedModifiedAt: file.modifiedAt, force: true, priority: true, into: (existing ?? earlier)! }))}>重新转换</button>
          <button type="button" className="primary" onClick={() => onOpenDocument((existing ?? earlier)!)}>打开 ChalkLee<ArrowRight size={14} aria-hidden="true" /></button>
        </>
        : kept ? null
        : notNeeded ? onSetConversionNeeded ? <button type="button" disabled={disabled} title="重新计入待转换的原稿，之后可以转换"
            onClick={() => mark(true)}>需要转换</button> : null
        : <>
          {onSetConversionNeeded && !task && canSkipConversion(file.extension) ? <button type="button" disabled={disabled || submitting} title="课本等只用来阅读的原稿：不计入待转换的原稿，也不参加批量转换；以后仍可转换"
            onClick={() => mark(false)}>不需要转换</button> : null}
          <button ref={handOffRef} type="button" disabled={disabled || submitting} aria-haspopup="dialog" aria-expanded={prompt ? true : undefined}
            title={resumeAgent ? "将已保存的进度交给任意已连接的外部 AI 应用接着转换" : `复制一句转换指令，${phrase("到", named ?? `WorkBuddy、Codex 等${EXTERNAL}`, "中粘贴发送")}；它用自己的模型转换，结果保存在这个工作区`}
            onClick={() => void handOff()}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}交给外部 AI 应用</button>
          <button type="button" className={nextStep === "continue" ? "primary" : undefined} disabled={disabled || submitting} title={builtIn}
            onClick={() => void run(() => unavailableResult ? onStart({ sourcePath: file.path, expectedModifiedAt: file.modifiedAt, force: true, priority: true }) : task ? onResume(task.id) : onStart({ sourcePath: file.path, expectedModifiedAt: file.modifiedAt, priority: true }))}>
            {submitting ? "正在开始" : unavailableResult ? "重新转换" : !task ? "用 ChalkLee AI 转换" : agent ? "改用 ChalkLee AI 转换" : "继续转换"}{nextStep === "continue" ? <ArrowRight size={14} aria-hidden="true" /> : null}
          </button>
          {nextStep === "continue" ? null : <button type="button" className="primary" onClick={onChooseModel}>{nextStep === "model" ? "换个模型转换" : "打开模型设置"}<ArrowRight size={14} aria-hidden="true" /></button>}
        </>}
    </div>
    {prompt ? <ConnectionPrompt anchor={handOffRef} connection={prompt} onEnable={enable} onCopyAnyway={() => { closePrompt(true); copy(); }}
      onSetUp={() => { closePrompt(false); onSetUpAgent(); }} onClose={closePrompt} /> : null}
  </div>;
}

/** Asked under the hand-off button, where the teacher is looking, before an instruction is copied that could not get through. */
function ConnectionPrompt({ anchor, connection, onEnable, onCopyAnyway, onSetUp, onClose }: {
  anchor: RefObject<HTMLButtonElement>; connection: Exclude<ExternalConnection, "ready">;
  onEnable(): Promise<void>; onCopyAnyway(): void; onSetUp(): void;
  /** `refocus`: give focus back to the button, unless the person clicked somewhere else. */
  onClose(refocus: boolean): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const panel = ref.current, target = anchor.current;
    if (!panel || !target) return;
    // The top layer keeps the prompt above the document and outside any clipping container.
    panel.popover = "manual";
    panel.showPopover();
    const place = () => {
      const rect = target.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8));
      Object.assign(panel.style, { left: `${left}px`, top: `${rect.bottom + 6}px` });
    };
    place();
    panel.querySelector<HTMLElement>(".primary")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!panel.contains(event.target as Node) && !target.contains(event.target as Node)) close.current(false); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", place);
      if (panel.matches(":popover-open")) panel.hidePopover();
    };
  }, [anchor]);
  const enable = () => {
    setBusy(true); setError("");
    onEnable().catch(cause => setError(errorText(cause, "没能打开连接，请在设置中重试。"))).finally(() => setBusy(false));
  };
  const off = connection === "off";
  return <div ref={ref} className="source-conversion-prompt" role="alertdialog" aria-labelledby="source-conversion-prompt-title" aria-describedby="source-conversion-prompt-text"
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(true); } }}>
    <strong id="source-conversion-prompt-title"><Unplug size={15} aria-hidden="true" />{off ? `${EXTERNAL}现在连不上 ChalkLee` : `${EXTERNAL}的连接没能启动`}</strong>
    {/* One sentence per line, so lines break at the punctuation rather than mid-phrase. */}
    <p id="source-conversion-prompt-text">{off
      ? <>连接已在设置中关闭，指令发过去也无法转换。<br />打开后可随时在“设置 → 外部连接”中关闭。</>
      : <>ChalkLee 的连接服务没有启动，<br />WorkBuddy 等外部 AI 应用暂时连不上。</>}</p>
    {error ? <p className="source-conversion-prompt-error" role="alert">{error}</p> : null}
    <footer>
      {off ? <>
        <button type="button" disabled={busy} onClick={() => onClose(true)}>取消</button>
        <button type="button" className="primary" disabled={busy} onClick={enable}>{busy ? "正在打开…" : "打开连接并复制"}</button>
      </> : <>
        <button type="button" onClick={onCopyAnyway}>仍然复制</button>
        <button type="button" className="primary" onClick={onSetUp}>查看原因</button>
      </>}
    </footer>
  </div>;
}

const errorText = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
