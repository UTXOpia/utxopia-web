/**
 * Persisting applications, server-side.
 *
 * Until this existed an application was an email and nothing else: the webhook
 * and log sinks are unset, and Vercel's filesystem does not survive a request,
 * so the only copy of what someone wrote lived in an inbox. That was tolerable
 * while a person read every one before deciding. Auto-issue removed the person,
 * and with them the only thing that was reading.
 *
 * It goes in the invite DB — same file, same volume, same operator key — so
 * "who applied" and "who is a member" can be answered from one place.
 *
 * Best-effort by design. The application has already been delivered to intake
 * by the time this runs, so a backend that is down costs us a row, not the
 * submission.
 */

import { getBackendApiKey } from "@/lib/server/backend-auth";
import { verifiedBackendUrl } from "@/lib/server/invite-issue";

export interface ApplicationRecord {
  email: string;
  roles: string[];
  reason: string;
  emailOptIn: boolean;
  feedbackOptIn: boolean;
  network: string;
  /** Whether a code went out on submit — the one field the applicant does not
   *  supply, and the one that says which cohort they are. */
  invited: boolean;
}

/** Whether there is a database to write to at all. The route needs this before
 *  it accepts a submission: with no store and no webhook, an application has
 *  nowhere to go and 503 is the honest answer. */
export function applicationStoreConfigured(): boolean {
  return Boolean(verifiedBackendUrl() && getBackendApiKey());
}

/** Returns true if the row landed. Never throws. */
export async function recordApplication(entry: ApplicationRecord): Promise<boolean> {
  const backendUrl = verifiedBackendUrl();
  const apiKey = getBackendApiKey();
  if (!backendUrl || !apiKey) return false;

  try {
    const response = await fetch(`${backendUrl}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(entry),
      cache: "no-store",
    });
    if (!response.ok) {
      console.warn("[apply] not stored", response.status, await response.text());
      return false;
    }
    return true;
  } catch (caught) {
    console.warn("[apply] not stored", caught);
    return false;
  }
}
