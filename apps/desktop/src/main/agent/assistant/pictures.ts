import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { workspaceStorageDirectory } from "../../workspace/storage";

export interface AssistantPictureFile { hash: string; mimeType: string }
const validId = (id: string) => /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id);
async function directory(root: string, id: string, create: boolean) {
  if (!validId(id)) throw new Error("对话编号无效。");
  return workspaceStorageDirectory(root, ["assistant", "images", id], create);
}
async function picturePath(root: string, id: string, hash: string, create = false) {
  if (!/^[a-f\d]{64}$/.test(hash)) throw new Error("原图记录无效。");
  return path.join(await directory(root, id, create), `${hash}.image`);
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function readPictureBytes(file: string, hash: string) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("原图不能是符号链接或文件夹。");
  const bytes = await readFile(file);
  if (digest(bytes) !== hash) throw new Error("对话中的原图已损坏。");
  return bytes;
}

/** Originals stay as binary assets; the Pi transcript only needs a small reference. */
export async function saveAssistantPicture(root: string, id: string, image: ImageContent): Promise<AssistantPictureFile> {
  const bytes = Buffer.from(image.data, "base64"), hash = digest(bytes);
  const file = await picturePath(root, id, hash, true);
  const temporary = `${file}.${randomUUID()}.next`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    try { await copyFile(temporary, file, constants.COPYFILE_EXCL); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await readPictureBytes(file, hash);
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return { hash, mimeType: image.mimeType };
}
export async function readAssistantPicture(root: string, id: string, picture: AssistantPictureFile): Promise<ImageContent> {
  const bytes = await readPictureBytes(await picturePath(root, id, picture.hash), picture.hash);
  return { type: "image", data: bytes.toString("base64"), mimeType: picture.mimeType };
}
export async function removeAssistantPictures(root: string, id: string) {
  const target = await directory(root, id, false).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (target) await rm(target, { recursive: true });
}
