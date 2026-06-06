/**
 * API Client - Minimal Backend Interface
 *
 * Architecture:
 * - Most operations (deposit, claim, split) are handled client-side via SDK + Solana
 * - JoinSplit relay submission is handled by @utxopia/sdk's submitToRelay()
 * - Block headers are submitted by the backend header-relayer service (batch only)
 * - Deposit status checked via mempool.space directly (no backend needed)
 *
 * Backend provides:
 * 1. GET /api/withdrawal/status/:id - Check withdrawal status
 */

import type {
  WithdrawalStatusResponse,
  DepositStatusResponse,
  HeaderStatusResponse,
} from "./types";
import { ApiError } from "./errors";
import { API_ENDPOINTS } from "./constants";
import { getEsploraApiUrl } from "@/lib/btc-network";
import type { NetworkId } from "@/lib/network-config";

/**
 * UTXOpia API Client (Minimal - Redemption Only)
 *
 * Note: Deposit and claim operations are handled client-side:
 * - Use @/lib/sdk for deposit credential generation
 * - Use @/lib/solana/instructions for Solana transactions
 * - Use getDepositStatusFromMempool() for deposit status
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

// ============ Mempool.space Direct API (No Backend Needed) ============

/** Get mempool API URL from SDK config (single source of truth) */
function getMempoolApiUrl(): string {
  return getEsploraApiUrl();
}
const REQUIRED_CONFIRMATIONS = 2;
const DEPOSIT_OP_RETURN_HEX_SIZE = 73 * 2;

interface MempoolAddressInfo {
  address: string;
  chain_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
  mempool_stats: {
    funded_txo_count: number;
    funded_txo_sum: number;
    spent_txo_count: number;
    spent_txo_sum: number;
    tx_count: number;
  };
}

interface MempoolTransaction {
  txid: string;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
  };
  vout: Array<{
    scriptpubkey: string;
    scriptpubkey_type: string;
    scriptpubkey_address?: string;
    value: number;
  }>;
}

function extractCompactDepositOpReturn(scriptPubkey: string): string | undefined {
  const script = scriptPubkey.toLowerCase();
  if (!script.startsWith("6a")) return undefined;

  // OP_RETURN OP_PUSHBYTES_73 <payload>
  if (script.startsWith("6a49") && script.length === 4 + DEPOSIT_OP_RETURN_HEX_SIZE) {
    return script.slice(4);
  }

  // OP_RETURN OP_PUSHDATA1 0x49 <payload>
  if (script.startsWith("6a4c49") && script.length === 6 + DEPOSIT_OP_RETURN_HEX_SIZE) {
    return script.slice(6);
  }

  return undefined;
}

/**
 * Fetch deposit status directly from mempool.space by taproot address
 *
 * This function queries Bitcoin network directly - no backend needed.
 * Uses mempool.space API for testnet.
 *
 * @param taprootAddress - Bitcoin taproot address (tb1p...)
 * @returns Deposit status with confirmation count
 */
export async function getDepositStatusFromMempool(
  taprootAddress: string
): Promise<DepositStatusResponse> {
  try {
    // Get address info
    const addressRes = await fetch(`${getMempoolApiUrl()}/address/${taprootAddress}`);
    if (!addressRes.ok) {
      return {
        found: false,
        confirmations: 0,
        required_confirmations: REQUIRED_CONFIRMATIONS,
        status: "waiting_payment",
        escrow_status: "waiting_payment",
        can_claim: false,
        claimed: false,
        refund_available: false,
      };
    }

    const addressInfo: MempoolAddressInfo = await addressRes.json();

    // Check if any transactions received
    const totalReceived = addressInfo.chain_stats.funded_txo_sum + addressInfo.mempool_stats.funded_txo_sum;

    if (totalReceived === 0) {
      return {
        found: false,
        taproot_address: taprootAddress,
        confirmations: 0,
        required_confirmations: REQUIRED_CONFIRMATIONS,
        status: "waiting_payment",
        escrow_status: "waiting_payment",
        can_claim: false,
        claimed: false,
        refund_available: false,
      };
    }

    // Get transactions to find the deposit
    const txsRes = await fetch(`${getMempoolApiUrl()}/address/${taprootAddress}/txs`);
    const txs: MempoolTransaction[] = txsRes.ok ? await txsRes.json() : [];

    // Find the deposit transaction (first incoming tx to this address)
    let depositTx: MempoolTransaction | null = null;
    let depositAmount = 0;

    for (const tx of txs) {
      for (const vout of tx.vout) {
        if (vout.scriptpubkey_address === taprootAddress) {
          depositTx = tx;
          depositAmount = vout.value;
          break;
        }
      }
      if (depositTx) break;
    }

    if (!depositTx) {
      return {
        found: false,
        taproot_address: taprootAddress,
        confirmations: 0,
        required_confirmations: REQUIRED_CONFIRMATIONS,
        status: "waiting_payment",
        escrow_status: "waiting_payment",
        can_claim: false,
        claimed: false,
        refund_available: false,
      };
    }

    // Extract compact deposit OP_RETURN data (scriptpubkey_type === "op_return").
    let opReturnHex: string | undefined;
    for (const vout of depositTx.vout) {
      if (vout.scriptpubkey_type === "op_return") {
        opReturnHex = extractCompactDepositOpReturn(vout.scriptpubkey);
      }
      if (opReturnHex) {
        break;
      }
    }

    // Calculate confirmations
    let confirmations = 0;
    if (depositTx.status.confirmed && depositTx.status.block_height) {
      // Get current block height
      const tipRes = await fetch(`${getMempoolApiUrl()}/blocks/tip/height`);
      if (tipRes.ok) {
        const tipHeight = parseInt(await tipRes.text(), 10);
        confirmations = tipHeight - depositTx.status.block_height + 1;
      }
    }

    const canClaim = confirmations >= REQUIRED_CONFIRMATIONS;

    // Determine escrow status
    let escrowStatus: DepositStatusResponse["escrow_status"] = "waiting_payment";
    if (depositTx.status.confirmed) {
      if (confirmations >= REQUIRED_CONFIRMATIONS) {
        escrowStatus = "passed"; // Ready to claim
      } else {
        escrowStatus = "confirming";
      }
    } else {
      escrowStatus = "confirming"; // In mempool
    }

    return {
      found: true,
      taproot_address: taprootAddress,
      amount_sats: depositAmount,
      btc_txid: depositTx.txid,
      confirmations,
      required_confirmations: REQUIRED_CONFIRMATIONS,
      status: escrowStatus,
      escrow_status: escrowStatus,
      can_claim: canClaim,
      claimed: false,
      refund_available: false,
      op_return_hex: opReturnHex,
    };
  } catch (error) {
    console.error("Failed to fetch from mempool.space:", error);
    return {
      found: false,
      confirmations: 0,
      required_confirmations: REQUIRED_CONFIRMATIONS,
      status: "waiting_payment",
      escrow_status: "waiting_payment",
      can_claim: false,
      claimed: false,
      refund_available: false,
    };
  }
}
