import { beforeEach, describe, expect, test } from "bun:test";
import { useNotesStore, type StoredNote } from "./notes-store";

const deposit = (commitment: string): Omit<StoredNote, "id" | "createdAt"> => ({
  commitment,
  noteExport: "txid",
  amountSats: 100_000,
  taprootAddress: "bcrt1p-same-address",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
});

beforeEach(() => useNotesStore.getState().clearNotes());

describe("notes-store keys by id, not commitment", () => {
  // Two deposits to one address for one amount hash to the same commitment.
  // Keying on it made the second record invisible once the first was touched.
  test("updating one colliding note leaves the other alone", () => {
    const s = useNotesStore.getState();
    const first = s.saveNote(deposit("same"));
    const second = s.saveNote(deposit("same"));
    expect(first).not.toBe(second);

    s.updateNote(first, { depositId: "dep-1" });

    expect(useNotesStore.getState().getNote(first)?.depositId).toBe("dep-1");
    expect(useNotesStore.getState().getNote(second)?.depositId).toBeUndefined();
  });

  test("deleting one colliding note keeps the other", () => {
    const s = useNotesStore.getState();
    const first = s.saveNote(deposit("same"));
    const second = s.saveNote(deposit("same"));

    s.deleteNote(first);

    expect(useNotesStore.getState().getNote(first)).toBeUndefined();
    expect(useNotesStore.getState().getNote(second)).toBeDefined();
  });
});
