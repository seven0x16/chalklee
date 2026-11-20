import { useEffect, useState } from "react";
import type { ImportHistory } from "../../../shared/conversion/types";
import type { WorkspaceFileNode } from "../../../shared/contracts";

/** One source for the document summary and outline badges, scoped to this file. */
export function useImportHistory(file: WorkspaceFileNode | null, paused = false) {
  const [state, setState] = useState<{ path: string; history: ImportHistory | null; error: string } | null>(null);
  useEffect(() => {
    if (file?.extension !== "chalklee" || paused) return;
    let current = true;
    void window.chalkLee.readImportHistory(file.path).then(history => {
      if (current) setState({ path: file.path, history, error: "" });
    }).catch(cause => {
      if (current) setState({ path: file.path, history: null, error: cause instanceof Error ? cause.message : "转换记录读取失败，请重试。" });
    });
    return () => { current = false; };
  }, [file?.path, file?.extension, file?.modifiedAt, paused]);
  return file?.extension === "chalklee" && state?.path === file.path ? state : null;
}
