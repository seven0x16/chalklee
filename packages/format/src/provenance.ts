import type { ChalkLeeDocument } from "./types";

/**
 * Anchors follow their nodes: drop anchors whose node was deleted or undone, and
 * question-bank (`chalklee`) sources that no longer anchor anything. Import sources
 * stay even without anchors because they describe the whole document's origin.
 */
export function pruneChalkLeeProvenance(document: ChalkLeeDocument): ChalkLeeDocument {
  const provenance = document.provenance;
  if (!provenance || (!provenance.anchors?.length && !provenance.sources.some(source => source.type === "chalklee"))) return document;
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const node = value as { attrs?: { id?: unknown }; content?: unknown };
    if (typeof node.attrs?.id === "string") ids.add(node.attrs.id);
    visit(node.content);
  };
  visit(document.content.content);
  const anchors = provenance.anchors?.filter(anchor => ids.has(anchor.nodeId));
  const anchoredSources = new Set(anchors?.map(anchor => anchor.sourceId));
  const sources = provenance.sources.filter(source => source.type !== "chalklee" || anchoredSources.has(source.id));
  if (anchors?.length === provenance.anchors?.length && sources.length === provenance.sources.length) return document;
  return { ...document, provenance: { ...provenance, sources, ...(anchors ? { anchors } : {}) } };
}
