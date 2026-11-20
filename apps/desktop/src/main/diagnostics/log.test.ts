import { mkdtemp, readdir, readFile, rm, utimes, writeFile, mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOG_FILE, LogFile, OLD_LOG_FILE, redactLogText, removeOldCrashDumps } from "./log";

const DAY = 24 * 60 * 60 * 1000;
const folders: string[] = [];
const folder = async () => { const created = await mkdtemp(path.join(os.tmpdir(), "chalklee-log-")); folders.push(created); return created; };
afterEach(async () => { await Promise.all(folders.splice(0).map(item => rm(item, { recursive: true, force: true }))); });

describe("redactLogText", () => {
  it("hides keys and tokens a service echoes back", () => {
    const text = redactLogText([
      "401 Incorrect API key provided: sk-proj-abcdefghijklmnop",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      "GET https://example.com/v1/models?key=AIzaSyExample123&alt=json",
      '{"api_key":"secret-value-123","model":"m"}',
      "x-api-key: abcdef123456"
    ].join("\n"));
    expect(text).not.toMatch(/abcdefghijklmnop|abcdefghijklmnopqrstuvwxyz|AIzaSyExample123|secret-value-123|abcdef123456/);
    expect(text).toContain("Bearer ***");
    expect(text).toContain("?key=***&alt=json");
    expect(text).toContain('"model":"m"');
  });

  it("writes the home folder as ~ without touching folders that only share its start", () => {
    expect(redactLogText("open /Users/li/Documents/a.pdf and /Users/lisa/b.pdf", "/Users/li")).toBe("open ~/Documents/a.pdf and /Users/lisa/b.pdf");
    expect(redactLogText("C:\\Users\\li\\a.pdf C:/Users/li/b.pdf 'C:\\\\Users\\\\li\\\\c.pdf'", "C:\\Users\\li")).toBe("~\\a.pdf ~/b.pdf '~\\\\c.pdf'");
  });
});

describe("LogFile", () => {
  it("keeps the current and one older file under the size limit", async () => {
    const directory = await folder();
    const log = new LogFile({ directory, maxBytes: 300 });
    for (let index = 0; index < 20; index += 1) log.write("warn", `entry ${index} ${"x".repeat(40)}`);
    await log.flush();
    expect((await readdir(directory)).sort()).toEqual([LOG_FILE, OLD_LOG_FILE].sort());
    expect((await stat(path.join(directory, LOG_FILE))).size).toBeLessThanOrEqual(300);
    expect((await stat(path.join(directory, OLD_LOG_FILE))).size).toBeLessThanOrEqual(300);
    expect(await readFile(path.join(directory, LOG_FILE), "utf8")).toContain("entry 19");
  });

  it("tells a repeated entry once with a count and cuts very long entries", async () => {
    const directory = await folder();
    const log = new LogFile({ directory });
    for (let index = 0; index < 5; index += 1) log.write("error", "[conversion:external-idle] boom");
    log.write("info", "y".repeat(20_000));
    await log.flush();
    const text = await readFile(path.join(directory, LOG_FILE), "utf8");
    expect(text.match(/boom/g)).toHaveLength(1);
    expect(text).toContain("上一条又出现 4 次");
    expect(text).toContain("已截断");
    expect(text.length).toBeLessThan(9000);
  });

  it("removes only its own files that went untouched for a month", async () => {
    const directory = await folder();
    const now = Date.now();
    const stale = new Date(now - 31 * DAY);
    await writeFile(path.join(directory, LOG_FILE), "old current\n");
    await writeFile(path.join(directory, OLD_LOG_FILE), "old rolled\n");
    await writeFile(path.join(directory, "other.log"), "someone else's\n");
    for (const name of [LOG_FILE, OLD_LOG_FILE, "other.log"]) await utimes(path.join(directory, name), stale, stale);
    const log = new LogFile({ directory, now: () => now });
    log.write("info", "started");
    await log.flush();
    expect((await readdir(directory)).sort()).toEqual([LOG_FILE, "other.log"].sort());
    const text = await readFile(path.join(directory, LOG_FILE), "utf8");
    expect(text).toContain("started");
    expect(text).not.toContain("old current");
  });

  it("keeps writing after the folder is deleted", async () => {
    const directory = path.join(await folder(), "logs");
    const log = new LogFile({ directory });
    log.write("info", "first");
    await log.flush();
    await rm(directory, { recursive: true });
    log.write("info", "second");
    await log.flush();
    log.write("info", "third");
    await log.flush();
    expect(await readFile(path.join(directory, LOG_FILE), "utf8")).toContain("third");
  });
});

describe("removeOldCrashDumps", () => {
  it("keeps the newest reports from the last month and leaves other files alone", async () => {
    const directory = await folder();
    const now = Date.now();
    await mkdir(path.join(directory, "completed"));
    await mkdir(path.join(directory, "new"));
    const dumps = ["a", "b", "c", "d"].map((name, index) => ({ file: path.join(directory, "completed", `${name}.dmp`), age: (index + 1) * DAY }));
    dumps.push({ file: path.join(directory, "completed", "e.dmp"), age: 40 * DAY });
    for (const dump of dumps) {
      await writeFile(dump.file, "dump");
      const time = new Date(now - dump.age);
      await utimes(dump.file, time, time);
    }
    await writeFile(path.join(directory, "new", "writing.dmp"), "dump");
    await writeFile(path.join(directory, "settings.dat"), "crashpad");
    await removeOldCrashDumps(directory, { now });
    expect((await readdir(path.join(directory, "completed"))).sort()).toEqual(["a.dmp", "b.dmp", "c.dmp"]);
    expect(await readdir(path.join(directory, "new"))).toEqual(["writing.dmp"]);
    expect(await readdir(directory)).toContain("settings.dat");
  });
});
