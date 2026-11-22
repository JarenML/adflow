// API keys of paid providers, encrypted with the operating system's keychain (Electron safeStorage).
// They never go to the renderer: the UI only learns whether each one is set.
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { getDataDir, writeJson } from './store';

const file = () => path.join(getDataDir(), 'secrets.json');

function readAll(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return {};
  }
}

export function setSecret(name: string, value: string): void {
  const all = readAll();
  if (!value) delete all[name];
  else {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('El sistema no permite guardar claves cifradas.');
    all[name] = safeStorage.encryptString(value).toString('base64');
  }
  writeJson(file(), all);
}

export function getSecrets(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(readAll())) {
    try {
      out[k] = safeStorage.decryptString(Buffer.from(v, 'base64'));
    } catch {
      /* unreadable on this machine: ignore */
    }
  }
  return out;
}

export function secretStatus(): Record<string, boolean> {
  return Object.fromEntries(Object.keys(readAll()).map((k) => [k, true]));
}
