"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * The monotonic counter behind every OP_RETURN-free deposit address.
 *
 * A deposit address commits to its ephemeral key through the tapleaf, and that
 * key is `sha256(viewingNode ‖ index)`. So the index is half of what makes a
 * deposit recoverable — with the viewing key, walking it upward rebuilds every
 * address the wallet was ever handed.
 *
 * It must only ever move forward. Reusing an index re-derives the same address,
 * which is safe on chain (the two deposits get distinct outpoints, receipts and
 * leaves) but links them to each other for anyone watching.
 *
 * Losing it is survivable, unlike losing the viewing key: the used indices can be
 * recovered by scanning, because each one derives an address whose history is
 * public. Treat a lost counter as "rescan", not "lost funds".
 *
 * Keyed per identity, since indices under one viewing key say nothing about
 * another's.
 */
interface DepositIndexState {
  /** identity key → next unused index */
  next: Record<string, number>;
  /** Reserve and return the next index for `identity`. */
  claim: (identity: string) => number;
  /** Raise the floor after a scan finds higher used indices. Never lowers it. */
  observe: (identity: string, usedIndex: number) => void;
  peek: (identity: string) => number;
}

export const useDepositIndexStore = create<DepositIndexState>()(
  persist(
    (set, get) => ({
      next: {},

      claim: (identity) => {
        const index = get().next[identity] ?? 0;
        set((state) => ({ next: { ...state.next, [identity]: index + 1 } }));
        return index;
      },

      // A scan is a floor, not the truth: an address derived moments ago may not
      // be visible yet, so this may only ever raise the counter.
      observe: (identity, usedIndex) => {
        set((state) => {
          const current = state.next[identity] ?? 0;
          const floor = usedIndex + 1;
          return floor > current ? { next: { ...state.next, [identity]: floor } } : state;
        });
      },

      peek: (identity) => get().next[identity] ?? 0,
    }),
    { name: "utxopia-deposit-index" },
  ),
);
