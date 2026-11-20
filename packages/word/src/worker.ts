import { parseWord } from "./parse";

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const document = await parseWord(new Uint8Array(event.data));
    const transfers = [...new Set(document.assets.map(a => a.bytes.buffer as ArrayBuffer))];
    self.postMessage({ ok: true, document }, { transfer: transfers });
  } catch (error) { self.postMessage({ ok: false, message: error instanceof Error ? error.message : "Word 解析失败。" }); }
};
