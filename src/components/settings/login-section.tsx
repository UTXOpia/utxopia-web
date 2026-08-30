"use client";

/**
 * Which login this browser is on, and how to leave it.
 *
 * There was no way out before: a member who signed in with the wrong Google
 * account had no control anywhere that would put them on the right one.
 *
 * Signing out is not the same as forgetting the vault, and the copy has to say
 * so, because the two look identical from here — one drops a session, the other
 * drops the only wrapping this device holds. It is also not reversible by any
 * other account: this browser's wrapping is bound to the login that armed it,
 * so coming back as somebody else fails with that, not with a wrong PIN.
 */

import { useState } from "react";
import { usePrivySolanaAuthority } from "@/lib/privy-solana-context";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { RowButton, Section, SettingsRow } from "@/components/settings/preferences-form";

export function LoginSection() {
  const privy = usePrivySolanaAuthority();
  const clearKeys = useUTXOpiaStore((s) => s.clearKeys);
  const [busy, setBusy] = useState(false);

  if (!privy.enabled || !privy.authenticated) return null;

  const signOut = async () => {
    setBusy(true);
    try {
      // Keys first. Leaving an unlocked vault on screen behind a login that is
      // no longer signed in reads as still being signed in.
      clearKeys();
      await privy.logout();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section label="Login">
      <SettingsRow
        title="Signed in as"
        tip={
          <>
            Signing out does not forget your vault — the wrapping stays on this device, and this
            same account plus your PIN reopens it. A different account will not: the wrapping is
            bound to the login that made it. To remove the vault from this browser, use{" "}
            <span className="text-gray-light">This vault on this device</span> under Recovery.
          </>
        }
        value={
          <span className="truncate font-mono text-[12px] text-privacy">
            {privy.accountLabel ?? "your account"}
          </span>
        }
        action={
          <RowButton onClick={() => void signOut()} busy={busy}>
            Sign out
          </RowButton>
        }
      />
    </Section>
  );
}
