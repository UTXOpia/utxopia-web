"use client";

import { useState, useEffect, useRef } from "react";
import { usePasskey } from "@/hooks/use-passkey";
import { useUTXOpiaStore } from "@/stores/utxopia-store";

/**
 * @param autoOpen Pop the auth modal on mount when there are no keys. Right for
 *   a flow the user came to in order to spend; wrong for a page that is useful
 *   signed out, where an unprompted modal on arrival is just in the way.
 */
export function usePayFlowAuth(hasKeys: boolean, { autoOpen = true }: { autoOpen?: boolean } = {}) {
  const {
    isSupported: passkeySupported,
    hasCredential: hasPasskeyCredential,
    isLoading: passkeyLoading,
    error: passkeyError,
    register: registerPasskey,
    authenticate: authenticatePasskey,
  } = usePasskey();
  const deriveKeysFromPasskeySeed = useUTXOpiaStore((s) => s.deriveKeysFromPasskeySeed);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const handlePasskeyRegister = async () => {
    const seed = await registerPasskey();
    if (seed) {
      await deriveKeysFromPasskeySeed(seed);
      setAuthModalOpen(false);
    }
  };

  const handlePasskeyAuthenticate = async () => {
    const seed = await authenticatePasskey();
    if (seed) {
      await deriveKeysFromPasskeySeed(seed);
      setAuthModalOpen(false);
    }
  };

  // Auto-open auth modal when no keys
  const authAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpen && !hasKeys && !authAutoOpenedRef.current) {
      authAutoOpenedRef.current = true;
      setAuthModalOpen(true);
    }
    if (hasKeys) authAutoOpenedRef.current = false;
  }, [hasKeys, autoOpen]);

  return {
    authModalOpen,
    setAuthModalOpen,
    passkeySupported,
    hasPasskeyCredential,
    passkeyLoading,
    passkeyError,
    handlePasskeyRegister,
    handlePasskeyAuthenticate,
  };
}
