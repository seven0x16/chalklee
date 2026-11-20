import { setTimeout as delay } from "node:timers/promises";
import type { Agent } from "@earendil-works/pi-agent-core";
import { isTransientImportFailure } from "../../shared/conversion/failure";

export { isTransientImportFailure };

/** Retry one failed request from its existing tool context, without replaying tools. */
export async function runImportWithRecovery(agent: Agent, start: () => Promise<void>, signal: AbortSignal, onRetry?: (quota: boolean) => void, waitForQuota = false): Promise<void> {
  await start();
  signal.throwIfAborted();
  const last = agent.state.messages.at(-1);
  if (last?.role !== "assistant" || last.stopReason !== "error") return;
  // Some compatible services use the same quota error for time-window token
  // limits. The whole-document runner may wait once, never immediately loop.
  const quota = /insufficient_quota|allocated quota exceeded/i.test(last.errorMessage ?? "");
  if (!(quota && waitForQuota) && !isTransientImportFailure(last.errorMessage ?? "")) return;
  // A failed response must not have side effects or be treated as a successful
  // inspection turn. Keep all earlier user/tool messages, including latest images.
  const previous = agent.state.messages.at(-2);
  if (!previous || !["user", "toolResult"].includes(previous.role)) return;
  onRetry?.(quota);
  await delay(quota ? 60000 : 400, undefined, { signal });
  signal.throwIfAborted();
  agent.state.messages = agent.state.messages.slice(0, -1);
  await agent.continue();
  signal.throwIfAborted();
}
