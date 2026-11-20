import { ipcMain, type IpcMainInvokeEvent } from "electron";

const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: any[]) => unknown>();

export function handleDesktop(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) {
  handlers.set(channel, listener);
  ipcMain.handle(channel, listener);
}

export async function invokeDesktop(channel: string, event: IpcMainInvokeEvent, args: unknown[]) {
  const handler = handlers.get(channel);
  if (!handler) throw new Error("应用操作不存在。");
  return handler(event, ...args);
}
