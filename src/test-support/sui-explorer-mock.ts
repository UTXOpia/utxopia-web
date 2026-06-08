import { mock } from "bun:test";

// Shared mock for `@/lib/sui/explorer`.
//
// bun's `mock.module` is process-global and the resolved module is cached on
// first import, so two route test files cannot each register their own *partial*
// mock of this module — whichever registers last wins and the other route gets
// `undefined` exports (500s). Register ONE combined mock here that exposes the
// full surface; each test file imports the function it needs and sets its own
// implementation. Because the function instances are shared, call-count
// assertions (`toHaveBeenCalledTimes`) still work.
export const fetchSuiExplorerTransactions = mock(async (): Promise<unknown[]> => []);
export const fetchSuiExplorerStats = mock(async (): Promise<unknown> => ({}));
export const fetchSuiMerkleProof = mock(async (): Promise<unknown> => null);

mock.module("@/lib/sui/explorer", () => ({
  fetchSuiExplorerTransactions,
  fetchSuiExplorerStats,
  fetchSuiMerkleProof,
}));
