/** Ensure the IPC buffer spans exactly the archive's bytes. */
export function chalkLeeOutputBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength
    && !("resizable" in buffer && buffer.resizable)) return buffer;
  return Uint8Array.from(bytes).buffer;
}
