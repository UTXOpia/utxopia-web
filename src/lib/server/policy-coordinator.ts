import { applyBackendAuthHeaders } from "@/lib/server/backend-auth";

export type PolicyStage =
  | "policy_checking"
  | "approved"
  | "awaiting_signature"
  | "submitted_to_solana"
  | "finalized"
  | "rejected"
  | "failed";

interface PolicyRequestStatus {
  requestId: string;
  stage: PolicyStage;
  actor?: string;
  approvalAccount?: string;
  error?: string;
}

const POLICY_POLL_INTERVAL_MS = 500;
const POLICY_APPROVAL_TIMEOUT_MS = 90_000;
const POLICY_FINALITY_TIMEOUT_MS = 30_000;

function endpoint(backendUrl: string, path: string): string {
  return `${backendUrl.replace(/\/+$/, "")}${path}`;
}

async function readPolicyResponse(response: Response): Promise<PolicyRequestStatus> {
  const body = await response.json().catch(() => ({})) as PolicyRequestStatus & {
    details?: string;
  };
  if (!response.ok) {
    throw new Error(body.details || body.error || `Policy coordinator returned ${response.status}`);
  }
  return body;
}

async function getPolicyRequest(
  backendUrl: string,
  requestId: string,
): Promise<PolicyRequestStatus> {
  const response = await fetch(
    endpoint(backendUrl, `/api/policy/requests/${encodeURIComponent(requestId)}`),
    { headers: applyBackendAuthHeaders({ Accept: "application/json" }), cache: "no-store" },
  );
  return readPolicyResponse(response);
}

async function waitForStage(
  backendUrl: string,
  initial: PolicyRequestStatus,
  accepted: ReadonlySet<PolicyStage>,
  timeoutMs: number,
): Promise<PolicyRequestStatus> {
  let status = initial;
  const deadline = Date.now() + timeoutMs;
  while (!accepted.has(status.stage)) {
    if (status.stage === "rejected" || status.stage === "failed") {
      throw new Error(status.error || `Policy request ${status.stage}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Policy request timed out while ${status.stage}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLICY_POLL_INTERVAL_MS));
    status = await getPolicyRequest(backendUrl, status.requestId);
  }
  return status;
}

export async function requestPolicyApproval(input: {
  backendUrl: string;
  actor: string;
  instructionData: Uint8Array;
}): Promise<{ requestId: string; approvalAccount: string }> {
  const response = await fetch(endpoint(input.backendUrl, "/api/policy/requests"), {
    method: "POST",
    headers: applyBackendAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      actor: input.actor,
      instructionDataBase64: Buffer.from(input.instructionData).toString("base64"),
    }),
    cache: "no-store",
  });
  const created = await readPolicyResponse(response);
  const approved = await waitForStage(
    input.backendUrl,
    created,
    new Set(["awaiting_signature"]),
    POLICY_APPROVAL_TIMEOUT_MS,
  );
  if (!approved.approvalAccount) {
    throw new Error("Policy coordinator omitted the approved account");
  }
  return {
    requestId: approved.requestId,
    approvalAccount: approved.approvalAccount,
  };
}

export async function resolvePolicyApproval(input: {
  backendUrl: string;
  requestId: string;
  actor: string;
}): Promise<{ requestId: string; approvalAccount: string }> {
  const status = await getPolicyRequest(input.backendUrl, input.requestId);
  if (status.stage !== "awaiting_signature") {
    throw new Error(`Policy request is ${status.stage}, not awaiting signature`);
  }
  if (status.actor !== input.actor) {
    throw new Error("Policy request actor does not match the relayer");
  }
  if (!status.approvalAccount) {
    throw new Error("Policy coordinator omitted the approved account");
  }
  return {
    requestId: status.requestId,
    approvalAccount: status.approvalAccount,
  };
}

export async function recordPolicySubmission(input: {
  backendUrl: string;
  requestId: string;
  signature: string;
}): Promise<PolicyStage> {
  const response = await fetch(
    endpoint(
      input.backendUrl,
      `/api/policy/requests/${encodeURIComponent(input.requestId)}/submission`,
    ),
    {
      method: "POST",
      headers: applyBackendAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ signature: input.signature }),
      cache: "no-store",
    },
  );
  const submitted = await readPolicyResponse(response);
  const final = await waitForStage(
    input.backendUrl,
    submitted,
    new Set(["finalized"]),
    POLICY_FINALITY_TIMEOUT_MS,
  );
  return final.stage;
}
