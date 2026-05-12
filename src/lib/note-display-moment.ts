// note-display-moment.ts
// ─────────────────────────────────────────────────────────────────────
// Picks the right moment in time to *display* for a note that has a
// due_date and/or a reminder_time.
//
// The bug being fixed
// ───────────────────
// A note created via "remind me Friday" gets `due_date` set to
// `2026-05-15 00:00:00+00` — midnight UTC, because that's how a
// date-only value gets stored in a `timestamptz` column. When the
// frontend does `new Date(due_date).toLocaleString()` in any
// negative-offset timezone (NY: UTC-4, LA: UTC-7, etc.) the result is
// the PREVIOUS day. Friday becomes Thursday. This is the same off-by-
// one class of bug fixed previously in the server-side
// `_shared/bulk-resolver.ts` and `_shared/pattern-detector.ts`.
//
// Compounding the issue: when the user later says "Friday at 12pm"
// (via Ask Olive), the handler sets `reminder_time` to the timed
// value (`2026-05-15 16:00:00+00` for NY noon) but leaves `due_date`
// at the original UTC-midnight value. The note now has TWO truths:
//   - reminder_time: precise moment, correct
//   - due_date: date-only, off-by-one in the user's timezone
//
// Surfaces that read `due_date` alone (ContextRail, the calendar
// grid, etc.) render the stale, wrong-in-timezone value.
//
// The fix
// ───────
// One helper, applied at every display site: prefer reminder_time
// when present. Treat due_date as date-only when its time-of-day is
// midnight UTC, and parse it as the literal date the user meant
// (anchored at noon in the user's timezone so day-of-week math is
// stable regardless of zone).
//
// This is presentation-layer ONLY. The database schema is unchanged.
// Storage shape stays the same; we just stop letting `new Date()`
// guess wrong on midnight-UTC values.

/** A note with the two date-ish fields we care about. */
export interface NoteWithDates {
  dueDate?: string | null;
  reminder_time?: string | null;
}

/**
 * Returns the user-meaningful moment a note should be displayed at,
 * along with whether it's a real timed moment (precise to the minute)
 * or a date-only "this day" marker.
 *
 * Returns null when the note has neither field — the caller decides
 * whether that means "no date" (hide) or something else.
 *
 * Precedence:
 *   1. `reminder_time` if set — this is the authoritative "when".
 *   2. `due_date` parsed timezone-safely otherwise.
 */
export function getNoteDisplayMoment(
  note: NoteWithDates,
  /**
   * IANA timezone for the user (e.g. "America/New_York"). Used to
   * anchor date-only `due_date` values to the user's calendar day.
   * Falls back to the browser's resolved zone when omitted.
   */
  timeZone?: string,
): { moment: Date; isTimed: boolean } | null {
  if (note.reminder_time) {
    const t = new Date(note.reminder_time);
    if (!Number.isNaN(t.getTime())) {
      return { moment: t, isTimed: true };
    }
  }

  if (note.dueDate) {
    const parsed = parseDueDate(note.dueDate, timeZone);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * Parse a `due_date` value into a Date that renders as the right
 * calendar day in the user's timezone.
 *
 * Three cases the column produces in practice:
 *   - "2026-05-15"                          → date-only (rare; some legacy rows)
 *   - "2026-05-15T00:00:00.000Z"           → ISO with UTC midnight
 *   - "2026-05-15 00:00:00+00"             → Postgres timestamptz, UTC midnight
 *   - "2026-05-15T16:00:00.000Z" / similar  → genuine timed moment
 *
 * For the first three we anchor to noon in the user's timezone (any
 * hour between 1am and 11pm in any zone is fine — noon keeps us
 * comfortably away from DST transitions). For the last one we return
 * the parsed timestamp as-is.
 */
function parseDueDate(
  raw: string,
  timeZone?: string,
): { moment: Date; isTimed: boolean } | null {
  // Pure date string — no time component at all.
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnlyMatch) {
    return {
      moment: anchorAtLocalNoon(
        parseInt(dateOnlyMatch[1], 10),
        parseInt(dateOnlyMatch[2], 10),
        parseInt(dateOnlyMatch[3], 10),
        timeZone,
      ),
      isTimed: false,
    };
  }

  // Full timestamp — check if it's the "date-only signal" pattern
  // (midnight UTC, regardless of separator and fractional seconds).
  const utcMidnightMatch = /^(\d{4})-(\d{2})-(\d{2})[T ]00:00:00(?:\.0+)?(?:Z|\+00(?::00)?)$/.exec(raw);
  if (utcMidnightMatch) {
    return {
      moment: anchorAtLocalNoon(
        parseInt(utcMidnightMatch[1], 10),
        parseInt(utcMidnightMatch[2], 10),
        parseInt(utcMidnightMatch[3], 10),
        timeZone,
      ),
      // Date-only by convention. A user who explicitly meant
      // "midnight UTC" loses, but in practice nobody schedules a
      // task for actual midnight UTC; date-only fallback is the
      // overwhelmingly common case.
      isTimed: false,
    };
  }

  // Any other ISO timestamp — it's a real moment, trust it.
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) return null;
  return { moment: t, isTimed: true };
}

