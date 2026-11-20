import { Book, BookOpenText, ImagePlus, Minus, PanelBottom, PanelTop, SeparatorHorizontal, Sigma, SquarePen, Table2, TableOfContents } from "lucide-react";

/**
 * What the toolbar's insert menu offers, in this order.
 * A question becomes a choice or fill-in question as options or blanks are added,
 * an inline formula can stand on its own line, and typed underscores make a blank,
 * so none of these needs its own entry.
 */
export const CHALKLEE_INSERT_COMMANDS = [
  { id: "question", label: "题目", icon: SquarePen },
  { id: "question-group", label: "题组", icon: BookOpenText },
  { id: "math", label: "公式", icon: Sigma },
  { id: "image", label: "图片", icon: ImagePlus },
  { id: "table", label: "表格", icon: Table2 },
  { id: "box", label: "盒子", icon: PanelTop },
  { id: "divider", label: "分割线", icon: Minus },
  { id: "page-break", label: "分页符", icon: SeparatorHorizontal },
  // Not placed at the caret: a cover is the first page, the contents follow it, and headers and footers run on every page.
  { id: "cover", label: "封面", icon: Book },
  { id: "toc", label: "目录", icon: TableOfContents },
  { id: "header", label: "页眉", icon: PanelTop },
  { id: "footer", label: "页脚", icon: PanelBottom }
] as const;

export type ChalkLeeInsertCommand = (typeof CHALKLEE_INSERT_COMMANDS)[number];
export type ChalkLeeInsertCommandId = ChalkLeeInsertCommand["id"];

/** Belong to the paper rather than a line. */
const PAPER_COMMANDS: ReadonlySet<ChalkLeeInsertCommandId> = new Set(["cover", "toc", "header", "footer"]);

/** What the blank line's ＋ menu offers: everything that goes on that line. */
export const CHALKLEE_LINE_INSERT_COMMANDS: readonly ChalkLeeInsertCommand[] = CHALKLEE_INSERT_COMMANDS.filter(command => !PAPER_COMMANDS.has(command.id));
