import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { workspaceEntryName, workspaceRenameName, type WorkspaceCreationKind } from "../../../shared/workspace/names";
import type { DocumentKind, WorkspaceNode } from "../../../shared/contracts";
import { DocumentFileIcon } from "../ui/DocumentFileIcon";
import { WorkspaceFolderIcon } from "../ui/WorkspaceFolderIcon";

export interface WorkspaceTreeCreation {
  id: number;
  kind: WorkspaceCreationKind;
  directoryPath: string;
  initialName: string;
}

export interface WorkspaceTreeCreationControls {
  creation: WorkspaceTreeCreation;
  onCreate(name: string): Promise<void>;
  onCancel(): void;
}

export function WorkspaceTreeCreateRow({ creation, depth, onCreate, onCancel }: WorkspaceTreeCreationControls & { depth: number }) {
  return <WorkspaceTreeNameRow initialName={creation.initialName} kind={creation.kind} depth={depth}
    focusKey={creation} label={creation.kind === "chalklee" ? "新建 ChalkLee 名称" : "新建文件夹名称"}
    validate={name => workspaceEntryName(name, creation.kind)} onSubmit={onCreate} onCancel={onCancel} />;
}

export interface WorkspaceTreeRenameControls {
  node: WorkspaceNode;
  id: number;
  onRename(name: string): Promise<void>;
  onCancel(): void;
}

export function WorkspaceTreeRenameRow({ node, id, depth, open, onRename, onCancel }: WorkspaceTreeRenameControls & { depth: number; open?: boolean }) {
  return <WorkspaceTreeNameRow initialName={node.name} kind={node.kind === "directory" ? "directory" : node.extension}
    depth={depth} focusKey={id} label="重命名" open={open} renaming
    validate={name => workspaceRenameName(name, node.name, node.kind)} onSubmit={onRename} onCancel={onCancel} />;
}

function WorkspaceTreeNameRow({ initialName, kind, depth, focusKey, label, open = false, renaming = false, validate, onSubmit, onCancel }: {
  initialName: string; kind: DocumentKind | "directory"; depth: number; focusKey: unknown; label: string; open?: boolean; renaming?: boolean;
  validate(name: string): string; onSubmit(name: string): Promise<void>; onCancel(): void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const canceled = useRef(false);
  const composing = useRef(false);
  const errorId = useId();

  useEffect(() => {
    const input = inputRef.current;
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(0, kind !== "directory" ? input.value.replace(/\.[^.]+$/, "").length : input.value.length);
    input?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focusKey, kind]);

  async function submit() {
    if (pending.current || canceled.current || composing.current) return;
    pending.current = true;
    try {
      const normalized = validate(name);
      setError(null);
      setBusy(true);
      await onSubmit(normalized);
    } catch (reason) {
      setError((reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': Error: /, ""));
      inputRef.current?.focus({ preventScroll: true });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <div className={`workspace-tree-creation${renaming ? " workspace-tree-renaming" : ""}`} style={{ "--tree-depth": depth } as React.CSSProperties}>
    <div className={`workspace-tree-create-row ${kind !== "directory" ? "tree-file" : "tree-folder-label"}`} aria-busy={busy}>
      {kind !== "directory" ? <DocumentFileIcon kind={kind} /> : <><ChevronDown size={13} className={open ? "" : "collapsed"} /><WorkspaceFolderIcon open={open} /></>}
      <input ref={inputRef} value={name} maxLength={120} readOnly={busy} spellCheck={false}
        aria-label={label}
        aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
        onChange={event => { setName(event.target.value); setError(null); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onBlur={() => { void submit(); }}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
          if (event.key === "Enter") { event.preventDefault(); void submit(); }
          if (event.key === "Escape" && !pending.current) { event.preventDefault(); canceled.current = true; onCancel(); }
        }} />
    </div>
    {error ? <div className="workspace-tree-create-error" id={errorId} role="alert">{error}</div> : null}
  </div>;
}
