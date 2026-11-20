import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import type { McpLaunchConfig } from "../../shared/settings/app";

export interface AppPreferences { mcpEnabled: boolean }
const DEFAULT_PREFERENCES: AppPreferences = { mcpEnabled: true };
const preferencesPath = () => path.join(app.getPath("userData"), "app-preferences.json");

export async function readAppPreferences(): Promise<AppPreferences> {
  try {
    const value = JSON.parse(await readFile(preferencesPath(), "utf8")) as Partial<AppPreferences>;
    return { mcpEnabled: typeof value.mcpEnabled === "boolean" ? value.mcpEnabled : DEFAULT_PREFERENCES.mcpEnabled };
  } catch { return { ...DEFAULT_PREFERENCES }; }
}

export async function updateAppPreferences(patch: Partial<AppPreferences>): Promise<AppPreferences> {
  const next = { ...await readAppPreferences(), ...patch };
  await mkdir(app.getPath("userData"), { recursive: true });
  const temporary = `${preferencesPath()}.${randomUUID()}.next`;
  await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
  await rename(temporary, preferencesPath());
  return next;
}

/** Where mcpBridge looks for the connection file when no --connection is given. */
export function defaultBridgeDataDirectory(platform = process.platform, env = process.env, home = os.homedir()): string {
  return platform === "darwin" ? path.join(home, "Library", "Application Support", "ChalkLee")
    : platform === "win32" ? path.join(env.APPDATA ?? home, "ChalkLee") : path.join(env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "ChalkLee");
}

/** The app's own runtime starts the bridge as plain Node, so agent apps need no separate Node install. */
export function mcpLaunchConfig(options: { execPath: string; bridgePath: string; dataDirectory: string; defaultDataDirectory: string }): McpLaunchConfig {
  const args = [options.bridgePath];
  if (path.resolve(options.dataDirectory) !== path.resolve(options.defaultDataDirectory)) args.push("--connection", path.join(options.dataDirectory, "agent-connection.json"));
  return { command: options.execPath, args, env: { ELECTRON_RUN_AS_NODE: "1" } };
}
