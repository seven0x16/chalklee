import { useEffect, useRef, useState } from "react";
import type { ChalkLeePageAppearance } from "@chalklee/format";
import { chalkLeeColumnLayout, chalkLeePageSizePt } from "./pagination";
import { chalkLeeMarginPreset, chalkLeeMarginPresets, chalkLeePaperSizePatch, type ChalkLeePagePatch } from "./pageSettings";
import { AppSelect } from "../ui/AppSelect";

const mm = (pt: number) => Math.round(pt * 254 / 72) / 10;
const columnLabels = ["单栏", "双栏", "三栏", "四栏", "五栏", "六栏", "七栏", "八栏", "九栏", "十栏", "十一栏", "十二栏"];
export function ChalkLeePaperProperties({ page, onChange }: { page: ChalkLeePageAppearance; onChange?(patch: ChalkLeePagePatch): void }) {
  const [customMargins, setCustomMargins] = useState(false);
  const marginInputsRef = useRef<HTMLDivElement>(null);
  const { width, height } = chalkLeePageSizePt(page);
  const columns = chalkLeeColumnLayout(page);
  const preset = chalkLeeMarginPreset(page);
  const showCustomMargins = customMargins || preset === "custom";
  const color = page.background.type === "solid" ? page.background.color : page.background.fallbackColor;
  function editCustomMargins() {
    setCustomMargins(true);
    requestAnimationFrame(() => {
      const inputs = marginInputsRef.current;
      inputs?.scrollIntoView({ block: "nearest" });
      inputs?.querySelector("input")?.focus({ preventScroll: true });
    });
  }
  return <fieldset className="chalklee-property-card chalklee-paper-settings" aria-label="纸张属性" disabled={!onChange}>
    <div className="chalklee-paper-overview">
      <div className="chalklee-paper-miniature" aria-hidden="true" style={{ width: Math.min(28, 40 * width / height), aspectRatio: `${width} / ${height}`, background: color }}>
        <span style={{ inset: `${page.marginsPt.top / height * 100}% ${page.marginsPt.right / width * 100}% ${page.marginsPt.bottom / height * 100}% ${page.marginsPt.left / width * 100}%`, display: "flex", gap: `${columns.gapPt / width * 100}%` }}>
          {Array.from({ length: columns.count }, (_, index) => <i key={index} />)}
        </span>
      </div>
      <div className="chalklee-paper-size-details">
        <AppSelect className="chalklee-property-select" label="纸张大小" menuWidth="fit" value={page.size} disabled={!onChange} onChange={value => onChange?.(chalkLeePaperSizePatch(page, value as ChalkLeePageAppearance["size"]))}
          options={[{ value: "A4", label: "A4" }, { value: "A3", label: "A3" }, { value: "Letter", label: "Letter" }, { value: "slide", label: "课件 16:9" }, ...(page.size === "custom" ? [{ value: "custom", label: "自定义" }] : [])]} />
        <small title={`${mm(width)} × ${mm(height)} mm`}>{mm(width)} × {mm(height)} mm</small>
      </div>
      <div className="chalklee-paper-layout-controls">
        <AppSelect className="chalklee-property-select" label="纸张方向" menuWidth="fit" menuAlign="end" value={page.orientation} disabled={!onChange}
          options={[{ value: "portrait", label: "纵向" }, { value: "landscape", label: "横向" }]}
          onChange={value => onChange?.({ orientation: value as ChalkLeePageAppearance["orientation"] })} />
        <AppSelect className="chalklee-property-select" label="栏数" menuWidth="fit" menuAlign="end" value={String(columns.count)} disabled={!onChange}
          options={Array.from({ length: Math.max(3, columns.maxCount) }, (_, index) => ({ value: String(index + 1), label: columnLabels[index], disabled: index >= columns.maxCount }))}
          onChange={value => onChange?.({ columnCount: Number(value) })} />
      </div>
    </div>
    {columns.count > 1 ? <div className="chalklee-property-row" title={`每栏 ${mm(columns.widthPt)} mm`}>
      <span>栏间距</span>
      <PageMarginInput ariaLabel="栏间距（毫米）" value={columns.gapPt} max={Math.floor(columns.maxGapPt * 25.4 / 72 * 10) / 10} onChange={value => onChange?.({ columnGapPt: value })} />
    </div> : null}
    <div className="chalklee-margin-settings">
      <div className="chalklee-property-row">
        <span>页边距</span>
        <AppSelect className="chalklee-property-select" label="页边距" menuWidth="fit" menuAlign="end" disabled={!onChange}
          value={showCustomMargins ? "custom" : preset}
          options={[...chalkLeeMarginPresets.map(item => ({ value: item.id, label: item.label, meta: `${mm(item.pt)} mm` })), { value: "custom", label: "自定义" }]}
          onChange={value => {
            const item = chalkLeeMarginPresets.find(candidate => candidate.id === value);
            if (!item) return editCustomMargins();
            onChange?.({ marginsPt: { top: item.pt, right: item.pt, bottom: item.pt, left: item.pt } });
            setCustomMargins(false);
          }} />
      </div>
      {showCustomMargins ? <div ref={marginInputsRef} className="chalklee-margin-inputs">
        {([['top', '上'], ['bottom', '下'], ['left', '左'], ['right', '右']] as const).map(([side, label]) => <PageMarginInput key={side} label={label} value={page.marginsPt[side]}
          max={mm((side === "top" || side === "bottom" ? height - page.marginsPt[side === "top" ? "bottom" : "top"] : width - page.marginsPt[side === "left" ? "right" : "left"]) - 36)}
          onChange={value => onChange?.({ marginsPt: { [side]: value } })} />)}
      </div> : null}
    </div>
  </fieldset>;
}

function PageMarginInput({ label, ariaLabel, value, max, onChange }: { label?: string; ariaLabel?: string; value: number; max: number; onChange(value: number): void }) {
  const [draft, setDraft] = useState(String(mm(value)));
  const cancel = useRef(false);
  useEffect(() => setDraft(String(mm(value))), [value]);
  return <label>{label ? <span>{label}</span> : null}<span className="chalklee-paper-number-input" data-unit="mm"><input data-chalklee-page-draft="" aria-label={ariaLabel ?? `${label}页边距（毫米）`} type="number" min="0" max={max} step="0.1" value={draft}
    onFocus={() => { cancel.current = false; }} onChange={event => setDraft(event.target.value)}
    onBlur={event => {
      // Enter and manual save commit exactly the value visible in the input.
      const entered = event.currentTarget.value;
      const number = Number(entered);
      if (!cancel.current && entered.trim() && Number.isFinite(number) && number >= 0 && number <= max && Math.abs(number - mm(value)) > .001) onChange(number * 72 / 25.4);
      else setDraft(String(mm(value)));
    }}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel.current = true; event.currentTarget.blur(); }
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
    }} /><small aria-hidden="true">mm</small></span></label>;
}
