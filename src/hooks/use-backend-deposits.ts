"use client";

import useSWR from "swr";
import {
  fetchAllDeposits,
  type DepositStatusResponse,
} from "@/lib/api/deposits";
import { useChainEnvironment } from "@/lib/chain-environment";

/**
 * Hook to fetch all deposits from the backend tracker API.
 * Polls every 30s via SWR revalidation.
 */
export function useBackendDeposits() {
  const { networkId } = useChainEnvironment();
  const { data, error, isLoading, mutate } = useSWR<DepositStatusResponse[]>(
    ["backend-deposits", networkId],
    async () => {
      const result = await fetchAllDeposits(networkId);
      return result.deposits ?? [];
    },
    {
      refreshInterval: 30_000,
      dedupingInterval: 5_000,
      revalidateOnFocus: false,
      errorRetryCount: 3,
    }
  );

  return {
    deposits: data ?? [],
    isLoading,
    error: error
      ? error instanceof Error
        ? error.message
        : "Failed to fetch deposits"
      : null,
    refresh: () => mutate(),
  };
}
