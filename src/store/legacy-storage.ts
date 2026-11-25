/* ============================================================
   legacy-storage.ts — the storage contract.

   Users have real data under localStorage key `sentinel.v1`, written by
   the vanilla app as ONE JSON object: the whole `SentinelState`, with
   `schemaVersion: 1` at the top level and nothing wrapping it. The old
   app's `Store.importBlob(text)` refuses anything without a top-level
   `schemaVersion`, so the new app must keep writing exactly that.

   Zustand's `persist` middleware normally writes `{state:…, version:…}`,
   which `importBlob` would reject. This module supplies:

     • rawBlobIO         — the low-level read/write of the legacy blob
     • createPersistence — the `Persistence` port `createStore()` needs
     • legacyPersistStorage — a custom zustand `PersistStorage` that
       unwraps `{state,version}` on the way out and re-wraps on the way
       in, so what lands on disk is the bare legacy blob.

   Neither path ever writes a wrapper, and both write the same bytes to
   the same key, so it does not matter which one fires first.
   ============================================================ */

import type { PersistStorage, StorageValue } from 'zustand/middleware';
import type { Persistence } from '@/core/store-core';
import { SCHEMA_VERSION, STORE_KEY } from '@/core/store-core';
import type { SentinelState } from '@/core/types';

/** Non-throwing localStorage with an in-memory fallback (SSR, file://, private mode). */
function backingStore(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof localStorage !== 'undefined') {
      // touch it — Safari private mode throws only on write
      localStorage.getItem(STORE_KEY);
      return localStorage;
    }
  } catch {
    /* fall through to memory */
  }
  const mem = new Map<string, string>();
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
  };
}

export interface RawBlobIO {
  read(): string | null;
  write(text: string): void;
  clear(): void;
}

export function createRawBlobIO(
  backing: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = backingStore(),
): RawBlobIO {
  let lastWritten: string | null = null;
  return {
    read: () => backing.getItem(STORE_KEY),
    write(text: string) {
      // both the core store and zustand's persist serialize the same object;
      // skip the redundant second write of identical bytes.
      if (text === lastWritten) return;
      backing.setItem(STORE_KEY, text);
      lastWritten = text;
    },
    clear() {
      backing.removeItem(STORE_KEY);
      lastWritten = null;
    },
  };
}

/** The port `createStore()` consumes. Ignores the key it is handed — there is only one. */
export function createPersistence(io: RawBlobIO): Persistence {
  return {
    getItem: () => io.read(),
    setItem: (_key, value) => io.write(value),
    removeItem: () => io.clear(),
  };
}

/** What the persisted zustand slice looks like in memory. */
export interface PersistedSlice {
  blob: SentinelState;
}

/**
 * Custom zustand storage: on disk it is the bare legacy blob, in memory it is
 * a normal `StorageValue`. A blob without a top-level `schemaVersion` is not a
 * Sentinel blob and reads as "nothing stored" — the same rule the old app's
 * `importBlob` applies. `version` is reported as SCHEMA_VERSION so persist
 * hydrates the legacy blob directly, with no migration step to write.
 */
export function createLegacyPersistStorage(io: RawBlobIO): PersistStorage<PersistedSlice> {
  return {
    getItem(): StorageValue<PersistedSlice> | null {
      const raw = io.read();
      if (!raw) return null;
      try {
        const blob = JSON.parse(raw) as SentinelState;
        if (!blob || !blob.schemaVersion) return null;
        return { state: { blob }, version: SCHEMA_VERSION };
      } catch {
        return null;
      }
    },
    setItem(_name: string, value: StorageValue<PersistedSlice>): void {
      const blob = value.state?.blob;
      if (!blob) return;
      io.write(JSON.stringify(blob));
    },
    removeItem(): void {
      io.clear();
    },
  };
}
