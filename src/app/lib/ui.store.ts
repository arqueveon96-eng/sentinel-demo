/* ============================================================
   ui.store.ts — view state only. Nothing here is persisted and
   nothing here is truth: which machine is selected, what the picker
   filter says, which devices are staged for the bulk ticket CSV, and
   which files are waiting to be committed.
   ============================================================ */

import { create } from 'zustand';
import type { SourceFile } from '@/core/types';

/**
 * PHASE 3: the app-level sheets. They are opened from four different
 * places (the utility corner, the queue picker's footer, the Investigate
 * panel, the Close panel) and rendered once at the shell, so which one
 * is open is view state like everything else in this file.
 */
export type SheetId = 'export' | 'shortcuts' | 'phases' | 'findings' | 'roundup';

interface UiState {
  selected: string | null;
  filter: string;
  /** the direction the last device change moved, for the dossier slide */
  direction: 1 | -1;
  batch: string[];
  staged: SourceFile[];
  sheet: SheetId | null;

  select(name: string | null, direction?: 1 | -1): void;
  setFilter(f: string): void;
  toggleBatch(name: string): void;
  clearBatch(): void;
  setStaged(files: SourceFile[]): void;
  openSheet(id: SheetId): void;
  closeSheet(): void;
}

export const useUi = create<UiState>()((set) => ({
  selected: null,
  filter: '',
  direction: 1,
  batch: [],
  staged: [],
  sheet: null,

  select: (name, direction = 1) => set({ selected: name, direction }),
  setFilter: (filter) => set({ filter }),
  openSheet: (sheet) => set({ sheet }),
  closeSheet: () => set({ sheet: null }),
  toggleBatch: (name) =>
    set((s) => ({
      batch: s.batch.includes(name) ? s.batch.filter((n) => n !== name) : [...s.batch, name],
    })),
  clearBatch: () => set({ batch: [] }),
  setStaged: (staged) => set({ staged }),
}));
