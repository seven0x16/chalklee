import { PLUGIN_API_VERSION } from "../../shared/plugins/manifest";

/**
 * Runs first in every plugin page. The page talks to the app only through these messages; everything
 * it asks for is checked again in the main process against what the teacher allowed.
 * See the Plugins section of the repository's NOTICE for the AGPL section 7 additional permission.
 */
export const PLUGIN_SDK_SOURCE = `(() => {
  "use strict";
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"]) { try { delete window[name]; } catch {} }
  const CHANNEL = "chalklee-plugin";
  const pending = new Map();
  const themeListeners = new Set();
  let nextId = 1;
  let theme = null;
  const applyTheme = value => {
    theme = value;
    const root = document.documentElement;
    root.style.colorScheme = value.appearance;
    root.dataset.chalkleeAppearance = value.appearance;
    for (const [name, color] of Object.entries(value.colors)) root.style.setProperty("--chalklee-" + name, color);
    for (const listener of themeListeners) { try { listener(value); } catch (error) { console.error(error); } }
  };
  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.data?.channel !== CHANNEL) return;
    const message = event.data;
    if (message.type === "theme") { applyTheme(message.theme); return; }
    if (message.type !== "result") return;
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error)); else call.resolve(message.value);
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ channel: CHANNEL, type: "call", id, method, params: params ?? {} }, "*");
  });
  window.parent.postMessage({ channel: CHANNEL, type: "ready" }, "*");
  window.chalklee = Object.freeze({
    apiVersion: ${PLUGIN_API_VERSION},
    get theme() { return theme; },
    onThemeChange(listener) { themeListeners.add(listener); return () => themeListeners.delete(listener); },
    storage: Object.freeze({
      get: key => call("storage.get", { key }),
      set: (key, value) => call("storage.set", { key, value }),
      remove: key => call("storage.remove", { key }),
      keys: () => call("storage.keys")
    }),
    document: Object.freeze({
      current: () => call("document.current"),
      questions: options => call("document.questions", options),
      show: questionId => call("document.show", { questionId }),
      open: (path, questionId) => call("document.open", { path, questionId }),
      create: options => call("document.create", options)
    }),
    bank: Object.freeze({ search: options => call("bank.search", options) }),
    basket: Object.freeze({ add: questions => call("basket.add", { questions }) }),
    assistant: Object.freeze({ draft: text => call("assistant.draft", { text }) }),
    files: Object.freeze({
      save: async (name, data) => call("files.save", { name, data: data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data instanceof ArrayBuffer ? new Uint8Array(data) : data })
    })
  });
})();
`;
