import "mathlive/static.css";
import { renderChalkLeeMathMarkup } from "../editor/mathMarkup";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { chalkLeeGraphicPicture, chalkLeeGroupContinuesNumbers } from "@chalklee/format";
import { QUESTION_BANK_TYPE_LABELS, normalizeQuestionText, type QuestionBankEntry, type QuestionBankLocation, type QuestionBasketItem, type QuestionSnapshot } from "../../../shared/questionBank/search";
import { highlightText } from "../ui/highlightText";
import type { QuestionBankHighlight } from "./questionPresentation";

/** Which solution parts are shown under a question. */
export interface QuestionSolutionVisibility { answer: boolean; analysis: boolean }

function assetDataUrl(asset: { mediaType: string; data: ArrayBuffer }) {
  const bytes = new Uint8Array(asset.data);
  const nativeEncode = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (nativeEncode) return `data:${asset.mediaType};base64,${nativeEncode.call(bytes)}`;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return `data:${asset.mediaType};base64,${btoa(binary)}`;
}
function latexMarkup(latex: string) {
  try { return latex.trim() ? renderChalkLeeMathMarkup(latex) : ""; }
  catch { return ""; }
}

/** Whether any copy of a question is in the basket. */
export const inQuestionBasket = (basket: readonly QuestionBasketItem[], locations: readonly QuestionBankLocation[]) =>
  basket.some(item => locations.some(location => item.relativePath === location.relativePath && item.questionId === location.questionId));

/** Paper name and question number, e.g. "高三开学考 · 第 7 题". */
export function questionSourceLabel(entry: { documentTitle: string; number: string }) {
  return `${entry.documentTitle}${entry.number ? ` · 第 ${entry.number} 题` : ""}`;
}

export function QuestionTypeTag({ type }: { type: QuestionBankEntry["type"] }) {
  return <span className="question-type-tag" data-type={type}>{QUESTION_BANK_TYPE_LABELS[type]}</span>;
}

function Formula({ latex, highlight, block = false }: { latex: string; highlight: QuestionBankHighlight; block?: boolean }) {
  const normalized = highlight.tokens.length ? normalizeQuestionText(`$${latex}$`) : "";
  const hit = highlight.tokens.some(token => normalized.includes(token));
  const markup = latexMarkup(latex);
  const className = `question-bank-math${block ? " block" : ""}${hit ? " hit" : ""}`;
  // The named math node conveys the formula. MathLive's visual spans would expose its glyphs again in layout order.
  return markup
    ? <span className={className} role="math" aria-label={latex}><span aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} /></span>
    : <span className={className}>{latex}</span>;
}

/** Plain index text where formulas are kept as `$latex$`. */
export function QuestionBankText({ text, highlight, formatFormulas = true }: { text: string; highlight: QuestionBankHighlight; formatFormulas?: boolean }) {
  return <>{text.split(/(\$[^$]*\$)/).map((segment, index) => {
    if (!segment) return null;
    if (segment.length > 1 && segment.startsWith("$") && segment.endsWith("$")) {
      const latex = segment.slice(1, -1);
      return formatFormulas ? <Formula key={index} latex={latex} highlight={highlight} />
        : <span key={index} className="question-bank-math-source" role="math" aria-label={latex}>{latex}</span>;
    }
    return <Fragment key={index}>{highlightText(segment.replace(/＄/g, "$"), highlight.words)}</Fragment>;
  })}</>;
}

type Node = { type?: string; text?: string; attrs?: Record<string, any>; marks?: Array<{ type: string }>; content?: Node[] };

const region = (node: Node, type: string) => node.content?.find(child => child.type === type);
const plainLength = (node: Node | undefined): number => !node ? 0 : node.type === "text" ? (node.text ?? "").length
  : node.type === "image" || node.type === "imageInline" ? 99 : node.type === "mathInline" ? 6 : (node.content ?? []).reduce((total, child) => total + plainLength(child), 0);

function questionNumber(node: Node, ordinal: number) {
  const number = node.attrs?.number;
  if (number?.mode === "fixed") return String(number.label ?? "");
  if (number?.mode === "none") return "";
  return String(ordinal);
}

