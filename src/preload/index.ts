import { contextBridge, ipcRenderer } from "electron";

const api = {
  // Sessions
  listSessions: () => ipcRenderer.invoke("sessions:list"),
  createSession: (title?: string) => ipcRenderer.invoke("sessions:create", title),
  deleteSession: (id: string) => ipcRenderer.invoke("sessions:delete", id),
  renameSession: (id: string, title: string) => ipcRenderer.invoke("sessions:rename", id, title),
  getSession: (id: string) => ipcRenderer.invoke("sessions:get", id),

  // Engine
  sendMessage: (sessionId: string, text: string) => ipcRenderer.invoke("engine:query", sessionId, text),
  cancelQuery: () => ipcRenderer.invoke("engine:cancel"),
  getEngineStatus: () => ipcRenderer.invoke("engine:status"),

  // Workspace
  getWorkspace: () => ipcRenderer.invoke("workspace:get"),
  pickWorkspace: () => ipcRenderer.invoke("workspace:pick"),
  setWorkspace: (dir: string) => ipcRenderer.invoke("workspace:set", dir),

  // Settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (settings: Record<string, string>) => ipcRenderer.invoke("settings:set", settings),
  testConnection: (settings: { baseUrl: string; apiKey: string; model: string }) => ipcRenderer.invoke("settings:test", settings),

  // Config
  getConfig: () => ipcRenderer.invoke("config:get"),

  // App info
  getAppInfo: () => ipcRenderer.invoke("app:info"),

  // Events (renderer ← main)
  onStreamEvent: (callback: (event: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("engine:stream-event", handler);
    return () => ipcRenderer.removeListener("engine:stream-event", handler);
  },
  onEngineStatus: (callback: (status: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("engine:status", handler);
    return () => ipcRenderer.removeListener("engine:status", handler);
  },
  onEngineError: (callback: (err: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on("engine:error", handler);
    return () => ipcRenderer.removeListener("engine:error", handler);
  },
};

contextBridge.exposeInMainWorld("desktopAPI", api);
