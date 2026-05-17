// PII redaction helpers for edge function logs.
//
// Why this file exists
//   Edge function stdout streams into Supabase's runtime logs, which the
//   whole engineering team can read. Raw phone numbers, email addresses,
//   and display names should not be in that stream — they're not needed
//   to debug most failures, and they create a compliance footprint
//   (GDPR-style minimisation, EU users, partner-relay messages, etc.).
//
//   The 10X audit (OLIVE_10X_PLAN.md) found four high-confidence cases of
//   raw PII in `console.log`. This module is the shared remedy.
//
// Design rules
//   - Always preserve enough signal that an engineer can correlate logs:
//     last-4 of phone, prefix of email local-part, first-letter of name.
//   - Never throw — these are called from log paths and must not introduce
//     a new failure mode. Null/undefined in → "(none)" out.
//   - Pure functions. No I/O.
//   - Resist scope creep: keep the API tiny so callers don't have to
//     think. If you need more nuance, add a new named helper rather than
//     adding parameters to an existing one.

/**
 * Redact a phone number to its last 4 digits.
 *   maskPhone("+1 305-555-9123")  -> "+xxx*9123"
 *   maskPhone("+34 652 322 025")  -> "+xxx*2025"
 *   maskPhone(undefined)          -> "(none)"
 *
 * Only the digits are inspected; any country code or formatting is
 * collapsed. If the input has fewer than 4 digits, the whole thing is
 * masked to avoid producing accidental near-clear values.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "(none)";
  const digits = phone.replace(/\D+/g, "");
  if (digits.length < 4) return "(masked)";
  return `+xxx*${digits.slice(-4)}`;
}

/**
 * Redact an email to a recognizable but non-clear form.
 *   maskEmail("ganga90@gmail.com")           -> "g****@gmail.com"
 *   maskEmail("very.long.user@example.org")  -> "v************@example.org"
 *   maskEmail("a@b.co")                      -> "*@b.co"
 *   maskEmail(undefined)                     -> "(none)"
 *
 * Keeps the domain intact (it's almost never PII on its own) and the
 * local-part's first character. The domain is useful for distinguishing
 * gmail vs work accounts; the first char helps correlate per-user logs.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "(none)";
  const at = email.indexOf("@");
  if (at <= 0) return "(masked)";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length === 1) return `*${domain}`;
  return `${local[0]}${"*".repeat(local.length - 1)}${domain}`;
}

/**
 * Redact a display name to its first character.
 *   maskName("Giuseppe Venturi") -> "G********"
 *   maskName("Anna")             -> "A***"
 *   maskName("")                 -> "(none)"
 *   maskName(undefined)          -> "(none)"
 *
 * Just enough to disambiguate "user A" vs "user B" in a log stream
 * without identifying who the person is.
 */
export function maskName(name: string | null | undefined): string {
  if (!name) return "(none)";
  const trimmed = name.trim();
  if (!trimmed) return "(none)";
  const first = trimmed[0];
  return `${first}${"*".repeat(Math.max(1, trimmed.length - 1))}`;
}
