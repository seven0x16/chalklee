import { BrowserWindow, nativeImage } from "electron";
import type { ChalkLeeArchive } from "@chalklee/format";
import { createChalkLeeDocx, type DocxExportOptions } from "../../shared/document/docxExport";

/** Normalize pictures to PNG so the exported document also opens in older Word versions. */
export async function renderChalkLeeDocx(archive: ChalkLeeArchive, options: DocxExportOptions): Promise<Uint8Array> {
  let host: BrowserWindow | undefined;
  try {
    return await createChalkLeeDocx(archive, options, async (data, mediaType) => {
      if (mediaType === "image/svg+xml") {
        host ??= new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
        await host.loadURL('data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src %27none%27; img-src data:">');
        const url = `data:image/svg+xml;base64,${Buffer.from(data).toString("base64")}`;
        const result = await host.webContents.executeJavaScript(`(async () => {
          const image = new Image(); image.src = ${JSON.stringify(url)}; await image.decode();
          const width = image.naturalWidth || 300, height = image.naturalHeight || 150;
          const scale = Math.min(2, 4096 / Math.max(width, height));
          const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          return { data: canvas.toDataURL('image/png').split(',')[1], width, height };
        })()`, true) as { data: string; width: number; height: number };
        return { data: new Uint8Array(Buffer.from(result.data, "base64")), mediaType: "image/png", width: result.width, height: result.height };
      }
      const image = nativeImage.createFromBuffer(Buffer.from(data));
      if (image.isEmpty()) throw new Error("这份文档中有无法导出的图片，请替换后重试。");
      return { data: new Uint8Array(image.toPNG()), mediaType: "image/png", ...image.getSize() };
    });
  } finally { host?.destroy(); }
}
