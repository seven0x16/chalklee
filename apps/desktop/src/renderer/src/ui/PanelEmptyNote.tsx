import type { ReactNode } from "react";

/** What an empty right pane shows: its own icon, a title, and optionally a short line or one action. */
export function PanelEmptyNote({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return <div className="panel-empty">
    <span className="panel-empty-icon" aria-hidden="true">{icon}</span>
    <strong>{title}</strong>
    {children}
  </div>;
}
