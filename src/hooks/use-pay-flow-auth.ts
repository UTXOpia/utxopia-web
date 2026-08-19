"use client";

import { useState, useEffect, useRef } from "react";
import { usePasskey } from "@/hooks/use-passkey";

/**
 * @param autoOpen Pop the auth modal on mount when there are no keys. Right for
 *   a flow the user came to in order to spend; wrong for a page that is useful
 *   signed out, where an unprompted modal on arrival is just in the way.
 */
export function usePayFlowAuth(hasKeys: boolean, { autoOpen = true }: { autoOpen?: boolean } = {}) {
  const { error: passkeyError } = usePasskey();
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // Auto-open auth modal when no keys
  const authAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpen && !hasKeys && !authAutoOpenedRef.current) {
      authAutoOpenedRef.current = true;
      setAuthModalOpen(true);
    }
    if (hasKeys) authAutoOpenedRef.current = false;
  }, [hasKeys, autoOpen]);

  return { authModalOpen, setAuthModalOpen, passkeyError };
}
