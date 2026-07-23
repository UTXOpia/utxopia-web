import { beforeEach, describe, expect, it } from "bun:test";
import {
  ACTIVITY_LABEL_MAX_LENGTH,
  ACTIVITY_NOTE_MAX_LENGTH,
  getActivityAnnotations,
  saveActivityAnnotation,
} from "./activity-annotations";

describe("activity annotations", () => {
  beforeEach(() => localStorage.clear());

  it("stores annotations per network", () => {
    saveActivityAnnotation("devnet-regtest", "note:abc", {
      label: "Relay fee",
      note: "Fee from test transaction",
    });

    expect(getActivityAnnotations("devnet-regtest")["note:abc"]).toMatchObject({
      label: "Relay fee",
      note: "Fee from test transaction",
    });
    expect(getActivityAnnotations("devnet")).toEqual({});
  });

  it("trims values and removes an empty annotation", () => {
    saveActivityAnnotation("devnet-regtest", "tx:123", {
      label: `  ${"a".repeat(ACTIVITY_LABEL_MAX_LENGTH + 10)}  `,
      note: `  ${"b".repeat(ACTIVITY_NOTE_MAX_LENGTH + 10)}  `,
    });
    const stored = getActivityAnnotations("devnet-regtest")["tx:123"];
    expect(stored.label).toHaveLength(ACTIVITY_LABEL_MAX_LENGTH);
    expect(stored.note).toHaveLength(ACTIVITY_NOTE_MAX_LENGTH);

    saveActivityAnnotation("devnet-regtest", "tx:123", {
      label: " ",
      note: "",
    });
    expect(getActivityAnnotations("devnet-regtest")["tx:123"]).toBeUndefined();
  });
});
