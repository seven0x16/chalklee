import { describe, expect, it, vi } from "vitest";
vi.mock("./model", () => ({ runImportAgent: vi.fn() }));
import { runImportAgent } from "./model";
import { planReferenceFragments, referencePlanRanges, repairReferenceFragments, type PlanEntry } from "./referencePlan";

const paper = (count: number, headings: number[] = [], numbered: Record<number, string> = {}): PlanEntry[] =>
  Array.from({ length: count }, (_, index) => ({ ref: `s${index}`, text: headings.includes(index) ? "二、填空题" : `段落${index}`, role: headings.includes(index) ? "heading" : "body", questionNumber: numbered[index] }));

describe("reference plan parts", () => {
  it("organizes a short paper in one reply", () => {
    expect(referencePlanRanges(paper(120))).toEqual([{ from: 0, to: 120 }]);
  });

  it("cuts a long paper where a section starts, covering every paragraph once", () => {
    const ranges = referencePlanRanges(paper(330, [95, 210]));
    expect(ranges).toEqual([{ from: 0, to: 95 }, { from: 95, to: 210 }, { from: 210, to: 330 }]);
  });

  it("cuts at the start of a printed question when no section starts nearby, not inside one", () => {
    const numbers: Record<number, string> = {};
    for (let index = 0; index < 240; index++) numbers[index] = String(Math.floor(index / 7) + 1);
    const ranges = referencePlanRanges(paper(240, [], numbers));
    expect(ranges).toHaveLength(2);
    expect(ranges[1].from % 7).toBe(0);
    expect(ranges[0].to).toBe(ranges[1].from);
  });

  it("does not ask again or in halves when the service itself fails", async () => {
    vi.mocked(runImportAgent).mockReset().mockRejectedValue(new Error('402: {"message":"Insufficient Balance"}'));
    const plan = await planReferenceFragments({ entries: paper(100, [48]), source: "原文", sourceName: "试卷", systemPrompt: "", credentials: { baseUrl: "", model: "m", apiKey: "k" }, signal: new AbortController().signal });
    expect(runImportAgent).toHaveBeenCalledTimes(1);
    expect(plan.failures).toHaveLength(1);
    expect(plan.fragments).toEqual([]);
  });

  it("gives half the paragraphs to each of two replies when one runs past its length, without asking the same again", async () => {
    const entries = paper(100, [48]);
    const scopes: string[] = [];
    vi.mocked(runImportAgent).mockImplementation(async (credentials, prompt) => {
      expect(credentials.maxOutputTokens).toBeLessThanOrEqual(1500 + 100 * 60);
      const scope = prompt.slice(prompt.lastIndexOf("</source>"));
      scopes.push(scope);
      if (scope.includes("整理全部")) throw new Error("这一部分的内容超过模型输出长度，请缩小文档分段后重试。");
      const [from, to] = [...scope.matchAll(/\[s(\d+)\]/g)].map(match => Number(match[1]));
      return "```json\n" + JSON.stringify({ fragments: [{ key: "part", blocks: Array.from({ length: to - from + 1 }, (_, index) => ({ ref: `s${from + index}` })) }] }) + "\n```";
    });
    const plan = await planReferenceFragments({ entries, source: "原文", sourceName: "试卷", systemPrompt: "", credentials: { baseUrl: "", model: "m", apiKey: "k" }, signal: new AbortController().signal });
    expect(scopes).toHaveLength(3);
    expect(plan.failures).toEqual([]);
    expect(plan.ranges).toEqual([{ from: 0, to: 48 }, { from: 48, to: 100 }]);
    expect(plan.fragments.map(fragment => [fragment.key, fragment.part])).toEqual([["part", 0], ["part-2", 1]]);
    expect(plan.fragments.flatMap(fragment => fragment.blocks)).toHaveLength(100);
  });
});

describe("reference plan repair", () => {
  it("repairs many refused fragments in batches side by side, each with its own fragments only", async () => {
    const refused = Array.from({ length: 13 }, (_, index) => ({ fragment: { key: `passage_${index}`, blocks: Array.from({ length: 20 }, (_, ref) => ({ ref: `s${index * 20 + ref}` })) }, error: "原因" }));
    vi.mocked(runImportAgent).mockReset().mockImplementation(async (_credentials, prompt) => {
      const keys = [...String(prompt).matchAll(/"key":"(passage_\d+)"/g)].map(match => match[1]);
      return JSON.stringify({ fragments: keys.map(key => ({ key, blocks: [{ ref: "s0" }] })) });
    });
    const fragments = await repairReferenceFragments({ entries: paper(260), source: "原文", sourceName: "完形专项", systemPrompt: "", accepted: [], refused, missing: [],
      credentials: { baseUrl: "", model: "m", apiKey: "k" }, signal: new AbortController().signal, outputs: [] });
    expect(vi.mocked(runImportAgent).mock.calls.length).toBe(3);
    expect(fragments.map(fragment => fragment.key).sort()).toEqual(refused.map(item => item.fragment.key).sort());
  });
});
