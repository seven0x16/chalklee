const bytesKey = "$chalkleeBytes";

export function encodeBrowserWire(value: unknown): unknown {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 16384) binary += String.fromCharCode(...bytes.subarray(index, index + 16384));
    return { [bytesKey]: btoa(binary) };
  }
  if (Array.isArray(value)) return value.map(encodeBrowserWire);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encodeBrowserWire(child)]));
  return value;
}

export function decodeBrowserWire(value: unknown): any {
  if (Array.isArray(value)) return value.map(decodeBrowserWire);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && typeof record[bytesKey] === "string") {
      const binary = atob(record[bytesKey]);
      return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer;
    }
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, decodeBrowserWire(child)]));
  }
  return value;
}
