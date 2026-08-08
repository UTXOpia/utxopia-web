/**
 * How an applicant describes themselves. Multi-select: most of the people this
 * cohort wants are two or three of these at once, and forcing one answer throws
 * that away — the engineer who is also a bitcoiner is exactly the profile.
 *
 * Shared by the form and the route so the stored value is one of a known set
 * rather than whatever was posted. Segmentation is only worth collecting if the
 * buckets survive contact with a text field.
 *
 * On the list itself: "Security researcher" is broken out from the generic
 * "Researcher" because it names the person this phase is actually recruiting —
 * someone who will try to break the exit path and tell you how. "Trader" and
 * "DeFi user" are the two who feel the cost of *public* balances daily, which
 * is the problem being sold. "Investor" is deliberately absent: this cohort is
 * for people who will run the thing, and offering the box invites a different
 * conversation into an intake meant for testers. Add it back in one line if
 * that turns out to be wrong.
 */
export const APPLY_ROLES = [
  "Engineer",
  "Security researcher",
  "Founder",
  "Trader",
  "DeFi user",
  "Bitcoiner",
  "Privacy advocate",
  "Other",
] as const;

export type ApplyRole = (typeof APPLY_ROLES)[number];

function isApplyRole(value: unknown): value is ApplyRole {
  return typeof value === "string" && (APPLY_ROLES as readonly string[]).includes(value);
}

/**
 * Keep only known roles, deduplicated and in the order declared above, so the
 * stored value reads the same however the client happened to send it.
 */
export function cleanApplyRoles(value: unknown): ApplyRole[] {
  if (!Array.isArray(value)) return [];
  const picked = new Set(value.filter(isApplyRole));
  return APPLY_ROLES.filter((role) => picked.has(role));
}
