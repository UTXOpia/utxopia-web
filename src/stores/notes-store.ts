"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface StoredNote {
  /** Stable local id — the only key the store matches on.
   *  `commitment` is NOT unique: two deposits to the same address for the same
   *  amount produce the same value, and keying on it makes one record shadow
   *  the other (spend one → both marked spent). */
  id: string;
  commitment: string;
  noteExport: string;
  amountSats: number;
  taprootAddress: string;
  createdAt: number;
  expiresAt: number;
  depositId?: string;
  secretNote?: string;
  poseidonCommitment?: string;
  poseidonNote?: {
    amount: string;
    nullifier: string;
    secret: string;
    commitment?: string;
  };
}

interface NotesState {
  notes: StoredNote[];
  isLoaded: boolean;

  // Actions
  saveNote: (note: Omit<StoredNote, "id" | "createdAt">) => string;
  getNote: (id: string) => StoredNote | undefined;
  findByCommitment: (commitment: string) => StoredNote | undefined;
  updateNote: (id: string, updates: Partial<StoredNote>) => void;
  deleteNote: (id: string) => boolean;
  clearNotes: () => boolean;
  getActiveNotes: () => StoredNote[];
}

export const useNotesStore = create<NotesState>()(
  persist(
    (set, get) => ({
      notes: [],
      isLoaded: true,

      saveNote: (note) => {
        const newNote: StoredNote = {
          ...note,
          id: crypto.randomUUID(),
          createdAt: Date.now(),
        };
        set((state) => ({ notes: [...state.notes, newNote] }));
        return newNote.id;
      },

      getNote: (id) => {
        return get().notes.find((n) => n.id === id);
      },

      /** Newest match. Only for legacy lookups where the id was never held —
       *  ambiguous by construction, so never use it to mutate. */
      findByCommitment: (commitment) => {
        const matches = get().notes.filter((n) => n.commitment === commitment);
        return matches[matches.length - 1];
      },

      updateNote: (id, updates) => {
        set((state) => ({
          notes: state.notes.map((n) =>
            n.id === id ? { ...n, ...updates } : n
          ),
        }));
      },

      deleteNote: (id) => {
        set((state) => ({
          notes: state.notes.filter((n) => n.id !== id),
        }));
        return true;
      },

      clearNotes: () => {
        set({ notes: [] });
        return true;
      },

      getActiveNotes: () => {
        const now = Date.now();
        return get().notes.filter((note) => note.expiresAt * 1000 > now);
      },
    }),
    {
      name: "utxopia-notes",
      version: 1,
      // v0 records were keyed by `commitment` and carry no id. Backfill a stable
      // one rather than dropping them — these track in-flight BTC deposits.
      migrate: (persisted, version) => {
        const state = persisted as { notes?: StoredNote[] } | undefined;
        if (version >= 1 || !state?.notes) return persisted as NotesState;
        return {
          ...state,
          notes: state.notes.map((n, i) => ({ ...n, id: n.id ?? `legacy:${i}:${n.commitment}` })),
        } as NotesState;
      },
    }
  )
);

// Convenience hook
export function useNoteStorage() {
  return useNotesStore();
}
