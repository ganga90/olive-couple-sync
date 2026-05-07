// Deterministic multi-item & header detection for process-note.
//
// Runs BEFORE the AI to guarantee splitting on clearly structured input
// (numbered lists, bullet lists, multi-line tasks, comma/and chains) and
// to recognize a leading header line that introduces the list — so the
// header itself is never saved as a separate task.
//
// Pure functions, no IO. Exported for unit testing.

export interface MultiItemResult {
  items: string[];
  // The header line, if one was detected. Used by process-note to
  // propagate shared context (date, scope, list routing) to each
  // item's per-item AI prompt. The header is NOT a task.
  header: string | null;
}

// Action verbs commonly seen at the start of a TASK line. Used both to
// classify items as actionable AND to *reject* a candidate header that
// itself starts with one (in which case it's a task, not a header).
//
// IMPORTANT — terminator: the trailing lookahead is `(?=\s|$|[,.!?])`,
// NOT plain `\b`. `\b` fires on a hyphen (word→non-word), which would
// incorrectly classify "Check-list for the pets tomorrow:" as starting
// with the action verb "check" — and we'd reject the header. Requiring
// whitespace or terminal punctuation after the verb avoids that trap
// while still matching "Buy milk", "Check the door", "Set up dinner".
//
// Multi-language: en/es/it cover the supported locales.
const ACTION_VERB_HEAD = new RegExp(
  "^(?:" +
    // English
    "buy|get|grab|pick|fix|send|pay|check|schedule|book|cancel|return|order|" +
    "clean|wash|remind|update|find|research|plan|make|cook|prepare|organize|" +
    "sort|arrange|set\\s?up|follow\\s?up|renew|register|sign\\s?up|drop\\s?off|" +
    "pick\\s?up|call|email|text|message|reply|ping|reschedule|confirm|" +
    "watch|read|try|visit|review|finish|complete|start|begin|stop|" +
    // Spanish
    "comprar|llamar|pagar|enviar|reservar|cancelar|recoger|preparar|hacer|" +
    "limpiar|escribir|leer|ver|terminar|empezar|revisar|" +
    // Italian
    "comprare|chiamare|pagare|inviare|prenotare|annullare|preparare|fare|" +
    "pulire|scrivere|leggere|guardare|finire|iniziare|controllare" +
  ")(?=\\s|$|[,.!?:])",
  "i",
);

// Words that, when present in a short line ending with ":", strongly
// suggest the line is a HEADER introducing a list. Multi-language.
const HEADER_KEYWORDS = new RegExp(
  "\\b(?:" +
    // English
    "check.?list|checklist|to.?do|todo|tasks?|shopping|reminders?|notes?|" +
    "list|groceries|errands|agenda|plan|things|items|prep" +
    // Spanish
    "|lista|tareas?|recordatorios?|notas?|compras|cosas|cosas\\s+que" +
    // Italian
    "|elenco|cose|promemoria|compiti|spesa|liste" +
  ")\\b",
  "i",
);

// Time/scope words inside a header that hint at a shared time window for
// items below ("tomorrow before leaving", "this week", "today"). Used
// only as a secondary signal — primary structure is the colon.
const HEADER_TIME_HINTS = new RegExp(
  "\\b(?:tomorrow|today|tonight|this\\s+(?:week|weekend|month)|next\\s+\\w+|" +
    "before|after|by\\s+\\w+day|" +
    "ma[nñ]ana|hoy|esta\\s+(?:semana|noche)|antes|despu[eé]s|" +
    "domani|oggi|stasera|questa\\s+settimana|prima|dopo)\\b",
  "i",
);

// ─── Helpers ─────────────────────────────────────────────────────────

function trimLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function startsWithActionVerb(line: string): boolean {
  return ACTION_VERB_HEAD.test(line.trim());
}

// Item-likeness heuristic: short, no terminal sentence punctuation, OR
// starts with an action verb. We use this to confirm that the lines
// FOLLOWING a candidate header genuinely look like a list.
function looksLikeListItem(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (t.length > 100) return false;
  if (startsWithActionVerb(t)) return true;
  // Short noun phrase, no period at end → looks like a list item
  if (t.length < 60 && !/[.!?]$/.test(t)) return true;
  return false;
}

