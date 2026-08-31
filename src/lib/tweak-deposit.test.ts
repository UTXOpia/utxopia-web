import { describe, expect, test } from "bun:test";
import { deriveDepositAddress, depositTweakCommitment, bytesToHex } from "@utxopia/sdk";
import { useDepositIndexStore } from "@/stores/deposit-index-store";
import { claimDepositIndex } from "./tweak-deposit";

/**
 * The faucet route re-derives the address from the public keys the client sends
 * and refuses a mismatch. These assert the two halves that check relies on.
 */
describe("tweak deposit request", () => {
  test("what the client sends is what the route can recompute", () => {
    const npk = new Uint8Array(32).fill(0x22);
    const eph = new Uint8Array(32).fill(0x11);
    const vault = new Uint8Array(32).fill(0x33);

    // The route's check, run here: address must follow from the two keys alone.
    const address = deriveDepositAddress(
      depositTweakCommitment(npk, eph),
      vault,
      "regtest",
    ).address;

    expect(address).toBe("bcrt1pl44ykzegsumc3vgmghv0m7qerrvzcwds2qmfqerhj85jy9dl3dvs084mpx");
    expect(bytesToHex(npk).length).toBe(64);
    expect(bytesToHex(eph).length).toBe(64);
  });

  /// Every drip must burn an index. Two deposits sharing one would derive the
  /// same address — safe on chain, but it links them for anyone watching, and it
  /// is the kind of thing that only shows up as a privacy regression long after.
  test("each derivation consumes a fresh index", () => {
    useDepositIndexStore.setState({ next: {} });
    const s = useDepositIndexStore.getState();

    const claimed = [s.claim("me"), s.claim("me"), s.claim("me")];
    expect(claimed).toEqual([0, 1, 2]);
    expect(new Set(claimed).size).toBe(3);
  });

  /// Both deposit paths must land on ONE counter. They used to key it
  /// differently — encoded address here, mpk there — so a wallet's first faucet
  /// deposit and its first wallet deposit derived the same address.
  test("one wallet has one counter, and an existing one is not restarted", () => {
    const mpk = "44".repeat(32);
    const encoded = `utxo:${"55".repeat(32)}${"66".repeat(32)}${mpk}`;

    useDepositIndexStore.setState({ next: {} });
    expect(claimDepositIndex(encoded)).toBe(0);
    expect(useDepositIndexStore.getState().claim(mpk)).toBe(1);

    // A wallet that already spent indices under the legacy key resumes above
    // them rather than re-deriving addresses it has already handed out.
    useDepositIndexStore.setState({ next: { [encoded]: 7 } });
    expect(claimDepositIndex(encoded)).toBe(7);
    expect(claimDepositIndex(encoded)).toBe(8);
  });
});
