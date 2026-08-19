import { expect, test } from "bun:test";
import { pageSlice } from "./shared";

const items = Array.from({ length: 25 }, (_, i) => i);

test("slices and clamps", () => {
  expect(pageSlice(items, 1, 10)).toMatchObject({ page: 1, pageCount: 3, rows: items.slice(0, 10) });
  expect(pageSlice(items, 3, 10).rows).toEqual([20, 21, 22, 23, 24]);
  // page beyond the end clamps instead of showing a blank table
  expect(pageSlice(items, 9, 10).page).toBe(3);
  expect(pageSlice(items, 0, 10).page).toBe(1);
  expect(pageSlice([], 1, 10)).toMatchObject({ page: 1, pageCount: 1, rows: [] });
});
