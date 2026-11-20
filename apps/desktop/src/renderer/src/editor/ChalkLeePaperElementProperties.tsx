import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";
import { useEffect, useMemo, useRef } from "react";
import {
  chalkLeeCoverLook, chalkLeeCoverPicture, chalkLeeHeaderFooter, chalkLeeRunningLook, chalkLeeTocLevels, chalkLeeTocLook,
  type ChalkLeeCoverStyle, type ChalkLeePageAppearance, type ChalkLeeRunningLineStyle, type ChalkLeeTableOfContentsStyle
} from "@chalklee/format";
import {
  CHALKLEE_COVER_PRESETS, CHALKLEE_RUNNING_PRESETS, CHALKLEE_TOC_PRESETS, chalkLeeCurrentCoverPreset, chalkLeeCurrentRunningPreset, chalkLeeCurrentTocPreset
} from "../../../shared/document/paperPresets";
import { AppSelect } from "../ui/AppSelect";
import { SettingsSwitch } from "../settings/settingsControls";
import { ChalkLeeStyleAsk } from "./ChalkLeeBoxProperties";
import { useChalkLeeInspector } from "./inspectorContext";
import type { ChalkLeeEditorLayout } from "./layoutAppearance";
import {
  chalkLeeCoverStyleTransaction, chalkLeeRunningFirstPageTransaction, chalkLeeRunningStyleTransaction, chalkLeeTocStyleTransaction, chalkLeeTocTransaction,
  type ChalkLeePaperElement, type ChalkLeePaperStylePreview
} from "./paperElements";

const NAMES: Record<ChalkLeePaperElement, string> = { cover: "封面", toc: "目录", header: "页眉", footer: "页脚" };

const TOC_LEVELS = [{ value: "1", label: "只列一级标题" }, { value: "2", label: "列到二级标题" }, { value: "3", label: "列到三级标题" }];

/**
 * The style of a cover, contents, header or footer selected on the paper: described to ChalkLee AI or chosen from
 * the presets, which change its look and keep its words.
 */
