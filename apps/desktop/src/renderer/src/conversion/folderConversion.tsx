import { isConvertibleKind, isOriginalKind } from "../../../shared/document/kinds";
import { useState } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceDirectoryNode, WorkspaceFileNode, WorkspaceNode } from "../../../shared/contracts";
import { conversionIsActive, type ConversionTask } from "../../../shared/conversion/tasks";
import { ImportDialog } from "./SingleImport";
import { findWorkspaceNode } from "../workspace/breadcrumbs";

/**
 * What a right-click can convert: originals in the folder (or the file itself) that have no ChalkLee yet and are not converting.
 * A folder leaves out originals marked as not needing conversion; a file chosen on its own is converted as asked.
 */
export interface ConversionTargets { start: WorkspaceFileNode[]; converted: number; running: number; notNeeded: number }

export function conversionTargets(node: WorkspaceNode, tasks: readonly ConversionTask[]): ConversionTargets {
  const originals = (item: WorkspaceNode): WorkspaceFileNode[] => item.kind === "file"
    ? (node.kind === "file" ? isConvertibleKind : isOriginalKind)(item.extension) ? [item] : []
    : item.children.flatMap(originals);
  const active = new Set(tasks.filter(conversionIsActive).map(task => task.source.path));
  const targets: ConversionTargets = { start: [], converted: 0, running: 0, notNeeded: 0 };
  for (const file of originals(node)) {
    if (active.has(file.path)) targets.running++;
    else if (file.noConversion && node.kind === "directory") targets.notNeeded++;
    // An original edited after conversion is reconverted from its banner, not swept into a batch.
    else if (file.convertedTo?.length || file.earlierConversions?.length) targets.converted++;
    else targets.start.push(file);
  }
  return targets;
}

/** What a drop of files and folders brought in that can still be converted; null once none is left. */
export function importedConversionTargets(root: WorkspaceDirectoryNode, paths: readonly string[], tasks: readonly ConversionTask[]): ConversionTargets | null {
  const targets: ConversionTargets = { start: [], converted: 0, running: 0, notNeeded: 0 };
  for (const entry of paths) {
    const node = findWorkspaceNode(root, entry);
    if (!node || node.kind === "file" && !isOriginalKind(node.extension)) continue;
    const found = conversionTargets(node, tasks);
    targets.start.push(...found.start); targets.converted += found.converted; targets.running += found.running; targets.notNeeded += found.notNeeded;
  }
  return targets.start.length ? targets : null;
}

/** Several conversions spend the teacher's model quota and time, so they are confirmed once, with the originals to pick. */
export function BatchConversionDialog({ root, targets, model, onConfirm, onClose }: {
  root: WorkspaceDirectoryNode; targets: ConversionTargets; model?: string;
  onConfirm(files: WorkspaceFileNode[]): Promise<void>; onClose(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const chosen = targets.start.filter(file => !skipped.has(file.path));
  const groups = new Map<string, WorkspaceFileNode[]>();
  for (const file of targets.start) {
    const folder = file.path.slice(root.path.length + 1).split(/[\\/]/).slice(0, -1).join("/");
    groups.set(folder, [...(groups.get(folder) ?? []), file]);
  }
  const toggle = (paths: string[], on: boolean) => setSkipped(current => {
    const next = new Set(current);
    for (const item of paths) if (on) next.delete(item); else next.add(item);
    return next;
  });
  const left = [targets.converted ? `${targets.converted} 份已有转换结果` : "", targets.running ? `${targets.running} 份正在转换` : "",
    targets.notNeeded ? `${targets.notNeeded} 份不需要转换` : ""].filter(Boolean);
  const all = chosen.length === targets.start.length;
  // Opened from the sidebar, whose layout would clip a fixed overlay; the dialog belongs to the whole window.
  return createPortal(<ImportDialog title={`转换 ${targets.start.length} 份原稿为 ChalkLee`} onClose={onClose}>
    <p>选好要转换的原稿，ChalkLee AI 会在后台逐份转换{left.length ? `；${left.join("、")}，不再列出` : ""}。原稿保持不变。</p>
    <div className="conversion-batch-picker" role="group" aria-label="要转换的原稿">
      <label className="conversion-batch-all"><input type="checkbox" checked={all} ref={input => { if (input) input.indeterminate = !all && chosen.length > 0; }}
        onChange={event => toggle(targets.start.map(file => file.path), event.currentTarget.checked)} /><span>全选</span><small>已选 {chosen.length} / {targets.start.length} 份</small></label>
      {[...groups].map(([folder, files]) => <section key={folder}>
        {groups.size > 1 || folder ? <h4>{folder ? `${folder}/` : "根目录"}</h4> : null}
        {files.map(file => <label key={file.path}><input type="checkbox" checked={!skipped.has(file.path)} onChange={event => toggle([file.path], event.currentTarget.checked)} /><span>{file.name}</span></label>)}
      </section>)}
    </div>
    <ul className="conversion-batch-notes">
      <li>使用{model ? `「${model}」` : "当前所选模型"}转换。一次转换多份会消耗较多 tokens（模型额度），份数和页数越多用量越大，可以先挑几份试试。</li>
      <li>同时转换 2 份，其余排队；可以继续编辑其他文档，也可以关闭转换任务。</li>
      <li>转换任务中可随时“全部停止”，已整理的部分会保存，之后“继续”接着转换，不从头开始。</li>
      <li>每份转换完成后可在转换任务中逐份打开查看，不自动打开。</li>
    </ul>
    <footer>
      <button type="button" onClick={onClose}>取消</button>
      <button type="button" className="primary" disabled={busy || !chosen.length} onClick={() => { setBusy(true); void onConfirm(chosen).finally(() => setBusy(false)); }}>开始转换 {chosen.length} 份</button>
    </footer>
  </ImportDialog>, document.body);
}
