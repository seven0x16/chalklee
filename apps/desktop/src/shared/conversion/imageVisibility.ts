/** Whether decoded RGBA pixels contain anything visible on white paper.
 * Word's empty drawing assets can carry one level of near-white RGB noise.
 * Preserve even a single stronger pixel, including faint lines and small marks.
 */
export function hasVisibleImagePixels(pixels: Uint8Array | Uint8ClampedArray): boolean {
  if (!pixels.length || pixels.length % 4) return true;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3];
    if ((255 - pixels[offset]) * alpha > 255
      || (255 - pixels[offset + 1]) * alpha > 255
      || (255 - pixels[offset + 2]) * alpha > 255) return true;
  }
  return false;
}
