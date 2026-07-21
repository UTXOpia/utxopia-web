import { describe, expect, it } from "bun:test";
import {
  isNativeSolMint,
  NATIVE_SOL_2022_MINT,
  NATIVE_SOL_MINT,
} from "./native-sol";

describe("native SOL mint detection", () => {
  it("accepts the canonical Token and Token-2022 native mints", () => {
    expect(isNativeSolMint(NATIVE_SOL_MINT)).toBe(true);
    expect(isNativeSolMint(NATIVE_SOL_2022_MINT)).toBe(true);
  });

  it("does not treat an arbitrary SPL mint as native SOL", () => {
    expect(isNativeSolMint("AcxjjA4K9iyfBQBkDsErGVTJj1NtF7znzMjnVvd3Qzey")).toBe(false);
  });
});
