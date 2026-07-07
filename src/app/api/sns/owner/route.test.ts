import { afterEach, describe, expect, it } from "bun:test";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getNetworkConfig } from "@/lib/network-config";
import {
  deriveParentDomainKey,
  deriveReverseLookupKey,
  getSnsConfig,
  SNS_HEADER_SIZE,
} from "@/lib/names/sns";
import { GET } from "./route";

const originalGetProgramAccounts = Connection.prototype.getProgramAccounts;
const originalGetAccountInfo = Connection.prototype.getAccountInfo;

afterEach(() => {
  Connection.prototype.getProgramAccounts = originalGetProgramAccounts;
  Connection.prototype.getAccountInfo = originalGetAccountInfo;
});

describe("/api/sns/owner", () => {
  it("returns parsed SNS records owned by a wallet", async () => {
    const owner = Keypair.generate().publicKey;
    const sns = getSnsConfig(getNetworkConfig("devnet-regtest", { applyEnvOverrides: false }));
    expect(sns).toBeTruthy();
    if (!sns) return;

    const parentKey = deriveParentDomainKey(sns);
    const subdomainKey = Keypair.generate().publicKey;
    const reverseKey = deriveReverseLookupKey(subdomainKey, parentKey, sns);
    const viewingPubKey = new Uint8Array(32).fill(3);
    const mpk = new Uint8Array(32).fill(4);
    const stealthData = new Uint8Array(SNS_HEADER_SIZE + 66);
    stealthData[SNS_HEADER_SIZE] = 2;
    stealthData.set(viewingPubKey, SNS_HEADER_SIZE + 1);
    stealthData.set(mpk, SNS_HEADER_SIZE + 33);
    stealthData[SNS_HEADER_SIZE + 65] = 1;

    const reverseName = "\0alice";
    const reverseData = Buffer.alloc(SNS_HEADER_SIZE + 4 + reverseName.length);
    reverseData.writeUInt32LE(reverseName.length, SNS_HEADER_SIZE);
    reverseData.write(reverseName, SNS_HEADER_SIZE + 4, "utf8");
    const filtersSeen: unknown[] = [];

    Connection.prototype.getProgramAccounts = async function (_programId, config) {
      filtersSeen.push(...(config?.filters ?? []));
      return [
        {
          pubkey: subdomainKey,
          account: { data: Buffer.from(stealthData) },
        },
      ] as never;
    };
    Connection.prototype.getAccountInfo = async function (key: PublicKey) {
      return key.equals(reverseKey) ? { data: reverseData } as never : null;
    };

    const response = await GET(new Request(
      `https://app.utxopia.test/api/sns/owner?network=devnet-regtest&refresh=1&owner=${owner.toBase58()}`,
      {
        headers: {
          "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
        },
      },
    ) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.registered).toBe(true);
    expect(body.records).toHaveLength(1);
    expect(body.records[0]).toMatchObject({
      name: "alice",
      fullDomain: "alice.utxopia.sol",
      subdomainKey: subdomainKey.toBase58(),
      version: 2,
      complianceFlags: 1,
      viewingPubKey: Buffer.from(viewingPubKey).toString("hex"),
      mpk: Buffer.from(mpk).toString("hex"),
    });
    expect(filtersSeen).toHaveLength(2);
  });
});
