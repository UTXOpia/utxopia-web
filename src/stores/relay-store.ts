"use client";

/**
 * Relay selection store.
 *
 * Persistence strategy:
 * - Built-in relays live in code (relays.ts); they are NOT persisted here.
 * - Custom relays are stored as SerializableRelay (urlTemplate string, no function).
 *   The url() function is reconstructed at read time via serializableToConfig().
 * - Health records are persisted as a snapshot so the last-known state survives
 *   a reload (stale-while-revalidate UX). They are revalidated on mount.
 * - `mode` is persisted: "auto" or a relay id string.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RelayHealth } from "@/lib/relay-health";
import type { SerializableRelay } from "@/lib/relays";

interface RelayStoreState {
  /** "auto" = auto-select via resolveAutoRelay; any other string = pinned relay id. */
  mode: "auto" | string;
  /** User-added custom relays stored in serializable form. */
  customRelays: SerializableRelay[];
  /** Last-known health per relay id. */
  health: Record<string, RelayHealth>;

  setMode: (mode: "auto" | string) => void;
  addCustomRelay: (relay: { name: string; url: string }) => void;
  removeCustomRelay: (id: string) => void;
  setHealth: (id: string, health: RelayHealth) => void;
}

export const useRelayStore = create<RelayStoreState>()(
  persist(
    (set) => ({
      mode: "auto",
      customRelays: [],
      health: {},

      setMode: (mode) => set({ mode }),

      addCustomRelay: ({ name, url }) => {
        const id = `custom-${Date.now()}`;
        const relay: SerializableRelay = {
          id,
          name,
          urlTemplate: url.includes("{network}") ? url : `${url}?network={network}`,
          custom: true,
        };
        set((state) => ({ customRelays: [...state.customRelays, relay] }));
      },

      removeCustomRelay: (id) => {
        set((state) => ({
          customRelays: state.customRelays.filter((r) => r.id !== id),
          // If the removed relay was pinned, fall back to auto
          mode: state.mode === id ? "auto" : state.mode,
        }));
      },

      setHealth: (id, health) => {
        set((state) => ({ health: { ...state.health, [id]: health } }));
      },
    }),
    {
      name: "utxopia-relay",
      // Only persist user preferences + last health snapshot; builtins stay in code.
      partialize: (state) => ({
        mode: state.mode,
        customRelays: state.customRelays,
        health: state.health,
      }),
    },
  ),
);
