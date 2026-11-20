import type { ChalkLeeCropRect } from "./ChalkLeeImageCrop";

export interface ChalkLeeImageData { fileName: string; mediaType: string; data: Uint8Array; widthPt?: number }

const CHALKLEE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);

/** Picture files carried by a paste or drop; ignored when text comes along, as when copying from Word. */
export function chalkLeeImageFiles(transfer: DataTransfer | null | undefined): File[] {
  if (!transfer || transfer.getData("text/plain").trim()) return [];
  return Array.from(transfer.files).filter(file => CHALKLEE_IMAGE_TYPES.has(file.type));
}

/** Reads a picture and sizes it as shown on screen, at most `maxWidthPt` wide. */
export async function readChalkLeeImageFile(file: File, maxWidthPt: number): Promise<ChalkLeeImageData> {
  if (file.size > 25 * 1024 * 1024) throw new Error("图片不能超过 25 MB。");
  const data = new Uint8Array(await file.arrayBuffer());
  let widthPt = maxWidthPt;
  try {
    const bitmap = await createImageBitmap(file);
    widthPt = Math.min(maxWidthPt, Math.max(24, bitmap.width / (window.devicePixelRatio || 1) * 0.75));
    bitmap.close();
  } catch { /* SVG and unusual images keep the default width. */ }
  return { fileName: file.name || "粘贴的图片", mediaType: file.type, data, widthPt: Math.round(widthPt * 10) / 10 };
}

/** The kept part of a picture at full resolution; JPEG stays JPEG, everything else becomes PNG. */
export async function cropChalkLeeImageBytes(bytes: Uint8Array, mediaType: string, rect: ChalkLeeCropRect): Promise<{ mediaType: string; data: Uint8Array }> {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mediaType }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const sx = Math.round(rect.x * image.naturalWidth), sy = Math.round(rect.y * image.naturalHeight);
    const width = Math.max(1, Math.round(rect.width * image.naturalWidth)), height = Math.max(1, Math.round(rect.height * image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理图片");
    const type = mediaType === "image/jpeg" ? "image/jpeg" : "image/png";
    if (type === "image/jpeg") { context.fillStyle = "#fff"; context.fillRect(0, 0, width, height); }
    context.drawImage(image, sx, sy, width, height, 0, 0, width, height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.92));
    if (!blob) throw new Error("无法生成裁剪后的图片");
    return { mediaType: type, data: new Uint8Array(await blob.arrayBuffer()) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
