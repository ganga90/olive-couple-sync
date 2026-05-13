// Deterministic multi-item & header detection for process-note.
//
// Runs BEFORE the AI to guarantee splitting on clearly structured input
// (numbered lists, bullet lists, multi-line tasks, comma/and chains) and
// to recognize a leading header line that introduces the list — so the
// header itself is never saved as a separate task.
//
// Pure functions, no IO. Exported for unit testing.

/**
 * How the items should be persisted by process-note:
 *
 *   - "siblings" → N independent notes, one per item. The legacy and
 *     default mode. Used for to-do/checklist/shopping/grocery brain
 *     dumps where each item is an actionable task on its own.
 *
 *   - "subitems" → ONE parent note whose `summary` reflects the header
 *     and whose `items` JSONB array carries the list. Used when the
 *     header is a CONCEPTUAL umbrella ("Examples for X", "Ideas for Y",
 *     "Topics to discuss with Sarah") and the items are short noun
 *     phrases that belong together as sub-details, not as standalone
 *     tasks. This prevents the "five sibling notes for one topic" bug
 *     where a brain dump about a single subject got fragmented across
 *     unrelated rows in the user's list.
 *
 * The classifier is conservative: when in doubt about the user's
 * intent, fall back to "siblings" — that matches the prior behavior
 * exactly and never silently buries a real task inside a JSONB blob.
 */
export type ListMode = "siblings" | "subitems";

