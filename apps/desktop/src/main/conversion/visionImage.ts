import { nativeImage } from "electron";

/** Adapt only the model input. The original bytes used for cropping, caches
 * and ChalkLee assets remain unchanged, including tiny rules and glyphs. */
export function importVisionImage(dataUrl: string) {
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (width > 0 && height > 0 && Math.max(width, height) < 480) {
      const scale = Math.min(4, 480 / Math.max(width, height));
      dataUrl = nativeImage.createFromDataURL(dataUrl).resize({ width: Math.max(11, Math.round(width * scale)), height: Math.max(11, Math.round(height * scale)), quality: "best" }).toDataURL();
    }
  }
  return { type: "image" as const, data: dataUrl.split(",")[1], mimeType: "image/png" };
}
