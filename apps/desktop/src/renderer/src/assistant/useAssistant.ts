import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantConversation, AssistantConversationSummary, AssistantImage, AssistantStatus, AssistantUiContext } from "../../../shared/agent/assistant";
import type { AiReasoning, AiServicesView } from "../../../shared/settings/aiProviders";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");

/** One conversation at a time follows the main-process events; others stay in the history list. */
export function useAssistant(workspaceRoot: string | null, active: boolean, settingsRevision: number) {
  const api = window.chalkLee.assistant;
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [models, setModels] = useState<AiServicesView | null>(null);
  const [conversations, setConversations] = useState<AssistantConversationSummary[]>([]);
  const [conversation, setConversation] = useState<AssistantConversation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const currentId = useRef<string | null>(null);
  currentId.current = conversation?.id ?? null;

  const refreshList = useCallback(() => {
    if (!api || !workspaceRoot) { setConversations([]); return; }
    void api.list().then(setConversations).catch(() => undefined);
  }, [api, workspaceRoot]);

  useEffect(() => {
    setConversation(null); setNotice(null);
    refreshList();
  }, [workspaceRoot, refreshList]);

  const refreshStatus = useCallback(() => {
    if (!api) return;
    void api.status().then(setStatus).catch(() => setStatus({ configured: false, model: null }));
    void Promise.resolve().then(() => window.chalkLee.listAiServices()).then(setModels).catch(() => setModels(null));
  }, [api]);
  useEffect(() => { if (active) refreshStatus(); }, [active, settingsRevision, refreshStatus]);

  /** The next message (and new conversions) use the chosen model. */
  const selectModel = useCallback(async (serviceId: string, model: string) => {
    try {
      setModels(await window.chalkLee.selectAiModel(serviceId, model));
      refreshStatus();
    } catch (error) { setNotice(errorMessage(error)); }
  }, [refreshStatus]);

  /** The next message thinks as much as chosen. */
  const selectReasoning = useCallback(async (level: AiReasoning) => {
    try { setModels(await window.chalkLee.setAiReasoning(level)); }
    catch (error) { setNotice(errorMessage(error)); }
  }, []);

  useEffect(() => api?.onEvent(event => {
    if (event.type === "list") { setConversations(event.conversations); return; }
    if (event.type === "conversation") {
      if (event.conversation.id === currentId.current) setConversation(event.conversation);
      return;
    }
    if (event.conversationId !== currentId.current) return;
    setConversation(current => {
      if (!current || current.id !== event.conversationId) return current;
      // A new run replaces what the last one's reply could undo.
      if (event.type === "status") return { ...current, running: event.running, error: event.error, activity: event.activity, requestedAt: event.requestedAt ?? null, undoable: event.running ? null : current.undoable };
      if (event.type === "approval") return { ...current, approval: event.approval };
      const index = current.messages.findIndex(message => message.id === event.message.id);
      const messages = index < 0 ? [...current.messages, event.message] : current.messages.map((message, position) => position === index ? event.message : message);
      return { ...current, messages, updatedAt: Date.now() };
    });
  }), [api]);

  const send = useCallback(async (text: string, context: AssistantUiContext, images: AssistantImage[] = []) => {
    if (!api) return;
    setNotice(null);
    let id = currentId.current;
    const create = !id;
    if (!id) {
      id = crypto.randomUUID();
      const now = Date.now();
      const fresh: AssistantConversation = { id, title: (text || "请看图片。").split("\n")[0].slice(0, 28), createdAt: now, updatedAt: now, messages: [], running: true, approval: null, error: null, activity: null };
      currentId.current = id;
      setConversation(fresh);
    } else setConversation(current => current && { ...current, running: true, error: null, activity: null, undoable: null, requestedAt: null });
    try { await api.send({ conversationId: id, create, text, context, ...(images.length ? { images: images.map(({ data, mimeType }) => ({ data, mimeType })) } : {}) }); }
    catch (error) {
      setNotice(errorMessage(error));
      setConversation(current => current && current.id === id ? { ...current, running: false } : current);
    }
  }, [api]);

  const open = useCallback(async (id: string | null) => {
    setNotice(null);
    if (!api || !id) { currentId.current = null; setConversation(null); return; }
    try {
      const loaded = await api.open(id);
      currentId.current = loaded.id;
      setConversation(loaded);
    } catch (error) { setNotice(errorMessage(error)); }
  }, [api]);

  const remove = useCallback(async (id: string) => {
    if (!api) return;
    try {
      await api.remove(id);
      if (currentId.current === id) { currentId.current = null; setConversation(null); }
    } catch (error) { setNotice(errorMessage(error)); }
  }, [api]);

  /** Puts back what the latest run changed; the conversation event that follows removes the button. */
  const undoRun = useCallback(async () => {
    const id = currentId.current;
    if (!api || !id) return null;
    try { return await api.undoRun(id); }
    catch (error) { setNotice(errorMessage(error)); return null; }
  }, [api]);

  const act = useCallback((action: (id: string) => Promise<void> | undefined) => {
    const id = currentId.current;
    if (!id) return;
    void Promise.resolve(action(id)).catch(error => setNotice(errorMessage(error)));
  }, []);

  return {
    available: Boolean(api),
    status, models, conversations, conversation, notice,
    send, open, remove, selectModel, selectReasoning, undoRun,
    clearNotice: () => setNotice(null),
    showNotice: setNotice,
    stop: () => act(id => api?.abort(id)),
    retry: () => act(id => api?.retry(id)),
    approve: (approvalId: string, allow: boolean) => act(id => api?.approve(id, approvalId, allow))
  };
}

/** Whether any conversation is still working or waiting for a confirmation, for the rail while the panel is out of sight. */
export function useAssistantActivity(workspaceRoot: string | null) {
  const [states, setStates] = useState<ReadonlyMap<string, { running: boolean; waiting: boolean }>>(new Map());
  useEffect(() => setStates(new Map()), [workspaceRoot]);
  useEffect(() => window.chalkLee.assistant?.onEvent(event => {
    const change = event.type === "status" ? { id: event.conversationId, running: event.running, waiting: event.running ? undefined : false }
      : event.type === "approval" ? { id: event.conversationId, running: undefined, waiting: Boolean(event.approval) }
      : event.type === "conversation" ? { id: event.conversation.id, running: event.conversation.running, waiting: Boolean(event.conversation.approval) }
      : null;
    if (!change) return;
    setStates(current => {
      const previous = current.get(change.id) ?? { running: false, waiting: false };
      const next = { running: change.running ?? previous.running, waiting: change.waiting ?? previous.waiting };
      if (next.running === previous.running && next.waiting === previous.waiting) return current;
      const updated = new Map(current);
      if (next.running || next.waiting) updated.set(change.id, next); else updated.delete(change.id);
      return updated;
    });
  }), []);
  const values = [...states.values()];
  return { running: values.some(state => state.running), waiting: values.some(state => state.waiting) };
}
