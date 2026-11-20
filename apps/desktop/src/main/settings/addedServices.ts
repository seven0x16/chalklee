import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, safeStorage } from "electron";

/** Storage shared by OCR and web search: each file holds the choice and the configurations added with their own keys. */
export const settingsFile = (name: string) => path.join(app.getPath("userData"), name);

/** The parsed file, or nothing when it does not exist yet. */
export async function readSettingsFile(name: string, unreadable: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(await readFile(settingsFile(name), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(unreadable);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(unreadable);
  }
}
export async function writeSettingsFile(name: string, value: unknown) {
  await mkdir(app.getPath("userData"), { recursive: true });
  const temporary = `${settingsFile(name)}.${randomUUID()}.next`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, settingsFile(name));
}

export function requireEncryption() {
  if (!safeStorage.isEncryptionAvailable() || (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) throw new Error("系统凭据加密服务不可用，请先解锁系统钥匙串或密钥环。");
}
export function seal(value: string): string {
  requireEncryption();
  return safeStorage.encryptString(value).toString("base64");
}
export function unseal(sealed: string | undefined, label: string): string {
  if (!sealed) throw new Error(`请填写 ${label}。`);
  requireEncryption();
  try { return safeStorage.decryptString(Buffer.from(sealed, "base64")); }
  catch { throw new Error(`无法解密 ${label}，请重新填写。`); }
}
/** A typed key, trimmed; undefined keeps the saved one. */
export function draftKey(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new Error(`请填写有效的 ${label}。`);
  return value.trim();
}
export function draftName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length > 60) throw new Error("配置名称不能超过 60 个字。");
  return value.trim() || undefined;
}
export const textField = (value: unknown) => typeof value === "string" ? value : undefined;

/** Runs changes to one file one after another. */
export function serializer() {
  let pending: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = pending.then(task);
    pending = next.catch(() => undefined);
    return next;
  };
}
