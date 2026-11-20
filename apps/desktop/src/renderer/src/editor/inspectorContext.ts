import { createContext, useContext } from "react";
import type { ChalkLeePageAppearance } from "@chalklee/format";
import type { ChalkLeePagePatch } from "./pageSettings";
import type { ChalkLeePaperSettings } from "./paperSettings";
import type { ChalkLeePaperElement, ChalkLeePaperElements, ChalkLeePaperElementsPatch } from "./paperElements";
import type { AssistantPointedAt } from "../../../shared/agent/assistant";

export interface ChalkLeeInspectorTarget {
  owner: HTMLElement;
  filePath: string;
  questionId: string | null;
  questionLabel: string | null;
  /** A box selected whole, shown with its own properties when no question is selected. */
  boxId?: string | null;
  /** A cover, contents, header or footer selected on the paper, shown with its own style. */
  paperElement?: ChalkLeePaperElement | null;
  /** A box the caret is in, or selected text, when no question is selected. */
  pointedAt?: AssistantPointedAt | null;
  page: ChalkLeePageAppearance;
  changePage?(patch: ChalkLeePagePatch): void;
  /** Cover, contents, header and footer, turned on and off in the paper settings. */
  paperElements?: ChalkLeePaperElements;
  changePaperElements?(patch: ChalkLeePaperElementsPatch): void;
  paper: ChalkLeePaperSettings;
  /** Title and opening lines, where a paper names its own year and grade. */
  paperLead: string;
  documentTags?: readonly string[];
  changePaper?(patch: Partial<ChalkLeePaperSettings>): void;
}

/** A background editor must never leak its target into another document's inspector. */
export function activeChalkLeeInspectorTarget(target: ChalkLeeInspectorTarget | null, filePath?: string, extension?: string) {
  return extension === "chalklee" && target?.filePath === filePath ? target : null;
}

export function updateChalkLeeInspectorTarget(current: ChalkLeeInspectorTarget | null, next: ChalkLeeInspectorTarget) {
  return current?.owner === next.owner && current.filePath === next.filePath
    && current.questionId === next.questionId && current.questionLabel === next.questionLabel && current.boxId === next.boxId && current.paperElement === next.paperElement && current.pointedAt === next.pointedAt
    && current.page === next.page && current.changePage === next.changePage
    && current.paperElements === next.paperElements && current.changePaperElements === next.changePaperElements
    && current.paper === next.paper && current.paperLead === next.paperLead && current.documentTags === next.documentTags
    && current.changePaper === next.changePaper ? current : next;
}

/** Selection updates properties without switching the right pane's current content. */
export const ChalkLeeInspectorContext = createContext<{
  host: HTMLDivElement | null;
  setHost(host: HTMLDivElement | null): void;
  updateTarget(target: ChalkLeeInspectorTarget): void;
  releaseTarget(owner: HTMLElement): void;
  propertiesVisible: boolean;
  propertiesAvailable?: boolean;
  showProperties(): void;
  /** A request to ChalkLee AI in the teacher's words; a draft waits in the message box. Absent without the assistant. */
  askAssistant?(text: string, options?: { draft?: boolean }): void;
}>({
  host: null, setHost: () => undefined,
  updateTarget: () => undefined, releaseTarget: () => undefined,
  propertiesVisible: false, showProperties: () => undefined
});

export const useChalkLeeInspector = () => useContext(ChalkLeeInspectorContext);

/**
 * Only whether the properties pane can open and is open: what every question and box on the paper needs for its
 * "属性" button. Kept apart from the selection, so selecting something does not redraw every question of a long paper.
 */
export const ChalkLeePropertiesToggleContext = createContext<{ propertiesVisible: boolean; propertiesAvailable?: boolean; showProperties(): void }>({
  propertiesVisible: false, showProperties: () => undefined
});
export const useChalkLeePropertiesToggle = () => useContext(ChalkLeePropertiesToggleContext);
