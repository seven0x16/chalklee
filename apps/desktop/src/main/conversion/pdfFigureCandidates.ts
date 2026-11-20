import type { ImportUnit } from "../../shared/conversion/types";
import { cropComponentBox, cropGridCells, cropInkComponents, importCropRect, overlappingComponentGroups, pixelCropBox } from "./crop";
import { cropImportFigure } from "./sharpFigures";

/** Provide exact source pixels for recognition and crop repair, so a drawing
 * can be selected without repeatedly guessing its page coordinates. */
export function pdfFigureRepairCandidates(unit: ImportUnit): ImportUnit {
  const page = unit.images.find(image => image.id === unit.id);
  if (!page) return unit;
  const { image, size, rect } = importCropRect(page.dataUrl, [0, 0, 1000, 1000]);
  // A PDF image object can be clipped, stretched, or combined with vector
  // strokes. Its raw bitmap is not necessarily the figure visible on paper.
  // Retain its exact placement but take pixels from the rendered source page.
  const originals = unit.images.filter(asset => {
    const b = asset.pageBounds;
    // The rendered page already supplies scans and large background layers.
    // Offering them as figures encourages copying unrelated page content.
    return asset.id === unit.id || !b || b[2] * b[3] <= 350_000;
  }).map(asset => {
    if (asset.id === unit.id || !asset.pageBounds) return asset;
    const bounds = asset.pageBounds;
    const { dataUrl } = cropImportFigure(unit, page, bounds);
    return { ...asset, dataUrl, widthPt: page.widthPt * bounds[2] / 1000, heightPt: page.heightPt * bounds[3] / 1000 };
  });
  const pixels = image.toBitmap();
  // Local contrast separates line drawings from grey paper, but breaks a
  // photograph into hundreds of texture fragments. Dense image regions keep
  // that photograph whole; large page backgrounds are never candidates.
  const photos = cropInkComponents(pixels, size, rect, 220).filter(component => {
    const area = component.rect.width * component.rect.height;
    return area >= size.width * size.height * .01 && area <= size.width * size.height * .35
      && component.inkPixels / area >= .65;
  });
  const components = cropInkComponents(pixels, size, rect).filter(component => !photos.some(photo => {
    const a = component.rect, b = photo.rect;
    return a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
  }));
  const next = Math.max(0, ...components.map(component => component.id)) + 1;
  components.push(...photos.map((photo, index) => ({ ...photo, id: next + index })));
  const drawings = components.filter(component => component.rect.width >= size.width * .04 && component.rect.height >= size.height * .018).slice(0, 16);
  const cells = cropGridCells(pixels, size, drawings).filter(({ rect: cell }) => components.some(component => {
    const b = component.rect;
    // A plain text table does not need dozens of image candidates. Keep cells
    // containing drawing-sized ink; the entire page remains available either way.
    return b.width >= size.width * .025 && b.height >= size.height * .014
      && b.x >= cell.x && b.y >= cell.y && b.x + b.width <= cell.x + cell.width && b.y + b.height <= cell.y + cell.height;
  })).map(({ grid, row, column, rect }) => {
    const bounds = pixelCropBox([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height], size);
    const { dataUrl } = cropImportFigure(unit, page, bounds);
    return { id: `pdf_grid_${unit.page}_${grid}_row_${row}_column_${column}`, dataUrl, pageBounds: bounds,
      widthPt: page.widthPt * bounds[2] / 1000, heightPt: page.heightPt * bounds[3] / 1000 };
  });
  // Small detached apparatus (for example a phone on a table) can overlap a
  // larger component without meeting the drawing size threshold on its own.
  const drawingIds = new Set(drawings.map(component => component.id));
  const groups = overlappingComponentGroups(components).filter(group => {
    if (group.length < 2 || !group.some(id => drawingIds.has(id))) return false;
    const combined = cropComponentBox(components, group, size);
    return !drawings.some(component => group.includes(component.id)
      && cropComponentBox(components, [component.id], size).every((value, index) => value === combined[index]));
  });
  const candidates = [...groups, ...drawings.map(component => [component.id])].flatMap(ids => {
    const box = cropComponentBox(components, ids, size);
    // Prefer the original embedded image, which already includes detached
    // labels, over several competing cuts of the same connected drawing.
    if (unit.images.some(image => {
      const b = image.pageBounds;
      // Scanned PDFs commonly embed the entire sheet as one image. It is a
      // page reference, not an already isolated drawing with useful labels.
      return b && b[2] * b[3] <= 350_000 && Math.max(0, Math.min(box[0] + box[2], b[0] + b[2]) - Math.max(box[0], b[0]))
        * Math.max(0, Math.min(box[1] + box[3], b[1] + b[3]) - Math.max(box[1], b[1])) > box[2] * box[3] * .8;
    })) return [];
    const left = Math.max(0, box[0] - 32), top = Math.max(0, box[1] - 6);
    const context: typeof box = [left, top, Math.min(1000, box[0] + box[2] + 32) - left, Math.min(1000, box[1] + box[3] + 20) - top];
    return [box, context].map((bounds, index) => {
      const { dataUrl } = cropImportFigure(unit, page, bounds);
      return { id: `pdf_candidate_${unit.page}_${ids.join("_")}${index ? "_context" : ""}`, dataUrl, pageBounds: bounds,
        widthPt: page.widthPt * bounds[2] / 1000, heightPt: page.heightPt * bounds[3] / 1000 };
    });
  });
  const ordered = candidates.filter(candidate => !candidate.id.endsWith("_context"))
    .sort((a, b) => a.pageBounds[1] - b.pageBounds[1] || a.pageBounds[0] - b.pageBounds[0]);
  const named = ordered.flatMap((candidate, index) => {
    const context = candidates.find(image => image.id === `${candidate.id}_context`);
    const id = `pdf_candidate_${unit.page}_${index + 1}`;
    return [{ ...candidate, id }, ...(context ? [{ ...context, id: `${id}_context` }] : [])];
  });
  return { ...unit, images: [...originals, ...cells, ...named] };
}
