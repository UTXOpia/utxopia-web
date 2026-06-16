import { hex } from "@scure/base";
import { useUTXOpiaStore } from "@/stores/utxopia-store";

/** Seed the UTXOpia privacy identity deterministically from a hex seed. */
export async function loginDevIdentity(seedHex: string): Promise<void> {
  const seed = hex.decode(seedHex.replace(/^0x/, ""));
  await useUTXOpiaStore.getState().deriveKeysFromPasskeySeed(seed);
}
