// ProseMirror inserts sourceless <img> elements to support the editor caret.
export const PRINT_IMAGE_SELECTOR = "img:not(.ProseMirror-separator:not([src], [srcset]))";

export function decodeChalkLeePrintImages(images: Iterable<HTMLImageElement>) {
  const pending: Promise<void>[] = [];
  const sources = new Set<string>();
  for (const image of images) {
    const source = image.currentSrc;
    // An eager, loaded image with a fixed blob URL shares its resource with
    // other copies. Wait per element if the request or source can still change.
    if (image.complete && image.naturalWidth > 0 && source.startsWith("blob:")
      && image.loading !== "lazy" && !image.srcset && image.parentElement?.tagName !== "PICTURE") {
      if (sources.has(source)) continue;
      sources.add(source);
    }
    pending.push(image.decode().catch(() => undefined));
  }
  return Promise.all(pending);
}