/** Read-only rendering of a saved question, close to the paper but compact enough for the sidebar. */
export function QuestionSnapshotView({ snapshot: preview, highlight, showSolutions }: { snapshot: QuestionSnapshot; highlight: QuestionBankHighlight; showSolutions: QuestionSolutionVisibility }) {
  const [loaded, setLoaded] = useState<{ preview: QuestionSnapshot; full: QuestionSnapshot | null }>();
  const requested = useRef<{ preview: QuestionSnapshot; promise: Promise<QuestionSnapshot | null> }>();
  const deferred = Boolean(preview.deferredAssetIds?.length && (showSolutions.answer || showSolutions.analysis));
  useEffect(() => {
    if (!deferred) return;
    const { path, questionId } = preview.location;
    if (requested.current?.preview !== preview) {
      requested.current = { preview, promise: window.chalkLee.readQuestionSnapshot(path, questionId).catch(() => null) };
    }
    const request = requested.current;
    let live = true;
    void request.promise.then(full => {
      if (!full && requested.current === request) requested.current = undefined;
      if (live) setLoaded(current => current?.preview === preview && current.full === full ? current : { preview, full });
    });
    return () => { live = false; };
  }, [deferred, preview]);
  const snapshot = (loaded?.preview === preview ? loaded.full : null) ?? preview;
  const pendingAssets = loaded?.preview === preview ? undefined : preview.deferredAssetIds;

  // Encode only rendered images. Folded answers and analysis can contain large figures.
  const assets = useMemo(() => new Map(snapshot.assets.map(asset => [asset.id, asset])), [snapshot]);
  const urls = useMemo(() => new Map<string, string>(), [preview]);

  const inline = (nodes: Node[] | undefined): ReactNode => (nodes ?? []).map((node, index) => {
    switch (node.type) {
      case "text": {
        let content: ReactNode = highlightText(node.text ?? "", highlight.words);
        for (const mark of node.marks ?? []) {
          if (mark.type === "bold") content = <strong>{content}</strong>;
          else if (mark.type === "italic") content = <em>{content}</em>;
          else if (mark.type === "underline") content = <u>{content}</u>;
          else if (mark.type === "strike") content = <s>{content}</s>;
          else if (mark.type === "superscript") content = <sup>{content}</sup>;
          else if (mark.type === "subscript") content = <sub>{content}</sub>;
        }
        return <Fragment key={index}>{content}</Fragment>;
      }
      case "mathInline": return <Formula key={index} latex={String(node.attrs?.latex ?? "")} highlight={highlight} />;
      case "blank": return <span key={index} className="question-bank-blank">{node.attrs?.label ? `(${node.attrs.label})` : ""}</span>;
      case "hardBreak": return <br key={index} />;
      case "imageInline": return image(node, index, true);
      default: return <Fragment key={index}>{inline(node.content)}</Fragment>;
    }
  });

  function image(node: Node, key: number, inlineImage = false) {
    const id = String(node.attrs?.assetId ?? "");
    const asset = assets.get(id);
    if (!asset) return <span key={key} className="question-bank-figure-missing">{pendingAssets?.includes(id) ? "正在读取图片…" : "图片缺失"}</span>;
    const urlKey = `${asset.mediaType}/${asset.sha256}`;
    let url = urls.get(urlKey);
    if (!url) {
      url = assetDataUrl(asset);
      urls.set(urlKey, url);
    }
    const widthPt = Number(node.attrs?.widthPt);
    const style = (Number.isFinite(widthPt) && widthPt > 0 ? { "--question-image-width": `${Math.round(widthPt * 4 / 3)}px` } : {}) as CSSProperties;
    return <img key={key} className={inlineImage ? "question-bank-image inline" : "question-bank-image"} src={url} alt={String(node.attrs?.alt ?? "题目配图")} style={style} draggable={false} />;
  }

  const blocks = (nodes: Node[] | undefined): ReactNode => (nodes ?? []).map((node, index) => {
    switch (node.type) {
      case "paragraph": case "heading": return <p key={index}>{inline(node.content)}</p>;
      case "blockMath": return <div key={index} className="question-bank-math-row"><Formula latex={String(node.attrs?.latex ?? "")} highlight={highlight} block /></div>;
      case "image": return <div key={index} className="question-bank-figure">{image(node, index)}</div>;
      case "graphic": return <div key={index} className="question-bank-figure"><img className="question-bank-image" src={chalkLeeGraphicPicture(String(node.attrs?.svg ?? ""))}
        alt={String(node.attrs?.alt ?? node.attrs?.caption ?? "图形")} style={{ "--question-image-width": `${Number(node.attrs?.widthPercent ?? 100) * 4}px` } as CSSProperties} draggable={false} /></div>;
      case "table": return (
        <div key={index} className="question-bank-table"><table><tbody>{(node.content ?? []).map((row, rowIndex) => (
          <tr key={rowIndex}>{(row.content ?? []).map((cell, cellIndex) => (
            <td key={cellIndex} colSpan={cell.attrs?.colspan ?? undefined} rowSpan={cell.attrs?.rowspan ?? undefined}>{blocks(cell.content)}</td>
          ))}</tr>
        ))}</tbody></table></div>
      );
      // Only the words printed on answer lines show; the bank leaves out the empty lines.
      case "answerLine": return node.content?.length ? <p key={index}>{inline(node.content)}</p> : null;
      case "pageBreak": return null;
      default: return <Fragment key={index}>{blocks(node.content)}</Fragment>;
    }
  });

  const options = (group: Node | undefined) => {
    const items = group?.content ?? [];
    if (!items.length) return null;
    // Mirror the paper's option layout; "auto" flows like the paper instead of guessing from text length.
    const layout = String(group?.attrs?.layout ?? "");
    const wide = items.some(option => plainLength(option) > 16);
    const className =
      layout === "one-column" || (!layout && wide) ? "question-bank-options wide"
      : layout === "four-column" ? "question-bank-options four"
      : layout === "inline" || layout === "auto" ? "question-bank-options flow"
      : "question-bank-options";
    return <div className={className}>{items.map((option, index) => (
      <div key={index}><b>{option.attrs?.label}.</b><div>{blocks(option.content)}</div></div>
    ))}</div>;
  };

  const solutions = (node: Node) => (["questionAnswer", "questionAnalysis"] as const).map(type => {
    const part = (type === "questionAnswer" ? showSolutions.answer : showSolutions.analysis) ? region(node, type) : undefined;
    return part ? <div key={type} className="question-bank-solution"><span>{type === "questionAnswer" ? "答案" : "解析"}</span><div>{blocks(part.content)}</div></div> : null;
  });

  const question = (node: Node): ReactNode => {
    const group = node.type === "questionGroup";
    const subs = (region(node, "subQuestionList")?.content ?? []).filter(child => child.type === "question" || child.type === "questionGroup");
    // A group whose subquestions take the paper's numbers was indexed by them, as 33–36, and counts on from the first.
    const first = chalkLeeGroupContinuesNumbers(node) ? Number(/^\d+/.exec(snapshot.location.number)?.[0] ?? 1) : 1;
    return <>
      {blocks(region(node, group ? "questionMaterial" : "questionStem")?.content)}
      {options(region(node, "optionGroup"))}
      {subs.length ? <ol className="question-bank-subquestions">{subs.map((sub, index) => (
        <li key={index}><span className="question-bank-sub-number">{questionNumber(sub, first + index)}</span><div>{question(sub)}</div></li>
      ))}</ol> : null}
      {solutions(node)}
    </>;
  };

  return <div className="question-bank-rich">{question(snapshot.node as Node)}</div>;
}

