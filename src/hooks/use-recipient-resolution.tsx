"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  decodeStealthMetaAddress,
  type SnsStealthAddress,
  type StealthMetaAddress,
} from "@utxopia/sdk";
import {
  detectRecipientAllowing,
  type DetectionResult,
  type RecipientType,
} from "@/components/send/recipient-detect";
import {
  PRIVATE_NAME_SUFFIX,
  normalizePrivateNameHandle,
} from "@/lib/names/private-name-claim";
import { useSnsName } from "@/hooks/use-sns-name";

export type RecipientResolveStatus = "idle" | "resolving" | "found" | "not_found";

/** Stop spinning and show a terminal state if the name server never answers. */
const RESOLVE_TIMEOUT_MS = 12_000;
/** Every lookup is an RPC round trip — don't fire one per keystroke. */
const RESOLVE_DEBOUNCE_MS = 250;

export interface UseRecipientResolutionOptions {
  chain?: "solana";
  /** Restrict which recipient types this surface accepts; others report invalid. */
  allow?: readonly RecipientType[];
  /** Message shown when the input parses but its type isn't in `allow`. */
  disallowedMessage?: string;
}

export interface RecipientResolution {
  detection: DetectionResult;
  status: RecipientResolveStatus;
  /** Stealth meta-address for the recipient. Name records carry a zeroed spending key. */
  meta: StealthMetaAddress | null;
  /** Full SNS record, when the recipient came from a name. */
  sns: SnsStealthAddress | null;
  /** Display name (`alice.utxopia.sol`); null for a pasted meta-address. */
  name: string | null;
  error: string | null;
}

type Settled = Omit<RecipientResolution, "detection">;

const SETTLED_IDLE: Settled = { status: "idle", meta: null, sns: null, name: null, error: null };

/**
 * One resolution path for every surface that takes a recipient: detection ladder,
 * debounced name lookup, meta-address decode, and terminal error text.
 *
 * `allow` must be referentially stable (a module-level const) — it feeds the
 * detection memo.
 */
export function useRecipientResolution(
  input: string,
  options: UseRecipientResolutionOptions = {},
): RecipientResolution {
  const { chain = "solana", allow, disallowedMessage } = options;
  const { lookupSnsName } = useSnsName();
  const [settled, setSettled] = useState<Settled>(SETTLED_IDLE);

  // Held in a ref, not an effect dependency: a caller whose `lookupSnsName`
  // identity changes per render would otherwise restart resolution forever.
  const lookup = useRef(lookupSnsName);
  useEffect(() => {
    lookup.current = lookupSnsName;
  });

  const trimmed = input.trim();

  const detection = useMemo<DetectionResult>(
    () =>
      detectRecipientAllowing(
        trimmed,
        allow,
        disallowedMessage ?? "Not a supported recipient here",
        { chain },
      ),
    [trimmed, chain, allow, disallowedMessage],
  );

  const detectionType = detection.type;
  const detectionReason = detection.reason;

  useEffect(() => {
    if (detectionType === "stealth_meta") {
      try {
        setSettled({
          status: "found",
          meta: decodeStealthMetaAddress(trimmed),
          sns: null,
          name: null,
          error: null,
        });
      } catch (err) {
        setSettled({
          ...SETTLED_IDLE,
          status: "not_found",
          error: err instanceof Error ? err.message : "Invalid private address",
        });
      }
      return;
    }

    if (detectionType !== "stealth_sns") {
      setSettled(
        detectionType === "invalid"
          ? { ...SETTLED_IDLE, error: detectionReason ?? "Not a valid recipient" }
          : SETTLED_IDLE,
      );
      return;
    }

    let handle: string;
    try {
      handle = normalizePrivateNameHandle(trimmed, "solana");
    } catch (err) {
      setSettled({
        ...SETTLED_IDLE,
        status: "not_found",
        error: err instanceof Error ? err.message : "Invalid name",
      });
      return;
    }
    const fullName = `${handle}${PRIVATE_NAME_SUFFIX}`;
    const notFound: Settled = {
      ...SETTLED_IDLE,
      status: "not_found",
      error: `"${fullName}" not found`,
    };

    setSettled({ ...SETTLED_IDLE, status: "resolving" });

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) setSettled(notFound);
    }, RESOLVE_TIMEOUT_MS);
    const settle = (next: Settled) => {
      if (cancelled) return;
      clearTimeout(timeout);
      setSettled(next);
    };
    const debounce = setTimeout(() => {
      void lookup.current(handle)
        .then((record) =>
          settle(
            record
              ? {
                  status: "found",
                  // Names publish only the viewing key and mpk; the spending key
                  // is never needed to send to a recipient.
                  meta: {
                    spendingPubKey: new Uint8Array(32),
                    viewingPubKey: record.viewingPubKey,
                    mpk: record.mpk,
                  },
                  sns: record,
                  name: fullName,
                  error: null,
                }
              : notFound,
          ),
        )
        .catch(() => settle(notFound));
    }, RESOLVE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      clearTimeout(debounce);
    };
  }, [detectionType, detectionReason, trimmed]);

  return { detection, ...settled };
}
