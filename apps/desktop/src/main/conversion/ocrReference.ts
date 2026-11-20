export type OcrBox = [number, number, number, number];
export interface OcrLayout { id: string; type: string; box: OcrBox; text?: string; lines?: { text: string; box?: OcrBox }[] }
/** One recognized page in provider-neutral form; layout types follow PaddleOCR-VL's names. */
export interface OcrReference {
  [key: string]: unknown;
  unitId: string; provider: string; status: "unverified-reference";
  coordinateSystem: "whole-page-0..1000-[x,y,width,height]";
  layouts: OcrLayout[]; tables: unknown[];
  imageCandidates: { id: string; type: string; sourceImageId: string; box: OcrBox }[];
}

/** `account` marks problems with the key, access or balance, which every later page would hit as well. */
export class OcrError extends Error {
  constructor(message: string, readonly account = false) { super(message); }
}

export interface PageRecognizer { recognize(png: string, fileName: string, signal: AbortSignal): Promise<OcrReference> }
