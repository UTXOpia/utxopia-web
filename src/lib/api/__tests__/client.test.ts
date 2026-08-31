import { describe, it, expect, beforeEach, mock } from "bun:test";
import { zkBTCApi, zkBTCApiClient } from "../client";

// Mock fetch
const mockFetch = mock(() => Promise.resolve({} as Response));
global.fetch = mockFetch as any;

describe("zkBTCApiClient", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("getWithdrawalStatus", () => {
    it("fetches withdrawal status correctly", async () => {
      const mockResponse = {
        request_id: "test_request_123",
        status: "completed",
        btc_txid: "abc123def456",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as any);

      const result = await zkBTCApi.getWithdrawalStatus("test_request_123");
      expect(result).toEqual(mockResponse);
    });

    it("handles pending status", async () => {
      const mockResponse = {
        request_id: "pending_123",
        status: "pending",
        btc_txid: null,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as any);

      const result = await zkBTCApi.getWithdrawalStatus("pending_123");
      expect(result.status).toBe("pending");
      expect(result.btc_txid).toBeNull();
    });

    it("uses the same-origin withdrawal proxy by default", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ request_id: "123", status: "pending" }),
      } as any);

      await zkBTCApi.getWithdrawalStatus("123");

      const url = (mockFetch.mock.calls[0] as any[])[0];
      expect(url).toBe("/api/withdrawal/status/123");
    });

    it("throws on 404 not found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: "Withdrawal not found" }),
      } as any);

      await expect(zkBTCApi.getWithdrawalStatus("invalid_id")).rejects.toThrow();
    });
  });

  describe("error handling", () => {
    it("handles network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));
      await expect(zkBTCApi.getWithdrawalStatus("test")).rejects.toThrow();
    });

    it("handles malformed JSON responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => { throw new Error("Invalid JSON"); },
      } as any);

      await expect(zkBTCApi.getWithdrawalStatus("test")).rejects.toThrow();
    });
  });

  describe("custom instance", () => {
    it("allows custom base URL", async () => {
      const customClient = new zkBTCApiClient("https://custom-api.example.com");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ request_id: "123", status: "pending" }),
      } as any);

      await customClient.getWithdrawalStatus("123");

      const url = (mockFetch.mock.calls[0] as any[])[0];
      expect(url).toBe("https://custom-api.example.com/api/withdrawal/status/123");
    });
  });

  describe("network routing", () => {
    it("adds explicit network query params to header status checks", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ exists: true, height: 123 }),
      } as any);

      await zkBTCApi.getHeaderStatus(123, "devnet-regtest");

      const url = (mockFetch.mock.calls[0] as any[])[0];
      expect(url).toBe("/api/header/status/123?network=devnet-regtest");
    });

    it("passes the selected network through withdrawal status checks", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ request_id: "abc", status: "pending" }),
      } as any);

      await zkBTCApi.getWithdrawalStatusForNetwork("abc", "devnet-regtest");

      const url = (mockFetch.mock.calls[0] as any[])[0];
      expect(url).toBe("/api/withdrawal/status/abc?network=devnet-regtest");
    });
  });
});
