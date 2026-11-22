import { contextBridge, ipcRenderer } from 'electron';
import { API_METHODS } from '@shared/api';

const api: Record<string, unknown> = {};
for (const m of API_METHODS) api[m] = (...args: unknown[]) => ipcRenderer.invoke(`adflow:${m}`, ...args);
api.on = (channel: string, cb: (payload: unknown) => void) => {
  const listener = (_: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(`adflow:event:${channel}`, listener);
  return () => ipcRenderer.removeListener(`adflow:event:${channel}`, listener);
};

contextBridge.exposeInMainWorld('adflow', api);
