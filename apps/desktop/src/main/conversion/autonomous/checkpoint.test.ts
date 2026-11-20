import { describe, expect, it } from "vitest";
import { referenceUnitFingerprints, resumeReferenceDraft } from "./checkpoint";
import { newAutonomousDraft } from "./state";
import { importAppearance } from "../../../shared/conversion/importDocument";
import type { PreparedImport } from "../../../shared/conversion/types";

describe("reference checkpoint recovery", () => {
  it("invalidates attached continuations but preserves independent later questions", () => {
    const draft = newAutonomousDraft();
    draft.fragments = [1, 2, 3, 4].map(n => ({ key: `q${n}`, order: n, unitIds: [`page_${n}`], blocks: [{ ref: `p${n}` }], warnings: [], continuesPrevious: n === 2 }));
    const current = { page_1: "recovered", page_2: "same2", page_3: "same3", page_4: "changed" };
    const recovered = resumeReferenceDraft(draft, { ...current, page_1: "failed", page_4: "old" }, current)!;
    expect(recovered.fragments.map(fragment => fragment.key)).toEqual(["q3"]);
    expect(draft.fragments).toHaveLength(4);
    expect(resumeReferenceDraft(draft, undefined, current)).toBeUndefined();
  });
  it("detects a changed recognized ref or cropped image even if the ID is unchanged", () => {
    const input: PreparedImport = { sourcePath: "/test.pdf", sourceHash: "immutable", page: importAppearance().page, warnings: [], units: [{
      id: "page_1", page: 1, label: "第1页", nativeReferences: true,
      blocks: [{ type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "Original" }] }],
      images: ["page_1", "figure_1"].map(id => ({ id, dataUrl: "original pixels", widthPt: 100, heightPt: 100 }))
    }] };
    const original = referenceUnitFingerprints(input);
    input.units[0].images[0].dataUrl = "different rasterization of the same immutable source";
    expect(referenceUnitFingerprints(input)).toEqual(original);
    input.units[0].images[1].dataUrl = "changed crop";
    expect(referenceUnitFingerprints(input)).not.toEqual(original);
    input.units[0].images[1].dataUrl = "original pixels";
    const paragraph = input.units[0].blocks[0];
    if (paragraph.type === "paragraph" && paragraph.content?.[0]?.type === "text") paragraph.content[0].text = "Changed";
    expect(referenceUnitFingerprints(input)).not.toEqual(original);
  });
});
