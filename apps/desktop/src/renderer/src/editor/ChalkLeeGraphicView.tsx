import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { AlignCenter, AlignLeft, AlignRight, Shapes, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, type PointerEvent } from "react";
import { chalkLeeGraphicPicture, chalkLeeStaticGraphicSvg } from "@chalklee/format";

type Align = "left" | "center" | "right";
const alignments: Array<[Align, string, typeof AlignLeft]> = [["left", "左对齐", AlignLeft], ["center", "居中", AlignCenter], ["right", "右对齐", AlignRight]];

/** Width as a share of the text width, from where the pointer is on an edge handle. */
export function chalkLeeGraphicWidthPercent(align: Align, pointerX: number, figure: { left: number; right: number }, textWidth: number): number {
  const width = align === "left" ? pointerX - figure.left : align === "right" ? figure.right - pointerX : 2 * Math.abs(pointerX - (figure.left + figure.right) / 2);
  return Math.max(10, Math.min(100, Math.round(width / Math.max(1, textWidth) * 100)));
}

/**
 * A drawing in the flow. It shows as a picture, so its own animations play and nothing in it runs;
 * the print copy swaps in the still version.
 */
export function ChalkLeeGraphicView({ editor, node, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const svg = String(node.attrs.svg ?? ""), printSvg = typeof node.attrs.printSvg === "string" ? node.attrs.printSvg : undefined;
  const picture = useMemo(() => chalkLeeGraphicPicture(svg), [svg]);
  const still = useMemo(() => chalkLeeGraphicPicture(chalkLeeStaticGraphicSvg({ svg, printSvg })), [svg, printSvg]);
  const align: Align = node.attrs.textAlign === "left" || node.attrs.textAlign === "right" ? node.attrs.textAlign : "center";
  const percent = Number(node.attrs.widthPercent ?? 100);
  const [preview, setPreview] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const figureRef = useRef<HTMLElement>(null);
  const editable = selected && editor.isEditable;
  const change = (attrs: Record<string, unknown>) => {
    updateAttributes(attrs);
    editor.view.dispatch(closeHistory(editor.state.tr));
  };
  const startResize = (event: PointerEvent<HTMLButtonElement>) => {
    const figure = figureRef.current, text = figure?.parentElement;
    if (!figure || !text) return;
    event.preventDefault(); event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const rect = figure.getBoundingClientRect(), textWidth = text.getBoundingClientRect().width;
    let latest = percent;
    const move = (moveEvent: globalThis.PointerEvent) => { latest = chalkLeeGraphicWidthPercent(align, moveEvent.clientX, rect, textWidth); setPreview(latest); };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setPreview(null);
      if (latest !== percent) change({ widthPercent: latest === 100 ? null : latest });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  const shown = preview ?? percent;
  return <NodeViewWrapper as="figure" ref={figureRef} className={`chalklee-graphic-node${editable ? " selected" : ""}`}
    data-chalklee-graphic="" data-node-id={node.attrs.id} contentEditable={false}
    style={{ width: `${shown}%`, marginLeft: align === "left" ? 0 : "auto", marginRight: align === "right" ? 0 : "auto" }}>
    <span className="chalklee-graphic-surface">
      <img src={picture} data-chalklee-print-src={still} alt={String(node.attrs.alt ?? node.attrs.caption ?? "")} draggable={false} />
      {editable ? <span className="chalklee-image-resize-controls" contentEditable={false}>
        <button type="button" className="chalklee-image-resize-handle chalklee-graphic-resize-handle" data-side={align === "right" ? "left" : "right"}
          aria-label="拖动调整图形宽度" title="拖动调整宽度" onPointerDown={startResize} onClick={event => { event.preventDefault(); event.stopPropagation(); }} />
        {preview !== null ? <output className="chalklee-image-size-hint">正文宽度的 {preview}%</output> : null}
      </span> : null}
    </span>
    {node.attrs.caption ? <figcaption className="chalklee-image-caption" data-chalklee-image-caption="">{String(node.attrs.caption)}</figcaption> : null}
    {editable && preview === null ? <span className="chalklee-image-tools" role="toolbar" aria-label="图形设置" contentEditable={false}>
      <Shapes size={13} />
      {alignments.map(([value, label, Icon]) => <button key={value} type="button" className={align === value ? "active" : ""} aria-pressed={align === value}
        title={`图形${label}`} aria-label={`图形${label}`} onClick={() => change({ textAlign: value })}><Icon size={12} /></button>)}
      <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}>说明</button>
      <button type="button" className="danger" title="删除图形" aria-label="删除图形" onClick={deleteNode}><Trash2 size={12} /></button>
      {detailsOpen ? <span className="chalklee-image-details">
        <label><span>图形说明</span><input value={String(node.attrs.caption ?? "")} onChange={event => updateAttributes({ caption: event.target.value || null })} placeholder="显示在图形下方" /></label>
      </span> : null}
    </span> : null}
  </NodeViewWrapper>;
}
