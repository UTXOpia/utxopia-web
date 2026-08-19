import { beforeEach, describe, expect, it } from "bun:test";
import { checkSignatureStability } from "./privy-signature-probe";

const MESSAGE = new TextEncoder().encode("Sign this message to unlock your UTXOpia vault.");
const sig = (byte: number) => new Uint8Array(64).fill(byte);

describe("Privy signature stability", () => {
  beforeEach(() => localStorage.clear());

  it("says nothing the first time, and nothing again when it agrees", () => {
    const call = () => checkSignatureStability({ signer: "wallet-a", message: MESSAGE, signature: sig(1) });
    expect(call()).toBeNull();
    expect(call()).toBeNull();
  });

  // The failure this exists for is silent: nothing throws, every wrapping just
  // stops opening. So the only signal is this string.
  it("reports a wallet that signed the same message differently", () => {
    checkSignatureStability({ signer: "wallet-a", message: MESSAGE, signature: sig(1) });
    const drift = checkSignatureStability({ signer: "wallet-a", message: MESSAGE, signature: sig(2) });
    expect(drift).toContain("signed the same message differently");
  });

  it("does not accuse a different wallet or a different message", () => {
    checkSignatureStability({ signer: "wallet-a", message: MESSAGE, signature: sig(1) });
    expect(
      checkSignatureStability({ signer: "wallet-b", message: MESSAGE, signature: sig(2) }),
    ).toBeNull();
    expect(
      checkSignatureStability({
        signer: "wallet-a",
        message: new TextEncoder().encode("another message"),
        signature: sig(3),
      }),
    ).toBeNull();
  });
});
