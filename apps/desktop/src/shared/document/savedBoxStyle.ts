import type { ChalkLeeBoxStyle } from "@chalklee/format";

/** A box style the teacher saved in 我的样式; `id` names its copy in a document as `box.mine-<id>`. */
export interface SavedBoxStyle { id: string; name: string; style: ChalkLeeBoxStyle; savedAt: string }

export const chalkLeeSavedBoxStyleName = (id: string) => `box.mine-${id}`;
