/**
 * The browser-facing shape of a policy request.
 *
 * One definition on purpose: this is an allowlist, and an allowlist that exists
 * in two files drifts until one of them leaks. The backend status carries the
 * actor, the member, both signatures and the raw workflow error — none of which
 * belongs in a page.
 */

export interface PublicStageMark {
  stage: string;
  atMs: number;
}

/** Stage marks in milliseconds. Timing of the coordinator's own steps is what
 *  the demo measures; it carries no identity and names no endpoint. */
export function publicTimeline(value: unknown): PublicStageMark[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((mark) => {
    if (!mark || typeof mark !== "object") return [];
    const { stage, atMs } = mark as { stage?: unknown; atMs?: unknown };
    return typeof stage === "string" && typeof atMs === "number"
      ? [{ stage, atMs }]
      : [];
  });
}

export function publicStatus(body: Record<string, unknown>) {
  return {
    requestId: body.requestId,
    stage: body.stage,
    timeline: publicTimeline(body.timeline),
    ...(typeof body.approvalAccount === "string"
      ? { approvalAccount: body.approvalAccount }
      : {}),
    ...(typeof body.error === "string" ? { error: body.error } : {}),
  };
}
