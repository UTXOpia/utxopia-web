import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

// The login-armed unlock has exactly one path: fetch the published wrapping
// against a counted PIN proof, then sign. A local wrapping under the login was
// the uncounted copy — six digits sweepable offline by anyone holding the
// profile and the provider session — so no setup or unlock code may write or
// read one. Rendering these screens needs Privy and the store; the invariant
// is cheaper to hold on the source.
const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

describe("login-armed browsers keep no local wrapping", () => {
  it("unlock never reads a device envelope", () => {
    expect(src("./vault-unlock-prompt.tsx")).not.toMatch(/readDeviceEnvelope|unlockEnvelopeVault\(keyMaterial/);
    expect(src("./vault-unlock-prompt.tsx")).toMatch(/getRemoteEnvelope\(/);
  });
  it("a login-armed browser sweeps any wrapping left from before", () => {
    expect(src("../../hooks/use-privy-vault-key.ts")).toMatch(/if \(isArmed\) dropDeviceEnvelope\(scope\)/);
  });
  it("asks the passkey to take over at most once per browser", () => {
    const s = src("./vault-unlock-prompt.tsx");
    expect(s).toMatch(/if \(!hasPasskey \|\| localStorage\.getItem\(HANDOVER_KEY\)\) return;/);
    expect(s).toMatch(/localStorage\.setItem\(HANDOVER_KEY, "1"\)/);
  });
  it("setup arms the login only after a confirmed publish", () => {
    const s = src("./vault-setup.tsx");
    expect(s).not.toMatch(/login\?\.keyMaterial|dropDeviceEnvelope/);
    expect(s.match(/privy\.remember\(login\.signer\)/g)?.length).toBe(2);
    expect(s).toMatch(/\(await publishLogin\(login, device\)\) && !device && login\) privy\.remember/);
  });
});