export function ChalkLeePaperElementProperties({ editor, layout, element, onPreview }: {
  editor: Editor;
  layout: ChalkLeeEditorLayout;
  element: ChalkLeePaperElement;
  onPreview(preview: ChalkLeePaperStylePreview | null): void;
}) {
  // Nothing stays previewed once this panel is gone.
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  useEffect(() => () => previewRef.current(null), []);
  const inspector = useChalkLeeInspector();
  const apply = (transaction: Transaction | null) => {
    if (!transaction) return;
    editor.view.dispatch(closeHistory(transaction));
    editor.view.dispatch(closeHistory(editor.state.tr));
  };
  const headerFooter = chalkLeeHeaderFooter({ headerFooter: layout.headerFooter });

  const thumbs = element === "cover"
    ? CHALKLEE_COVER_PRESETS.map(preset => ({
        id: preset.id, name: preset.name, current: chalkLeeCurrentCoverPreset(layout.cover)?.id === preset.id,
        picture: <CoverThumb style={preset.style} />,
        preview: { element, style: preset.style } as ChalkLeePaperStylePreview,
        pick: () => apply(chalkLeeCoverStyleTransaction(editor.state, preset.style))
      }))
    : element === "toc"
    ? CHALKLEE_TOC_PRESETS.map(preset => ({
        id: preset.id, name: preset.name, current: chalkLeeCurrentTocPreset(layout.tableOfContents)?.id === preset.id,
        picture: <TocThumb style={preset.style} />,
        preview: { element, style: preset.style } as ChalkLeePaperStylePreview,
        pick: () => apply(chalkLeeTocStyleTransaction(editor.state, preset.style))
      }))
    : CHALKLEE_RUNNING_PRESETS.map(preset => ({
        id: preset.id, name: preset.name, current: chalkLeeCurrentRunningPreset(headerFooter, headerFooter[element])?.id === preset.id,
        picture: <RunningThumb place={element} style={preset.style} />,
        preview: { element, style: preset.style } as ChalkLeePaperStylePreview,
        pick: () => apply(chalkLeeRunningStyleTransaction(editor.state, element, preset.style))
      }));

  return (
    <div className="chalklee-question-settings chalklee-question-settings-panel chalklee-box-style-panel" role="group" aria-label={`${NAMES[element]}样式`}
      onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
      {inspector.askAssistant ? <ChalkLeeStyleAsk onAsk={wish => inspector.askAssistant?.(`给${NAMES[element]}设计一个新样式：${wish}`)} /> : null}
      <div className="chalklee-box-style-gallery">
        {element === "toc" && layout.tableOfContents ? <section className="chalklee-inspector-section" aria-label="显示">
          <div className="chalklee-property-card">
            <div className="chalklee-property-row">
              <span>列出标题</span>
              <AppSelect className="chalklee-property-select" label="目录列出的标题" menuWidth="fit" menuAlign="end"
                value={String(chalkLeeTocLevels(layout.tableOfContents))} options={TOC_LEVELS}
                onChange={value => apply(chalkLeeTocTransaction(editor.state, { levels: Number(value) as 1 | 2 | 3 }))} />
            </div>
          </div>
        </section> : null}
        {(element === "header" || element === "footer") && !layout.cover && !layout.tableOfContents ? <section className="chalklee-inspector-section" aria-label="显示">
          <div className="chalklee-property-card">
            <div className="chalklee-property-row chalklee-paper-element-row" data-on={headerFooter.differentFirstPage ? "true" : undefined}>
              <span>首页不显示</span>
              <SettingsSwitch label="首页不显示页眉页脚" checked={Boolean(headerFooter.differentFirstPage)}
                onChange={hidden => apply(chalkLeeRunningFirstPageTransaction(editor.state, hidden))} />
            </div>
          </div>
        </section> : null}
        <section className="chalklee-inspector-section" aria-label="预设样式">
          <header><strong>预设样式</strong></header>
          <div className="chalklee-box-style-thumbs">
            {thumbs.map(thumb => (
              <button key={thumb.id} type="button" className="chalklee-box-style-thumb" aria-pressed={thumb.current} title={thumb.name}
                onMouseEnter={() => onPreview(thumb.preview)} onMouseLeave={() => onPreview(null)}
                onFocus={() => onPreview(thumb.preview)} onBlur={() => onPreview(null)}
                onClick={() => { onPreview(null); thumb.pick(); }}>
                <span className="chalklee-box-style-thumb-paper chalklee-paper-style-thumb-paper" aria-hidden="true">{thumb.picture}</span>
                <small>{thumb.name}</small>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** The top or bottom of a page in miniature: grey bars for the words and the body, the rule as it is drawn. */
function RunningThumb({ place, style }: { place: "header" | "footer"; style: ChalkLeeRunningLineStyle }) {
  const look = chalkLeeRunningLook({}, { style });
  const W = 110, H = 76, x0 = 10, x1 = 100;
  const header = place === "header";
  const barHeight = look.fontSizePt > 8.8 ? 3.2 : 2.6, opacity = look.fontWeight === "bold" ? 1 : .55;
  const textTop = header ? 13 : 58;
  const bodyLines = header ? [32, 39, 46, 53, 60, 67] : [5, 12, 19, 26, 33, 40];
  const rule = look.rule;
  const ruleLine = (y: number) => {
    if (!rule) return null;
    // At this size each rule keeps at least a pixel, and a double rule shows both its lines.
    const width = Math.max(1, rule.widthPt * 1.3), dash = rule.style === "dashed" ? "4 2.4" : rule.style === "dotted" ? ".1 3" : undefined;
    const line = (at: number, strokeWidth = width) => <line key={at} x1={x0} y1={at} x2={x1} y2={at} stroke={rule.color} strokeWidth={strokeWidth}
      strokeDasharray={dash} strokeLinecap={rule.style === "dotted" ? "round" : "butt"} />;
    return rule.style === "double" ? [line(y - 1.3, 1), line(y + 1.3, 1)] : [line(y)];
  };
  const near = header ? textTop + barHeight + 5 : textTop - 5;
  const far = header ? textTop - 5 : textTop + barHeight + 5;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
      {bodyLines.map((y, index) => <rect key={y} x={x0} y={y} width={index === bodyLines.length - 1 ? 56 : x1 - x0} height={2.2} rx={1} fill="#d9d9e0" />)}
      {header
        ? <>
            <rect x={x0} y={textTop} width={look.letterSpacingEm ? 40 : 34} height={barHeight} rx={1} fill={look.color} opacity={opacity} />
            <rect x={x1 - 30} y={textTop} width={30} height={barHeight} rx={1} fill={look.color} opacity={opacity * .8} />
          </>
        : <rect x={W / 2 - 16} y={textTop} width={look.letterSpacingEm ? 36 : 32} height={barHeight} rx={1} fill={look.color} opacity={opacity} />}
      {ruleLine(near)}
      {rule?.bothSides ? ruleLine(far) : null}
    </svg>
  );
}

/** An A4 page for drawing a cover thumbnail with the paper's own code. */
const THUMB_PAGE = {
  size: "A4", orientation: "portrait", marginsPt: { top: 0, right: 0, bottom: 0, left: 0 },
  background: { type: "solid", color: "#ffffff" }
} as ChalkLeePageAppearance;

/** A whole cover in miniature: its drawing, and grey bars for the title, subtitle and details. */
function CoverThumb({ style }: { style: ChalkLeeCoverStyle }) {
  const picture = useMemo(() => chalkLeeCoverPicture({ page: THUMB_PAGE, cover: { style } }, ""), [style]);
  const look = chalkLeeCoverLook(style);
  const H = 76, W = H * 210 / 297, x0 = (118 - W) / 2, y0 = 3;
  const left = look.align === "left";
  const bar = (y: number, width: number, height: number, fill: string, opacity = 1) =>
    <rect x={left ? x0 + W * .14 : x0 + (W - width) / 2} y={y} width={width} height={height} rx={.8} fill={fill} opacity={opacity} />;
  const titleY = y0 + H * look.titleTop;
  return (
    <svg viewBox="0 0 118 82">
      <rect x={x0} y={y0} width={W} height={H} fill="#ffffff" stroke="#e0e1e6" strokeWidth={.5} />
      {picture ? <image href={picture} x={x0} y={y0} width={W} height={H} preserveAspectRatio="none" /> : null}
      {bar(titleY, W * .56, 4.2, look.titleColor)}
      {bar(titleY + 7.5, W * .38, 2.4, look.color, .8)}
      {bar(y0 + H * .82, W * .3, 2, look.color, .7)}
      {bar(y0 + H * .82 + 4.5, W * .24, 2, look.color, .7)}
    </svg>
  );
}

/** A contents page in miniature: the title, then entries with their leaders and page numbers. */
function TocThumb({ style }: { style: ChalkLeeTableOfContentsStyle }) {
  const look = chalkLeeTocLook(style);
  const H = 76, W = H * 210 / 297, x0 = (118 - W) / 2, y0 = 3, left = x0 + W * .14, right = x0 + W * .86;
  const rows = [0, 1, 1, 0, 1, 1, 0, 1];
  const dash = look.leader === "dots" ? ".1 2" : undefined;
  return (
    <svg viewBox="0 0 118 82">
      <rect x={x0} y={y0} width={W} height={H} fill="#ffffff" stroke="#e0e1e6" strokeWidth={.5} />
      <rect x={look.titleAlign === "left" ? left : x0 + W / 2 - 7} y={y0 + 10} width={14} height={3.4} rx={.8} fill={look.accentColor} />
      {rows.map((depth, index) => {
        const y = y0 + 22 + index * 6.2, x = left + depth * 5, top = depth === 0;
        const textWidth = top ? 14 : 11;
        return <g key={index}>
          <rect x={x} y={y - 1.2} width={textWidth} height={top ? 2.4 : 2} rx={.6} fill={top ? look.accentColor : look.color} opacity={top && look.firstLevelBold ? 1 : .6} />
          {look.leader !== "none" ? <line x1={x + textWidth + 1.5} y1={y + .6} x2={right - 4.5} y2={y + .6} stroke={look.color} strokeWidth={.5}
            strokeDasharray={dash} strokeLinecap={dash ? "round" : "butt"} opacity={.6} /> : null}
          <rect x={right - 3} y={y - 1.2} width={3} height={2} rx={.6} fill={look.color} opacity={.6} />
        </g>;
      })}
    </svg>
  );
}