export interface MultiItemResult {
  items: string[];
  // The header line, if one was detected. Used by process-note to
  // propagate shared context (date, scope, list routing) to each
  // item's per-item AI prompt. The header is NOT a task.
  header: string | null;
  // How process-note should persist the items. See ListMode docs.
  mode: ListMode;
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

// Words that, when present in a short line, strongly suggest the line
// is a HEADER introducing a list. Used both for the "no colon" header
// path (where the keyword carries the whole signal) and as a sanity
// check for ambiguous colon endings.
//
// This list is intentionally broad: in addition to the classic
// checklist/shopping vocabulary, it covers conceptual brain-dump
// headers ("examples", "ideas", "topics", "options", "considerations",
// "highlights", "takeaways", "priorities", "questions", "points",
// "agenda", "discussion", "brainstorm", "next steps") in en/es/it.
//
// Why bother with the broader set? Without it, a message like
// "Examples for Hard Rock Stadium\nReplay\nSuite support\nMusic\n..."
// failed to match any HEADER_KEYWORDS and fell into the no-header
// newline split — every line became its own note, including the
// "Examples for Hard Rock Stadium" header line. That's the bug the
// expansion is designed to fix.
//
// Important: matching here only marks the line as a *header
// candidate*; classifyListMode() decides whether the items below
// should be saved as siblings or as sub-items of one parent note.
const HEADER_KEYWORDS = new RegExp(
  "\\b(?:" +
    // English — task / checklist family (already supported)
    "check.?list|checklist|to.?do|todo|tasks?|shopping|reminders?|notes?|" +
    "list|groceries|errands|agenda|plan|things|items|prep|" +
    // English — conceptual / brain-dump family (new)
    "examples?|ideas?|topics?|options?|points?|questions?|considerations?|" +
    "highlights?|takeaways?|priorities|workstreams?|sections?|categories|" +
    "brainstorm|discussion|talking\\s+points?|key\\s+(?:points?|areas?|takeaways?)|" +
    "action\\s+items?|next\\s+steps?|outline|breakdown|details?|" +
    "summary|overview|recap|" +
    // Spanish — task / checklist family (already supported)
    "lista|tareas?|recordatorios?|notas?|compras|cosas|cosas\\s+que|" +
    // Spanish — conceptual / brain-dump family (new)
    "ejemplos?|temas?|opciones?|puntos?|preguntas?|consideraciones?|" +
    "destacados?|prioridades|secciones?|categor[íi]as|discusi[óo]n|" +
    "lluvia\\s+de\\s+ideas|elementos\\s+(?:de\\s+acci[óo]n|clave)|" +
    "siguientes?\\s+pasos|esquema|desglose|detalles?|resumen|repaso|" +
    // Italian — task / checklist family (already supported)
    "elenco|cose|promemoria|compiti|spesa|liste|" +
    // Italian — conceptual / brain-dump family (new)
    "esempi|idee|argomenti|opzioni|domande|considerazioni|punti(?:\\s+chiave)?|" +
    "priorit[àa]|sezioni?|categorie|discussione|brainstorming|" +
    "elementi\\s+chiave|prossimi\\s+passi|schema|dettagli|riassunto|panoramica" +
  ")\\b",
  "i",
);

// Subset of header keywords whose presence signals the user intends the
// items to be saved as SUB-DETAILS of one parent note rather than as N
// independent tasks. These are the conceptual / brain-dump intros: a
// message like "Examples for hard rock stadium\nReplay\nSuite support\n..."
// is one topic with five sub-bullets, not five separate tasks.
//
// Headers that match HEADER_KEYWORDS but NOT this regex (checklist,
// shopping list, to-do, things to do, groceries, errands, action items)
// stay in the legacy "siblings" mode — each item becomes its own task.
//
// classifyListMode() additionally requires the items themselves to look
// like noun phrases (not action-verb-led tasks) before flipping to
// subitems mode; this regex is necessary but not sufficient.
const CONCEPTUAL_HEADER_RE = new RegExp(
  "\\b(?:" +
    // English
    "examples?|ideas?|topics?|options?|points?|questions?|considerations?|" +
    "highlights?|takeaways?|priorities|workstreams?|sections?|categories|" +
    "brainstorm|discussion|talking\\s+points?|key\\s+(?:points?|areas?|takeaways?)|" +
    "outline|breakdown|details?|summary|overview|recap|notes?|agenda|" +
    // Spanish
    "ejemplos?|ideas?|temas?|opciones?|puntos?|preguntas?|consideraciones?|" +
    "destacados?|prioridades|secciones?|categor[íi]as|discusi[óo]n|" +
    "lluvia\\s+de\\s+ideas|elementos\\s+clave|esquema|desglose|detalles?|" +
    "resumen|repaso|notas?|" +
    // Italian
    "esempi|idee|argomenti|opzioni|domande|considerazioni|punti(?:\\s+chiave)?|" +
    "priorit[àa]|sezioni?|categorie|discussione|brainstorming|elementi\\s+chiave|" +
    "schema|dettagli|riassunto|panoramica|note" +
  ")\\b",
  "i",
);

// Headers that explicitly request task-list semantics. When matched,
// classifyListMode() FORCES siblings mode regardless of item shape —
// "Shopping list: milk, eggs, bread" must become 3 grocery tasks even
// though those words are noun phrases. This is the conservative side
// of the new mode classifier: a user who literally wrote "checklist"
// or "to-do" wants discrete tasks.
const CHECKLIST_HEADER_RE = new RegExp(
  "\\b(?:" +
    // English
    "check.?list|checklist|to.?do|todo|tasks?|shopping|groceries|errands|" +
    "things\\s+to\\s+(?:do|buy|get|grab|pack|bring|remember)|" +
    "reminders?|action\\s+items?|next\\s+steps?|" +
    // Spanish
    "lista(?:\\s+de\\s+(?:compras|tareas|cosas?))?|tareas?|recordatorios?|" +
    "cosas\\s+que\\s+(?:hacer|comprar|recordar)|compras|" +
    // Italian
    "elenco(?:\\s+(?:della\\s+spesa|delle\\s+cose))?|cose\\s+da\\s+(?:fare|comprare|ricordare)|" +
    "compiti|promemoria|spesa|liste(?:\\s+della\\s+spesa)?" +
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

// Position-anchored keyword test for HEADER_KEYWORDS / CONCEPTUAL_HEADER_RE.
//
// We require a header keyword to appear NEAR the start of the line (in
// the first ~30 chars), not anywhere on it. Otherwise prose like "Here
// is everything I want to talk about during our discussion later this
// evening with the whole team:" would match "discussion" at character
// 51 and be wrongly classified as a header.
//
// 30 chars comfortably fits realistic headers in all three locales —
// "Examples for hard rock stadium" (30), "Pets checklist for tomorrow"
// (27), "Lista de compras" (16), "Cose da fare domani" (19),
// "Discussion topics for the meeting" (33 — the keyword "Discussion"
// itself starts at 0 so still matches), etc.
function headerKeywordNearStart(line: string, re: RegExp): boolean {
  return re.test(line.slice(0, 30));
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

// Hints that an item already carries its own due date / time anchor.
// When ≥1 items look time-anchored, we treat the whole list as
// siblings — the items are scheduled tasks, not sub-bullets of a
// shared concept. Multi-language coverage matches HEADER_TIME_HINTS.
const ITEM_TIME_HINT = new RegExp(
  "\\b(?:tomorrow|today|tonight|tonite|yesterday|" +
    "monday|tuesday|wednesday|thursday|friday|saturday|sunday|" +
    "this\\s+(?:week|weekend|month|morning|afternoon|evening)|" +
    "next\\s+(?:week|weekend|month|year|\\w+day)|" +
    "in\\s+\\d+\\s+(?:min(?:ute)?s?|hours?|days?|weeks?)|" +
    "\\d{1,2}(?::\\d{2})?\\s?(?:am|pm)|" +
    "by\\s+\\w+day|at\\s+\\d{1,2}|" +
    // Spanish
    "ma[nñ]ana|hoy|esta\\s+(?:semana|noche|tarde)|" +
    "lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo|" +
    // Italian
    "domani|oggi|stasera|stamattina|questa\\s+settimana|" +
    "luned[íi]|marted[íi]|mercoled[íi]|gioved[íi]|venerd[íi]|sabato|domenica" +
  ")\\b",
  "i",
);

/**
 * Decide whether a detected list should be persisted as N sibling
 * notes (legacy behavior) or as ONE parent note with the items in
 * its sub-details array.
 *
 * Returns "siblings" — the conservative legacy mode — whenever:
 *   - No header was detected.
 *   - The header matches CHECKLIST_HEADER_RE (user explicitly asked
 *     for a checklist / shopping list / to-do).
 *   - Items contain action verbs (≥30% verb-led → these are tasks).
 *   - Any item carries its own time anchor (scheduled tasks).
 *   - Items are too long on average (> 60 chars → likely tasks/
 *     prose, not bullet points).
 *   - List length is outside the 2–10 brain-dump range.
 *
 * Returns "subitems" only when ALL these are true:
 *   - A header was detected.
 *   - The header matches CONCEPTUAL_HEADER_RE (Examples/Ideas/Topics/
 *     Notes/etc.) and does NOT match CHECKLIST_HEADER_RE.
 *   - 2 ≤ items.length ≤ 10.
 *   - < 30% of items start with an action verb.
 *   - No item carries an independent time anchor.
 *   - Average item length ≤ 60 chars.
 *
 * Exported for unit testing.
 */
export function classifyListMode(
  header: string | null,
  items: string[],
): ListMode {
  if (!header) return "siblings";
  if (items.length < 2 || items.length > 10) return "siblings";

  // A user who explicitly wrote "Shopping list / To-do / Errands /
  // Action items" wants discrete tasks. Force siblings even if the
  // items are noun phrases ("milk", "eggs", "bread").
  if (CHECKLIST_HEADER_RE.test(header)) return "siblings";

  // Header must signal a conceptual brain-dump intent. "Reminder for
  // Tuesday\nmilk\neggs" has a header without a brain-dump keyword,
  // so we default to siblings to preserve legacy semantics.
  if (!CONCEPTUAL_HEADER_RE.test(header)) return "siblings";

  // Item-shape guards. Each is conservative — when any fires, fall
  // back to siblings so we never silently bury a real task inside a
  // JSONB blob.
  const verbCount = items.filter(startsWithActionVerb).length;
  if (verbCount / items.length >= 0.3) return "siblings";

  const timeAnchoredCount = items.filter((i) => ITEM_TIME_HINT.test(i)).length;
  if (timeAnchoredCount > 0) return "siblings";

  const avgLen = items.reduce((s, i) => s + i.length, 0) / items.length;
  if (avgLen > 60) return "siblings";

  return "subitems";
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
    // Long line ending in ":" — only accept if it OPENS with a header
    // keyword (anchored to the start of the line, not anywhere in it,
    // so prose with a stray keyword mid-sentence is not misread as a
    // labeled context block).
    if (headerKeywordNearStart(t, HEADER_KEYWORDS) || HEADER_TIME_HINTS.test(t)) return t;
    return null;
  }

  // No colon — require a header keyword AT THE START of the line. The
  // start-anchor is what distinguishes "Examples for the project\n…"
  // (header) from "I'm going to give some examples\n…" (prose).
  if (headerKeywordNearStart(t, HEADER_KEYWORDS) && t.length <= 80) {
    return t;
  }

  return null;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Build a MultiItemResult, computing `mode` from the header + items.
 * Centralizing this guarantees every return path in detectMultiItem
 * runs the classifier — no risk of one branch shipping a result
 * without the field set.
 */
function buildResult(items: string[], header: string | null): MultiItemResult {
  return {
    items,
    header,
    mode: classifyListMode(header, items),
  };
}

/**
 * Detects clearly structured multi-item input (numbered lists, bullet
 * points, newline-separated tasks, comma/and chains) and optionally
 * recognizes a leading header line.
 *
 * Returns null when the input doesn't look like a multi-item brain dump,
 * in which case process-note should fall through to the standard AI
 * path. Returns { items, header, mode } when a structured list is found.
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
        return buildResult(rest, headerText);
      }
      return buildResult(items, null);
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
        return buildResult(rest, headerText);
      }
      return buildResult(items, null);
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
        return buildResult(rest, headerText);
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
      return buildResult(lines, null);
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
        return buildResult(segments, null);
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
        return buildResult(andSegments, null);
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
