import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { readChalkLeeTableColumnWidths } from "../editing";
import { chalkLeeAutoTableColumnWeights } from "../tableLayout";
import { commonIdAttribute } from "./nodes";
import { TableNodeView } from "./TableNodeView";
import { tableLogicalColumnCount, tableColumnPercentages, parseTableColumnWidths } from "./tableCommands";

export const ChalkLeeTableNode = Node.create({
  name: "table",
  group: "block questionBlock",
  content: "tableRow+",
  isolating: true,
  extendNodeSchema: (extension) => extension.name === "table" ? { tableRole: "table" } : {},
  addAttributes: () => ({
    ...commonIdAttribute,
    widthPt: { default: null },
    columnWidthsPt: {
      default: null,
      parseHTML: (element: HTMLElement) => parseTableColumnWidths(element.getAttribute("data-column-widths-pt"))
    }
  }),
  parseHTML: () => [{ tag: "table[data-chalklee-table]" }],
  renderHTML: ({ node }) => {
    const savedWidths = readChalkLeeTableColumnWidths(node.attrs.columnWidthsPt, tableLogicalColumnCount(node));
    const widths = savedWidths ?? chalkLeeAutoTableColumnWeights(node);
    return ["table", {
      "data-chalklee-table": "",
      "data-node-id": node.attrs.id,
      ...(savedWidths ? { "data-column-widths-pt": savedWidths.join(",") } : {}),
      style: tableStyle(node.attrs)
    }, ...(widths ? [["colgroup", {}, ...tableColumnPercentages(widths).map((width) => ["col", { style: `width:${width}%` }])]] : []), ["tbody", 0]];
  },
  addNodeView: () => ReactNodeViewRenderer(TableNodeView, { contentDOMElementTag: "tbody" })
});

export const ChalkLeeTableRowNode = Node.create({
  name: "tableRow",
  content: "tableCell+",
  extendNodeSchema: (extension) => extension.name === "tableRow" ? { tableRole: "row" } : {},
  addAttributes: () => ({
    id: { default: null },
    heightPt: { default: null },
    repeatAsHeader: {
      default: null,
      parseHTML: (element: HTMLElement) => element.getAttribute("data-repeat-header") === "true" ? true : null
    }
  }),
  parseHTML: () => [{ tag: "tr" }],
  renderHTML: ({ node }) => ["tr", {
    "data-node-id": node.attrs.id,
    ...(node.attrs.repeatAsHeader === true ? { "data-repeat-header": "true" } : {}),
    ...(node.attrs.heightPt == null ? {} : { "data-row-height-pt": node.attrs.heightPt }),
    style: tableRowStyle(node.attrs)
  }, 0]
});

export const ChalkLeeTableCellNode = Node.create({
  name: "tableCell",
  // Any cell blocks, but a cell created empty (new rows and columns) starts with a paragraph, not a formula.
  content: "paragraph cellBlock* | cellBlock+",
  isolating: true,
  extendNodeSchema: (extension) => extension.name === "tableCell" ? { tableRole: "cell" } : {},
  addAttributes: () => ({ id: { default: null }, colspan: { default: 1 }, rowspan: { default: 1 } }),
  parseHTML: () => [{ tag: "td" }],
  renderHTML: ({ node }) => ["td", {
    "data-node-id": node.attrs.id,
    colspan: node.attrs.colspan,
    rowspan: node.attrs.rowspan
  }, 0]
});

function tableStyle(attrs: Record<string, unknown>) {
  return attrs.widthPt == null ? undefined : `width:${attrs.widthPt}pt;max-width:100%`;
}

function tableRowStyle(attrs: Record<string, unknown>) {
  return attrs.heightPt == null ? undefined : `height:${attrs.heightPt}pt`;
}
