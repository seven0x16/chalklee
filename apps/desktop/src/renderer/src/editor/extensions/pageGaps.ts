import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { ChalkLeeRepeatedTableHeader } from "../pagination";

type ChalkLeePaginationGapsState = {
  decorations: DecorationSet;
  signature: string | null;
};
export const chalkLeePaginationGapsKey = new PluginKey<ChalkLeePaginationGapsState>("chalkLeePaginationGaps");

export type ChalkLeePageGapSpec = {
  pos: number;
  page: number;
  kind?: "table";
  tableColumns?: number;
  tableHeader?: ChalkLeeRepeatedTableHeader;
  startPx: number;
  fillPx: number;
  marginTopPx: number;
  marginBottomPx: number;
  marginLeftPx: number;
  marginRightPx: number;
  bandPx: number;
};

/** Visual page gaps map through edits but never become part of the ChalkLee document. */
export const ChalkLeePaginationGapsExtension = Extension.create({
  name: "chalkLeePaginationGaps",
  addProseMirrorPlugins() {
    return [new Plugin<ChalkLeePaginationGapsState>({
      key: chalkLeePaginationGapsKey,
      state: {
        init: () => ({ decorations: DecorationSet.empty, signature: "" }),
        apply(transaction, value) {
          const replacement = transaction.getMeta(chalkLeePaginationGapsKey) as ChalkLeePaginationGapsState | undefined;
          if (replacement) return replacement;
          if (!transaction.docChanged) return value;
          return {
            decorations: value.decorations.map(transaction.mapping, transaction.doc),
            signature: null
          };
        }
      },
      props: {
        decorations(state) {
          return chalkLeePaginationGapsKey.getState(state)?.decorations ?? DecorationSet.empty;
        }
      }
    })];
  }
});

/** Identifies a layout of page spacers; equal signatures render identically. */
export function chalkLeePageGapSignature(specs: ChalkLeePageGapSpec[]) {
  return specs.map(spec => `${spec.pos}:${pageGapGeometry(spec)}`).join("|");
}

function pageGapGeometry(spec: ChalkLeePageGapSpec) {
  return [
    spec.page,
    spec.kind ?? "inline",
    spec.tableColumns ?? 0,
    spec.tableHeader?.signature ?? "no-header",
    roundedMetric(spec.startPx),
    roundedMetric(spec.fillPx),
    roundedMetric(spec.marginTopPx),
    roundedMetric(spec.marginBottomPx),
    roundedMetric(spec.marginLeftPx),
    roundedMetric(spec.marginRightPx),
    roundedMetric(spec.bandPx)
  ].join(":");
}

export function setChalkLeePageGaps(editor: Editor, specs: ChalkLeePageGapSpec[]) {
  const signature = chalkLeePageGapSignature(specs);
  const current = chalkLeePaginationGapsKey.getState(editor.state);
  if (current?.signature === signature) return;
  const decorations = DecorationSet.create(editor.state.doc, specs.flatMap((spec) => [
    Decoration.widget(
      spec.pos,
      () => createChalkLeePageGap(spec),
      // Position changes are mapped by ProseMirror. Preserve the widget's
      // aligned height when typing only moves its position in the document.
      { side: -1, key: `chalklee-page-gap-${pageGapGeometry(spec)}` }
    ),
    ...(spec.kind === "table" && spec.tableHeader ? spec.tableHeader.rows.map((row, index) => Decoration.widget(
      spec.pos,
      () => row.cloneNode(true) as HTMLTableRowElement,
      {
        side: 0,
        key: `chalklee-page-repeat-header-${spec.page}-${index}-${spec.tableHeader?.signature ?? "header"}`
      }
    )) : [])
  ]));
  if (samePageDecorations(current?.decorations, decorations)) return;
  editor.view.dispatch(editor.state.tr
    .setMeta(chalkLeePaginationGapsKey, { decorations, signature } satisfies ChalkLeePaginationGapsState)
    .setMeta("addToHistory", false));
}

