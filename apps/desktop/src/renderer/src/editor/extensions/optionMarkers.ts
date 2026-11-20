import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { type ChalkLeeOptionAuthoringStorage, chalkLeeOptionAuthoringContextIdentity, chalkLeeStableNodeId } from "./authoringShared";

/** A real, unmodified Space remains a supported marker completion key. */
export function isChalkLeeOptionMarkerSpaceKey(
  event: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; isComposing?: boolean; repeat?: boolean },
  viewComposing = false
) {
  return (event.key === " " || event.key === "Space" || event.key === "Spacebar")
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
    && !event.isComposing
    && !event.repeat
    && !viewComposing;
}

export function isChalkLeeMarkerTerminatorText(text: string) {
  // Browsers normally report one physical character here, but an IME,
  // accessibility keyboard, or native text service may commit the exact
  // marker as one chunk (for example `21.` or `A.`). The later exact-marker
  // and structural-eligibility checks remain the authority, so accepting a
  // chunk that merely ends in a terminator does not broaden what can convert.
  return /[.．。、)）]$/.test(text);
}

export function chalkLeeOptionalMarkerSpaceTarget(state: EditorState): ChalkLeeOptionAuthoringStorage["optionalMarkerSpace"] {
  const selection = state.selection;
  if (!(selection instanceof TextSelection)
    || !selection.empty
    || selection.$from.parent.type.name !== "paragraph"
    || selection.$from.parentOffset !== 0
    || selection.$from.parent.content.size !== 0) return undefined;
  const paragraphId = chalkLeeStableNodeId(selection.$from.parent);
  if (!paragraphId) return undefined;
  return {
    paragraphId,
    contextIdentity: chalkLeeOptionAuthoringContextIdentity(state)
  };
}

export function chalkLeeCanConsumeOptionalMarkerSpace(
  state: EditorState,
  from: number,
  to: number,
  target: NonNullable<ChalkLeeOptionAuthoringStorage["optionalMarkerSpace"]>
) {
  const selection = state.selection;
  return from === to
    && selection instanceof TextSelection
    && selection.empty
    && selection.from === from
    && selection.$from.parent.type.name === "paragraph"
    && selection.$from.parentOffset === 0
    && selection.$from.parent.content.size === 0
    && chalkLeeStableNodeId(selection.$from.parent) === target.paragraphId
    && chalkLeeOptionAuthoringContextIdentity(state) === target.contextIdentity;
}
