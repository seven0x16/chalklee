import type { AgentEditorRequest } from "../../../shared/agent/editing";

/** Only a paper with no edits or undo history can discard its editor instance. */
export interface DormantPaperView {
  zoom: number;
  zoomMode: "manual" | "fit-width";
  scrollTop: number;
  scrollLeft: number;
  showAnswers: boolean;
  showAnalysis: boolean;
  selection: unknown;
  caretPlaced: boolean;
  editorFocused: boolean;
}

type Handler = (request: AgentEditorRequest) => Promise<void>;

/** The tab, not the mounted editor, owns its agent registration. A request
 * addressed to a dormant paper wakes its editor before it can read or write. */
export function createPaperAgentConnection(id: string, wake: () => void, timeoutMs = 10_000) {
  let handler: Handler | undefined;
  let inFlight = 0;
  const waiting = new Set<{ resolve(handler: Handler): void; reject(error: Error): void }>();
  return {
    id,
    get busy() { return inFlight > 0; },
    attach(next: Handler) {
      handler = next;
      for (const waiter of waiting) waiter.resolve(next);
      waiting.clear();
      return () => { if (handler === next) handler = undefined; };
    },
    async dispatch(request: AgentEditorRequest) {
      inFlight++;
      try {
        const ready = handler ?? await new Promise<Handler>((resolve, reject) => {
          const finish = () => { clearTimeout(timer); waiting.delete(waiter); };
          const waiter = { resolve: (next: Handler) => { finish(); resolve(next); }, reject: (error: Error) => { finish(); reject(error); } };
          const timer = setTimeout(() => waiter.reject(new Error("文档尚未就绪，请稍后再试。")), timeoutMs);
          waiting.add(waiter);
          wake();
        });
        await ready(request);
      } finally { inFlight--; }
    },
    dispose() {
      handler = undefined;
      for (const waiter of waiting) waiter.reject(new Error("文档已关闭。"));
      waiting.clear();
    }
  };
}
export type PaperAgentConnection = ReturnType<typeof createPaperAgentConnection>;
