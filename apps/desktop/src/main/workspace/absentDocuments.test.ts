import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChalkLeeArchive } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../../renderer/src/editor/editing";
import { scanWorkspace } from "./files";
import { removeAbsentDocumentStorage, workspaceDocuments } from "./absentDocuments";

const day = 24 * 60 * 60 * 1000, start = Date.UTC(2026, 10, 8);
const hash = (digit: string) => digit.repeat(64);
let root: string;

async function chalklee(name: string, id: string, original?: string) {
  const document = createEmptyChalkLeeDocument(name);
  document.id = id;
  if (original) document.provenance = { method: "import", sources: [{ id: "original", type: "pdf", fileName: "原稿.pdf", sha256: original }] };
  await writeFile(path.join(root, name), await createChalkLeeArchive(document));
}
async function history(id: string) {
  await mkdir(path.join(root, ".chalklee", "history", id, "blobs"), { recursive: true });
  await writeFile(path.join(root, ".chalklee", "history", id, "versions.json"), "[]");
}
async function original(digest: string) {
  await mkdir(path.join(root, ".chalklee", "sources"), { recursive: true });
  await writeFile(path.join(root, ".chalklee", "sources", `${digest}.pdf`), "%PDF");
}
const sweep = async (at: number, tasks: string[] = []) => removeAbsentDocumentStorage(root, await workspaceDocuments(await scanWorkspace(root), tasks), at);
const histories = async () => (await readdir(path.join(root, ".chalklee", "history"))).filter(name => name !== "absent.json").sort();
const originals = async () => (await readdir(path.join(root, ".chalklee", "sources"))).sort();

beforeEach(async () => { root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-absent-"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("storage of documents no longer in the workspace", () => {
  it("removes a document's versions and original only after it has been gone for 60 days", async () => {
    await chalklee("期中.chalklee", "document_kept", hash("a"));
    for (const id of ["document_kept", "document_gone", "pages"]) await history(id);
    for (const digit of ["a", "b", "c"]) await original(hash(digit));

    await sweep(start, [hash("c")]);
    await sweep(start + 59 * day, [hash("c")]);
    expect(await histories()).toEqual(["document_gone", "document_kept", "pages"]);
    expect(await originals()).toHaveLength(3);

    await sweep(start + 61 * day, [hash("c")]);
    expect(await histories()).toEqual(["document_kept", "pages"]);
    // The kept document's original and a conversion task's original stay.
    expect(await originals()).toEqual([`${hash("a")}.pdf`, `${hash("c")}.pdf`]);
  });

  it("removes a kept copy at once when the same original sits beside every document made from it", async () => {
    const pdf = "%PDF-期中", digest = createHash("sha256").update(pdf).digest("hex");
    await writeFile(path.join(root, "期中.pdf"), pdf);
    await chalklee("期中.chalklee", "document_beside", digest);
    await original(digest);
    // Another document made from the same file elsewhere still needs the copy.
    await mkdir(path.join(root, "复习"));
    await chalklee("复习/期中.chalklee", "document_elsewhere", digest);
    await sweep(start);
    expect(await originals()).toEqual([`${digest}.pdf`]);
    await rm(path.join(root, "复习"), { recursive: true });
    await sweep(start + day);
    expect(await originals()).toEqual([]);
  });

  it("counts absence from when it is first noticed, not from the last version", async () => {
    await history("document_gone");
    await sweep(start + 400 * day);
    expect(await histories()).toEqual(["document_gone"]);
  });

  it("keeps the versions of a document that comes back, and starts counting again if it leaves", async () => {
    await history("document_moved");
    await sweep(start);
    await chalklee("讲义.chalklee", "document_moved");
    await sweep(start + 30 * day);
    await rm(path.join(root, "讲义.chalklee"));
    await sweep(start + 31 * day);
    await sweep(start + 80 * day);
    expect(await histories()).toEqual(["document_moved"]);
    await sweep(start + 92 * day);
    expect(await histories()).toEqual([]);
  });

  it("removes nothing while a document cannot be read or iCloud has moved one off this Mac", async () => {
    await history("document_gone");
    await sweep(start);
    await writeFile(path.join(root, "损坏.chalklee"), "not a ChalkLee");
    await sweep(start + 61 * day);
    expect(await histories()).toEqual(["document_gone"]);

    await rm(path.join(root, "损坏.chalklee"));
    await mkdir(path.join(root, "高一"));
    await writeFile(path.join(root, "高一", ".期末.chalklee.icloud"), "");
    await sweep(start + 62 * day);
    expect(await histories()).toEqual(["document_gone"]);

    await rm(path.join(root, "高一", ".期末.chalklee.icloud"));
    await sweep(start + 63 * day);
    expect(await histories()).toEqual([]);
  });
});
