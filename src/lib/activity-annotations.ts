"use client";

const STORAGE_PREFIX = "utxopia:activity-annotations:v1";
const CHANGE_EVENT = "utxopia:activity-annotations";
const MAX_ANNOTATIONS = 500;

export const ACTIVITY_LABEL_MAX_LENGTH = 48;
export const ACTIVITY_NOTE_MAX_LENGTH = 240;

export interface ActivityAnnotation {
  label?: string;
  note?: string;
  updatedAt: number;
}

type ActivityAnnotationLedger = Record<string, ActivityAnnotation>;

function storageKey(networkId: string): string {
  return `${STORAGE_PREFIX}:${networkId}`;
}

function cleanText(value: string | undefined, maxLength: number): string | undefined {
  const cleaned = value?.trim().slice(0, maxLength);
  return cleaned || undefined;
}

function isActivityAnnotation(value: unknown): value is ActivityAnnotation {
  if (!value || typeof value !== "object") return false;
  const annotation = value as Partial<ActivityAnnotation>;
  return (
    (annotation.label === undefined || typeof annotation.label === "string")
    && (annotation.note === undefined || typeof annotation.note === "string")
    && typeof annotation.updatedAt === "number"
    && Number.isFinite(annotation.updatedAt)
  );
}

export function getActivityAnnotations(networkId: string): ActivityAnnotationLedger {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(networkId)) || "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => isActivityAnnotation(value))
        .map(([id, value]) => {
          const annotation = value as ActivityAnnotation;
          return [id, {
            label: cleanText(annotation.label, ACTIVITY_LABEL_MAX_LENGTH),
            note: cleanText(annotation.note, ACTIVITY_NOTE_MAX_LENGTH),
            updatedAt: annotation.updatedAt,
          }];
        }),
    );
  } catch {
    return {};
  }
}

export function saveActivityAnnotation(
  networkId: string,
  activityId: string,
  input: { label?: string; note?: string },
): ActivityAnnotationLedger {
  const current = getActivityAnnotations(networkId);
  const label = cleanText(input.label, ACTIVITY_LABEL_MAX_LENGTH);
  const note = cleanText(input.note, ACTIVITY_NOTE_MAX_LENGTH);

  if (!label && !note) {
    delete current[activityId];
  } else {
    current[activityId] = { label, note, updatedAt: Date.now() };
  }

  const limited = Object.fromEntries(
    Object.entries(current)
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_ANNOTATIONS),
  );

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(storageKey(networkId), JSON.stringify(limited));
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { networkId } }));
    } catch {
      // The annotation remains optional if browser storage is unavailable.
    }
  }
  return limited;
}

export function activityAnnotationsEventName(): string {
  return CHANGE_EVENT;
}
