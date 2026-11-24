import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChalkLeeArchive } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../../shared/document/newDocument";
import { QuestionBankService } from "./service";
import { scanWorkspace } from "../workspace/files";

const roots: string[] = [], services: QuestionBankService[] = [];
const service = () => {
  // Exercise the actual worker protocol; electron-vite supplies the bundled path in the application.
  const workerPath = fileURLToPath(new URL("./worker.ts", import.meta.url));
  const result = new QuestionBankService(() => new Worker(`require('tsx/cjs'); require(${JSON.stringify(workerPath)});`, { eval: true }), () => undefined);
  services.push(result);
  return result;
};
async function workspace(stem: string) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-question-worker-")));
  roots.push(root);
  await paper(root, stem);
  return root;
}
async function paper(root: string, stem: string) {
  const document = createEmptyChalkLeeDocument("试卷");
  document.content.content = [{ type: "question", attrs: { id: "q1", kind: "free-response", number: { mode: "auto" } }, content: [
    { type: "questionStem", attrs: { id: "stem" }, content: [{ type: "paragraph", attrs: { id: "p" }, content: [{ type: "text", text: stem }] }] }
  ] }];
  await writeFile(path.join(root, "试卷.chalklee"), await createChalkLeeArchive(document));
}
afterEach(async () => {
  await Promise.allSettled(services.splice(0).map(service => service.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("question bank background service", () => {
  it("does not start a thread for an unused service or while disposing it", async () => {
    const create = vi.fn<() => Worker>(() => { throw new Error("should stay idle"); });
    const index = new QuestionBankService(create, () => undefined);
    await index.dispose();
    expect(create).not.toHaveBeenCalled();
    await expect(index.search({ query: "函数" })).rejects.toThrow("题库服务已关闭");
  });
  it("searches, updates, propagates errors and reopens persisted basket references through a real worker", async () => {
    const root = await workspace("反比例函数的图象");
    const index = service();
    await index.open(root, (await scanWorkspace(root)).root);
    const request = { query: "函数" };
    const original = await index.search(request);
    const [question] = original.items;
    await expect(index.searchIfChanged(request, original.searchVersion!)).resolves.toBeNull();
    await index.writeBasket([{ relativePath: question.relativePath, questionId: question.questionId, contentHash: question.contentHash, addedAt: 1, insertedInto: [] }]);
    await paper(root, "等比数列的前项和");
    await index.update(path.join(root, "试卷.chalklee"));
    await index.flush();
    await expect(index.searchIfChanged(request, original.searchVersion!)).resolves.toMatchObject({ total: 0 });
    expect((await index.search({ query: "数列" })).total).toBe(1);
    await expect(index.snapshot(path.join(root, "..", "outside.chalklee"), "q1")).rejects.toThrow();
    await paper(root, "等差数列的新内容");
    await index.update(path.join(root, "试卷.chalklee"));
    await index.dispose();
    const cache = JSON.parse(await readFile(path.join(root, ".chalklee", "question-bank", "index.json"), "utf8"));
    expect(cache).toMatchObject({ version: 10, documents: [{ entries: [{ questionId: "q1", stem: "等差数列的新内容" }] }] });
    services.splice(services.indexOf(index), 1);
    const reopened = service();
    await reopened.open(root, (await scanWorkspace(root)).root);
    expect((await reopened.readBasket())[0].status).toBe("changed");
    expect((await reopened.search({ query: "数列" })).total).toBe(1);
  });

  it("keeps results isolated when a newer workspace supersedes an opening workspace", async () => {
    const first = await workspace("只在第一处的函数题目"), second = await workspace("只在第二处的数列题目");
    const index = service();
    const firstTree = (await scanWorkspace(first)).root, secondTree = (await scanWorkspace(second)).root;
    await Promise.all([index.open(first, firstTree), index.open(second, secondTree)]);
    expect((await index.search({ query: "函数" })).total).toBe(0);
    expect((await index.search({ query: "数列" })).items[0].path).toBe(path.join(second, "试卷.chalklee"));
  });
});
