/** Reject the legacy shared fallback even on grants issued before this check. */
export function isVerifiedShopperId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value !== "unknown" &&
    value === value.trim()
  );
}
