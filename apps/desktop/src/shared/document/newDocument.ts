import { CHALKLEE_SCHEMA_VERSION, CHALKLEE_STANDARD_APPEARANCE, type ChalkLeeDocument } from "@chalklee/format";

export function createEmptyChalkLeeDocument(
  requestedTitle: string,
  createId: () => string = () => `node_${crypto.randomUUID()}`,
  now = new Date().toISOString()
): ChalkLeeDocument {
  const title = requestedTitle.trim() || "未命名讲义";
  return {
    schemaVersion: CHALKLEE_SCHEMA_VERSION,
    id: `document_${crypto.randomUUID()}`,
    metadata: { title, language: "zh-CN", createdAt: now, updatedAt: now },
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { id: createId(), level: 1, textAlign: "center", lineHeight: 1.95, spaceBeforePt: 0, spaceAfterPt: 0 },
          content: [{
            type: "text",
            text: title,
            marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontSizePt: 16 } }]
          }]
        },
        { type: "paragraph", attrs: { id: createId() } }
      ]
    },
    appearance: structuredClone(CHALKLEE_STANDARD_APPEARANCE) as ChalkLeeDocument["appearance"],
    provenance: { method: "manual", sources: [] }
  };
}
