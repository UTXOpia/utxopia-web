/**
 * Mint one invite code for an applicant, server-side.
 *
 * The beta admits everyone who asks. Nothing here is worth stealing — devnet,
 * no real money, and the page says so — so the screening a manual reply bought
 * costs more (in days of latency, and in applicants who never come back) than
 * the small cohort it protected. What it does NOT do is move the mint endpoint
 * behind a public origin: this is a server-only module, the admin key never
 * reaches the browser, and `/api/invite/[action]` still refuses `codes`.
 *
 * Fails closed and quietly. Without `UTXOPIA_INVITE_ADMIN_KEY` there is no
 * auto-issue and `/api/apply` falls back to the "a person will read it"
 * receipt, which is the behaviour that shipped before this file existed.
 *
 * `launch/invites/send-invite.ts` is still the manual path — same mint call,
 * same four facts, different copy. Change one, look at the other.
 */

import { getNetworkConfig, type NetworkId } from "@/lib/network-config";
import { getVaultNetworkConfig } from "@/lib/vault-config";
import { getBackendApiKey } from "@/lib/server/backend-auth";
import { renderIntakeEmail } from "@/lib/intake";

export interface Invite {
  code: string;
  link: string;
  /** Rendered for a human — a date beats "in 14 days" in a mail read a week later. */
  expiryLabel: string;
}

/** The four irreversible facts, in the same order as `/redeem` and the
 *  playbook. All of it gets said before the code can be spent, because
 *  afterwards nobody can take any of it back. One short sentence each: this is
 *  the part people skim, and a paragraph is where the warning goes to die. */
const FACTS = [
  "Devnet only. Nothing here is private — we log everything on purpose. That changes before real money is involved.",
  "A bitcoin withdrawal address is permanent once you add it. Skip it for now; you can already withdraw on Solana without us.",
  "Lose your recovery file and your notes are gone for good. Download it as soon as you have one. A passkey is not a backup.",
  "Your code locks to the first wallet that redeems it. That wallet is your membership, and you only get one code.",
];

const NEXT_STEPS = [
  "Deposit something small — 0.1 SOL is plenty.",
  "Download your recovery file, before you have anything to lose.",
  "Withdraw to your own wallet. That does not go through us, which is the whole point.",
];

export function autoInviteEnabled(): boolean {
  return Boolean(process.env.UTXOPIA_INVITE_ADMIN_KEY?.trim() && getBackendApiKey());
}

/**
 * Mints a code and returns it, or null if anything goes wrong. Callers treat
 * null as "no code this time" and send the review receipt instead — an
 * application that was already recorded must not fail because the mint did.
 */
export async function mintInvite(email: string): Promise<Invite | null> {
  const adminKey = process.env.UTXOPIA_INVITE_ADMIN_KEY?.trim();
  if (!adminKey) return null;

  // One network, fixed by config rather than by the applicant's query string:
  // the code is minted against whatever backend this resolves to, so letting a
  // submitted value pick it would let a stranger aim the mint.
  const networkId = (process.env.INVITE_NETWORK || "devnet-regtest") as NetworkId;
  const days = Number(process.env.INVITE_CODE_DAYS || 14);
  const app = (process.env.APP_URL || "https://www.utxopia.com").replace(/\/+$/, "");

  let backendUrl: string;
  try {
    backendUrl = getVaultNetworkConfig(
      networkId,
      getNetworkConfig(networkId),
      "verified",
    ).backend.url.replace(/\/+$/, "");
  } catch (caught) {
    console.error("[apply] no verified vault on", networkId, caught);
    return null;
  }

  // The expiry passed here is the expiry this code has forever: expires_at is
  // written only by the INSERT in mint, and no endpoint changes it later.
  const expiresAt = Math.floor(Date.now() / 1000) + days * 86_400;
  try {
    const minted = await fetch(`${backendUrl}/api/invite/codes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": getBackendApiKey(),
        // Two keys, not one — the invite routes sit inside the authed router.
        "x-invite-admin-key": adminKey,
      },
      body: JSON.stringify({
        count: 1,
        label: process.env.INVITE_LABEL || "auto-apply",
        expires_at: expiresAt,
        email,
      }),
      cache: "no-store",
    });
    if (!minted.ok) {
      console.error("[apply] mint failed", minted.status, await minted.text());
      return null;
    }
    const { codes } = (await minted.json()) as { codes?: string[] };
    const code = codes?.[0];
    if (!code) return null;
    return {
      code,
      link: `${app}/redeem?chain=sol&network=${networkId}&code=${encodeURIComponent(code)}`,
      expiryLabel: new Date(expiresAt * 1000).toUTCString().replace(/ GMT$/, " UTC"),
    };
  } catch (caught) {
    console.error("[apply] mint failed", caught);
    return null;
  }
}

/**
 * The mail that carries the code.
 *
 * Unlike the review receipt this one does echo something — the code — but only
 * a value we generated, never anything the applicant typed, so the endpoint
 * still cannot be used to deliver arbitrary content to an arbitrary inbox over
 * our domain.
 */
export function inviteEmail(invite: Invite): { subject: string; html: string; text: string } {
  const facts = FACTS.map((fact, index) => `${index + 1}. ${fact}`);
  const steps = NEXT_STEPS.map((step, index) => `${index + 1}. ${step}`);
  const feedback = `${new URL(invite.link).origin}/feedback`;
  const intro = ["You're in the UTXOpia beta. Your code is below.", "First, four things you cannot undo:"];
  // Expiry is a re-confirmation checkpoint, not a rejection. Say so, or a
  // lapsed code reads as being quietly dropped.
  const expires = `${invite.expiryLabel}. If it lapses, reply and we will send a new one.`;
  const ask = `Then tell us what broke — reply to this mail, or use ${feedback}. That is the whole reason you are here.`;

  return {
    subject: "Your UTXOpia beta invite",
    text: [
      ...intro,
      ...facts,
      `Redeem here: ${invite.link}`,
      `Code: ${invite.code}`,
      `Expires: ${expires}`,
      "After you redeem, do these three:",
      ...steps,
      ask,
      "UTXOpia",
    ].join("\n\n"),
    html: renderIntakeEmail({
      title: "You're in",
      intro: [...intro, ...facts],
      cta: { label: "Redeem your invite", url: invite.link },
      rows: [
        { label: "Your code", value: invite.code, mono: true },
        { label: "Expires", value: expires },
        { label: "After you redeem", value: steps.join("\n"), block: true },
      ],
      meta: [ask],
    }),
  };
}
