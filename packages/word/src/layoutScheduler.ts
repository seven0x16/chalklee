/** Release the UI thread between bounded chunks so paint/input/close can run.
 * MessageChannel avoids nested timers' delay; a promise alone is a microtask.
 */
export function createLayoutCheckpoint(signal: AbortSignal, budget = 12): (force?: boolean) => Promise<void> {
  let started = performance.now();
  return async (force = false) => {
    signal.throwIfAborted();
    if (!force && performance.now() - started < budget) return;
    await new Promise<void>(resolve => {
      if (typeof MessageChannel === "undefined") { setTimeout(resolve, 0); return; }
      const channel = new MessageChannel();
      channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
      channel.port2.postMessage(null);
    });
    signal.throwIfAborted();
    started = performance.now();
  };
}
