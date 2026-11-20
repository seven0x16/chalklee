import type { Node as PMNode } from "@tiptap/pm/model";
import { chalkLeeAutoTableColumnWeights as storedTableColumnWeights } from "../../../shared/document/tableColumns";

/** Relative preferred widths for tables without authored column widths, shared with Word export. */
export function chalkLeeAutoTableColumnWeights(table: PMNode): number[] {
  return storedTableColumnWeights(table.toJSON());
}
