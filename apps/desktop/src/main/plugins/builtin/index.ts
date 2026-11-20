import { pluginFromPage, type PluginContents } from "../package";
import license from "../../../../../../templates/plugin/LICENSE?raw";
import calendarManifest from "./calendar/plugin.json?raw";
import calendarPage from "./calendar/index.html?raw";
import todoManifest from "./todo/plugin.json?raw";
import todoPage from "./todo/index.html?raw";

const encoder = new TextEncoder();
const licenseBytes = encoder.encode(license);

function plugin(manifest: string, page: string): PluginContents {
  const contents = pluginFromPage(JSON.parse(manifest), encoder.encode(page));
  contents.files.set("LICENSE", licenseBytes);
  contents.bytes += licenseBytes.byteLength;
  return contents;
}

/** Plugins that ship with the app. They use the public interface like any other, and double as examples of it. */
export const BUILTIN_PLUGINS: readonly PluginContents[] = [plugin(todoManifest, todoPage), plugin(calendarManifest, calendarPage)];
