import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ directory: "", available: true }));
vi.mock("electron", () => ({
  app: { getPath: () => state.directory },
  safeStorage: { isEncryptionAvailable: () => state.available, getSelectedStorageBackend: () => "keychain", encryptString: (key: string) => Buffer.from(`sealed:${key}`), decryptString: (buffer: Buffer) => buffer.toString().replace(/^sealed:/, "") }
}));
const { addDeepSeekOcr, chooseOcr, conversionOcr, deleteOcrConfig, getOcrSettings, ocrDraftConnection, revealOcrKey, saveOcrConfig } = await import("./ocr");
const file = () => path.join(state.directory, "ocr-settings.json");
const sealed = (key: string) => Buffer.from(`sealed:${key}`).toString("base64");
const BAIDU = "百度智能云 PaddleOCR-VL";
const config = (id: string, name = BAIDU) => ({ id, name, provider: "baidu-paddleocr-vl", hasApiKey: true, hasSecretKey: true });
const deepSeek = (id: string, name = "DeepSeek OCR") => ({ id, name, provider: "deepseek", hasApiKey: true, hasSecretKey: false });
beforeEach(async () => { state.directory = await mkdtemp(path.join(tmpdir(), "chalklee-ocr-settings-")); state.available = true; });
afterEach(async () => { await rm(state.directory, { recursive: true, force: true }); });