/** A manual page break skips the remaining columns, without adding saved nodes. */
export function setChalkLeeColumnPageBreaks(editor: Editor, specs: { pos: number; emptyColumns: number }[]) {
  const signature = `columns:${specs.map(spec => `${spec.pos}:${spec.emptyColumns}`).join("|")}`;
  const current = chalkLeePaginationGapsKey.getState(editor.state);
  if (current?.signature === signature) return false;
  const decorations = DecorationSet.create(editor.state.doc, specs.filter(spec => spec.emptyColumns > 0).map(spec =>
    Decoration.widget(spec.pos, () => {
      const skip = document.createElement("span");
      skip.className = "chalklee-column-page-skip";
      skip.contentEditable = "false";
      skip.setAttribute("aria-hidden", "true");
      for (let index = 0; index < spec.emptyColumns; index += 1) skip.append(document.createElement("span"));
      return skip;
    }, { side: -1, key: `chalklee-column-page-skip-${spec.emptyColumns}` })
  ));
  // A text edit can move a break without changing which column it ends in.
  // Its existing skip widget has already moved with the document transaction.
  if (samePageDecorations(current?.decorations, decorations)) return false;
  editor.view.dispatch(editor.state.tr
    .setMeta(chalkLeePaginationGapsKey, { decorations, signature } satisfies ChalkLeePaginationGapsState)
    .setMeta("addToHistory", false));
  return true;
}

function samePageDecorations(current: DecorationSet | undefined, next: DecorationSet) {
  const mapped = current?.find() ?? [];
  const measured = next.find();
  return mapped.length === measured.length && mapped.every((widget, index) =>
    widget.from === measured[index].from && widget.spec.key === measured[index].spec.key);
}

export function createChalkLeePageGap(spec: ChalkLeePageGapSpec) {
  if (spec.kind === "table") return createChalkLeeTablePageGap(spec);
  const gap = document.createElement("span");
  gap.className = "chalklee-page-gap";
  gap.contentEditable = "false";
  gap.setAttribute("aria-hidden", "true");
  gap.dataset.chalkleePageGap = String(spec.page);
  gap.dataset.page = String(spec.page);
  gap.dataset.pageStart = String(spec.startPx);
  gap.style.height = `${spec.fillPx + spec.marginBottomPx + spec.bandPx + spec.marginTopPx}px`;
  gap.style.marginLeft = `-${spec.marginLeftPx}px`;
  gap.style.marginRight = `-${spec.marginRightPx}px`;
  gap.style.width = `calc(100% + ${spec.marginLeftPx + spec.marginRightPx}px)`;
  gap.style.setProperty("--chalklee-gap-ml", `${spec.marginLeftPx}px`);
  gap.style.setProperty("--chalklee-gap-mr", `${spec.marginRightPx}px`);
  gap.style.setProperty("--chalklee-gap-fill", `${spec.fillPx}px`);
  gap.style.setProperty("--chalklee-gap-mb", `${spec.marginBottomPx}px`);
  gap.style.setProperty("--chalklee-gap-mt", `${spec.marginTopPx}px`);
  gap.style.setProperty("--chalklee-gap-band", `${spec.bandPx}px`);
  return gap;
}

function createChalkLeeTablePageGap(spec: ChalkLeePageGapSpec) {
  const gap = document.createElement("tr");
  gap.className = "chalklee-page-gap chalklee-page-gap-table";
  gap.contentEditable = "false";
  gap.setAttribute("aria-hidden", "true");
  gap.dataset.chalkleePageGap = String(spec.page);
  gap.dataset.page = String(spec.page);
  gap.dataset.pageStart = String(spec.startPx);
  setChalkLeePageGapMetrics(gap, spec);

  const cell = document.createElement("td");
  cell.colSpan = Math.max(1, spec.tableColumns ?? 1);
  cell.contentEditable = "false";
  const fill = document.createElement("span");
  fill.className = "chalklee-page-gap-table-fill";
  cell.append(fill);
  gap.append(cell);
  return gap;
}

function setChalkLeePageGapMetrics(gap: HTMLElement, spec: ChalkLeePageGapSpec) {
  const total = spec.fillPx + spec.marginBottomPx + spec.bandPx + spec.marginTopPx;
  gap.style.height = `${total}px`;
  gap.style.setProperty("--chalklee-gap-total", `${total}px`);
  gap.style.setProperty("--chalklee-gap-fill", `${spec.fillPx}px`);
  gap.style.setProperty("--chalklee-gap-mb", `${spec.marginBottomPx}px`);
  gap.style.setProperty("--chalklee-gap-mt", `${spec.marginTopPx}px`);
  gap.style.setProperty("--chalklee-gap-band", `${spec.bandPx}px`);
  gap.style.setProperty("--chalklee-gap-ml", `${spec.marginLeftPx}px`);
  gap.style.setProperty("--chalklee-gap-mr", `${spec.marginRightPx}px`);
}

function roundedMetric(value: number) {
  return Math.round(value * 10) / 10;
}
