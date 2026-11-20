import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { chalkLeeImagePairs, chalkLeeRepairImagePairs } from "./imageLayout";
import { chalkLeeAutomaticImageRows } from "./imageRows";

export const CHALKLEE_IMAGE_LAYOUT_EVENT = "chalklee:image-layout";
/** Asks the paper to choose a new picture for the figure in `detail.nodeId`. */
export const CHALKLEE_REPLACE_IMAGE_EVENT = "chalklee:replace-image";
/** Asks the paper to crop the figure in `detail.nodeId` to `detail.rect` (fractions of the picture). */
export const CHALKLEE_CROP_IMAGE_EVENT = "chalklee:crop-image";

type ImageSlotBinding = { id: string; receive(slot: HTMLElement | null): void };
const imageSlotTrackers = new WeakMap<HTMLElement, ReturnType<typeof trackImageSlots>>();

/** Read the editor's current slots together, once per layout frame. */
export function observeChalkLeeImageSlot(content: HTMLElement, id: string, receive: ImageSlotBinding["receive"]) {
  let tracker = imageSlotTrackers.get(content);
  if (!tracker) {
    tracker = trackImageSlots(content);
    imageSlotTrackers.set(content, tracker);
  }
  const binding = { id, receive };
  tracker.bindings.add(binding);
  tracker.schedule();
  return () => {
    if (!tracker.bindings.delete(binding) || tracker.bindings.size) return;
    tracker.dispose();
    imageSlotTrackers.delete(content);
  };
}

function trackImageSlots(content: HTMLElement) {
  const bindings = new Set<ImageSlotBinding>();
  let frame: number | undefined;
  const schedule = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const slots = new Map<string, HTMLElement | null>();
      for (const slot of content.querySelectorAll<HTMLElement>("[data-chalklee-image-slot]")) {
        const id = slot.dataset.chalkleeImageSlot!;
        if (!slots.has(id)) slots.set(id, slot.closest<HTMLElement>("[data-image-pair]")?.dataset.suspended === "true" ? null : slot);
      }
      for (const binding of bindings) binding.receive(slots.get(binding.id) ?? null);
    });
  };
  content.addEventListener(CHALKLEE_IMAGE_LAYOUT_EVENT, schedule);
  return { bindings, schedule, dispose() {
    content.removeEventListener(CHALKLEE_IMAGE_LAYOUT_EVENT, schedule);
    if (frame !== undefined) cancelAnimationFrame(frame);
  } };
}

export const ChalkLeeImagePairsExtension = Extension.create({
  name: "chalkLeeImagePairs",
  addProseMirrorPlugins() {
    return [chalkLeeImagePairPlugin()];
  }
});