/**
 * Build a Date that represents noon in the given IANA timezone on
 * the given Y-M-D. We compute the UTC instant whose wall clock in
 * `timeZone` is `YYYY-MM-DD 12:00:00`.
 *
 * Why noon: any hour ≥1am and ≤11pm in every timezone keeps the
 * calendar-day intact when subsequent code calls things like
 * `date.toLocaleDateString(undefined, { timeZone })` or
 * `format(date, "EEE, MMM d")` (the latter formats in *system* zone,
 * which is what the components currently do — see ContextRail line 99).
 * Anchoring at noon UTC also works for most users; we prefer noon-in-
 * tz when possible because it survives DST transitions cleanly.
 */
function anchorAtLocalNoon(
  year: number,
  month: number,
  day: number,
  timeZone?: string,
): Date {
  // No timezone specified → noon UTC. The browser's `new Date(...)`
  // / `toLocaleString()` chain in any reasonable zone keeps the
  // calendar day right.
  if (!timeZone) {
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  }

  // With a timezone: find the UTC instant whose wall-clock reading in
  // `timeZone` is YYYY-MM-DD 12:00:00. We do this by guessing UTC noon
  // and correcting with the timezone offset at that instant. One
  // iteration is enough for any non-DST-transition day; for DST days,
  // a second pass nails the right answer.
  const guess = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offset1 = utcOffsetMinutes(guess, timeZone);
  const corrected = new Date(guess.getTime() - offset1 * 60_000);
  // DST guard: if the corrected instant has a different offset (DST
  // boundary), one more correction is needed.
  const offset2 = utcOffsetMinutes(corrected, timeZone);
  if (offset2 !== offset1) {
    return new Date(corrected.getTime() - (offset2 - offset1) * 60_000);
  }
  return corrected;
}

/**
 * Get the timezone's UTC offset *at a specific instant* in minutes,
 * with the convention `local = utc + offset`. NY in EDT returns -240.
 *
 * Implemented via `Intl.DateTimeFormat` because that's the only
 * cross-browser/cross-Node API that's both standardized and aware of
 * historical DST rules.
 */
function utcOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(instant).reduce<Record<string, string>>(
    (acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    },
    {},
  );
  const wallClockMs = Date.UTC(
    parseInt(parts.year, 10),
    parseInt(parts.month, 10) - 1,
    parseInt(parts.day, 10),
    parseInt(parts.hour, 10) === 24 ? 0 : parseInt(parts.hour, 10),
    parseInt(parts.minute, 10),
    parseInt(parts.second, 10),
  );
  return Math.round((wallClockMs - instant.getTime()) / 60_000);
}
