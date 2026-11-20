import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { chalkLeeNumberAutoformatKey, chalkLeeNumberAutoformatState, confirmChalkLeeNumberAutoformat, continueChalkLeeDecimalInput } from "../numberedBlocks";
import { type ChalkLeeOptionAuthoringStorage, matchChalkLeeQuestionNumberMarkerInput, chalkLeeOptionAuthoringContextIdentity, dispatchChalkLeeFreeAuthoringStatus, chalkLeeSelectedParagraphId, chalkLeeStableNodeId } from "./authoringShared";
import { chalkLeeNumberMarkerEligibility, chalkLeeSameNumberMarkerEligibility, applyChalkLeeNumberMarkerInput, chalkLeeNumberMarkerStatus } from "./numberMarkers";
import { isChalkLeeOptionMarkerSpaceKey, isChalkLeeMarkerTerminatorText, chalkLeeOptionalMarkerSpaceTarget, chalkLeeCanConsumeOptionalMarkerSpace } from "./optionMarkers";

export const ChalkLeeOptionAuthoringExtension = Extension.create<Record<string, never>, ChalkLeeOptionAuthoringStorage>({
  name: "chalkLeeOptionAuthoring",
  priority: 1_200,
  addStorage: () => ({ physicalSpacePending: false, composing: false, generation: 0, timer: null }),
  addProseMirrorPlugins() {
    const storage = this.storage;
    const cancelPending = () => {
      storage.generation += 1;
      if (storage.timer !== null) clearTimeout(storage.timer);
      storage.timer = null;
    };
    return [new Plugin({
      key: chalkLeeNumberAutoformatKey,
      state: chalkLeeNumberAutoformatState,
      props: {
        handleKeyDown(view, event) {
          cancelPending();
          const markerSpace = isChalkLeeOptionMarkerSpaceKey(event, view.composing) && !storage.composing;
          storage.physicalSpacePending = markerSpace;
          if (!markerSpace) storage.optionalMarkerSpace = undefined;
          return false;
        },
        handleTextInput(view, from, to, text) {
          cancelPending();
          const spacePending = storage.physicalSpacePending && !storage.composing && !view.composing;
          storage.physicalSpacePending = false;
          const optionalMarkerSpace = storage.optionalMarkerSpace;
          storage.optionalMarkerSpace = undefined;
          if (spacePending
            && (text === " " || text === "\u3000")
            && optionalMarkerSpace
            && chalkLeeCanConsumeOptionalMarkerSpace(view.state, from, to, optionalMarkerSpace)) {
            confirmChalkLeeNumberAutoformat(view);
            return true;
          }
          if (!storage.composing && !view.composing && continueChalkLeeDecimalInput(view, from, to, text)) {
            dispatchChalkLeeFreeAuthoringStatus(view, "number-restored");
            return true;
          }

          const punctuationPending = !storage.composing
            && !view.composing
            && isChalkLeeMarkerTerminatorText(text);
          if ((!spacePending && !punctuationPending) || from !== to) return false;

          // Typed text only becomes structure for a question number; option and
          // answer markers stay literal and are added with the question's buttons.
          const $from = view.state.doc.resolve(from);
          const textBefore = $from.parent.textBetween(0, $from.parentOffset, "", "\ufffc") + text;
          const numberMarker = matchChalkLeeQuestionNumberMarkerInput(textBefore, true);
          if (!numberMarker) return false;

          // ProseMirror's regular InputRule runs before the trigger character is
          // present. Its inverse therefore restores `1.` instead of the exact
          // teacher input `1. `. Preflight against a state containing the raw
          // space, commit that ordinary typing transaction, then record the
          // semantic conversion as one closed history event. This makes the
          // first undo restore `1. ` and the next undo remove the raw typing
          // cleanly, while a fail-closed raw insertion remains dirty/saveable.
          const rawTransaction = view.state.tr.insertText(text, from, to);
          rawTransaction.setSelection(TextSelection.create(rawTransaction.doc, from + text.length));
          const rawState = view.state.apply(rawTransaction);
          const markerRange = { from: from - (numberMarker.text.length - text.length), to: from + text.length };
          const preflightIdentity = chalkLeeOptionAuthoringContextIdentity(rawState);
          const preflightNumber = chalkLeeNumberMarkerEligibility(rawState, markerRange, numberMarker.number);
          if (!preflightNumber) return false;

          view.dispatch(rawTransaction);
          const actualSelection = view.state.selection;
          if (!(actualSelection instanceof TextSelection) || !actualSelection.empty) return true;
          const actualTo = actualSelection.from;
          const $actual = view.state.doc.resolve(actualTo);
          if (chalkLeeOptionAuthoringContextIdentity(view.state) !== preflightIdentity) return true;
          const structureTransaction = view.state.tr;
          const actualMarker = matchChalkLeeQuestionNumberMarkerInput(
            $actual.parent.textBetween(0, $actual.parentOffset, "", "\ufffc"),
            true
          );
          if (!actualMarker || actualMarker.number !== numberMarker.number) return true;
          const actualRange = { from: actualTo - actualMarker.text.length, to: actualTo };
          const actualEligibility = chalkLeeNumberMarkerEligibility(view.state, actualRange, actualMarker.number);
          if (!actualEligibility
            || !chalkLeeSameNumberMarkerEligibility(actualEligibility, preflightNumber)
            || !applyChalkLeeNumberMarkerInput(view.state, structureTransaction, actualEligibility)) return true;
          const status = chalkLeeNumberMarkerStatus(actualEligibility);
          view.dispatch(structureTransaction);
          if (punctuationPending) {
            storage.optionalMarkerSpace = chalkLeeOptionalMarkerSpaceTarget(view.state);
          }
          view.dispatch(closeHistory(view.state.tr));
          dispatchChalkLeeFreeAuthoringStatus(view, status);
          return true;
        },
        handlePaste() {
          cancelPending();
          storage.physicalSpacePending = false;
          storage.optionalMarkerSpace = undefined;
          return false;
        },
        handleDOMEvents: {
          compositionstart() {
            cancelPending();
            storage.composing = true;
            storage.physicalSpacePending = false;
            storage.optionalMarkerSpace = undefined;
            return false;
          },
          compositionend(view) {
            storage.composing = false;
            storage.physicalSpacePending = false;
            storage.optionalMarkerSpace = undefined;
            cancelPending();
            const generation = storage.generation;
            const paragraphId = chalkLeeSelectedParagraphId(view.state);
            if (!paragraphId) return false;
            storage.timer = setTimeout(() => {
              storage.timer = null;
              if (storage.generation !== generation || view.composing || view.isDestroyed) return;
              const result = applyChalkLeeSelectedNumberMarker(view, paragraphId);
              if (!result) return;
              if (result.armOptionalSpace) {
                storage.optionalMarkerSpace = chalkLeeOptionalMarkerSpaceTarget(view.state);
              }
              view.dispatch(closeHistory(view.state.tr));
              dispatchChalkLeeFreeAuthoringStatus(view, result.status);
            }, 0);
            return false;
          },
          blur() {
            cancelPending();
            storage.composing = false;
            storage.physicalSpacePending = false;
            storage.optionalMarkerSpace = undefined;
            return false;
          },
          mousedown() {
            cancelPending();
            storage.optionalMarkerSpace = undefined;
            return false;
          }
        }
      },
      view() {
        return { destroy: cancelPending };
      }
    })];
  }
});

function applyChalkLeeSelectedNumberMarker(view: EditorView, expectedParagraphId: string) {
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection)
    || !selection.empty
    || selection.$from.parent.type.name !== "paragraph"
    || chalkLeeStableNodeId(selection.$from.parent) !== expectedParagraphId
    || selection.from !== selection.$from.end(selection.$from.depth)) return null;
  const text = selection.$from.parent.textBetween(0, selection.$from.parentOffset, "", "\ufffc");
  const numberMarker = matchChalkLeeQuestionNumberMarkerInput(text, true);
  if (!numberMarker) return null;
  const transaction = view.state.tr;
  const range = { from: selection.from - numberMarker.text.length, to: selection.from };
  const eligibility = chalkLeeNumberMarkerEligibility(view.state, range, numberMarker.number);
  if (!eligibility || !applyChalkLeeNumberMarkerInput(view.state, transaction, eligibility)) return null;
  view.dispatch(transaction);
  return {
    status: chalkLeeNumberMarkerStatus(eligibility),
    armOptionalSpace: !/[ \u3000]$/u.test(numberMarker.text)
  };
}
