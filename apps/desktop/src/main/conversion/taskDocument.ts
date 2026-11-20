import { readChalkLeeArchiveMetadata } from "@chalklee/format";
import type { ConversionTask } from "../../shared/conversion/tasks";
import { readWorkspaceDocument } from "../workspace/files";

/** History records a conversion, not whether its output still exists when the teacher clicks it. */
export async function conversionTaskDocument(task: ConversionTask, target: "source" | "result") {
  const candidates = target === "result" ? [task.result?.file, task.source, task.snapshot] : [task.source, task.snapshot];
  const tried = new Set<string>();
  for (const file of candidates) {
    if (!file || tried.has(file.path)) continue;
    tried.add(file.path);
    try {
      const bytes = await readWorkspaceDocument(task.workspaceRoot, file.path);
      if (file === task.result?.file) await readChalkLeeArchiveMetadata(bytes.data);
      return { ...file, size: bytes.size, modifiedAt: bytes.modifiedAt };
    } catch { /* A removed or unreadable result falls back to the original, including retained legacy sources. */ }
  }
  throw new Error(target === "result" ? "转换结果和原稿都已被删除、移走或无法读取。" : "原稿已被删除、移走或无法读取。");
}
