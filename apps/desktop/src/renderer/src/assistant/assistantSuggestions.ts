import { isMarkdownKind } from "../../../shared/document/kinds";
import { ChartColumn, FileCheck2, FilePlus2, FolderTree, Globe, Lightbulb, ListChecks, ListPlus, Palette, PencilLine, RefreshCw, Search, ShoppingBasket, SquareDashed, Tags, TrendingUp, type LucideIcon } from "lucide-react";
import { assistantQuestionLabel, type AssistantUiContext } from "../../../shared/agent/assistant";

export interface AssistantSuggestion { icon: LucideIcon; text: string }

/** What the window knows beyond the message context, used only to pick suggestions. */
export interface AssistantSuggestionHints {
  /** Originals in the workspace that have not been converted yet. */
  convertible?: number;
  /** The open original's conversion: under way, finished with a result, or not needed because it is kept for reading. */
  sourceConversion?: "converting" | "converted" | "not-needed" | null;
  /** The open Markdown reads like a paper for students and has not been converted as it is. */
  paperNote?: boolean;
}

const LIMIT = 4;

/** Requests for the empty conversation: what the teacher is pointing at first, then the paper, the basket and the workspace. */
export function assistantSuggestions(context: AssistantUiContext, hints: AssistantSuggestionHints = {}): AssistantSuggestion[] {
  const list: AssistantSuggestion[] = [];
  const add = (icon: LucideIcon, text: string) => { if (list.length < LIMIT) list.push({ icon, text }); };
  const basket = context.basketCount;

  if (context.place === "library") {
    const library = context.questionLibrary;
    if (library?.selected) {
      const name = assistantQuestionLabel(library.selected.number);
      add(Search, `找和${name}考点相同的题目`);
      add(Lightbulb, `讲讲${name}的解题思路和易错点`);
    }
    const total = library?.total ?? 0;
    if (library?.conditions.length && total > 0) {
      if (total > 5) add(ShoppingBasket, `从这 ${total} 道题里挑 5 道难度适中的，加入选题篮`);
      add(ChartColumn, `按题型和难度统计这 ${total} 道题`);
    } else {
      add(ShoppingBasket, "从这些题里挑 5 道难度适中的，加入选题篮");
      add(Tags, "给还没打标签的题补充知识点标签");
    }
    if (basket) add(FilePlus2, `用选题篮里的 ${basket} 道题新建一份文档`);
    add(Search, "找出重复或几乎相同的题目");
    return list;
  }

  const document = context.activeDocument;
  if (document?.kind === "chalklee") {
    const question = context.selectedQuestion, pointed = context.pointedAt;
    if (question) {
      const name = question.label ? assistantQuestionLabel(question.label) : "这道题";
      add(ListPlus, `给${name}出 2 道相似题，插在原题后面`);
      add(ListChecks, `核对${name}的答案，补上分步解析`);
      add(TrendingUp, `把${name}改编得难一些，插在原题后面`);
    } else if (pointed?.kind === "box") {
      const name = pointed.label ? `“${pointed.label}”盒子` : "这个盒子";
      add(PencilLine, `精简${name}里的文字，意思不变`);
      add(Palette, `把${name}的样式改得更醒目`);
    } else if (pointed?.kind === "text") {
      add(PencilLine, "润色选中的内容，意思不变");
      add(SquareDashed, "把选中的内容放进一个盒子");
    }
    if (basket) add(ListPlus, `把选题篮里的 ${basket} 道题插到末尾`);
    // A longer paper is most often asked to fit fewer sheets.
    const pages = context.pageCount ?? 0;
    if (pages >= 3) add(Palette, `把这份压缩到 ${pages - 1} 页，内容不删`);
    add(ListChecks, "补全缺少的答案和解析，已有的先核对");
    add(Tags, "给每道题补充难度和知识点标签");
    if (pages < 3) add(Palette, "把这份排版得更清爽，并预览效果");
    add(FilePlus2, "参照这份，出一份同类型的练习");
    return list;
  }

  if (document && isMarkdownKind(document.kind)) {
    if (hints.paperNote) add(RefreshCw, "把这份转换为 ChalkLee，排好版发给学生");
    add(PencilLine, "润色这份笔记，保留原意");
    add(ListChecks, "整理这份笔记的要点");
    add(FilePlus2, "根据这份笔记写一份教学计划");
    return list;
  }
  if (document) {
    // A textbook or other reading material is drawn on, not converted.
    if (hints.sourceConversion === "not-needed") {
      add(ListChecks, "把这份资料的要点整理成一份知识清单");
      add(FilePlus2, "根据这份资料出一份巩固练习");
      return list;
    }
    if (hints.sourceConversion === "converted") add(FileCheck2, "对照原稿检查转换结果，看有没有漏题和错字");
    else if (hints.sourceConversion !== "converting") add(RefreshCw, "把这份原稿转换为可编辑的 ChalkLee");
    add(Lightbulb, "这份原稿考了哪些知识点，难度怎么样");
    add(Search, "在题库里找和这份原稿相似的题目");
    return list;
  }

  const convertible = hints.convertible ?? 0;
  if (convertible > 0) add(RefreshCw, `把工作区里还没转换的 ${convertible} 份原稿都转换为 ChalkLee`);
  if (basket) add(FilePlus2, `用选题篮里的 ${basket} 道题新建一份文档`);
  add(FolderTree, "看看工作区里有哪些资料，帮我整理归类");
  add(Search, "搜索二次函数相关的题目，加入选题篮");
  add(Globe, "上网找深圳初三英语三模试卷，要有答案");
  return list;
}
