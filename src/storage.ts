import { type Memory, migrate } from './memory';

const KEY = 'memory';

/**
 * `chrome.storage.local`: kept across extension reloads and updates, cleared only when the extension is
 * removed (the extension ID is pinned by `key` in the manifest, so moving the folder doesn't lose it).
 */
export async function loadMemory(): Promise<Memory> {
  const stored = await chrome.storage.local.get(KEY);
  return migrate(stored[KEY]);
}

export async function saveMemory(memory: Memory): Promise<void> {
  await chrome.storage.local.set({ [KEY]: memory });
}