describe("OCR settings", () => {
  it("uses the conversion model until a model is added", async () => {
    expect(await getOcrSettings()).toEqual({ choice: "conversion", configs: [] });
    await expect(chooseOcr("missing")).rejects.toThrow("已被删除");
    expect(await conversionOcr()).toBeUndefined();
  });
  it("adds models with every key encrypted, chooses each new one, and names them apart", async () => {
    await expect(saveOcrConfig({ apiKey: "ak" })).rejects.toThrow("API Key 和 Secret Key");
    await expect(saveOcrConfig({ provider: "deepseek" })).rejects.toThrow("请填写 API Key。");
    await expect(readFile(file())).rejects.toMatchObject({ code: "ENOENT" });
    const first = await saveOcrConfig({ name: "", apiKey: " ak-1 ", secretKey: "sk-1" });
    const firstId = first.configs[0].id;
    expect(first).toEqual({ choice: firstId, configs: [config(firstId)] });
    expect(await readFile(file(), "utf8")).not.toMatch(/ak-1|sk-1/);
    const second = await saveOcrConfig({ apiKey: "ak-2", secretKey: "sk-2" });
    const secondId = second.configs[1].id;
    expect(second).toEqual({ choice: secondId, configs: [config(firstId), config(secondId, `${BAIDU} 2`)] });
    const third = await saveOcrConfig({ provider: "deepseek", apiKey: "sk-deepseek", secretKey: "ignored" });
    expect(third).toEqual({ choice: third.configs[2].id, configs: [config(firstId), config(secondId, `${BAIDU} 2`), deepSeek(third.configs[2].id)] });
    expect(await conversionOcr()).toEqual({ provider: "deepseek", connection: { apiKey: "sk-deepseek" } });
    await expect(revealOcrKey(third.configs[2].id, "secretKey")).rejects.toThrow("Secret Key");
    await expect(saveOcrConfig({ name: "AI 大模型", apiKey: "ak", secretKey: "sk" })).rejects.toThrow("已有名为“AI 大模型”的选项");
    await expect(saveOcrConfig({ id: secondId, name: BAIDU.toLowerCase() })).rejects.toThrow("已有名为");
    expect(await revealOcrKey(firstId, "apiKey")).toBe("ak-1");
  });
  it("changes one key of a model and keeps the other, its provider, its name and the current choice", async () => {
    const { configs: [added] } = await saveOcrConfig({ name: "学校账号", apiKey: "ak-1", secretKey: "sk-1" });
    await chooseOcr("conversion");
    expect(await saveOcrConfig({ id: added.id, name: "学校账号", provider: "deepseek", secretKey: "sk-2" })).toEqual({ choice: "conversion", configs: [config(added.id, "学校账号")] });
    expect(await revealOcrKey(added.id, "apiKey")).toBe("ak-1");
    expect(await revealOcrKey(added.id, "secretKey")).toBe("sk-2");
    expect(await ocrDraftConnection({ id: added.id, apiKey: "ak-draft" })).toEqual({ provider: "baidu-paddleocr-vl", credentials: { apiKey: "ak-draft", secretKey: "sk-2" } });
    expect(await ocrDraftConnection({ provider: "deepseek", apiKey: "sk-draft" })).toEqual({ provider: "deepseek", connection: { apiKey: "sk-draft" } });
    await expect(saveOcrConfig({ id: added.id, apiKey: "  " })).rejects.toThrow("有效的 API Key");
    await expect(saveOcrConfig({ id: "missing", apiKey: "ak" })).rejects.toThrow("已被删除");
    expect(await revealOcrKey(added.id, "apiKey")).toBe("ak-1");
  });
  it("deletes a model with its keys; the conversion model takes over only when it was chosen", async () => {
    const { configs: [first] } = await saveOcrConfig({ apiKey: "ak-1", secretKey: "sk-1" });
    const { configs: [, second] } = await saveOcrConfig({ apiKey: "ak-2", secretKey: "sk-2" });
    expect(await deleteOcrConfig(second.id)).toEqual({ choice: "conversion", configs: [config(first.id)] });
    await expect(revealOcrKey(second.id, "apiKey")).rejects.toThrow("已被删除");
    await chooseOcr(first.id);
    const { configs: [, third] } = await saveOcrConfig({ apiKey: "ak-3", secretKey: "sk-3" });
    expect((await deleteOcrConfig(first.id)).choice).toBe(third.id);
    expect((await deleteOcrConfig(third.id)).choice).toBe("conversion");
    await expect(readFile(file())).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("adds DeepSeek OCR with a copied key once, chosen unless the person chose something still there", async () => {
    await addDeepSeekOcr("sk-model");
    const view = await getOcrSettings();
    expect(view).toEqual({ choice: view.configs[0].id, configs: [deepSeek(view.configs[0].id)] });
    expect(await revealOcrKey(view.configs[0].id, "apiKey")).toBe("sk-model");
    await addDeepSeekOcr("sk-other");
    expect(await getOcrSettings()).toEqual(view);
    // Deleted, it comes back with the next DeepSeek model, but leaves a chosen model chosen.
    await deleteOcrConfig(view.configs[0].id);
    const { configs: [baidu] } = await saveOcrConfig({ apiKey: "ak", secretKey: "sk" });
    await addDeepSeekOcr("sk-model");
    expect((await getOcrSettings()).choice).toBe(baidu.id);
    await chooseOcr("conversion");
    await deleteOcrConfig((await getOcrSettings()).configs[1].id);
    await addDeepSeekOcr("sk-model");
    expect((await getOcrSettings()).choice).toBe("conversion");
  });
  it("reads the earlier single model: turned on it stays chosen, turned off it is only listed", async () => {
    await writeFile(file(), JSON.stringify({ enabled: true, provider: "baidu-paddleocr-vl", encryptedApiKey: sealed("ak"), encryptedSecretKey: sealed("sk") }));
    expect(await getOcrSettings()).toEqual({ choice: "paddleocr-vl", configs: [config("paddleocr-vl")] });
    expect(await revealOcrKey("paddleocr-vl", "secretKey")).toBe("sk");
    await writeFile(file(), JSON.stringify({ enabled: false, provider: "baidu-paddleocr-vl", encryptedApiKey: sealed("ak"), encryptedSecretKey: sealed("sk") }));
    expect((await getOcrSettings()).choice).toBe("conversion");
    await saveOcrConfig({ id: "paddleocr-vl", name: "学校账号" });
    expect(JSON.parse(await readFile(file(), "utf8"))).toEqual({ configs: [{ id: "paddleocr-vl", name: "学校账号", provider: "baidu-paddleocr-vl", encryptedApiKey: sealed("ak"), encryptedSecretKey: sealed("sk") }] });
  });
  it("does not store keys when system encryption is unavailable", async () => {
    state.available = false;
    await expect(saveOcrConfig({ apiKey: "ak", secretKey: "sk" })).rejects.toThrow("系统凭据加密服务不可用");
    await expect(addDeepSeekOcr("sk-model")).rejects.toThrow("系统凭据加密服务不可用");
    await expect(readFile(file())).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("conversion OCR", () => {
  it("follows the choice in effect", async () => {
    expect(await conversionOcr()).toBeUndefined();
    await addDeepSeekOcr("sk-model");
    expect(await conversionOcr()).toEqual({ provider: "deepseek", connection: { apiKey: "sk-model" } });
    await saveOcrConfig({ apiKey: "ak", secretKey: "sk" });
    expect(await conversionOcr()).toEqual({ provider: "baidu-paddleocr-vl", credentials: { apiKey: "ak", secretKey: "sk" } });
    await chooseOcr("conversion");
    expect(await conversionOcr()).toBeUndefined();
  });
});

it("requires a valid Qwen workspace and saves it separately from the encrypted API key", async () => {
  const draft = { provider: "qwen-ocr" as const, apiKey: "qwen-test-key" };
  await expect(saveOcrConfig(draft)).rejects.toThrow("业务空间 ID");
  await expect(saveOcrConfig({ ...draft, workspaceId: "workspace.example.org" })).rejects.toThrow("业务空间 ID");
  const { configs: [config] } = await saveOcrConfig({ ...draft, workspaceId: "llm-test" });
  expect(config).toMatchObject({ workspaceId: "llm-test", hasApiKey: true, hasSecretKey: false });
  expect(await readFile(file(), "utf8")).not.toContain("qwen-test-key");
  const { configs: [updated] } = await saveOcrConfig({ id: config.id, workspaceId: "llm-second" });
  expect(updated.workspaceId).toBe("llm-second");
  expect(await conversionOcr()).toEqual({ ...draft, workspaceId: "llm-second" });
});

it("keeps a self-hosted MinerU's address, with an optional key that only goes to the address it was entered for", async () => {
  const { configs: [local] } = await saveOcrConfig({ provider: "mineru-local" });
  expect(local).toEqual({ id: local.id, name: "MinerU 本地部署", provider: "mineru-local", hasApiKey: false, hasSecretKey: false, baseUrl: "http://127.0.0.1:8000" });
  expect(await conversionOcr()).toEqual({ provider: "mineru-local", baseUrl: "http://127.0.0.1:8000" });
  // Copied from the address bar of the service's API page, or behind a reverse proxy's path.
  expect((await saveOcrConfig({ id: local.id, baseUrl: " http://192.168.1.20:8000/docs/ ", apiKey: "mineru-test-key" })).configs[0])
    .toMatchObject({ baseUrl: "http://192.168.1.20:8000", hasApiKey: true });
  expect(await conversionOcr()).toEqual({ provider: "mineru-local", baseUrl: "http://192.168.1.20:8000", apiKey: "mineru-test-key" });
  expect(await ocrDraftConnection({ provider: "mineru-local", baseUrl: "https://ocr.example.org/mineru/v1/tasks" })).toEqual({ provider: "mineru-local", baseUrl: "https://ocr.example.org/mineru" });
  expect(await ocrDraftConnection({ id: local.id, baseUrl: "http://192.168.1.20:8000/v1" })).toMatchObject({ apiKey: "mineru-test-key" });
  await expect(ocrDraftConnection({ id: local.id, baseUrl: "http://192.168.1.30:8000" })).rejects.toThrow("更换服务地址后，请重新填写或清空 API Key");
  await expect(saveOcrConfig({ id: local.id, baseUrl: "http://192.168.1.30:8000" })).rejects.toThrow("更换服务地址后");
  for (const baseUrl of ["192.168.1.30:8000", "ftp://192.168.1.30", "http://user:secret@192.168.1.30:8000", "http://192.168.1.30:8000/?token=1"]) {
    await expect(saveOcrConfig({ id: local.id, baseUrl, apiKey: "mineru-test-key" })).rejects.toThrow("服务地址");
  }
  // Clearing the key is how a service without one is reached at the new address.
  expect((await saveOcrConfig({ id: local.id, baseUrl: "http://192.168.1.30:8000", apiKey: "" })).configs[0]).toMatchObject({ baseUrl: "http://192.168.1.30:8000", hasApiKey: false });
  expect(await conversionOcr()).toEqual({ provider: "mineru-local", baseUrl: "http://192.168.1.30:8000" });
});
