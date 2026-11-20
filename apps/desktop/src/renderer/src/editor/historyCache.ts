import { history } from "@tiptap/pm/history";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";

let detachedHistoryState: EditorState | undefined;

/** ProseMirror's history caches the last plugin array it saw. In Tiptap that
 * array can reference the entire editor, including its assets and undo stack.
 * Give the cache a small detached state when an editor is destroyed. */
export function releaseChalkLeeHistoryCache() {
  const state = detachedHistoryState ??= EditorState.create({
    schema: new Schema({ nodes: { doc: { content: "paragraph" }, paragraph: { content: "text*" }, text: {} } }),
    plugins: [history()]
  });
  state.apply(state.tr.insertText(" "));
}
