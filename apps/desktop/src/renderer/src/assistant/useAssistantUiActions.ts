import { useEffect, useRef } from "react";
import type { AssistantUiAction } from "../../../shared/agent/assistant";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Runs the assistant's interface requests with the window's latest state and replies to the main process. */
export function useAssistantUiActions(handler: (action: AssistantUiAction) => Promise<unknown>, enabled: boolean) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const api = window.chalkLee.assistant;
    if (!api || !enabled) return;
    return api.onUiRequest(request => {
      const { requestId, ...action } = request;
      void Promise.resolve()
        .then(() => handlerRef.current(action as AssistantUiAction))
        .then(value => api.replyUiRequest({ requestId, value: value ?? null }), error => api.replyUiRequest({ requestId, error: errorMessage(error) }))
        .catch(() => undefined);
    });
  }, [enabled]);
}

/** Resolve once `ready` holds, re-checking every animation frame until the timeout. */
export function waitUntil(ready: () => boolean, timeoutMs: number, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      if (ready()) resolve();
      else if (performance.now() - started > timeoutMs) reject(new Error(message));
      else window.setTimeout(check, 80);
    };
    check();
  });
}
