import type { PolicyStage } from "@/lib/server/policy-coordinator";

const TERMINAL_FAILURES = new Set<PolicyStage>(["rejected", "failed"]);

export function isPolicyRejection(message: string | null | undefined): boolean {
  return !!message && message.includes("isn't approved for Verified Privacy");
}

export function policyFailureMessage(stage: PolicyStage, detail?: string): string {
  if (stage === "rejected") {
    return detail && /allow|permission|actor/i.test(detail)
      ? `This wallet isn't approved for Verified Privacy: ${detail}. Switch to Open Privacy, or ask the operator to allowlist your wallet.`
      : detail ||
          "This wallet isn't approved for Verified Privacy. Switch to Open Privacy, or ask the operator to allowlist your wallet.";
  }
  return detail || `Policy request ${stage}`;
}

interface PublicPolicyStatus {
  requestId: string;
  stage: PolicyStage;
  error?: string;
  approvalAccount?: string;
}

export function policyStageMessage(stage: PolicyStage): string {
  switch (stage) {
    case "policy_checking":
      return "Checking privacy policy...";
    case "approved":
      return "Policy approved...";
    case "awaiting_signature":
      return "Policy approved. Awaiting signature...";
    case "submitted_to_solana":
      return "Submitted to Solana...";
    case "finalized":
      return "Finalized on Solana.";
    case "rejected":
      return "Policy rejected.";
    case "failed":
      return "Policy check failed.";
  }
}

function policyUrl(networkId: string, vaultId: string, requestId?: string): string {
  const path = requestId
    ? `/api/policy/requests/${encodeURIComponent(requestId)}`
    : "/api/policy/requests";
  const params = new URLSearchParams({ network: networkId, vault: vaultId });
  return `${path}?${params}`;
}

function policySubmissionUrl(
  networkId: string,
  vaultId: string,
  requestId: string,
): string {
  const params = new URLSearchParams({ network: networkId, vault: vaultId });
  return `/api/policy/requests/${encodeURIComponent(requestId)}/submission?${params}`;
}

async function parse(response: Response): Promise<PublicPolicyStatus> {
  const body = await response.json().catch(() => ({})) as PublicPolicyStatus & {
    details?: string;
  };
  if (!response.ok) {
    throw new Error(body.details || body.error || `Policy check returned ${response.status}`);
  }
  return body;
}

export async function preparePolicyApproval(input: {
  networkId: string;
  vaultId: string;
  actor: string;
  /** The member this spend is for, when the actor is not them.
   *
   *  A deposit is signed by the member so `actor` already names them. Anything
   *  relayed is signed by the relayer, and without this the approval records the
   *  relayer — every member's transfers then land on one pubkey that is not a
   *  member at all. */
  member?: string;
  /** Asset instruction discriminator this approval covers. */
  action: number;
  /** Intent parts, in the order the asset program hashes them. */
  intentParts: Uint8Array[];
  onStage: (stage: PolicyStage) => void;
}): Promise<{ requestId: string; approvalAccount: string }> {
  const created = await parse(await fetch(policyUrl(input.networkId, input.vaultId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      actor: input.actor,
      member: input.member ?? input.actor,
      action: input.action,
      intentPartsBase64: input.intentParts.map((part) =>
        Buffer.from(part).toString("base64"),
      ),
    }),
  }));
  let status = created;
  input.onStage(status.stage);
  const deadline = Date.now() + 90_000;
  while (status.stage !== "awaiting_signature") {
    if (TERMINAL_FAILURES.has(status.stage)) {
      throw new Error(policyFailureMessage(status.stage, status.error));
    }
    if (Date.now() >= deadline) {
      throw new Error(`Policy request timed out while ${status.stage}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    status = await parse(await fetch(
      policyUrl(input.networkId, input.vaultId, status.requestId),
      { cache: "no-store" },
    ));
    input.onStage(status.stage);
  }
  if (!status.approvalAccount) {
    throw new Error("Policy coordinator omitted the approved account");
  }
  return {
    requestId: status.requestId,
    approvalAccount: status.approvalAccount,
  };
}

export async function finalizePolicyApproval(input: {
  networkId: string;
  vaultId: string;
  requestId: string;
  signature: string;
  onStage: (stage: PolicyStage) => void;
}): Promise<void> {
  let status = await parse(await fetch(
    policySubmissionUrl(input.networkId, input.vaultId, input.requestId),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature: input.signature }),
    },
  ));
  input.onStage(status.stage);
  const deadline = Date.now() + 30_000;
  while (status.stage !== "finalized") {
    if (TERMINAL_FAILURES.has(status.stage)) {
      throw new Error(policyFailureMessage(status.stage, status.error));
    }
    if (Date.now() >= deadline) {
      throw new Error(`Solana finality timed out while ${status.stage}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    status = await parse(await fetch(
      policyUrl(input.networkId, input.vaultId, input.requestId),
      { cache: "no-store" },
    ));
    input.onStage(status.stage);
  }
}
