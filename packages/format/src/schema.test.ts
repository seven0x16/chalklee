import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { expect, it } from "vitest";
import schema from "../schema/document.schema.json";
import { CHALKLEE_STANDARD_APPEARANCE } from "./appearance";
import { chalkLeeSchemaErrors, createChalkLeeFragmentSchema } from "./schema";

it("defines valid draft 2020-12 schemas for full documents and fragments", () => {
  const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
  expect(ajv.validateSchema(schema), ajv.errorsText()).toBe(true);
  expect(ajv.validateSchema(createChalkLeeFragmentSchema()), ajv.errorsText()).toBe(true);
});

it("keeps fragment and complete validation independent, including errors on nested nodes", () => {
  const stem = { type: "questionStem", attrs: { id: "stem" }, content: [] };
  const question = { type: "question", attrs: { id: "question", kind: "free-response", number: { mode: "auto" } }, content: [stem] };
  const date = "2026-01-01T00:00:00.000Z";
  const paper = (block: unknown) => ({
    schemaVersion: "chalklee/0.3", id: "test",
    metadata: { title: "测试", createdAt: date, updatedAt: date },
    appearance: CHALKLEE_STANDARD_APPEARANCE,
    content: { type: "doc", content: [block] }
  });
  const incomplete = paper(question);
  expect(chalkLeeSchemaErrors(incomplete, { fragment: true })).toEqual([]);
  expect(chalkLeeSchemaErrors(incomplete).join(" ")).toContain("/content/content/0/content/0/content");

  const paragraph = { type: "paragraph", attrs: { id: "paragraph" }, content: [{ type: "text", text: "题干" }] };
  const complete = paper({ ...question, content: [{ ...stem, content: [paragraph] }] });
  expect(chalkLeeSchemaErrors(complete)).toEqual([]);

  const misplacedHeading = paper({ ...question, content: [{ ...stem, content: [{ ...paragraph, type: "heading", attrs: { id: "heading", level: 1 } }] }] });
  const diagnostic = "/content/content/0/content/0/content/0: questionStem 中不能放 heading，标题请作为独立块放在题目之外";
  expect(chalkLeeSchemaErrors(misplacedHeading)).toContain(diagnostic);
  expect(chalkLeeSchemaErrors(misplacedHeading, { fragment: true })).toContain(diagnostic);
  expect(chalkLeeSchemaErrors(incomplete, { fragment: true })).toEqual([]);
});
