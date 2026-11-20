import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const CLOCK_TICK_MS = 5_000;
const clockListeners = new Set<() => void>();
let clockNow = Date.now();
let clockTimer: number | undefined;

function subscribeToClock(listener: () => void) {
  if (!clockListeners.size) {
    clockNow = Date.now();
    clockTimer = window.setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach(notify => notify());
    }, CLOCK_TICK_MS);
  }
  clockListeners.add(listener);
  return () => {
    clockListeners.delete(listener);
    if (!clockListeners.size) window.clearInterval(clockTimer);
  };
}
const subscribeToNothing = () => () => undefined;
const readClock = () => clockNow;

/**
 * The time every conversion surface reads while a task runs. One shared tick keeps the
 * banner and the task list on the same minute. Connection heartbeats do not count as conversion progress.
 */
export function useConversionClock(enabled: boolean) {
  return useSyncExternalStore(enabled ? subscribeToClock : subscribeToNothing, readClock);
}

export function useCopiedFlag<T = true>(): [T | null, (value?: T) => void] {
  const [copied, setCopied] = useState<T | null>(null);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const flash = useCallback((value?: T) => {
    window.clearTimeout(timer.current);
    setCopied((value ?? true) as T);
    timer.current = window.setTimeout(() => setCopied(null), 2000);
  }, []);
  return [copied, flash];
}
