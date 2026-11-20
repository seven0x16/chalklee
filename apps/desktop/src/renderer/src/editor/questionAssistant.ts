import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { createContext, useContext } from "react";
import type { AssistantSelection } from "../../../shared/agent/assistant";

/** One-click ChalkLee AI requests offered on a question of an open paper. */
export type QuestionAssistantAction = "similar" | "easier" | "harder" | "solution" | "answer" | "analysis";

/** The teacher's own words, as they appear in the conversation. */
export const QUESTION_ASSISTANT_PROMPTS: Record<QuestionAssistantAction, string> = {
  similar: "给这道题出 2 道相似题，难度相当，插在原题后面",
  easier: "降低这道题的难度，直接改写原题，答案和解析一起改",
  harder: "提高这道题的难度，直接改写原题，答案和解析一起改",
  solution: "给这道题写答案与解析，已有的先核对",
  answer: "给这道题写答案，不用写解析",
  analysis: "给这道题写解析，已有答案的先核对"
};

export interface QuestionAssistantRequest {
  filePath: string;
  question: { id: string; label: string | null };
  action: QuestionAssistantAction;
}

/** Recognizing the questions in a picture on the paper, such as a pasted screenshot. */
export const IMAGE_ASSISTANT_PROMPT = "把这张图中的题目转成可编辑的题目，替换这张图";

export interface ImageAssistantRequest {
  filePath: string;
  /** The picture as it is on the paper (after any crop), sent along as the message's picture. */
  image: File;
  /** Points at the picture, so the reply replaces it where it stands. */
  selection: AssistantSelection;
}

export type PaperAssistantRequest = QuestionAssistantRequest | ImageAssistantRequest;

/** Sends a request to ChalkLee AI about a question or picture (absent where the assistant is unavailable). */
export const QuestionAssistantContext = createContext<((request: PaperAssistantRequest) => void) | null>(null);

/** One paper's binding: the node view knows the question, the paper knows its file. */
export const ChalkLeeQuestionAssistantBindingContext = createContext<((question: QuestionAssistantRequest["question"], action: QuestionAssistantAction) => void) | null>(null);
export const useChalkLeeQuestionAssistant = () => useContext(ChalkLeeQuestionAssistantBindingContext);

/** One paper's binding for its pictures, by image id. */
export const ChalkLeeImageAssistantBindingContext = createContext<((imageId: string) => void) | null>(null);
export const useChalkLeeImageAssistant = () => useContext(ChalkLeeImageAssistantBindingContext);

/**
 * A picture whose questions can be recognized: one on its own line in the body or in a box. Pictures in a
 * question are usually its figures, and those in a line of text or a table cell are not a block to replace.
 */
export function chalkLeeRecognizableImage(doc: ProseMirrorNode, imageId: string) {
  let found: { position: number; node: ProseMirrorNode; box: ProseMirrorNode | null } | null = null;
  doc.descendants((node, position) => {
    if (found) return false;
    if (node.type.name !== "image" || node.attrs.id !== imageId) return true;
    const $position = doc.resolve(position);
    let box: ProseMirrorNode | null = null;
    for (let depth = $position.depth; depth > 0; depth--) {
      const parent = $position.node(depth);
      if (parent.type.name !== "box") return false;
      box = parent;
    }
    found = { position, node, box };
    return false;
  });
  return found as { position: number; node: ProseMirrorNode; box: ProseMirrorNode | null } | null;
}
