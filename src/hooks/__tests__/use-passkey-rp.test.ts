import { describe, expect, it } from "bun:test";
import { registrableRpId } from "../use-passkey";

describe("registrableRpId", () => {
  it("collapses every utxopia.com subdomain onto one relying party", () => {
    expect(registrableRpId("app.utxopia.com")).toBe("utxopia.com");
    expect(registrableRpId("www.utxopia.com")).toBe("utxopia.com");
    expect(registrableRpId("utxopia.com")).toBe("utxopia.com");
  });

  it("leaves anything else as its own relying party", () => {
    expect(registrableRpId("localhost")).toBe("localhost");
    expect(registrableRpId("utxopia-web.vercel.app")).toBe("utxopia-web.vercel.app");
  });

  // Suffix matching, not substring: a lookalike must not claim our credentials.
  it("does not match a domain that merely ends in the same letters", () => {
    expect(registrableRpId("notutxopia.com")).toBe("notutxopia.com");
    expect(registrableRpId("utxopia.com.evil.io")).toBe("utxopia.com.evil.io");
  });
});
