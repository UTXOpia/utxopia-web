/**
 * TransferDetails — dispatcher component that renders the appropriate
 * detail view based on the transfer kind.
 */

import type { RedemptionRecord } from "@/hooks/use-explorer";
import { getTransferKind } from "../transfers-tab";
import { ShieldDetails } from "./shield-details";
import { RedeemDetails } from "./redeem-details";
import { UnshieldDetails } from "./unshield-details";
import { StandardTransferDetails } from "./standard-transfer-details";
import type { TransferTx } from "./detail-helpers";
import type { NetworkId } from "@/lib/network-config";

export function TransferDetails({ tx, redemption, network }: { tx: TransferTx; redemption?: RedemptionRecord; network?: NetworkId }) {
  const kind = getTransferKind(tx);
  if (kind === "shield") return <ShieldDetails tx={tx} network={network} />;
  if (kind === "withdraw") return <RedeemDetails tx={tx} redemption={redemption} network={network} />;
  if (kind === "unshield") return <UnshieldDetails tx={tx} network={network} />;
  return <StandardTransferDetails tx={tx} network={network} />;
}
