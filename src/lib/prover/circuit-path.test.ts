import { describe, expect, it } from "bun:test";
import { resolveCircuitPath } from "./circuit-path";

describe("resolveCircuitPath", () => {
  it("uses bundled artifacts by default", () => {
    expect(resolveCircuitPath()).toBe("/circuits/groth16");
  });

  it("does not duplicate the documented circuits path", () => {
    expect(resolveCircuitPath("/circuits")).toBe("/circuits/groth16");
  });

  it("normalizes CDN roots and complete paths", () => {
    expect(resolveCircuitPath("https://cdn.example.com/")).toBe("https://cdn.example.com/circuits/groth16");
    expect(resolveCircuitPath("https://cdn.example.com/circuits/groth16/")).toBe("https://cdn.example.com/circuits/groth16");
  });
});