export function chalkLeeImagePairPlugin() {
  const decorationsByDocument = new WeakMap<ProseMirrorNode, DecorationSet>();
    return new Plugin({
      key: new PluginKey("chalkLeeImagePairs"),
      appendTransaction(transactions, _old, state) {
        return transactions.some(tr => tr.docChanged) ? chalkLeeRepairImagePairs(state) : null;
      },
      props: {
        decorations(state) {
          const cached = decorationsByDocument.get(state.doc);
          if (cached) return cached;
          const decorations = chalkLeeImagePairs(state.doc).map(pair => Decoration.widget(pair.to, () => {
            const row = document.createElement("div");
            row.className = "chalklee-image-pair-row";
            row.dataset.imagePair = pair.id;
            row.dataset.pairFrom = String(pair.from);
            row.dataset.pairTo = String(pair.to);
            row.contentEditable = "false";
            for (const image of pair.images) {
              const cell = document.createElement("div");
              cell.className = "chalklee-image-pair-cell";
              cell.dataset.pairQuestion = String(image.question.attrs.id);
              const slot = document.createElement("div");
              slot.className = "chalklee-image-pair-slot";
              slot.dataset.chalkleeImageSlot = String(image.node.attrs.id);
              const label = document.createElement("div");
              label.className = "chalklee-image-pair-label";
              label.textContent = image.label;
              cell.append(slot, label);
              row.append(cell);
            }
            return row;
          }, { side: -10, key: `${pair.id}:${pair.from}:${pair.to}:${pair.images.map(i => i.label).join(":")}`, ignoreSelection: true, stopEvent: () => true }));
          for (const group of chalkLeeAutomaticImageRows(state.doc)) decorations.push(Decoration.widget(group.to, () => {
            const row = document.createElement("div");
            row.className = "chalklee-auto-image-row";
            row.dataset.automaticImageRow = group.id;
            row.dataset.rowFrom = String(group.from); row.dataset.rowTo = String(group.to);
            row.contentEditable = "false";
            for (const image of group.images) {
              const slot = document.createElement("div");
              slot.className = "chalklee-auto-image-cell";
              slot.dataset.chalkleeImageSlot = String(image.node.attrs.id);
              slot.style.width = `${image.widthPt}pt`;
              row.append(slot);
            }
            return row;
          }, { side: -10, key: `auto:${group.id}:${group.from}:${group.to}:${group.images.map(image => image.widthPt).join(":")}`, ignoreSelection: true, stopEvent: () => true }));
          const result = DecorationSet.create(state.doc, decorations);
          decorationsByDocument.set(state.doc, result);
          return result;
        }
      },
      view(view) {
        let frame = 0;
        let editable = view.editable;
        const announce = () => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => view.dom.dispatchEvent(new Event(CHALKLEE_IMAGE_LAYOUT_EVENT)));
        };
        announce();
        return {
          update(next, previous) {
            if (next.state.doc !== previous.doc || next.editable !== editable) announce();
            editable = next.editable;
          },
          destroy: () => cancelAnimationFrame(frame)
        };
      }
    });
}

/** Keep a short pair's text and picture row on one page. Oversized combinations
 * and multicolumn documents display each original image in its own question. */
export function syncChalkLeeImagePairPagination(content: HTMLElement, scale: number, contentHeight: number) {
  const rows = content.querySelectorAll<HTMLElement>(".chalklee-image-pair-row");
  if (!rows.length) return false;
  const multiColumn = Number(content.closest<HTMLElement>(".chalklee-paper")?.dataset.columnCount ?? 1) > 1;
  const questionsById = new Map<string, HTMLElement>();
  for (const question of content.querySelectorAll<HTMLElement>(".chalklee-question-object")) {
    const id = question.dataset.nodeId;
    if (id !== undefined && !questionsById.has(id)) questionsById.set(id, question);
  }
  let changed = false;
  for (const row of rows) {
    const suspended = row.dataset.suspended === "true";
    const questions = Array.from(row.querySelectorAll<HTMLElement>("[data-pair-question]")).map(cell =>
      questionsById.get(cell.dataset.pairQuestion!));
    if (questions.some(q => !q)) continue;
    const ready = row.querySelectorAll("[data-chalklee-image] img").length === 2;
    if (!suspended && !ready) continue;
    const rowHeight = suspended ? Number(row.dataset.measuredHeight ?? 0) : row.getBoundingClientRect().height / scale;
    if (!suspended) row.dataset.measuredHeight = String(rowHeight);
    let height = rowHeight;
    for (const question of questions) {
      height += question!.getBoundingClientRect().height / scale;
      for (const gap of question!.querySelectorAll<HTMLElement>(".chalklee-page-gap")) height -= gap.getBoundingClientRect().height / scale;
      if (suspended) {
        for (const cell of row.querySelectorAll<HTMLElement>("[data-chalklee-image-slot]")) {
          const source = Array.from(question!.querySelectorAll<HTMLElement>("[data-chalklee-image]")).find(i => i.dataset.nodeId === cell.dataset.chalkleeImageSlot);
          if (source) {
            const style = getComputedStyle(source);
            height -= source.getBoundingClientRect().height / scale + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
          }
        }
      }
    }
    const next = multiColumn || height + 16 > contentHeight;
    if (next !== suspended) { row.dataset.suspended = String(next); changed = true; }
  }
  if (changed) content.dispatchEvent(new Event(CHALKLEE_IMAGE_LAYOUT_EVENT));
  return changed;
}
