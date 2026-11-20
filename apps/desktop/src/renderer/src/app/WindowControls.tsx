import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import type { WindowControlState } from "../../../shared/contracts";

/** Windows has no caption bar, so the title bar ends with the window's own buttons, as on macOS it starts with the
 *  traffic lights. The glyphs are sized to one optical width with hairline strokes, quieter than the panel icons. */
export function WindowControls() {
  const controls = window.chalkLee.windowControls;
  const [state, setState] = useState<WindowControlState>({ maximized: false, fullScreen: false });

  useEffect(() => {
    if (!controls) return;
    let reported = false;
    const stop = controls.onState(next => { reported = true; setState(next); });
    void controls.state().then(next => { if (!reported) setState(next); }).catch(() => undefined);
    return stop;
  }, [controls]);

  if (!controls) return null;
  const restore = state.maximized || state.fullScreen;
  return (
    <div className="window-controls" role="group" aria-label="窗口">
      <button type="button" className="window-control" title="最小化" aria-label="最小化" onClick={() => controls.act("minimize")}>
        <Minus size={17} strokeWidth={1} absoluteStrokeWidth aria-hidden="true" />
      </button>
      <button type="button" className="window-control" title={restore ? "还原" : "最大化"} aria-label={restore ? "还原" : "最大化"} onClick={() => controls.act("maximize")}>
        {restore
          ? <Copy className="window-control-restore" size={12} strokeWidth={1} absoluteStrokeWidth aria-hidden="true" />
          : <Square size={13} strokeWidth={1} absoluteStrokeWidth aria-hidden="true" />}
      </button>
      <button type="button" className="window-control is-close" title="关闭" aria-label="关闭" onClick={() => controls.act("close")}>
        <X size={19} strokeWidth={1} absoluteStrokeWidth aria-hidden="true" />
      </button>
    </div>
  );
}
