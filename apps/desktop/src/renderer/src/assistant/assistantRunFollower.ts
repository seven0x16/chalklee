import type { AssistantConversation } from "../../../shared/agent/assistant";

/** What a request made elsewhere in the window wants to know about the run it starts. */
export interface AssistantRunFollow {
  /** Workspace-relative path of the document the run is meant to change. */
  document: string;
  /** The run is over. A change can be reported just after the run ends, so `false` may be followed by `true`. */
  onEnded(edited: boolean): void;
  /** The change was put back from the run's reply. */
  onUndone(): void;
}

type FollowedConversation = Pick<AssistantConversation, "id" | "running" | "error" | "undoable" | "messages">;

/** A run stopped or failed midway may have changed the document without finishing what it was asked. */
const finished = (conversation: FollowedConversation) => {
  const reply = conversation.messages.findLast(message => message.role === "assistant");
  return !conversation.error && !(reply?.role === "assistant" && ["aborted", "error"].includes(reply.stopReason ?? ""));
};

/** Follows one run through the conversation updates, until a later run replaces what it can undo. */
export function assistantRunFollower(follow: AssistantRunFollow) {
  let phase: "waiting" | "running" | "ended" | "edited" | "done" = "waiting";
  let conversationId: string | undefined;
  const stop = () => {
    if (phase === "running") follow.onEnded(false);
    phase = "done";
  };
  const update = (conversation: FollowedConversation | null) => {
    if (phase === "done") return;
    if (phase === "waiting") {
      if (conversation?.running) { phase = "running"; conversationId = conversation.id; }
      return;
    }
    if (!conversation || conversation.id !== conversationId) { stop(); return; }
    const changed = !!conversation.undoable?.includes(follow.document);
    if (phase === "edited") {
      if (conversation.running) phase = "done";
      else if (!changed) { phase = "done"; follow.onUndone(); }
      return;
    }
    if (phase === "running") {
      if (conversation.running) return;
      phase = "ended";
      if (!changed || !finished(conversation)) { follow.onEnded(false); return; }
    }
    if (conversation.running) phase = "done";
    else if (changed && finished(conversation)) { phase = "edited"; follow.onEnded(true); }
  };
  return { update, stop };
}
