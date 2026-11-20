import { getSchema, type JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Fragment } from "@tiptap/pm/model";
import { EditorState, Plugin, TextSelection, type Transaction } from "@tiptap/pm/state";
import { history, undo, redo } from "@tiptap/pm/history";
import { describe, expect, it } from "vitest";
import { ChalkLeeDocumentNode, ChalkLeeParagraphNode } from "./extensions/nodes";
import { chalkLeeStructuralExtensions } from "./extensions/questionNodes";
import { chalkLeeGroupAnswerColumns, chalkLeeQuestionWithSolutions, chalkLeeSolutionForQuestion, chalkLeeSolutionsForQuestion, chalkLeeSolutionTextSlice, normalizeChalkLeeGroupSolutions } from "./groupSolutions";
import { projectChalkLeeGroupSolutions, restoreChalkLeeGroupSolutions } from "./groupSolutionContent";
import { sanitizeChalkLeeEditorJson } from "./editing";
import { chalkLeeQuestionRegionTransaction, selectedChalkLeeQuestionContext, findChalkLeeQuestionContext } from "./editorContext";
import { setQuestionRegion } from "./extensions/questionCommands";

const schema = getSchema([StarterKit.configure({ document: false, paragraph: false }), ChalkLeeDocumentNode, ChalkLeeParagraphNode, ...chalkLeeStructuralExtensions]);
const region = (type: string, id: string, text = id) => schema.nodes[type].create({id}, schema.nodes.paragraph.create({id: `${id}-p`}, schema.text(text)));
const question = (id: string, label?: string, regions = ["questionAnswer", "questionAnalysis"]) => schema.nodes.question.create({id, number: label ? {mode:"fixed", label} : {mode:"auto"}}, [
  region("questionStem", `${id}-stem`), ...regions.map(type => region(type, `${id}-${type}`))
]);
const group = (id: string, children = [question("a", "1"), question("b", "（2）")]) => schema.nodes.questionGroup.create({id}, [
  region("questionMaterial", `${id}-material`), schema.nodes.subQuestionList.create({id:`${id}-list`}, children), region("questionAnswer", `${id}-answer`)
]);
const layoutPlugin = () => new Plugin({appendTransaction: (transactions, _old, state) => transactions.some(tr => tr.docChanged) ? normalizeChalkLeeGroupSolutions(state) : null});
const editingState = (node = group("g")) => EditorState.create({schema, doc:schema.nodeFromJSON(projectChalkLeeGroupSolutions(schema.nodes.doc.create(null, node).toJSON())), plugins:[history(), layoutPlugin()]});

