import { QWEN_OCR_MODEL } from "../../shared/settings/ocr";
import { OcrError, type OcrReference, type PageRecognizer } from "./ocrReference";
import { ocrJson, structuredOcrPage } from "./structuredOcr";

const GLM_TYPES: Record<string, string> = {
  title: "doc_title", figure: "image", formula: "display_formula", page_number: "number"
};

export class GlmPageRecognizer implements PageRecognizer {
  constructor(private readonly apiKey: string) {}

  async recognize(png: string, _fileName: string, signal: AbortSignal): Promise<OcrReference> {
    const result = await ocrJson("智谱 GLM-OCR", "https://open.bigmodel.cn/api/paas/v4/layout_parsing", this.apiKey, signal, {
      model: "glm-ocr", file: `data:image/png;base64,${png}`
    });
    const code = Number(result?.error?.code);
    if (code === 1110 || code === 1113) throw new OcrError("智谱 GLM-OCR 额度或余额不足，请检查服务控制台。", true);
    const page = result?.layout_details;
    const size = result?.data_info?.pages?.[0];
    // The cloud API returns pixels in the service's rendering, not the SDK's normalized coordinates.
    if (!Array.isArray(page) || page.length !== 1 || !Array.isArray(page[0])
      || !Number.isFinite(size?.width) || !Number.isFinite(size?.height)) {
      throw new OcrError("智谱 GLM-OCR 未返回完整的单页版面。");
    }
    return structuredOcrPage("glm-ocr", page[0].map(block => ({
      type: GLM_TYPES[block?.label] ?? block?.label, text: block?.content, box: block?.bbox_2d
    })), size);
  }
}

// Fixed structured-layout prompt required by the Model Studio OCR endpoint.
const QWEN_LAYOUT_PROMPT = `Analyze the document structure and extract text content. Return a single JSON array in natural reading order.

Each element follows this schema:
{"bbox": [x_min, y_min, x_max, y_max], "category": "string", "content": "string"}

Rules:
1. The bbox coordinates are integers scaled to [0, 1000).
2. The category is exactly one of:
["abstract", "algorithm", "aside_text", "chart", "content", "display_formula", "doc_title", "figure_title", "footer", "footer_image", "footnote", "formula_number", "header", "header_image", "image", "inline_formula", "number", "paragraph_title", "reference_content", "seal", "table", "text", "vertical_text", "vision_footnote"].
3. The content formatting depends on category:
- For "footer_image", "header_image", "image", or "chart": write as an HTML image tag <img src="images/bbox_{x_min}_{y_min}_{x_max}_{y_max}.jpg" />.
- For "display_formula" or "inline_formula": write in LaTeX.
- For "table": write as a standard HTML <table>...</table>.
- Otherwise: write in Markdown.
4. Output must be strictly valid JSON. Properly escape quotes and special characters inside content.`;

export class QwenPageRecognizer implements PageRecognizer {
  constructor(private readonly apiKey: string, private readonly workspaceId: string) {}

  async recognize(png: string, _fileName: string, signal: AbortSignal): Promise<OcrReference> {
    const result = await ocrJson("百炼 Qwen-OCR", `https://${this.workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`, this.apiKey, signal, {
      model: QWEN_OCR_MODEL, messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${png}` } },
        { type: "text", text: QWEN_LAYOUT_PROMPT }
      ] }]
    });
    const choice = result?.choices?.[0];
    if (choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string") {
      throw new OcrError("百炼 Qwen-OCR 未返回完整结果，请检查业务空间及模型权限。");
    }
    let blocks: unknown;
    try { blocks = JSON.parse(choice.message.content); }
    catch { throw new OcrError("百炼 Qwen-OCR 返回的版面无法读取。"); }
    if (!Array.isArray(blocks)) throw new OcrError("百炼 Qwen-OCR 返回的版面无效。");
    return structuredOcrPage("qwen-ocr", blocks.map(block => ({
      type: block?.category, text: block?.content, box: block?.bbox
    })));
  }
}
