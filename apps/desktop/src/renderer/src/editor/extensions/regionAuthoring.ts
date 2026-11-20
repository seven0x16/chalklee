import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { chalkLeeRegionExitKey } from "../regionExit";
import { chalkLeeNodeIdOccursOnce, chalkLeeStableNodeId } from "./authoringShared";
import { type ChalkLeeQuestionRegionNavigationSeparatorEvidence, type ChalkLeeQuestionRegionNavigationSeparatorMatcher, splitChalkLeeQuestionRegionMarkerPaste, handleChalkLeeQuestionRegionMarkerTextInput } from "./regionMarkers";
import { handleChalkLeeQuestionFlowKeyDown } from "./questionKeys";

export const ChalkLeeQuestionRegionAuthoringExtension = Extension.create({
  name: "chalkLeeQuestionRegionAuthoring",
  priority: 1_190,
  addProseMirrorPlugins() {
    const runtimeNavigationSeparators = new Map<
      string,
      Omit<ChalkLeeQuestionRegionNavigationSeparatorEvidence, "paragraphId">
    >();
    const rememberRuntimeNavigationSeparator = ({
      paragraphId,
      ...evidence
    }: ChalkLeeQuestionRegionNavigationSeparatorEvidence) => {
      runtimeNavigationSeparators.set(paragraphId, evidence);
    };
    const matchesRuntimeNavigationSeparator: ChalkLeeQuestionRegionNavigationSeparatorMatcher = (
      state,
      source,
      paragraph,
      followingParagraph
    ) => {
      if (paragraph.type.name !== "paragraph" || paragraph.content.size !== 0 || paragraph.attrs.listType != null) {
        return false;
      }
      const paragraphId = chalkLeeStableNodeId(paragraph);
      const followingParagraphId = chalkLeeStableNodeId(followingParagraph);
      const containerId = chalkLeeStableNodeId(source);
      if (!paragraphId || !followingParagraphId || !containerId) return false;
      const evidence = runtimeNavigationSeparators.get(paragraphId);
      return Boolean(evidence
        && evidence.containerId === containerId
        && evidence.containerType === source.type.name
        && evidence.followingParagraphId === followingParagraphId
        && paragraph.sameMarkup(evidence.paragraphMarkup)
        && chalkLeeNodeIdOccursOnce(state.doc, paragraphId)
        && chalkLeeNodeIdOccursOnce(state.doc, followingParagraphId)
        && chalkLeeNodeIdOccursOnce(state.doc, containerId));
    };
    return [new Plugin({
      key: chalkLeeRegionExitKey,
      props: {
        handleKeyDown(view, event) {
          if (view.composing) return false;
          return handleChalkLeeQuestionFlowKeyDown(view, event, {
            onSplitEmptyParagraph: rememberRuntimeNavigationSeparator
          });
        },
        // Typed `答案：` / `解析：` stay literal; only a pasted marker line becomes a region.
        handlePaste(view, event) {
          if (view.composing) return false;
          const text = event.clipboardData?.getData("text/plain") ?? "";
          const pasted = splitChalkLeeQuestionRegionMarkerPaste(text);
          if (!pasted) return false;
          return handleChalkLeeQuestionRegionMarkerTextInput(
            view,
            view.state.selection.from,
            view.state.selection.to,
            pasted.marker.text,
            {
              atomicHistory: true,
              body: pasted.body,
              matchesRuntimeNavigationSeparator
            }
          );
        }
      }
    })];
  }
});
