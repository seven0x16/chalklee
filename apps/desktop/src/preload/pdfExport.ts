import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("readChalkLeePdfArchive", (): Promise<ArrayBuffer> => ipcRenderer.invoke("chalklee:pdf-export-archive"));
