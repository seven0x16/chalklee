import { describe, expect, it } from "vitest";
import { normalizeAssistantSendRequest } from "../../../shared/agent/assistant";
import { readWorkspaceFileDrag, writeWorkspaceEntryDrag } from "./drag";

describe("original attachments", () => {
  it.each(["pdf", "docx", "md", "markdown"] as const)("carries %s from the tree through assistant request validation", kind => {
    const data = new Map<string, string>();
    const transfer = { setData: (type: string, value: string) => { data.set(type, value); }, getData: (type: string) => data.get(type) ?? "" } as DataTransfer;
    const file = { path: `/workspace/paper.${kind}`, name: `paper.${kind}`, kind };
    writeWorkspaceEntryDrag(transfer, [file]);
    expect(readWorkspaceFileDrag(transfer)).toEqual([file]);
    const request = normalizeAssistantSendRequest({ text: "查看原稿", context: { activeDocument: file, openDocuments: [file], attachedFiles: readWorkspaceFileDrag(transfer) } });
    expect(request.context.activeDocument).toMatchObject(file);
    expect(request.context.openDocuments).toEqual([file]);
    expect(request.context.attachedFiles).toEqual([file]);
  });
});