/** The saved question read fresh from disk, answers and analysis folded; `children` adds actions below. */
export function QuestionPreview({ path, questionId, contentHash, fallback, highlight, hasSolutions, children }: {
  path: string;
  questionId: string;
  contentHash: string;
  fallback: string;
  highlight: QuestionBankHighlight;
  hasSolutions: boolean;
  children?: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<QuestionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSolutions, setShowSolutions] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSnapshot(null); setError(null);
    window.chalkLee.readQuestionSnapshot(path, questionId)
      .then(result => { if (!cancelled) setSnapshot(result); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [path, questionId, contentHash]);
  return (
    <div className="question-bank-preview">
      {error ? <p className="question-bank-preview-error">{error}</p>
        : snapshot ? <QuestionSnapshotView snapshot={snapshot} highlight={highlight} showSolutions={{ answer: showSolutions, analysis: showSolutions }} />
        : <div className="question-bank-preview-loading"><QuestionBankText text={fallback} highlight={highlight} /></div>}
      {hasSolutions || children ? (
        <div className="question-bank-preview-actions">
          {hasSolutions ? (
            <button type="button" className="question-bank-link" aria-expanded={showSolutions} onClick={() => setShowSolutions(value => !value)}>
              {showSolutions ? <ChevronDown size={12} /> : <ChevronRight size={12} />}答案与解析
            </button>
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
