import { isConvertibleKind } from "../../shared/document/kinds";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { readImportRetryHistory } from "./documentImport";
import { documentKind, readWorkspaceDocument } from "../workspace/files";
import type { StartConversionRequest } from "../../shared/conversion/tasks";
import type { WorkspaceFileNode } from "../../shared/contracts";

export async function snapshotConversionSource(rootPath: string, request: StartConversionRequest) {
  const workspaceRoot = await realpath(rootPath);
  const sourcePath = await realpath(request.sourcePath);
  const extension = documentKind(sourcePath);
  if (!extension || !isConvertibleKind(extension)) throw new Error("请选择 DOC、DOCX、PDF、LaTeX 或 Markdown 原稿。");
  const bytes = await readWorkspaceDocument(workspaceRoot, sourcePath);
  if (bytes.size > 100 * 1024 * 1024) throw new Error("单篇转换支持最大 100 MB 的原稿。");
  if (request.expectedModifiedAt !== undefined && bytes.modifiedAt !== request.expectedModifiedAt) throw new Error("原稿已更新，请重新加载后转换。");
  const sourceHash = createHash("sha256").update(new Uint8Array(bytes.data)).digest("hex");
  const history = await readImportRetryHistory(workspaceRoot, request.retryOf, sourceHash);
  const source: WorkspaceFileNode = { kind: "file", id: `file:${sourcePath}`, fileId: sourcePath, path: sourcePath, name: history?.record.sourceName ?? path.basename(sourcePath), extension, size: bytes.size, modifiedAt: bytes.modifiedAt, status: "unparsed" };
  // No copy is kept: the conversion reads the original itself and checks it still has this content.
  const snapshot = source;
  // Continuing from a result's saved progress updates that result; converting again may name the paper to update.
  const into = typeof request.into === "string" ? request.into : history ? request.retryOf : undefined;
  return { workspaceRoot, source, snapshot, sourceHash, ...(history ? { retryOf: request.retryOf } : {}), ...(into ? { into } : {}) };
}
