/**
 * Shared pantry expiry classification.
 *
 * The day calculation intentionally matches the existing UI and tool
 * behavior: whole elapsed days are rounded down from the supplied instant.
 * A date is "soon" through three days, while a negative day count is
 * explicitly expired. Keeping this calculation here prevents the profile,
 * meal-planning context, and pantry view from drifting apart.
 */
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export type ExpiryStatus =
  | "none"
  | "invalid"
  | "expired"
  | "today"
  | "soon"
  | "ok";

export type ExpiryClassification =
  | { status: "none" }
  | { status: "invalid" }
  | { status: "expired"; daysUntil: number }
  | { status: "today"; daysUntil: number }
  | { status: "soon"; daysUntil: number }
  | { status: "ok"; daysUntil: number };

export function classifyExpiry(
  expiresAt: string | undefined,
  now: number = Date.now(),
): ExpiryClassification {
  if (!expiresAt) return { status: "none" };

  const expiresAtMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresAtMs)) return { status: "invalid" };

  const daysUntil = Math.floor((expiresAtMs - now) / MS_PER_DAY);
  if (daysUntil < 0) return { status: "expired", daysUntil };
  if (daysUntil === 0) return { status: "today", daysUntil };
  if (daysUntil <= 3) return { status: "soon", daysUntil };
  return { status: "ok", daysUntil };
}
