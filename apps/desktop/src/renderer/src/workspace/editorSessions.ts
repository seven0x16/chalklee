import { workspacePathContains } from "../../../shared/workspace/paths";

type PrepareEditor = (saveChanges: boolean, closing?: boolean) => Promise<() => void>;
type EditorSession = { prepare: PrepareEditor; isDirty?: () => boolean };
const sessions = new Map<string, EditorSession>();

export function registerWorkspaceEditor(path: string, prepare: PrepareEditor, isDirty?: () => boolean) {
  const session = { prepare, isDirty };
  sessions.set(path, session);
  return () => { if (sessions.get(path) === session) sessions.delete(path); };
}

/** Read the live editor, not a possibly uncommitted React tab update. */
export function workspaceEditorDirty(path: string, reported: boolean): boolean {
  return sessions.get(path)?.isDirty?.() ?? reported;
}

/** Wait for ongoing writes before changing paths; copies/trash also save current edits. */
export async function prepareWorkspaceEditors(path: string, saveChanges: boolean, closing = false) {
  const releases: Array<() => void> = [];
  try {
    for (const [editorPath, session] of [...sessions]) {
      if (workspacePathContains(path, editorPath)) releases.push(await (closing ? session.prepare(saveChanges, true) : session.prepare(saveChanges)));
    }
  } catch (error) {
    releases.reverse().forEach(release => release());
    throw error;
  }
  return () => releases.reverse().forEach(release => release());
}
