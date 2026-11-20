import type { AssistantImage } from "../../../shared/agent/assistant";

/** An attached picture with a preview for the message box. */
export type AssistantImageAttachment = AssistantImage & { id: string; url: string };

const TYPES = new Set<string>(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_SIDE = 2000;
const MAX_BYTES = 3_500_000;

/** Pictures in a paste or drop; ignored when text comes along, as when copying from Word. */
export function assistantImageFiles(transfer: DataTransfer | null | undefined): File[] {
  if (!transfer || transfer.types.includes("text/plain")) return [];
  return Array.from(transfer.files).filter(file => file.type.startsWith("image/"));
}

/** Whether a drag carries files and every one of them is a picture (types are readable before the drop). */
export function assistantDragKind(transfer: DataTransfer): "images" | "files" | null {
  if (!transfer.types.includes("Files")) return null;
  const items = Array.from(transfer.items).filter(item => item.kind === "file");
  return items.length && items.every(item => item.type.startsWith("image/")) ? "images" : "files";
}

const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error("无法读取图片。"));
  reader.readAsDataURL(blob);
});

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob>((resolve, reject) =>
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("无法处理图片。")), type, quality));

/** Large pictures are scaled down so screenshots stay legible without making the conversation heavy. */
export async function prepareAssistantImage(file: File): Promise<AssistantImageAttachment> {
  let blob: Blob = file;
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("无法读取这张图片，请换成 PNG 或 JPG。"); });
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale < 1 || !TYPES.has(file.type) || file.size > MAX_BYTES) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await encode(canvas, "image/png");
      if (blob.size > MAX_BYTES) blob = await encode(canvas, "image/jpeg", 0.9);
    }
  } finally { bitmap.close(); }
  const url = await dataUrl(blob);
  return { id: crypto.randomUUID(), url, data: url.slice(url.indexOf(",") + 1), mimeType: blob.type as AssistantImage["mimeType"] };
}
