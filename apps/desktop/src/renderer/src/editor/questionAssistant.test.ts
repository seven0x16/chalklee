import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeImageNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { ChalkLeeBoxNode } from "./extensions/boxNodes";
import { chalkLeeRecognizableImage, QUESTION_ASSISTANT_PROMPTS, questionAssistantUsesDraft } from "./questionAssistant";

const schema = getSchema([
  StarterKit.configure({ document: false, paragraph: false }),
  ChalkLeeDocumentNode, ChalkLeeParagraphNode, ChalkLeeImageNode, ChalkLeeBoxNode, ...chalkLeeStructuralExtensions
]);
const image = (id: string) => schema.nodes.image.create({ id, src: "data:image/png;base64,AA==" });
const doc = schema.nodes.doc.create({}, [
  image("body"),
  schema.nodes.box.create({ id: "box", label: "例题" }, [image("boxed")]),
  schema.nodes.question.create({ id: "q", kind: "free-response" }, schema.nodes.questionStem.create({ id: "stem" }, [
    schema.nodes.paragraph.create({ id: "stem_p" }, schema.text("如图")), image("figure")
  ]))
]);

describe("pictures whose questions ChalkLee AI can recognize", () => {
  it("offers pictures in the body and in boxes, with the box they are in", () => {
    expect(chalkLeeRecognizableImage(doc, "body")).toMatchObject({ box: null });
    expect(chalkLeeRecognizableImage(doc, "boxed")?.box?.attrs.id).toBe("box");
  });

  it("leaves a question's own figures alone", () => {
    expect(chalkLeeRecognizableImage(doc, "figure")).toBeNull();
    expect(chalkLeeRecognizableImage(doc, "missing")).toBeNull();
  });
});

describe("question six-dot ChalkLee AI actions", () => {
  it("opens similar-question generation as an editable 1-question draft and keeps direct actions immediate", () => {
    expect(QUESTION_ASSISTANT_PROMPTS.similar).toBe("给这道题出 1 道相似题，难度相当，插在原题后面");
    expect(questionAssistantUsesDraft("similar")).toBe(true);
    for (const action of ["easier", "harder", "solution", "answer", "analysis"] as const) {
      expect(questionAssistantUsesDraft(action)).toBe(false);
    }
  });
});
