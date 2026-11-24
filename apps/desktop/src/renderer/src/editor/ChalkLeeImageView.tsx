import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { AlignCenter, AlignLeft, AlignRight, Crop, GripVertical, ImageIcon, Sparkles, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import { CHALKLEE_CROP_IMAGE_EVENT, CHALKLEE_REPLACE_IMAGE_EVENT, observeChalkLeeImageSlot } from "./imagePairs";
import { CHALKLEE_FULL_CROP, ChalkLeeImageCropFrame, chalkLeeTrimWhiteMargins, type ChalkLeeCropRect } from "./ChalkLeeImageCrop";
import { chalkLeeImageLayoutTransaction, chalkLeeNudgeImageTransaction, chalkLeePairCandidates, chalkLeePairImagesTransaction, type ChalkLeeImageLayout } from "./imageLayout";
import { showChalkLeeImageGestureCursor, useChalkLeeImageDrag } from "./imageDrag";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { AppSelect } from "../ui/AppSelect";
import { chalkLeeElementScale } from "./viewport";
import { chalkLeeImageWidthPreset } from "./editing";
import { chalkLeeRecognizableImage, useChalkLeeImageAssistant } from "./questionAssistant";
import { chalkLeeImageSizeTransaction, constrainChalkLeeImageSize, resizeChalkLeeImage, type ChalkLeeImageResizeGeometry, type ChalkLeeImageResizeHandle, type ChalkLeeImageSize } from "./imageResize";
import { ChalkLeeImageDisplayContext, ChalkLeeImagePictureEditingContext } from "./imageDisplayUrls";

const handles = { nw: "左上角", ne: "右上角", sw: "左下角", se: "右下角" } as const;

export function ChalkLeeImageView({ editor, node, selected, getPos, updateAttributes, deleteNode }: NodeViewProps) {
  const inline = node.type.name === "imageInline";
  const layout: ChalkLeeImageLayout = inline ? "inline" : node.attrs.layout ?? "auto";
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const slotRef = useRef<HTMLElement | null>(null);
  const [, refreshLayout] = useState(0);
  const drag = useChalkLeeImageDrag(editor, String(node.attrs.id));
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const toolsState = useRef({ doc: editor.state.doc, editable: editor.isEditable });
  if (selected) toolsState.current = { doc: editor.state.doc, editable: editor.isEditable };
  useEffect(() => observeChalkLeeImageSlot(editor.view.dom, String(node.attrs.id), target => {
    if (slotRef.current !== target) {
      slotRef.current = target;
      setSlot(target);
    }
    // Only the open toolbar needs fresh options when another picture or question changes.
    if (selectedRef.current) {
      const doc = editor.state.doc, editable = editor.isEditable;
      if (toolsState.current.doc !== doc || toolsState.current.editable !== editable) {
        toolsState.current = { doc, editable };
        refreshLayout(value => value + 1);
      }
    }
  }), [editor, node.attrs.id, node.attrs.imagePairId]);
  const editable = selected && editor.isEditable;
  const candidates = editable ? chalkLeePairCandidates(editor.state.doc) : undefined;
  const owner = candidates?.find(i => i.node.attrs.id === node.attrs.id);
  const previous = owner && candidates?.find(i => i.index === owner.index - 1);
  const next = owner && candidates?.find(i => i.index === owner.index + 1);
  const applyLayout = (value: ChalkLeeImageLayout) => {
    const transaction = chalkLeeImageLayoutTransaction(editor.state, String(node.attrs.id), value);
    if (transaction) { editor.view.dispatch(transaction); editor.view.dispatch(closeHistory(editor.state.tr)); }
    editor.view.focus();
  };
  const pairWith = (id: string) => {
    const transaction = chalkLeePairImagesTransaction(editor.state, String(node.attrs.id), id);
    if (transaction) { editor.view.dispatch(transaction); editor.view.dispatch(closeHistory(editor.state.tr)); }
    editor.view.focus();
  };
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [preview, setPreview] = useState<ChalkLeeImageSize | null>(null);
  const [loaded, setLoaded] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const displayUrls = useContext(ChalkLeeImageDisplayContext);
  const picturesEditable = useContext(ChalkLeeImagePictureEditingContext);
  const source: string | null = node.attrs.src;
  const assetId: string | null = node.attrs.assetId;
  const attachImage = useCallback((image: HTMLImageElement | null) => {
    imageRef.current = image;
    if (!image) return;
    const url = source ? displayUrls?.get(source) ?? source : assetId ? displayUrls?.getAsset(assetId) : undefined;
    if (url) image.src = url;
    else image.removeAttribute("src");
  }, [source, assetId, displayUrls]);
  const toolsRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const width = chalkLeeImageWidthPreset(node.attrs.widthPt);
  const alignment = inline ? "left" : layout === "wrap-left" ? "left" : layout === "wrap-right" ? "right" : node.attrs.textAlign === "right" ? "right" : node.attrs.textAlign === "left" ? "left" : "center";
  const askImageAssistant = useChalkLeeImageAssistant();
  const recognizable = Boolean(askImageAssistant && editable && !inline && chalkLeeRecognizableImage(editor.state.doc, String(node.attrs.id)));
  const [crop, setCrop] = useState<ChalkLeeCropRect | null>(null);
  useEffect(() => { if (!editable) setCrop(null); }, [editable]);
  const applyCrop = (rect: ChalkLeeCropRect) => {
    setCrop(null);
    const whole = rect.x <= 0.001 && rect.y <= 0.001 && rect.width >= 0.999 && rect.height >= 0.999;
    if (!whole) editor.view.dom.dispatchEvent(new CustomEvent(CHALKLEE_CROP_IMAGE_EVENT, { detail: { nodeId: String(node.attrs.id), rect } }));
  };
  const cropRef = useRef(crop);
  cropRef.current = crop;
  useEffect(() => {
    if (!crop) return;
    // While cropping, Enter applies and Esc cancels instead of reaching the paper.
    const keys = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Enter" && cropRef.current) applyCrop(cropRef.current); else setCrop(null);
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, [crop !== null]);
  const changeImageLayout = (attributes: Record<string, unknown>) => {
    updateAttributes(attributes);
    editor.view.focus();
  };
  const dimensions = preview ?? node.attrs;
  // Explicit dimensions retain their ratio when the paper/cell becomes narrower.
  const aspectRatio = dimensions.widthPt > 0 && dimensions.heightPt > 0 ? `${dimensions.widthPt} / ${dimensions.heightPt}` : undefined;

  const measure = (): ChalkLeeImageResizeGeometry | null => {
    const image = imageRef.current;
    const figure = image?.closest<HTMLElement>("[data-chalklee-image]");
    const container = inline ? figure?.closest<HTMLElement>("p, h1, h2, h3, h4, h5, h6") : figure?.parentElement;
    if (!image || !container) return null;
    const rect = image.getBoundingClientRect();
    const paper = image.closest<HTMLElement>(".chalklee-paper");
    const scale = chalkLeeElementScale(image);
    const containerStyle = getComputedStyle(container);
    const padding = (Number.parseFloat(containerStyle.paddingLeft) || 0) + (Number.parseFloat(containerStyle.paddingRight) || 0);
    const maxWidthPt = (container.clientWidth - padding) * .75 * (layout.startsWith("wrap-") ? .55 : 1);
    const pageHeight = Number.parseFloat(paper ? getComputedStyle(paper).getPropertyValue("--chalklee-page-content-height") : "");
    const captionHeight = (figure?.querySelector(".chalklee-image-caption")?.getBoundingClientRect().height ?? 0) / scale;
    if (rect.width <= 0 || rect.height <= 0 || maxWidthPt <= 0) return null;
    const widthPt = rect.width / scale * .75;
    // Avoid accumulating subpixel layout rounding in the saved aspect ratio.
    const ratio = node.attrs.widthPt > 0 && node.attrs.heightPt > 0
      ? node.attrs.widthPt / node.attrs.heightPt : image.naturalWidth / image.naturalHeight;
    return {
      widthPt, heightPt: Number.isFinite(ratio) && ratio > 0 ? widthPt / ratio : rect.height / scale * .75,
      scale, alignment, maxWidthPt,
      maxHeightPt: Number.isFinite(pageHeight) ? Math.max(24, (pageHeight - captionHeight - 12) * .75) : Infinity
    };
  };

  const commit = (size: ChalkLeeImageSize) => {
    if (editor.isDestroyed || !editor.isEditable) return;
    const position = getPos();
    if (typeof position !== "number" || editor.state.doc.nodeAt(position)?.attrs.id !== node.attrs.id) return;
    const transaction = chalkLeeImageSizeTransaction(editor.state, position, size);
    if (!transaction) return;
    editor.view.dispatch(transaction);
    editor.view.dispatch(closeHistory(editor.state.tr));
  };

  const startResize = (handle: ChalkLeeImageResizeHandle) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !editor.isEditable || cleanupRef.current) return;
    const geometry = measure();
    if (!geometry) return;
    event.preventDefault();
    event.stopPropagation();
    editor.view.focus();
    const target = event.currentTarget;
    const figure = imageRef.current!.closest<HTMLElement>("[data-chalklee-image]")!;
    const pointerId = event.pointerId;
    const startX = event.clientX, startY = event.clientY;
    const controller = new AbortController();
    let next: ChalkLeeImageSize = geometry;
    let moved = false;
    let frame = 0;
    target.setPointerCapture(pointerId);
    figure.classList.add("is-resizing");
    const restoreCursor = showChalkLeeImageGestureCursor(target.ownerDocument, `chalklee-image-resizing-${handle}`,
      handle === "nw" || handle === "se" ? "nwse-resize" : "nesw-resize");
    setPreview({ widthPt: geometry.widthPt, heightPt: geometry.heightPt });
    const cleanup = () => {
      controller.abort();
      cancelAnimationFrame(frame);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      figure.classList.remove("is-resizing");
      restoreCursor();
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    const finish = (save: boolean) => {
      cleanup();
      if (save && moved && (Math.abs(next.widthPt - geometry.widthPt) > .05 || Math.abs(next.heightPt - geometry.heightPt) > .05)) commit(next);
      setPreview(null);
    };
    const update = (e: globalThis.PointerEvent) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < 3 && !moved) return;
      moved = true;
      next = resizeChalkLeeImage(geometry, handle, e.clientX - startX, e.clientY - startY);
    };
    window.addEventListener("pointermove", e => {
      if (e.pointerId !== pointerId) return;
      if (!target.hasPointerCapture(pointerId)) { finish(false); return; }
      e.preventDefault();
      update(e);
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; setPreview(next); });
    }, { signal: controller.signal, capture: true, passive: false });
    window.addEventListener("pointerup", e => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      update(e);
      finish(target.hasPointerCapture(pointerId));
    }, { signal: controller.signal, capture: true });
    window.addEventListener("pointercancel", e => { if (e.pointerId === pointerId) finish(false); }, { signal: controller.signal });
    target.addEventListener("lostpointercapture", () => finish(false), { signal: controller.signal });
    window.addEventListener("blur", () => finish(false), { signal: controller.signal });
    window.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      // Finish before save/undo/print shortcuts so those actions see a stable document.
      else if (e.metaKey || e.ctrlKey) finish(true);
    }, { signal: controller.signal, capture: true });
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); editor.view.focus(); return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const geometry = measure();
    if (!geometry) return;
    event.preventDefault(); event.stopPropagation();
    const direction = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
    commit(constrainChalkLeeImageSize(geometry, geometry.widthPt + direction * (event.shiftKey ? 10 : 1)));
  };

  useEffect(() => () => cleanupRef.current?.(), []);
  useEffect(() => { if (!selected) setDetailsOpen(false); }, [selected]);
  useEffect(() => {
    setLoaded(Boolean(imageRef.current?.complete && imageRef.current.naturalWidth));
  }, [source, assetId]);

  useLayoutEffect(() => {
    editor.view.dom.dispatchEvent(new Event("chalklee:image-layout-ready"));
  }, [editor, slot, loaded, layout]);

  // Keep the floating controls inside the visible editing area, including at high zoom.
  useLayoutEffect(() => {
    const toolbar = toolsRef.current;
    const figure = imageRef.current?.closest<HTMLElement>("[data-chalklee-image]");
    if (!editable || !toolbar || !figure) return;
    const scroller = figure.closest<HTMLElement>(".chalklee-editor-scroll");
    const paper = figure.closest<HTMLElement>(".chalklee-paper");
    const refresh = () => {
      const figureRect = figure.getBoundingClientRect();
      const scale = chalkLeeElementScale(figure);
      figure.style.setProperty("--chalklee-image-ui-scale", String(scale));
      const bounds = scroller?.getBoundingClientRect();
      const left = Math.max(8, (bounds?.left ?? 0) + 8);
      const right = Math.min(window.innerWidth - 8, (bounds?.right ?? window.innerWidth) - 8);
      toolbar.style.maxWidth = `${(right - left) / scale}px`;
      const toolbarWidth = toolbar.getBoundingClientRect().width;
      const ideal = figureRect.left + figureRect.width / 2 - toolbarWidth / 2;
      const clamped = Math.max(left, Math.min(right - toolbarWidth, ideal));
      toolbar.style.setProperty("--chalklee-image-tools-shift", `${(clamped - ideal) / scale}px`);
      // Inside an option the bar goes below, so the option row being edited stays readable.
      const roomAbove = figureRect.top - toolbar.getBoundingClientRect().height - 10 >= (bounds?.top ?? 0);
      const roomBelow = figureRect.bottom + toolbar.getBoundingClientRect().height + 10 <= (bounds?.bottom ?? window.innerHeight);
      toolbar.dataset.below = String(!roomAbove || (Boolean(figure.closest("[data-chalklee-option]")) && roomBelow));
    };
    refresh();
    const observer = new ResizeObserver(refresh);
    observer.observe(figure);
    observer.observe(toolbar);
    if (scroller) observer.observe(scroller);
    window.addEventListener("resize", refresh);
    paper?.addEventListener("chalklee:viewport-change", refresh);
    scroller?.addEventListener("scroll", refresh, { passive: true });
    return () => { observer.disconnect(); window.removeEventListener("resize", refresh); paper?.removeEventListener("chalklee:viewport-change", refresh); scroller?.removeEventListener("scroll", refresh); };
  }, [editable, preview !== null, crop !== null, node.attrs.textAlign, slot, layout]);

  const content = <>
      <span className="chalklee-image-surface" style={{ marginLeft: alignment === "left" ? undefined : "auto", marginRight: alignment === "right" ? undefined : "auto" }}>
        <img ref={attachImage} draggable={false} onDragStart={event => event.preventDefault()} onPointerDown={drag.onPointerDown} alt={node.attrs.alt ?? ""}
          onClick={event => {
            if (!editor.isEditable || drag.suppressClick.current) return;
            const position = getPos();
            if (typeof position !== "number") return;
            event.stopPropagation();
            editor.commands.setNodeSelection(position);
            editor.view.focus();
          }}
          onLoad={() => setLoaded(true)} onError={() => setLoaded(false)}
          style={{ maxWidth: "100%", width: dimensions.widthPt == null ? "auto" : `${dimensions.widthPt}pt`,
            height: aspectRatio || dimensions.heightPt == null ? "auto" : `${dimensions.heightPt}pt`, aspectRatio }} />
        {editable && loaded && crop ? <ChalkLeeImageCropFrame image={imageRef.current} rect={crop} onChange={setCrop} /> : null}
        {editable && loaded && !crop ? <span className="chalklee-image-resize-controls" contentEditable={false}>
          {(Object.keys(handles) as ChalkLeeImageResizeHandle[]).map(handle => <button key={handle} type="button"
            className={`chalklee-image-resize-handle ${handle}`} aria-label={`${handles[handle]}缩放图片`}
            title="拖动等比缩放；方向键微调，Shift 加速；Esc 取消" onPointerDown={startResize(handle)} onKeyDown={resizeWithKeyboard}
            onClick={event => { event.preventDefault(); event.stopPropagation(); }} />)}
          {preview ? <output className="chalklee-image-size-hint">{(preview.widthPt * 25.4 / 72).toFixed(1)} × {(preview.heightPt * 25.4 / 72).toFixed(1)} mm<span>Esc 取消</span></output> : null}
        </span> : null}
      </span>
      {node.attrs.caption ? <span className="chalklee-image-caption" data-chalklee-image-caption="">{String(node.attrs.caption)}</span> : null}
      {editable && !preview && crop ? <span ref={toolsRef} className="chalklee-image-tools" role="toolbar" aria-label="裁剪图片" contentEditable={false}>
        <Crop size={13} />
        <span className="chalklee-image-crop-hint">拖动边框选择保留的部分</span>
        <button type="button" title="自动去掉四周的空白" onClick={() => { const trimmed = imageRef.current ? chalkLeeTrimWhiteMargins(imageRef.current) : null; if (trimmed) setCrop(trimmed); }}>去白边</button>
        <button type="button" title="恢复整张图" onClick={() => setCrop(CHALKLEE_FULL_CROP)}>还原</button>
        <button type="button" title="取消（Esc）" onClick={() => setCrop(null)}>取消</button>
        <button type="button" className="primary" title="完成（Enter），可撤销" onClick={() => applyCrop(crop)}>完成</button>
      </span> : null}
      {editable && !preview && !crop ? <span ref={toolsRef} className="chalklee-image-tools" role="toolbar" aria-label="图片设置" contentEditable={false}>
        <button type="button" aria-label="拖动图片" title="拖动图片；方向键移动位置" onPointerDown={drag.onPointerDown} onKeyDown={event => {
          if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const transaction = chalkLeeNudgeImageTransaction(editor.state, String(node.attrs.id), ["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1);
          if (transaction) { editor.view.dispatch(transaction); editor.view.dispatch(closeHistory(editor.state.tr)); }
        }}><GripVertical size={13} /></button>
        <ImageIcon size={13} />
        <AppSelect label="图片排版" value={slot?.closest("[data-image-pair]") ? "paired" : layout} menuWidth={180} onChange={value => applyLayout(value as ChalkLeeImageLayout)} options={[
          { value: "auto", label: "自动排列", title: "同一题目区域内的连续图片，在空间足够时并排" },
          { value: "block", label: "单独一行" }, { value: "inline", label: "嵌入文字", title: "像一个文字一样，随段落换行" },
          { value: "wrap-left", label: "文字环绕 · 图在左" }, { value: "wrap-right", label: "文字环绕 · 图在右" },
          ...(slot?.closest("[data-image-pair]") ? [{ value: "paired", label: "跨题并排", disabled: true }] : [])
        ]} />
        <AppSelect label="图片尺寸" value={width} onChange={value => {
          const widths = { auto: null, small: 180, medium: 300, large: 430 };
          const preset = value as keyof typeof widths | "custom";
          if (preset !== "custom") changeImageLayout({ widthPt: widths[preset], heightPt: null });
        }} options={[
          { value: "auto", label: "原始尺寸" }, { value: "small", label: "小图" }, { value: "medium", label: "中图" }, { value: "large", label: "大图" },
          ...(width === "custom" ? [{ value: "custom", label: `自定义 · ${Number(node.attrs.widthPt).toFixed(1)} pt`, disabled: true }] : [])
        ]} />
        {!inline && !layout.startsWith("wrap-") ? <><button type="button" className={alignment === "left" ? "active" : ""} title="图片左对齐" aria-label="图片左对齐" aria-pressed={alignment === "left"} onClick={() => changeImageLayout({ textAlign: "left" })}><AlignLeft size={12} /></button>
        <button type="button" className={alignment === "center" ? "active" : ""} title="图片居中" aria-label="图片居中" aria-pressed={alignment === "center"} onClick={() => changeImageLayout({ textAlign: "center" })}><AlignCenter size={12} /></button>
        <button type="button" className={alignment === "right" ? "active" : ""} title="图片右对齐" aria-label="图片右对齐" aria-pressed={alignment === "right"} onClick={() => changeImageLayout({ textAlign: "right" })}><AlignRight size={12} /></button></> : null}
        {node.attrs.imagePairId ? <button type="button" onClick={() => applyLayout("block")}>取消并排</button> : <>
          {previous ? <button type="button" onClick={() => pairWith(String(previous.node.attrs.id))}>与上一题图并排</button> : null}
          {next ? <button type="button" onClick={() => pairWith(String(next.node.attrs.id))}>与下一题图并排</button> : null}
        </>}
        {loaded && picturesEditable ? <button type="button" title="裁剪图片，去掉多余的部分" onClick={() => setCrop(CHALKLEE_FULL_CROP)}><Crop size={12} />裁剪</button> : null}
        {picturesEditable ? <button type="button" title="换一张图片，大小和排版不变；也可选中图片后直接粘贴" onClick={() => editor.view.dom.dispatchEvent(new CustomEvent(CHALKLEE_REPLACE_IMAGE_EVENT, { detail: { nodeId: String(node.attrs.id) } }))}>替换</button> : null}
        {recognizable ? <button type="button" title="用 ChalkLee AI 把图中的题目转成可编辑的文字" onClick={() => askImageAssistant?.(String(node.attrs.id))}><Sparkles size={12} />识别题目</button> : null}
        <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(value => !value)}>说明</button>
        <button type="button" className="danger" title="删除图片" aria-label="删除图片" onClick={deleteNode}><Trash2 size={12} /></button>
        {detailsOpen ? <span className="chalklee-image-details">
          <label><span>图片说明</span><input value={node.attrs.caption ?? ""} onChange={event => updateAttributes({ caption: event.target.value || null })} placeholder="显示在图片下方" /></label>
          <label><span>替代文本</span><input value={node.attrs.alt ?? ""} onChange={event => updateAttributes({ alt: event.target.value || null })} placeholder="便于无障碍阅读" /></label>
        </span> : null}
      </span> : null}
  </>;
  const style: CSSProperties = {
    width: "fit-content", maxWidth: layout.startsWith("wrap-") ? "55%" : "100%", textAlign: alignment,
    marginLeft: alignment === "left" ? undefined : "auto", marginRight: alignment === "right" ? undefined : "auto",
    marginTop: node.attrs.spaceBeforePt == null ? undefined : `${node.attrs.spaceBeforePt}pt`,
    marginBottom: node.attrs.spaceAfterPt == null ? undefined : `${node.attrs.spaceAfterPt}pt`
  };
  const className = `chalklee-image-node${editable ? " selected" : ""}`;
  if (slot) return <>
    {/* Keep the same editability when portaling a figure. Changing it can force Chromium to lay out the paper once per image. */}
    <NodeViewWrapper as="figure" data-image-source={node.attrs.id} contentEditable={false} style={{ display: "none" }} />
    {createPortal(<figure className={className} data-chalklee-image="" data-node-id={node.attrs.id} data-asset-id={node.attrs.assetId}
      data-image-layout="block" contentEditable={false} style={style}>{content}</figure>, slot)}
  </>;
  return <NodeViewWrapper as={inline ? "span" : "figure"} className={className}
    data-chalklee-image="" data-node-id={node.attrs.id} data-asset-id={node.attrs.assetId} data-image-layout={layout} contentEditable={false}
    style={style}>{content}</NodeViewWrapper>;
}
