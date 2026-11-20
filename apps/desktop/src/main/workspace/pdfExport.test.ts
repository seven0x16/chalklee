import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChalkLeeArchive } from "@chalklee/format";
import { createEmptyChalkLeeDocument } from "../../renderer/src/editor/editing";
import { assertNotChalkLeeOriginal, availableExportPath, availablePdfExportPath, safeExportName } from "./pdfExport";

let root: string;
beforeEach(async () => { root = await realpath(await mkdtemp(path.join(os.tmpdir(), "chalklee-pdf-export-"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const digest = (content: string) => createHash("sha256").update(content).digest("hex");
async function converted(name: string, originals: string[], coverage?: "partial") {
  const document = createEmptyChalkLeeDocument(name);
  document.provenance = { method: "import", sources: originals.map((content, index) => ({ id: `source-${index}`, type: "pdf", fileName: `原稿${index}.pdf`, sha256: digest(content), ...(coverage ? { coverage } : {}) })) };
  const filePath = path.join(root, `${name}.chalklee`);
  await writeFile(filePath, await createChalkLeeArchive(document));
  return filePath;
}

describe("PDF export destinations", () => {
  it("numbers Word exports and protects renamed Word originals by content", async () => {
    const original = path.join(root, "改名的原稿.docx");
    await writeFile(original, "original Word bytes");
    const document = await converted("试卷", ["original Word bytes"]);
    await expect(assertNotChalkLeeOriginal(document, original)).rejects.toThrow("是这份 ChalkLee 的原稿");
    expect(await readFile(original, "utf8")).toBe("original Word bytes");
    await writeFile(path.join(root, "试卷.docx"), "previous export");
    expect(await availableExportPath(root, "试卷.docx", "docx")).toBe(path.join(root, "试卷（2）.docx"));
    expect(safeExportName('../试卷:一.docx', "docx")).toBe('..-试卷-一（导出）.docx');
  });
  it("suggests the plain name when it is free and numbers it beside existing files", async () => {
    expect(await availablePdfExportPath(root, "期中.pdf")).toBe(path.join(root, "期中.pdf"));
    await writeFile(path.join(root, "期中.pdf"), "original");
    await writeFile(path.join(root, "期中（2）.pdf"), "earlier export");
    expect(await availablePdfExportPath(root, "期中.pdf")).toBe(path.join(root, "期中（3）.pdf"));
  });

  it("refuses to replace any original of this ChalkLee and leaves it unchanged", async () => {
    await writeFile(path.join(root, "期中.pdf"), "paper");
    await writeFile(path.join(root, "改名的答案.pdf"), "answers");
    const document = await converted("期中", ["paper", "answers"]);
    for (const name of ["期中.pdf", "改名的答案.pdf"]) {
      await expect(assertNotChalkLeeOriginal(document, path.join(root, name))).rejects.toThrow(`“${name}”是这份 ChalkLee 的原稿`);
    }
    expect(await readFile(path.join(root, "期中.pdf"), "utf8")).toBe("paper");
  });

  it("refuses an original another ChalkLee in that folder hides, but not one it only quotes", async () => {
    await writeFile(path.join(root, "期中.pdf"), "paper");
    await writeFile(path.join(root, "节选.pdf"), "excerpt");
    await converted("期中", ["paper"]);
    await converted("讲评", ["excerpt"], "partial");
    const document = await converted("复习", []);
    await expect(assertNotChalkLeeOriginal(document, path.join(root, "期中.pdf"))).rejects.toThrow("“期中.pdf”是《期中》的原稿");
    expect(await readFile(path.join(root, "期中.pdf"), "utf8")).toBe("paper");
    await expect(assertNotChalkLeeOriginal(document, path.join(root, "节选.pdf"))).resolves.toBeUndefined();
  });

  it("allows new files, earlier exports and folders that only share a name", async () => {
    await writeFile(path.join(root, "期中.pdf"), "earlier export");
    await mkdir(path.join(root, "目录.pdf"));
    const document = await converted("期中", ["paper"]);
    for (const name of ["新导出.pdf", "期中.pdf", "目录.pdf"]) {
      await expect(assertNotChalkLeeOriginal(document, path.join(root, name))).resolves.toBeUndefined();
    }
    await writeFile(path.join(root, "坏文档.chalklee"), "damaged");
    await expect(assertNotChalkLeeOriginal(path.join(root, "坏文档.chalklee"), path.join(root, "期中.pdf"))).resolves.toBeUndefined();
  });
});