// Score a candidate header line. Returns null if not a header,
// otherwise the original line text (trimmed).
//
// Strict signals — multiple must combine:
//   1. Ends with ":" — strongest single signal
//   2. Does NOT start with an action verb (a verb-led "Buy these:" is
//      itself the task; we keep it)
//   3. Is reasonably short (< 120 chars) — long sentences that happen
//      to end in ":" are not headers
//   4. The lines below it (≥ 2) look like list items
//
// OR (no colon path):
//   1. Matches HEADER_KEYWORDS (e.g., "Shopping list", "Lista para X")
//   2. Does NOT start with an action verb
//   3. Lines below look like list items
function detectHeader(candidateLine: string, followingLines: string[]): string | null {
  const t = candidateLine.trim();
  if (t.length === 0 || t.length > 120) return null;
  if (startsWithActionVerb(t)) return null;
  if (followingLines.length < 2) return null;

  // At least 2/3 of the following lines must look like list items.
  // Conservative threshold to avoid stripping a normal first sentence
  // of a paragraph.
  const itemLike = followingLines.filter(looksLikeListItem).length;
  const itemRatio = itemLike / followingLines.length;
  if (itemRatio < 0.66) return null;

  const endsWithColon = /:$/.test(t);
  if (endsWithColon) {
    // Strong signal — only reject if first line is itself an obvious
    // single task with a colon (e.g., "Meeting with Dr. Smith at 3:")
    // We treat anything <= 80 chars as plausible header.
    if (t.length <= 80) return t;
    // Long line ending in ":" — only accept if it has header keywords
    // or time hints (suggesting it's a labeled context block).
    if (HEADER_KEYWORDS.test(t) || HEADER_TIME_HINTS.test(t)) return t;
    return null;
  }

  // No colon — require explicit header keyword
  if (HEADER_KEYWORDS.test(t) && t.length <= 80) {
    return t;
  }

  return null;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Detects clearly structured multi-item input (numbered lists, bullet
 * points, newline-separated tasks, comma/and chains) and optionally
 * recognizes a leading header line.
 *
 * Returns null when the input doesn't look like a multi-item brain dump,
 * in which case process-note should fall through to the standard AI
 * path. Returns { items, header } when a structured list is found.
 *
 * Behavior matches the legacy detectMultiItemInput for non-header input
 * — this is a strict superset.
 */
export function detectMultiItem(text: string): MultiItemResult | null {
  if (!text || text.length < 10) return null;
  const trimmed = text.trim();

  // ─── Pattern 1: Numbered lists ────────────────────────────────────
  // "1. Buy milk 2. Call doctor" or "1) Buy milk 2) Call doctor"
  const numberedPattern = /(?:^|\n)\s*\d+[\.\)]\s+/;
  if (numberedPattern.test(trimmed)) {
    const items = trimmed
      .split(/(?:^|\n)\s*\d+[\.\)]\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (items.length >= 2) {
      // Numbered lists may have a header BEFORE the first number.
      // The split's first element is whatever preceded "1." — if it's
      // non-empty AND looks like a header, treat it as such.
      const head = items[0];
      const rest = items.slice(1);
      const headerText = detectHeader(head, rest);
      if (headerText !== null) {
        return { items: rest, header: headerText };
      }
      return { items, header: null };
    }
  }

  // ─── Pattern 2: Bullet points ─────────────────────────────────────
  // "- buy milk\n- call doctor" or "• buy milk\n• call doctor"
  const bulletPattern = /(?:^|\n)\s*[-•*]\s+/;
  if (bulletPattern.test(trimmed)) {
    const items = trimmed
      .split(/(?:^|\n)\s*[-•*]\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (items.length >= 2) {
      // Same header-before-first-bullet handling as numbered lists.
      const head = items[0];
      const rest = items.slice(1);
      const headerText = detectHeader(head, rest);
      if (headerText !== null) {
        return { items: rest, header: headerText };
      }
      return { items, header: null };
    }
  }

  // ─── Pattern 3: Newline-separated lines (the bug case) ───────────
  // The historical Pattern 3 split EVERY line, including a leading
  // header. This is where "Check-list for the pets tomorrow before
  // leaving:\nMilka food\n..." became 6 tasks instead of 5 + header.
  const lines = trimLines(trimmed);
  if (lines.length >= 2 && lines.every((l) => l.length < 120)) {
    const avgLen = lines.reduce((sum, l) => sum + l.length, 0) / lines.length;
    if (avgLen < 80) {
      // Try to detect a leading header. If the first line is a header
      // AND the remaining lines look like list items, strip it.
      const head = lines[0];
      const rest = lines.slice(1);
      const headerText = detectHeader(head, rest);
      if (headerText !== null && rest.length >= 2) {
        return { items: rest, header: headerText };
      }
      // No header detected. Two paths:
      //   - First line looks like a list item (short, ≤ 60 chars) →
      //     preserve legacy behavior: every line is a task.
      //   - First line is paragraph-shaped (> 60 chars without being a
      //     header) → defer to the AI. Splitting a paragraph into "1
      //     paragraph task + N short tasks" produces a malformed
      //     phantom note exactly like the original bug, just with no
      //     colon to anchor the header detector.
      const firstLineIsParagraphy =
        head.length > 60 && !looksLikeListItem(head);
      if (firstLineIsParagraphy) {
        return null;
      }
      return { items: lines, header: null };
    }
  }

  // ─── Pattern 4: Comma-separated tasks ─────────────────────────────
  // "buy milk, call doctor, book restaurant"
  if (trimmed.includes(",") && !trimmed.includes("\n")) {
    const segments = trimmed
      .split(/,\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 2);
    if (segments.length >= 3 && segments.every((s) => s.length < 80)) {
      const verbCount = segments.filter((s) => startsWithActionVerb(s)).length;
      if (verbCount >= segments.length * 0.5 || segments.every((s) => s.length < 30)) {
        return { items: segments, header: null };
      }
    }
  }

  // ─── Pattern 5: "and"-joined distinct actions ─────────────────────
  // "buy milk and call doctor and book restaurant"
  if (/\band\b/i.test(trimmed) && !trimmed.includes(",") && !trimmed.includes("\n")) {
    const andSegments = trimmed
      .split(/\s+and\s+/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 2);
    if (andSegments.length >= 2 && andSegments.length <= 5) {
      const verbCount = andSegments.filter((s) => startsWithActionVerb(s)).length;
      if (verbCount >= andSegments.length * 0.7) {
        return { items: andSegments, header: null };
      }
    }
  }

  return null;
}

/**
 * Legacy-compatible wrapper. Returns just the items array (or null),
 * matching the original `detectMultiItemInput` signature so callers
 * that don't need header context can keep the old shape.
 */
export function detectMultiItemInput(text: string): string[] | null {
  const result = detectMultiItem(text);
  if (!result) return null;
  return result.items;
}
