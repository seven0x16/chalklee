import { workspacePathContains } from "../../../shared/workspace/paths";

type PrepareEditor = (saveChanges: boolean) => Promise<() => void>;
const sessions = new Map<string, PrepareEditor>();

export function registerWorkspaceEditor(path: string, prepare: PrepareEditor) {
  sessions.set(path, prepare);
  return () => { if (sessions.get(path) === prepare) sessions.delete(path); };
}

/** Wait for ongoing writes before changing paths; copies/trash also save current edits. */
export async function prepareWorkspaceEditors(path: string, saveChanges: boolean) {
  const releases: Array<() => void> = [];
  try {
    for (const [editorPath, prepare] of [...sessions]) {
      if (workspacePathContains(path, editorPath)) releases.push(await prepare(saveChanges));
    }
  } catch (error) {
    releases.reverse().forEach(release => release());
    throw error;
  }
  return () => releases.reverse().forEach(release => release());
}
