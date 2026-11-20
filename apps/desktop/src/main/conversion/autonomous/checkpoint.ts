import { createHash } from "node:crypto";
import type { PreparedImport } from "../../../shared/conversion/types";
import type { AutonomousDraft } from "./state";

/** The original file/model already scopes the cache directory. Recognition
 * results and cropped pixels still need their own identity inside that scope. */
export function referenceUnitFingerprints(input: PreparedImport): Record<string, string> {
  return Object.fromEntries(input.units.map(unit => [unit.id, createHash("sha256").update(JSON.stringify([
    input.page, { ...unit, images: unit.images.map(image => image.id === unit.id && unit.page ? { ...image, dataUrl: undefined } : image) }
  ])).digest("hex")]));
}

/** Reuse completed assembly when a failed page is recognized on continuation.
 * A changed page invalidates its whole fragment and any attached continuation,
 * never the unrelated, unchanged questions. Old checkpoints need exact input. */
export function resumeReferenceDraft(draft: AutonomousDraft, previous: Record<string, string> | undefined, current: Record<string, string>): AutonomousDraft | undefined {
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) return undefined;
  const stable = new Set(Object.keys(current).filter(id => previous[id] === current[id]));
  const kept = new Set<string>();
  let previousKept = false;
  for (const fragment of [...draft.fragments].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))) {
    previousKept = fragment.unitIds.length > 0 && fragment.unitIds.every(id => stable.has(id))
      && (!fragment.continuesPrevious || previousKept);
    if (previousKept) kept.add(fragment.key);
  }
  if (!kept.size) return undefined;
  return {
    ...draft, revision: draft.revision + 1,
    fragments: draft.fragments.filter(fragment => kept.has(fragment.key)),
    figures: draft.figures.filter(figure => stable.has(figure.unitId)),
    seenUnits: draft.seenUnits.filter(id => stable.has(id)),
    sourceChecks: [],
    sourceRevisions: draft.sourceRevisions?.filter(revision => stable.has(revision.unitId))
  };
}
