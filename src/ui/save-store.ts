/**
 * Where the automatic save lives (spec §9: IndexedDB). One record, written at
 * checkpoints and when the page goes to the background (src/sim/save/save.ts
 * builds it). IndexedDB stores structured clones, so the state keeps the
 * values JSON would lose (Infinity). Where IndexedDB is missing or blocked
 * (some private windows), the save lasts for the page only.
 */
import type { SaveData } from '../sim/save/save';

export interface SaveStore {
  /** The stored value as it is (migrate it before use), or null. */
  load(): Promise<unknown>;
  save(data: SaveData): Promise<void>;
  clear(): Promise<void>;
}

const DB = 'ninth-chamber';
const STORE = 'saves';
const KEY = 'auto';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
    r.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

/** A store that keeps the save in memory (no IndexedDB, and tests). */
export function memorySaveStore(): SaveStore {
  let value: unknown = null;
  return {
    load: () => Promise.resolve(value),
    save: (data) => {
      value = structuredClone(data);
      return Promise.resolve();
    },
    clear: () => {
      value = null;
      return Promise.resolve();
    },
  };
}

/** The browser's IndexedDB, falling back to memory when it cannot be used. */
export function browserSaveStore(): SaveStore {
  const fallback = memorySaveStore();
  let db: Promise<IDBDatabase | null> | null = null;
  const database = (): Promise<IDBDatabase | null> =>
    (db ??= typeof indexedDB === 'undefined' ? Promise.resolve(null) : open().catch(() => null));
  const tx = async <T>(
    mode: IDBTransactionMode,
    run: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | null> => {
    const d = await database();
    if (!d) return null;
    return request(run(d.transaction(STORE, mode).objectStore(STORE)));
  };
  return {
    async load() {
      try {
        const d = await database();
        if (!d) return fallback.load();
        return (await tx('readonly', (s) => s.get(KEY))) ?? null;
      } catch {
        return fallback.load();
      }
    },
    async save(data) {
      await fallback.save(data);
      try {
        await tx('readwrite', (s) => s.put(data, KEY));
      } catch {
        // Full or blocked: the save lasts for this page only.
      }
    },
    async clear() {
      await fallback.clear();
      try {
        await tx('readwrite', (s) => s.delete(KEY));
      } catch {
        // Nothing stored anyway.
      }
    },
  };
}
