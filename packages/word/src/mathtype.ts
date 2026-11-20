import { readCompound } from "./compound";
import { mtefToLatex } from "./mtef";

export type MathTypeEquation = { latex: string } | { error: string };

export function readEquationNative(bytes: Uint8Array): Uint8Array {
  const stream = readCompound(bytes, ["Equation Native"]).get("Equation Native");
  if (!stream) throw new Error("Missing MathType Equation Native stream");
  return equationNativeData(stream);
}

/** A DOC stores Equation Native directly inside an ObjectPool storage. */
export function equationNativeData(stream: Uint8Array): Uint8Array {
  if (stream.length < 28) throw new Error("Truncated MathType native header");
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const headerSize = view.getUint16(0, true), equationSize = view.getUint32(8, true);
  if (headerSize < 28 || headerSize > stream.length || !equationSize || equationSize > stream.length - headerSize)
    throw new Error("Truncated MathType native data");
  return stream.subarray(headerSize, headerSize + equationSize);
}

export function readMathTypeEquation(bytes: Uint8Array): MathTypeEquation {
  try {
    const latex = mtefToLatex(readEquationNative(bytes));
    if (!latex) throw new Error("Empty MathType equation");
    return { latex };
  } catch (error) { return { error: error instanceof Error ? error.message : "Invalid MathType equation" }; }
}
