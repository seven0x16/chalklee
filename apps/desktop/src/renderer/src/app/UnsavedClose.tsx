import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ImportDialog } from "../conversion/SingleImport";
import { readChalkLeeAutoSavePreference } from "../editor/autoSave";
import { flushQuestionCardEdit, hasQuestionCardEdit, subscribeQuestionCardEdit } from "../questionBank/questionCardEdits";
import { prepareWorkspaceEditors } from "../workspace/editorSessions";
import type { OpenTab } from "./tabs";

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Saves every document with unsaved edits through its editor; the first failure names its document. */
async function saveUnsavedTabs(tabs: readonly OpenTab[]) {
  for (const tab of tabs.filter(tab => tab.dirty)) {
    try { (await prepareWorkspaceEditors(tab.file.path, true))(); }
    catch (error) { throw new Error(`《${tab.file.name}》未能保存：${messageOf(error)}`); }
  }
}

/**
 * Closing the window or quitting with unsaved documents: with auto-save on they are saved and the app goes on;
 * otherwise, or when saving fails, the teacher chooses to save, discard or stay.
 */
export function useUnsavedClose(tabs: readonly OpenTab[]) {
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [prompt, setPrompt] = useState<{ saving: boolean; error: string | null } | null>(null);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  // A question open on its library card counts too; it is saved before anything is asked.
  const cardEditing = useSyncExternalStore(subscribeQuestionCardEdit, hasQuestionCardEdit);
  const unsaved = tabs.some(tab => tab.dirty);

  useEffect(() => { window.chalkLee.reportUnsavedChanges(unsaved || cardEditing); }, [unsaved, cardEditing]);

  const savingRef = useRef(false);
  const flushingRef = useRef(false);
  const answer = (proceed: boolean) => { setPrompt(null); window.chalkLee.answerCloseRequest(proceed); };
  /** Shown saves keep the question open with its progress; a failure stays in it for the teacher to decide. */
  const save = async (shown: boolean) => {
    if (savingRef.current) return;
    savingRef.current = true;
    if (shown) setPrompt({ saving: true, error: null });
    try { await saveUnsavedTabs(tabsRef.current); answer(true); }
    catch (error) { setPrompt({ saving: false, error: messageOf(error) }); }
    finally { savingRef.current = false; }
  };

  useEffect(() => window.chalkLee.onCloseRequest(() => {
    if (promptRef.current || savingRef.current || flushingRef.current) return;
    const decide = () => {
      if (!tabsRef.current.some(tab => tab.dirty)) window.chalkLee.answerCloseRequest(true);
      else if (readChalkLeeAutoSavePreference()) void save(false);
      else setPrompt({ saving: false, error: null });
    };
    if (!hasQuestionCardEdit()) { decide(); return; }
    flushingRef.current = true;
    void flushQuestionCardEdit().then(saved => {
      flushingRef.current = false;
      // The card stays open and says why it could not save.
      if (saved) decide();
      else window.chalkLee.answerCloseRequest(false);
    });
  }), []);

  // Auto-save may finish the last document while the question is open: nothing is left to decide.
  useEffect(() => { if (prompt && !prompt.saving && !unsaved) answer(true); }, [prompt, unsaved]);

  if (!prompt) return null;
  const names = tabs.filter(tab => tab.dirty).map(tab => `《${tab.file.name}》`);
  if (!names.length) return null;
  const listed = names.length > 3 ? `${names.slice(0, 3).join("、")}等` : names.join("、");
  return createPortal(<ImportDialog className="unsaved-close-dialog" initialFocus="button.primary"
    title={names.length === 1 ? `是否保存对${names[0]}的修改？` : `是否保存对 ${names.length} 份文档的修改？`}
    onClose={() => { if (!prompt.saving) answer(false); }}>
    <p>{names.length === 1 ? "不保存的话，这次的修改会丢失。" : `${listed}有未保存的修改，不保存的话会丢失。`}</p>
    {prompt.error ? <div className="ai-import-message error" role="alert">{prompt.error}</div> : null}
    <footer>
      <button type="button" disabled={prompt.saving} onClick={() => answer(true)}>不保存</button>
      <button type="button" disabled={prompt.saving} onClick={() => answer(false)}>取消</button>
      <button type="button" className="primary" disabled={prompt.saving} onClick={() => void save(true)}>{prompt.saving ? "正在保存…" : "保存"}</button>
    </footer>
  </ImportDialog>, document.body);
}
