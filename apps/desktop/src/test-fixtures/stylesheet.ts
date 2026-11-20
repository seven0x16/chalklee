import { readFileSync } from "node:fs";

/** The application stylesheet as bundled: styles/app.css with its section imports inlined in order. */
export function readAppStylesheet(): string {
  const entry = new URL("../renderer/src/styles/app.css", import.meta.url);
  return readFileSync(entry, "utf8").replace(/@import "([^"]+)";/g, (_, file: string) => readFileSync(new URL(file, entry), "utf8"));
}
