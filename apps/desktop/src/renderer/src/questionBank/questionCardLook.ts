import { compileChalkLeeDesignStyles, type ChalkLeeDocument } from "@chalklee/format";
import { useLayoutEffect, useMemo, useState, type CSSProperties, type RefObject } from "react";
import { chalkLeeDesignLayoutCss } from "../editor/designLayout";
import { pageStyle } from "../editor/pageView";

interface DesignSheet { scope: string; css: string; element: HTMLStyleElement | null; holders: number }

const KEPT_SHEETS = 32;
const sheets = new Map<string, DesignSheet>();
let lastScope = 0;

/** One style sheet per distinct design, however many of its questions are on screen. */
function designSheet(source: string): DesignSheet {
  const known = sheets.get(source);
  if (known) return known;
  const scope = `question-card-${++lastScope}`;
  let css = "";
  // A design that cannot be compiled leaves the card in the document's plain settings.
  try { css = compileChalkLeeDesignStyles(source, scope).css; } catch { css = ""; }
  const sheet: DesignSheet = { scope, css, element: null, holders: 0 };
  sheets.set(source, sheet);
  for (const [key, kept] of sheets) {
    if (sheets.size <= KEPT_SHEETS) break;
    if (!kept.holders && kept !== sheet) sheets.delete(key);
  }
  return sheet;
}

function holdDesignSheet(sheet: DesignSheet) {
  if (!sheet.css) return;
  if (!sheet.element) {
    sheet.element = document.createElement("style");
    sheet.element.dataset.chalkleeCardDesign = sheet.scope;
    sheet.element.textContent = sheet.css;
    document.head.append(sheet.element);
  }
  sheet.holders++;
  return () => {
    if (--sheet.holders) return;
    sheet.element?.remove();
    sheet.element = null;
  };
}

/**
 * The document's page settings and design on a card. The text is laid out at the document's own
 * column width, so lines break where they do on the page, and scaled down when the card is narrower.
 */
export function useQuestionCardLook(source: ChalkLeeDocument, page: RefObject<HTMLElement | null>, paper: RefObject<HTMLElement | null>) {
  const designCss = source.appearance.design?.css;
  const sheet = useMemo(() => designCss ? designSheet(designCss) : null, [designCss]);
  useLayoutEffect(() => sheet ? holdDesignSheet(sheet) : undefined, [sheet]);

  // Labels of answers and analysis follow the padding the design gives them, as on the page.
  const [labelCss, setLabelCss] = useState("");
  useLayoutEffect(() => {
    const element = paper.current;
    if (!element || !sheet?.css) { setLabelCss(""); return; }
    const sync = () => setLabelCss(chalkLeeDesignLayoutCss(element, sheet.scope));
    const observer = new MutationObserver(sync);
    observer.observe(element, { childList: true, subtree: true });
    sync();
    return () => observer.disconnect();
  }, [paper, sheet]);

  const [fit, setFit] = useState({ scale: 1, trim: 0, height: 0 });
  useLayoutEffect(() => {
    const frame = page.current, content = paper.current;
    if (!frame || !content) return;
    const measure = () => {
      const style = getComputedStyle(frame);
      const room = frame.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      // A hidden list measures nothing; the card keeps the scale it last had.
      if (room <= 0 || content.offsetWidth <= 0) return;
      const scale = Math.min(1, Math.floor(room / content.offsetWidth * 1000) / 1000);
      const trim = scale < 1 ? Math.floor(content.offsetHeight * (1 - scale)) : 0;
      const height = content.offsetHeight;
      setFit(current => current.scale === scale && current.trim === trim && current.height === height ? current : { scale, trim, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [page, paper]);

  const style = useMemo(() => {
    const { width: _width, minHeight: _minHeight, padding: _padding, ...settings } = pageStyle(source, 1);
    return settings as CSSProperties;
  }, [source]);
  return {
    scope: sheet?.css ? sheet.scope : undefined,
    labelCss,
    scale: fit.scale,
    /** The question's height at the document's own width. */
    height: fit.height,
    style: fit.scale < 1 ? { ...style, transform: `scale(${fit.scale})`, marginBottom: -fit.trim } : style
  };
}
