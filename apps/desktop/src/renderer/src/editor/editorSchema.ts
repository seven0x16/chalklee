import { ChalkLeeImagePairsExtension } from "./imagePairs";
import { ChalkLeeGroupSolutionsExtension } from "./groupSolutions";
import { Extension, Mark } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { chalkLeeToggleBold } from "./boldToggle";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import { ChalkLeeBlankNode, ChalkLeeBlockMathNode, ChalkLeeDividerNode, ChalkLeeDocumentNode, ChalkLeeGraphicNode, ChalkLeeHeadingNode, ChalkLeeImageNode, ChalkLeeInlineImageNode, ChalkLeeInlineMathNode, ChalkLeePageBreakNode, ChalkLeeAnswerLinesNode, ChalkLeeAnswerLineNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { ChalkLeePaginationGapsExtension } from "./extensions/pageGaps";
import { ChalkLeeFrontSpacerExtension } from "./extensions/frontSpacer";
import { ChalkLeeOptionAuthoringExtension } from "./extensions/optionAuthoring";
import { ChalkLeeQuestionRegionAuthoringExtension } from "./extensions/regionAuthoring";
import { ChalkLeeEmptyRegionExtension, ChalkLeeQuestionOutsideKeyboardExtension, ChalkLeeRegionStyleExtension, ChalkLeeStableIdExtension, chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { ChalkLeeTableCellNode, ChalkLeeTableNode, ChalkLeeTableRowNode } from "./extensions/tableNodes";
import { ChalkLeeTableKeyboardExtension } from "./extensions/tableCommands";
import { ChalkLeeBoxKeyboardExtension, ChalkLeeBoxNode, ChalkLeeBoxStyleExtension } from "./extensions/boxNodes";
import { ChalkLeeBlankTypingExtension } from "./blankTyping";
import { ChalkLeeAnswerLineKeysExtension } from "./answerLineKeys";
import { ChalkLeeQuestionFieldKeyboardExtension, ChalkLeeQuestionFieldSelectAllExtension } from "./questionFieldKeyboard";
import { ChalkLeeFindReplaceExtension } from "./findReplace";
import { ChalkLeeSearchHighlightExtension } from "./searchHighlight";
import { ChalkLeeReviewMarkerExtension } from "./reviewMarkers";
import { ChalkLeeAutoNumberExtension } from "./autoNumbers";
import { ChalkLeeFixedNumberRunsExtension } from "./fixedNumberRuns";

const ChalkLeeTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      fontFamily: { default: null },
      fontSizePt: { default: null },
      color: { default: null },
      backgroundColor: { default: null },
      // "normal": not bold where the text would be by default, as in a heading.
      fontWeight: { default: null, parseHTML: element => /^(normal|400)$/.test(element.style.fontWeight) ? "normal" : null }
    };
  },
  renderHTML({ HTMLAttributes }) {
    const styles = [
      HTMLAttributes.fontFamily ? `font-family:${HTMLAttributes.fontFamily}` : "",
      HTMLAttributes.fontSizePt ? `font-size:${HTMLAttributes.fontSizePt}pt` : "",
      HTMLAttributes.color ? `color:${HTMLAttributes.color}` : "",
      HTMLAttributes.backgroundColor ? `background-color:${HTMLAttributes.backgroundColor}` : "",
      HTMLAttributes.fontWeight === "normal" ? "font-weight:normal" : ""
    ].filter(Boolean).join(";");
    return ["span", styles ? { style: styles } : {}, 0];
  }
});

/** ⌘B toggles bold by what the teacher sees, so a heading, bold by default, can be made normal too. */
const ChalkLeeBoldShortcut = Extension.create({
  name: "chalkLeeBoldShortcut",
  // Ahead of the bold mark's own shortcut.
  priority: 1000,
  addKeyboardShortcuts() {
    const toggle = () => chalkLeeToggleBold(this.editor.state, this.editor.view.dispatch);
    return { "Mod-b": toggle, "Mod-B": toggle };
  }
});

const ChalkLeeLink = Mark.create({
  name: "link",
  inclusive: false,
  addAttributes: () => ({ href: { default: "" }, title: { default: null } }),
  parseHTML: () => [{ tag: "a[href]" }],
  renderHTML: ({ HTMLAttributes }) => ["a", { href: HTMLAttributes.href, title: HTMLAttributes.title, rel: "noopener noreferrer" }, 0]
});

export const chalkLeeExtensions = [
  StarterKit.configure({
    document: false,
    paragraph: false,
    heading: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    codeBlock: false,
    code: false,
    horizontalRule: false,
    link: false,
    trailingNode: false
  }),
  ChalkLeeBoldShortcut,
  ChalkLeeDocumentNode,
  ChalkLeeParagraphNode,
  ChalkLeeHeadingNode,
  ChalkLeeImageNode,
  ChalkLeeInlineImageNode,
  ChalkLeeGraphicNode,
  ChalkLeeBlockMathNode,
  ChalkLeeInlineMathNode,
  ChalkLeeBlankNode,
  ChalkLeeBlankTypingExtension,
  ChalkLeePageBreakNode,
  ChalkLeeDividerNode,
  ChalkLeeAnswerLinesNode,
  ChalkLeeAnswerLineNode,
  ChalkLeeAnswerLineKeysExtension,
  ChalkLeeTableNode,
  ChalkLeeTableRowNode,
  ChalkLeeTableCellNode,
  ChalkLeeBoxNode,
  ChalkLeeBoxStyleExtension,
  ChalkLeeBoxKeyboardExtension,
  ...chalkLeeStructuralExtensions,
  ChalkLeeStableIdExtension,
  ChalkLeeRegionStyleExtension,
  ChalkLeeEmptyRegionExtension,
  ChalkLeeImagePairsExtension,
  ChalkLeeGroupSolutionsExtension,
  ChalkLeeOptionAuthoringExtension,
  ChalkLeeQuestionRegionAuthoringExtension,
  ChalkLeeQuestionOutsideKeyboardExtension,
  ChalkLeeTableKeyboardExtension,
  ChalkLeeQuestionFieldKeyboardExtension,
  ChalkLeeQuestionFieldSelectAllExtension,
  ChalkLeeFindReplaceExtension,
  ChalkLeePaginationGapsExtension,
  ChalkLeeFrontSpacerExtension,
  ChalkLeeSearchHighlightExtension,
  ChalkLeeReviewMarkerExtension,
  ChalkLeeAutoNumberExtension,
  ChalkLeeFixedNumberRunsExtension,
  ChalkLeeTextStyle,
  Superscript,
  Subscript,
  ChalkLeeLink
];
