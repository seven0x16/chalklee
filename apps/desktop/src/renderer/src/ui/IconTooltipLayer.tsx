import { useEffect, useLayoutEffect, useRef, useState } from "react";

type TooltipPlacement = "top" | "right" | "bottom" | "left";

interface TooltipState {
  label: string;
  left: number;
  top: number;
  placement: TooltipPlacement;
  variant: "default" | "filename";
}

export function IconTooltipLayer() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const tooltipElementRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = tooltipElementRef.current;
    if (!element || !tooltip) return;
    element.style.marginLeft = "0px";
    element.style.marginTop = "0px";
    const rect = element.getBoundingClientRect();
    const viewportInset = 8;
    const horizontalNudge = rect.left < viewportInset
      ? viewportInset - rect.left
      : rect.right > window.innerWidth - viewportInset
        ? window.innerWidth - viewportInset - rect.right
        : 0;
    const verticalNudge = rect.top < viewportInset
      ? viewportInset - rect.top
      : rect.bottom > window.innerHeight - viewportInset
        ? window.innerHeight - viewportInset - rect.bottom
        : 0;
    element.style.marginLeft = `${horizontalNudge}px`;
    element.style.marginTop = `${verticalNudge}px`;
  }, [tooltip]);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const restoreTitle = (target: HTMLElement | null) => {
      if (!target?.dataset.chalkLeeTooltip) return;
      target.title = target.dataset.chalkLeeTooltip;
      delete target.dataset.chalkLeeTooltip;
    };

    const resolveTarget = (node: EventTarget | null) => {
      if (!(node instanceof Element)) return null;
      return node.closest<HTMLElement>("[data-overflow-tooltip], button[title], a[title], label[title]");
    };

    const tooltipFor = (target: HTMLElement): TooltipState => {
      const rect = target.getBoundingClientRect();
      const filename = target.dataset.overflowTooltip;
      const label = filename ?? target.dataset.chalkLeeTooltip ?? target.title;
      const variant = filename === undefined ? "default" : "filename";
      if (target.closest(".workspace-side-rail")) {
        return { label, left: rect.left - 8, top: rect.top + rect.height / 2, placement: "left", variant };
      }
      if (target.closest(".complete-activity-rail")) {
        return { label, left: rect.right + 8, top: rect.top + rect.height / 2, placement: "right", variant };
      }
      if (target.closest(".app-titlebar, .window-controls, .complete-topbar, .sidebar-pane-header")) {
        return { label, left: rect.left + rect.width / 2, top: rect.bottom + 8, placement: "bottom", variant };
      }
      // Question controls sit in the paper margin beside the number; their tips stay in the margin.
      if (target.closest(".workspace-inspector, .chalklee-question-grip, .chalklee-question-basket-mark")) {
        return { label, left: rect.left - 8, top: rect.top + rect.height / 2, placement: "left", variant };
      }
      return { label, left: rect.left + rect.width / 2, top: rect.top - 8, placement: "top", variant };
    };

    const show = (target: HTMLElement) => {
      if (activeTargetRef.current === target) return;
      clearTimer();
      restoreTitle(activeTargetRef.current);
      activeTargetRef.current = null;
      setTooltip(null);
      const overflowLabel = target.dataset.overflowTooltip;
      if (overflowLabel !== undefined && target.scrollWidth <= target.clientWidth) return;
      const label = overflowLabel ?? target.title;
      if (!label) return;
      activeTargetRef.current = target;
      if (target.title) {
        target.dataset.chalkLeeTooltip = target.title;
        target.removeAttribute("title");
      }
      timerRef.current = window.setTimeout(() => setTooltip(tooltipFor(target)), 320);
    };

    const hide = (target?: HTMLElement | null) => {
      if (target && activeTargetRef.current !== target) return;
      clearTimer();
      restoreTitle(activeTargetRef.current);
      activeTargetRef.current = null;
      setTooltip(null);
    };

    const onPointerOver = (event: PointerEvent) => {
      const target = resolveTarget(event.target);
      if (target) show(target);
    };
    const onPointerOut = (event: PointerEvent) => {
      const target = activeTargetRef.current;
      if (!target) return;
      if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
      hide(target);
    };
    const onPointerDown = () => hide();
    const onFocusIn = (event: FocusEvent) => {
      const target = resolveTarget(event.target);
      if (target) show(target);
    };
    const onFocusOut = (event: FocusEvent) => hide(resolveTarget(event.target));
    const reposition = () => {
      const target = activeTargetRef.current;
      if (!target?.isConnected) return hide();
      setTooltip(tooltipFor(target));
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      clearTimer();
      restoreTitle(activeTargetRef.current);
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, []);

  if (!tooltip) return null;
  return <div ref={tooltipElementRef} className="complete-icon-tooltip" data-placement={tooltip.placement} data-variant={tooltip.variant} role="tooltip" style={{ left: tooltip.left, top: tooltip.top }}>{tooltip.label}</div>;
}
