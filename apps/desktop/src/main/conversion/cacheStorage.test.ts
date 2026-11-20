import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureConversionStorage, conversionStorageNames, conversionTranscriptText, openConversionStorage, removeSupersededCacheFiles, removeUnusedConversionStorage, writeConversionRunRecord } from "./cacheStorage";

const day = 24 * 60 * 60 * 1000;
const cacheName = (digit: string) => digit.repeat(64);
const sessionName = "0f8fad5b-d9cb-469f-a165-70867728950e";
let root: string, outside: string;

async function folder(relative: string, ageDays: number) {
  const directory = path.join(root, ".chalklee", relative);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "content.json"), "{}");
  const time = new Date(Date.now() - ageDays * day);
  await utimes(directory, time, time);
  return directory;
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-cache-")));
  outside = await mkdtemp(path.join(tmpdir(), "chalklee-cache-outside-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("conversion cache storage", () => {
  it("removes caches and external sessions unused for 30 days, and nothing else", async () => {
    await folder(`import-cache/${cacheName("a")}`, 31);
    await folder(`import-cache/${cacheName("b")}`, 2);
    await folder(`external-imports/${sessionName}`, 45);
    await folder("import-cache/notes", 90);
    await folder("sources", 90);
    await folder("history/document", 90);
    await writeFile(path.join(outside, "kept.txt"), "outside");
    await symlink(outside, path.join(root, ".chalklee", "import-cache", cacheName("c")));

    await removeUnusedConversionStorage(root);

    expect((await readdir(path.join(root, ".chalklee", "import-cache"))).sort()).toEqual([cacheName("b"), cacheName("c"), "notes"]);
    expect(await readdir(path.join(root, ".chalklee", "external-imports"))).toEqual([]);
    expect(await readdir(path.join(root, ".chalklee", "sources"))).toEqual(["content.json"]);
    expect(await readdir(path.join(root, ".chalklee", "history", "document"))).toEqual(["content.json"]);
    expect(await readdir(outside)).toEqual(["kept.txt"]);
  });

  it("keeps a cache that a conversion has just used, even if it only read it", async () => {
    const directory = await folder(`import-cache/${cacheName("a")}`, 40);
    expect(await openConversionStorage(root, "import-cache", cacheName("a"))).toBe(directory);
    await removeUnusedConversionStorage(root);
    expect(await readdir(directory)).toEqual(["content.json"]);
  });

  it("gives a conversion starting during removal a usable folder", async () => {
    const directory = await folder(`import-cache/${cacheName("a")}`, 40);
    const [, opened] = await Promise.all([removeUnusedConversionStorage(root), openConversionStorage(root, "import-cache", cacheName("a"))]);
    expect(opened).toBe(directory);
    await writeFile(path.join(opened, "next.json"), "{}");
    expect(await readdir(opened)).toContain("next.json");
  });

  it("works in a workspace without conversion storage", async () => {
    await expect(removeUnusedConversionStorage(root)).resolves.toBeUndefined();
  });

  it("removes only the entries a newer one replaces", async () => {
    const directory = await folder(`import-cache/${cacheName("a")}`, 0);
    const names = [`document-${cacheName("1")}.json`, `document-${cacheName("2")}.json`, `proofread-${cacheName("3")}.json`, `document-${cacheName("2")}.json.next`, "reference-agent-messages.json"];
    for (const name of names) await writeFile(path.join(directory, name), "{}");
    await removeSupersededCacheFiles(path.join(directory, names[1]), /^document-[a-f0-9]{64}\.json$/);
    expect((await readdir(directory)).sort()).toEqual(["content.json", ...names.slice(1)].sort());
  });

  it("keeps the conversion record's text without the page images", () => {
    const text = conversionTranscriptText({ messages: [{ role: "user", content: [{ type: "text", text: "成品预览第1页" }, { type: "image", data: "iVBORw0KGgo".repeat(1000), mimeType: "image/png" }] }] });
    expect(text).toContain("成品预览第1页");
    expect(text).toContain("image/png");
    expect(text).not.toContain("iVBORw0KGgo");
  });

  it("keeps the records of the latest runs instead of replacing the previous run's record", async () => {
    const directory = await folder(`import-cache/${cacheName("b")}`, 0);
    for (const run of ["first", "second", "third", "fourth"]) await writeConversionRunRecord(directory, "reference-agent-messages", run, 3);
    const records = (await readdir(directory)).filter(name => name.startsWith("reference-agent-messages")).sort();
    expect(records).toEqual(["reference-agent-messages-2.json", "reference-agent-messages-3.json", "reference-agent-messages-4.json"]);
    expect(await readFile(path.join(directory, records[0]), "utf8")).toBe("second");
    expect(await readFile(path.join(directory, records[2]), "utf8")).toBe("fourth");
  });
});

describe("conversion caches kept with the app", () => {
  let app: string;
  beforeEach(async () => { app = await realpath(await mkdtemp(path.join(tmpdir(), "chalklee-app-cache-"))); configureConversionStorage(app); });
  afterEach(async () => { configureConversionStorage(undefined); await rm(app, { recursive: true, force: true }); });

  it("keeps new caches out of the workspace and carries one over from it the first time it is used", async () => {
    await folder(`import-cache/${cacheName("a")}`, 3);
    const carried = await openConversionStorage(root, "import-cache", cacheName("a"));
    expect(carried).toBe(path.join(app, "import-cache", cacheName("a")));
    expect(await readdir(carried)).toEqual(["content.json"]);
    expect(await readdir(path.join(root, ".chalklee", "import-cache"))).toEqual([]);
    expect(await openConversionStorage(root, "import-cache", cacheName("b"))).toBe(path.join(app, "import-cache", cacheName("b")));
    expect(await readdir(path.join(root, ".chalklee", "import-cache"))).toEqual([]);
  });

  it("lists and removes unused folders in both places", async () => {
    await folder(`external-imports/${sessionName}`, 45);
    const recent = "1f8fad5b-d9cb-469f-a165-70867728950e";
    await openConversionStorage(root, "external-imports", recent);
    expect(await conversionStorageNames(root, "external-imports")).toEqual([sessionName, recent]);
    await mkdir(path.join(app, "import-cache", cacheName("c")), { recursive: true });
    const old = new Date(Date.now() - 40 * day);
    await utimes(path.join(app, "import-cache", cacheName("c")), old, old);
    await removeUnusedConversionStorage(root);
    expect(await conversionStorageNames(root, "external-imports")).toEqual([recent]);
    expect(await readdir(path.join(app, "import-cache"))).toEqual([]);
  });
});
