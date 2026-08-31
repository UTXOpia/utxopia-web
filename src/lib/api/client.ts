/**
 * API Client - Minimal Backend Interface
 *
 * Architecture:
 * - Most operations (deposit, claim, split) are handled client-side via SDK + Solana
 * - JoinSplit relay submission is handled by @utxopia/sdk's submitToRelay()
 * - Block headers are submitted by the backend header-relayer service (batch only)
 * - Deposit status is tracked via @/lib/api/deposits (backend deposit tracker)
 *
 * Backend provides:
 * 1. GET /api/withdrawal/status/:id - Check withdrawal status
 */

import type {
  WithdrawalStatusResponse,
  HeaderStatusResponse,
} from "./types";
import { ApiError } from "./errors";
import { API_ENDPOINTS } from "./constants";
import type { NetworkId } from "@/lib/network-config";

/**
 * UTXOpia API Client (Minimal - Redemption Only)
 *
 * Note: Deposit and claim operations are handled client-side:
 * - Use @/lib/sdk for deposit credential generation
 * - Use @/lib/solana/instructions for Solana transactions
 * - Use getDepositStatus() from @/lib/api/deposits for deposit status
 */
class zkBTCApiClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || "";
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
        ...options,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: `HTTP ${response.status}: ${response.statusText}`,
        }));
        throw ApiError.fromResponse(error, response.status);
      }

      return await response.json();
    } catch (error) {
      throw ApiError.fromUnknown(error);
    }
  }

  /**
   * Get the status of a withdrawal request
   *
   * @param requestId - Withdrawal request ID from redeem() response
   */
  async getWithdrawalStatus(requestId: string): Promise<WithdrawalStatusResponse> {
    return this.request<WithdrawalStatusResponse>(API_ENDPOINTS.WITHDRAWAL_STATUS(requestId));
  }

  async getWithdrawalStatusForNetwork(
    requestId: string,
    network: NetworkId,
  ): Promise<WithdrawalStatusResponse> {
    const endpoint = `${API_ENDPOINTS.WITHDRAWAL_STATUS(requestId)}?network=${encodeURIComponent(network)}`;
    return this.request<WithdrawalStatusResponse>(endpoint);
  }

  // ============ Block Header Status (Next.js API Route) ============

  /**
   * Check if a block header exists on-chain
   * Uses internal Next.js API route
   */
  async getHeaderStatus(blockHeight: number, network?: NetworkId): Promise<HeaderStatusResponse> {
    const query = network ? `?network=${encodeURIComponent(network)}` : "";
    const response = await fetch(`/api/header/status/${blockHeight}${query}`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: `HTTP ${response.status}: ${response.statusText}`,
      }));
      throw ApiError.fromResponse(error, response.status);
    }

    return response.json();
  }
}

// Export singleton instance
export const zkBTCApi = new zkBTCApiClient();

// Export class for custom instances
export { zkBTCApiClient };
