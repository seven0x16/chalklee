import { BaiduPageRecognizer, type BaiduOcrCredentials } from "./baiduOcr";
import { DeepSeekPageRecognizer, type DeepSeekOcrConnection } from "./deepseekOcr";
import { GlmPageRecognizer, QwenPageRecognizer } from "./cloudPageOcr";
import { MineruLocalPageRecognizer, type MineruLocalConnection } from "./mineruLocalOcr";
import { MineruPageRecognizer } from "./mineruOcr";
import type { PageRecognizer } from "./ocrReference";

export { OcrError } from "./ocrReference";

/** The OCR chosen for a conversion, with what it needs to connect. */
export type ConversionOcr =
  | { provider: "deepseek"; connection: DeepSeekOcrConnection }
  | { provider: "baidu-paddleocr-vl"; credentials: BaiduOcrCredentials }
  | { provider: "glm-ocr" | "mineru"; apiKey: string }
  | { provider: "qwen-ocr"; apiKey: string; workspaceId: string }
  | ({ provider: "mineru-local" } & MineruLocalConnection);

export function pageRecognizer(ocr: ConversionOcr): PageRecognizer {
  switch (ocr.provider) {
    case "deepseek": return new DeepSeekPageRecognizer(ocr.connection);
    case "baidu-paddleocr-vl": return new BaiduPageRecognizer(ocr.credentials);
    case "glm-ocr": return new GlmPageRecognizer(ocr.apiKey);
    case "qwen-ocr": return new QwenPageRecognizer(ocr.apiKey, ocr.workspaceId);
    case "mineru": return new MineruPageRecognizer(ocr.apiKey);
    case "mineru-local": return new MineruLocalPageRecognizer(ocr);
  }
}
