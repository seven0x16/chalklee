import { useLayoutEffect, useRef, type ReactNode } from "react";
import { chalkLeeElementScale } from "./viewport";

export function ChalkLeeObjectActions({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const toolbar = ref.current;
    if (!toolbar) return;
    // The editor updates this value on zoom changes. Set it when opening a menu as well.
    toolbar.style.setProperty("--chalklee-editor-inverse-zoom", String(1 / chalkLeeElementScale(toolbar)));
    const frame = window.requestAnimationFrame(() => toolbar.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return <div ref={ref} className="chalklee-question-object-actions" role="toolbar" aria-label={label}>{children}</div>;
}