describe("question group answer and analysis summaries", () => {
  it("copies a partial answer selection without runtime group ownership wrappers", () => {
    const state = editingState();
    const solution = chalkLeeSolutionForQuestion(state.doc,"a")!;
    const start = solution.position + 3;
    const selection = TextSelection.create(state.doc,start,start+4);
    const copied = chalkLeeSolutionTextSlice(selection.content());
    expect(copied.content.textBetween(0,copied.content.size)).toBe("a-qu");
    expect(copied.content.firstChild!.type.name).toBe("paragraph");
    expect(copied.openStart).toBe(1);
    expect(copied.openEnd).toBe(1);
    expect(JSON.stringify(copied.toJSON())).not.toContain("questionSolution");
  });
  it("does not collide with authored IDs or repeatedly rebuild a repaired summary", () => {
    const source = schema.nodes.doc.create(null, [schema.nodes.paragraph.create({id:"solution_a"}), group("g")]);
    const projected = schema.nodeFromJSON(projectChalkLeeGroupSolutions(source.toJSON()));
    expect(chalkLeeSolutionForQuestion(projected,"a")?.node.attrs.id).toBe("solution_a_2");
    const state = EditorState.create({schema,doc:projected});
    expect(normalizeChalkLeeGroupSolutions(state)).toBeNull();
  });
  it("collects both regions in child order, preserves ownership and keeps the group's own answer", () => {
    const doc = schema.nodes.doc.create(null, [question("standalone"), group("g")]);
    const original = doc.toJSON();
    const projected = schema.nodeFromJSON(projectChalkLeeGroupSolutions(original));
    const summaries = projected.lastChild!.content.content.filter(node => node.type.name === "questionSolution");
    expect(summaries.map(q => [q.attrs.questionId, q.attrs.label, q.attrs.heading])).toEqual([
      ["g", "", "答案"], ["a", "1)", ""], ["b", "2)", ""], ["a", "1)", "解析"], ["b", "2)", ""]
    ]);
    expect(summaries.flatMap(q => q.content.content.map(r => r.attrs.id))).toEqual(["g-answer", "a-questionAnswer", "b-questionAnswer", "a-questionAnalysis", "b-questionAnalysis"]);
    expect(chalkLeeSolutionForQuestion(projected, "a")?.node).toBe(summaries[1]);
    expect(sanitizeChalkLeeEditorJson(projected.toJSON())).toEqual(sanitizeChalkLeeEditorJson(original));
    expect(schema.nodeFromJSON(restoreChalkLeeGroupSolutions(projected.toJSON())).eq(doc)).toBe(true);
    expect(doc.toJSON()).toEqual(original);
    expect(projectChalkLeeGroupSolutions(projected.toJSON())).toEqual(projected.toJSON());
  });

  it.each(["参考答案", ""])("uses the region's styled label %j for a group heading", label => {
    const source: JSONContent = group("g").toJSON();
    const answer = source.content!.find(node => node.type === "questionAnswer")!;
    answer.attrs = { ...answer.attrs, runtimeLabel: label };
    const projected = projectChalkLeeGroupSolutions(source);
    const summaries = projected.content!.filter(node => node.type === "questionSolution");
    expect(summaries.filter(node => node.attrs?.regionType === "questionAnswer").map(node => node.attrs?.heading))
      .toEqual([label, "", ""]);
    expect(restoreChalkLeeGroupSolutions(projected)).toEqual(source);
    expect(projectChalkLeeGroupSolutions(projected)).toEqual(projected);
  });

  it("skips missing regions without numbering gaps incorrectly or mixing groups", () => {
    const doc = schema.nodes.doc.create(null, [group("g", [question("empty", undefined, []), question("answer", undefined, ["questionAnswer"]), question("analysis", "B", ["questionAnalysis"])]), group("other", [question("other-child")])]);
    const projected = schema.nodeFromJSON(projectChalkLeeGroupSolutions(doc.toJSON()));
    const summaries = projected.firstChild!.content.content.filter(node => node.type.name === "questionSolution");
    expect(summaries.map(q => q.attrs.label)).toEqual(["", "2)", "B)"]);
    expect(summaries.map(q => q.attrs.heading)).toEqual(["答案", "", "解析"]);
    expect(summaries.map(q => q.childCount)).toEqual([1, 1, 1]);
    expect(chalkLeeSolutionForQuestion(projected, "other-child")?.node.attrs.questionId).toBe("other-child");
    expect(chalkLeeSolutionForQuestion(projected, "empty")).toBeNull();
  });

  it("shares one analysis heading between the group's introduction and each child's explanation", () => {
    const source = group("g"), introduction = region("questionAnalysis", "g-analysis", "材料导语");
    const original = source.copy(source.content.append(Fragment.from(introduction)));
    let state = editingState(original);
    const projected = state.doc;
    const summaries = projected.firstChild!.content.content.filter(node => node.type.name === "questionSolution");
    expect(summaries.filter(node => node.attrs.heading === "解析")).toHaveLength(1);
    expect(summaries.filter(node => node.attrs.regionType === "questionAnalysis").map(node => [node.attrs.questionId, node.attrs.label, node.attrs.heading]))
      .toEqual([["g", "", "解析"], ["a", "1)", ""], ["b", "2)", ""]]);
    expect(chalkLeeQuestionWithSolutions(projected, projected.firstChild!).eq(original)).toBe(true);
    expect(schema.nodeFromJSON(restoreChalkLeeGroupSolutions(projected.toJSON())).firstChild!.eq(original)).toBe(true);
    state = state.applyTransaction(chalkLeeQuestionRegionTransaction(state, "g", "questionAnalysis")!).state;
    expect(selectedChalkLeeQuestionContext(state)).toMatchObject({id:"g", region:"questionAnalysis"});
    state = state.applyTransaction(state.tr.insertText("补充")).state;
    expect(chalkLeeSolutionForQuestion(state.doc, "g", "questionAnalysis")?.node.textContent).toBe("补充材料导语");
    expect(chalkLeeSolutionForQuestion(state.doc, "a", "questionAnalysis")?.node.textContent).toBe("a-questionAnalysis");
    undo(state, tr => {state = state.applyTransaction(tr).state});
    expect(state.doc.eq(projected)).toBe(true);
    redo(state, tr => {state = state.applyTransaction(tr).state});
    expect(chalkLeeSolutionForQuestion(state.doc, "g", "questionAnalysis")?.node.textContent).toBe("补充材料导语");
  });

  it("adds and removes common solution regions without disturbing the children's answers", () => {
    let state = editingState();
    const original = state.doc;
    state = state.applyTransaction(chalkLeeQuestionRegionTransaction(state, "g", "questionAnalysis")!).state;
    expect(() => state.doc.check()).not.toThrow();
    expect(selectedChalkLeeQuestionContext(state)).toMatchObject({id:"g", region:"questionAnalysis"});
    expect(chalkLeeSolutionsForQuestion(state.doc, "g")).toHaveLength(2);
    undo(state, tr => {state = state.applyTransaction(tr).state});
    expect(state.doc.eq(original)).toBe(true);
    const editor = { get state() { return state; }, schema, view: { dispatch: (tr: Transaction) => { state = state.applyTransaction(tr).state; } } } as unknown as Editor;
    const context = findChalkLeeQuestionContext(state.doc, "g")!;
    setQuestionRegion(editor, context.position, "questionAnswer", false);
    expect(chalkLeeSolutionForQuestion(state.doc, "g", "questionAnswer")).toBeNull();
    expect(chalkLeeSolutionForQuestion(state.doc, "a", "questionAnswer")?.node.textContent).toBe("a-questionAnswer");
    setQuestionRegion(editor, context.position, "questionAnswer", true);
    expect(() => state.doc.check()).not.toThrow();
    expect(chalkLeeSolutionForQuestion(state.doc, "g", "questionAnswer")?.node.textContent).toBe("");
    expect(chalkLeeSolutionForQuestion(state.doc, "b", "questionAnalysis")?.node.textContent).toBe("b-questionAnalysis");
  });

  it("keeps edits, added regions and undo attached to the original subquestion", () => {
    let state = editingState(group("g", [question("a", "1", ["questionAnswer"])]));
    const original = state.doc;
    state = state.applyTransaction(chalkLeeQuestionRegionTransaction(state, "a", "questionAnalysis")!).state;
    state = state.applyTransaction(state.tr.insertText("补充解析")).state;
    expect(selectedChalkLeeQuestionContext(state)).toMatchObject({id:"a", region:"questionAnalysis"});
    expect(chalkLeeSolutionsForQuestion(state.doc, "a")).toHaveLength(2);
    expect(chalkLeeSolutionForQuestion(state.doc,"a","questionAnalysis")?.node.textContent).toBe("补充解析");
    undo(state, tr => {state = state.applyTransaction(tr).state});
    undo(state, tr => {state = state.applyTransaction(tr).state});
    expect(state.doc.eq(original)).toBe(true);
    redo(state, tr => {state = state.applyTransaction(tr).state});
    redo(state, tr => {state = state.applyTransaction(tr).state});
    expect(chalkLeeSolutionsForQuestion(state.doc, "a")).toHaveLength(2);
  });

  it("lays out newly inserted answers without losing their caret and undoes creation together with layout", () => {
    let state = editingState(group("g", [question("a", "1", [])]));
    const original = state.doc;
    state = state.applyTransaction(chalkLeeQuestionRegionTransaction(state, "a", "questionAnswer")!).state;
    expect(selectedChalkLeeQuestionContext(state)).toMatchObject({id:"a", region:"questionAnswer"});
    state = state.applyTransaction(state.tr.insertText("新答案")).state;
    expect(chalkLeeSolutionForQuestion(state.doc, "a")?.node.textContent).toBe("新答案");
    undo(state, tr => {state = state.applyTransaction(tr).state});
    expect(chalkLeeSolutionForQuestion(state.doc, "a")?.node.textContent).toBe("");
    undo(state, tr => {state = state.applyTransaction(tr).state});
    expect(state.doc.eq(original)).toBe(true);
    redo(state, tr => {state = state.applyTransaction(tr).state});
    redo(state, tr => {state = state.applyTransaction(tr).state});
    expect(chalkLeeSolutionForQuestion(state.doc, "a")?.node.textContent).toBe("新答案");
    expect(normalizeChalkLeeGroupSolutions(state)).toBeNull();
  });

  it("updates summary order when children move and removes only a deleted child's solution", () => {
    let state = editingState();
    const a = findChalkLeeQuestionContext(state.doc, "a")!, b = findChalkLeeQuestionContext(state.doc, "b")!;
    state = state.applyTransaction(state.tr.replaceWith(a.position, b.position + b.node.nodeSize, [b.node, a.node])).state;
    expect(state.doc.firstChild!.content.content.filter(n=>n.type.name==="questionSolution").map(n=>n.attrs.questionId)).toEqual(["g","b","a","b","a"]);
    const moved = findChalkLeeQuestionContext(state.doc, "a")!;
    state = state.applyTransaction(state.tr.delete(moved.position, moved.position + moved.node.nodeSize)).state;
    expect(chalkLeeSolutionForQuestion(state.doc,"a")).toBeNull();
    expect(chalkLeeSolutionForQuestion(state.doc,"b")?.node.textContent).toContain("b-questionAnswer");
    undo(state,tr=>{state=state.applyTransaction(tr).state});
    expect(chalkLeeSolutionForQuestion(state.doc,"a")?.node.textContent).toContain("a-questionAnswer");
  });

  it("preserves a saved answer when a fresh answer region is authored from the stem", () => {
    let state = editingState();
    const a = findChalkLeeQuestionContext(state.doc,"a")!;
    state = state.applyTransaction(state.tr.insert(a.position+a.node.nodeSize-1, region("questionAnswer","new-answer","补充"))).state;
    const solution = chalkLeeSolutionForQuestion(state.doc,"a")!;
    expect(solution.node.firstChild!.attrs.id).toBe("a-questionAnswer");
    expect(solution.node.firstChild!.textContent).toBe("a-questionAnswer补充");
    expect(chalkLeeQuestionWithSolutions(state.doc, findChalkLeeQuestionContext(state.doc,"a")!.node).lastChild!.type.name).toBe("questionAnalysis");
  });

  it("keeps existing analysis when an analysis marker adds content from the answer", () => {
    let state = editingState();
    const answer = chalkLeeSolutionForQuestion(state.doc,"a","questionAnswer")!;
    state = state.applyTransaction(state.tr.insert(answer.position+answer.node.nodeSize-1,region("questionAnalysis","new-analysis","补充解析"))).state;
    expect(chalkLeeSolutionForQuestion(state.doc,"a","questionAnalysis")?.node.textContent).toBe("a-questionAnalysis补充解析");
    expect(chalkLeeQuestionWithSolutions(state.doc,findChalkLeeQuestionContext(state.doc,"a")!.node).childCount).toBe(3);
  });

  it("keeps existing answers when an answer marker adds content from analysis", () => {
    let state = editingState();
    const analysis = chalkLeeSolutionForQuestion(state.doc,"a","questionAnalysis")!;
    state = state.applyTransaction(state.tr.insert(analysis.position+1,region("questionAnswer","new-answer","补充答案"))).state;
    expect(chalkLeeSolutionForQuestion(state.doc,"a","questionAnswer")?.node.textContent).toBe("a-questionAnswer补充答案");
    expect(chalkLeeSolutionForQuestion(state.doc,"a","questionAnalysis")?.node.textContent).toBe("a-questionAnalysis");
  });
  it("lays short subquestion answers side by side and keeps longer ones one per line", () => {
    const answered = (answers: string[], extra: string[] = []) => {
      const children = answers.map((text, index) => schema.nodes.question.create({id:`q${index}`, number:{mode:"auto"}}, [region("questionStem", `q${index}-stem`),
        schema.nodes.questionAnswer.create({id:`q${index}-answer`}, [text, ...(index === 0 ? extra : [])].map((line, part) => schema.nodes.paragraph.create({id:`q${index}-a${part}`}, schema.text(line))))]));
      const node = schema.nodes.questionGroup.create({id:"g"}, [region("questionMaterial", "g-material"), schema.nodes.subQuestionList.create({id:"g-list"}, children)]);
      return chalkLeeGroupAnswerColumns(editingState(node).doc.firstChild!);
    };
    expect(answered(["D", "B", "AC"])).toBe(5);
    expect(answered(["village", "himself", "村庄"])).toBe(3);
    expect(answered(["D", "Minsky wanted to teach poor children how to swim"])).toBe(0);
    expect(answered(["D", "B"], ["第二段"])).toBe(0);
    expect(answered(["D"])).toBe(0);
  });
});
