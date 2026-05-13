// Topical-follow-up detection — Change 3 of the brain-dump-organization
// programme.
//
// Problem this solves
// --------------------
// A user types "Examples for Hard Rock Stadium" with five bullets, and a
// minute later sends "Email address for Hard Rock\ngroisinblit@dolphins.com".
// Without cross-message awareness, Olive saves the email as a brand-new
// standalone note titled "Email address for Hard Rock:
// groisinblit@dolphins.com" — fragmenting one real-world topic across two
// rows of the user's list.
//
// What this module does
// ---------------------
// On a new CREATE event, scan the user's most recent notes (default: last
// 5 within 30 minutes) and decide whether the new message is a follow-up
// supplying a sub-detail (email / phone / address / link / etc.) for a
// topic the user just captured. If so, surface a structured match that
// the caller can use to ATTACH the new value to the parent note's
// `items[]` array instead of creating a sibling row.
//
// Two principles drive the design:
//
//   1. The detector is conservative. False-positive attaches silently bury
//      data inside the wrong parent — much worse than a missed merge. The
//      score gate is high (≥ 0.7) and requires either a multi-token shared
//      phrase or a capitalized proper-noun anchor; generic words ("the
//      meeting", "lunch", "the project") never match alone.
//
//   2. Detection is pure logic on strings + a single Supabase read. No
//      LLM call. No side effects. The caller is responsible for the
//      actual UPDATE, the user-facing offer/confirm copy, and the undo
//      bookkeeping. This keeps the module testable in isolation and
//      makes the integration easy to reason about.

// `any` for the supabase client mirrors the convention used by the rest
// of the _shared utilities (orchestrator.ts, inbound-cluster.ts) — the
// @supabase/supabase-js generic varies between versions and we only
// touch the documented surface at runtime.
// deno-lint-ignore no-explicit-any
type SupabaseClientLike = any;

/**
 * The default look-back window for "recent notes." 30 minutes covers the
 * realistic span of a conversational brain dump — the user types a topic
 * note, pauses to copy a contact / dig up an address, and comes back to
 * supply the detail. Older context is too stale to be a confident match
 * and risks bundling unrelated topics that happen to share a noun.
 */
export const FOLLOWUP_WINDOW_MS = 30 * 60 * 1000;

/**
 * Max number of recent notes scanned per CREATE. The detector returns
 * the FIRST candidate above threshold (recent-first ordering), so a tight
 * scan limit keeps the lookup fast even for power users with dozens of
 * captures per hour.
 */
export const FOLLOWUP_SCAN_LIMIT = 5;

/**
 * Score threshold for a silent attach. Calibrated on the Hard Rock case:
 * "Hard Rock" (topic) vs "Hard Rock Stadium examples" (recent summary)
 * scores 1.0; "the meeting" vs "Project kickoff meeting" scores 0; "the
 * project" vs "Project foo bar" scores 0. Anything < 0.7 falls through
 * to the normal note-creation path.
 */
export const FOLLOWUP_MATCH_THRESHOLD = 0.7;

/**
 * The labels we recognize as "this is a sub-detail of a parent topic"
 * intros. Each entry is a tuple of (regex pattern alternation, canonical
 * label, locale). The canonical label is what gets stored in the parent
 * note's `items[]` array ("Email: foo@bar.com"), so it stays in English
 * even when the user wrote in Spanish or Italian — keeping cross-locale
 * notes searchable by a single canonical form.
 */
const LABEL_PATTERNS: ReadonlyArray<{ alt: string; canonical: string }> = [
  // Email
  {
    alt:
      "email(?:\\s+address)?|" +
      "correo(?:\\s+(?:electr[óo]nico|e-?mail))?|" +
      "e-?mail|" +
      "indirizzo(?:\\s+e-?mail)?|posta(?:\\s+elettronica)?",
    canonical: "Email",
  },
  // Phone
  {
    alt:
      "phone(?:\\s+number)?|tel(?:ephone)?|cell(?:\\s*phone)?|mobile|" +
      "tel[ée]fono|n[úu]mero(?:\\s+de\\s+tel[ée]fono)?|m[oó]vil|celular|" +
      "telefono|cellulare|numero(?:\\s+di\\s+telefono)?",
    canonical: "Phone",
  },
  // Address
  {
    alt:
      "address|street\\s+address|" +
      "direcci[óo]n|domicilio|" +
      "indirizzo",
    canonical: "Address",
  },
  // Website / link / URL
  {
    alt:
      "website|web\\s+site|url|link|web|" +
      "sitio(?:\\s+web)?|enlace|p[áa]gina(?:\\s+web)?|" +
      "sito(?:\\s+web)?|collegamento",
    canonical: "Link",
  },
  // Contact (generic)
  {
    alt: "contact(?:\\s+info(?:rmation)?)?|contacto|contatto",
    canonical: "Contact",
  },
  // Notes / details / info
  {
    alt:
      "notes?|details?|info(?:rmation)?|update|" +
      "notas?|detalles?|informaci[óo]n|actualizaci[óo]n|" +
      "note|dettagli|informazioni|aggiornamento",
    canonical: "Notes",
  },
];

/**
 * Connector words between label and topic — the "for" in "Email for
 * Hard Rock", the "para" in "Correo para Hard Rock", the "per" in
 * "Email per Hard Rock". Including locale variants here is what makes
 * the detector pull through the same intent across all three Olive
 * locales without per-locale code paths.
 */
const TOPIC_CONNECTOR =
  "(?:for|about|on|regarding|re:?|with|" +
  "para|sobre|de|acerca\\s+de|" +
  "per|su|riguardo|riguardanti)";

// Build one big alternation regex from LABEL_PATTERNS so the detector
// can do a single match-and-classify call. Each label pattern is wrapped
// in a non-capturing group; the leading anchor is `^` and the trailing
// anchor accepts whitespace, a colon, end-of-line, or end-of-string —
// the same terminators the multi-item-detector uses for header phrases.
const LABEL_ALT = LABEL_PATTERNS.map((p) => `(?:${p.alt})`).join("|");
const INTRO_RE = new RegExp(
  `^(${LABEL_ALT})\\s+${TOPIC_CONNECTOR}\\s+(.+?)\\s*$`,
  "i",
);

// Field-value patterns inside the message body. When the user writes
// "Email: foo@bar.com" on a SECOND line, the value is everything after
// the colon. When the value is just the email/phone/url itself (no
// "Field:" prefix), we extract it as a raw value via these patterns.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const URL_RE = /\bhttps?:\/\/\S+/i;
// Conservative phone regex — must have a digit-cluster of length ≥ 7
// somewhere so a stray bare number ("flight 412") doesn't trip it.
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4}/;

/**
 * Maps a raw label match (e.g., "Email address", "correo electrónico")
 * to its canonical English label ("Email") so attached items have a
 * consistent shape across locales.
 */
function canonicalizeLabel(rawLabel: string): string {
  const lower = rawLabel.trim().toLowerCase();
  for (const { alt, canonical } of LABEL_PATTERNS) {
    const re = new RegExp(`^(?:${alt})$`, "i");
    if (re.test(lower)) return canonical;
  }
  // Fallback: capitalize the first word of whatever the user wrote.
  // Defensive — INTRO_RE only ever captures groups built from
  // LABEL_PATTERNS, so this branch is unreachable in practice.
  return rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1).toLowerCase();
}

/**
 * The structured intent extracted from a follow-up message. All three
 * fields are required for a match; when any is null the message is not
 * a follow-up and the caller should proceed with normal note creation.
 */
export interface ExtractedFollowupIntent {
  /** Canonical English label, e.g. "Email", "Phone", "Address". */
  label: string;
  /** The topic phrase the user referenced (e.g. "Hard Rock"). */
  topic: string;
  /** The value being supplied (the email itself, the phone number, etc.). */
  value: string;
}

/**
 * Parse a CREATE message and decide whether it is a "label for topic →
 * value" follow-up.
 *
 * Patterns recognized (en/es/it):
 *   "Email address for Hard Rock\ngroisinblit@dolphins.com"
 *   "Phone number for Sarah\n555-123-4567"
 *   "Address for the rental: 123 Main St"
 *   "Correo para Hard Rock: foo@bar.com"
 *   "Telefono per Sarah: 555 1234"
 *
 * Returns null when the message doesn't fit the pattern OR when the
 * value can't be located (e.g., user wrote only the label/topic intro
 * with no actual value to attach).
 */
export function extractFollowupIntent(
  messageText: string,
): ExtractedFollowupIntent | null {
  if (!messageText || typeof messageText !== "string") return null;
  const trimmed = messageText.trim();
  if (trimmed.length === 0 || trimmed.length > 600) return null;

  const lines = trimmed.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0 || lines.length > 6) return null;

  // The intro is always the first line. It may end with a colon and
  // have the value inline after the colon, OR be a clean "Label for
  // Topic" intro with the value on subsequent lines.
  const firstLine = lines[0];
  // Strip a trailing colon (and any value after it) so INTRO_RE only
  // sees the bare intro; the value-after-colon path is handled below.
  const colonIdx = firstLine.indexOf(":");
  const introCore = colonIdx === -1 ? firstLine : firstLine.slice(0, colonIdx).trim();
  const introValue = colonIdx === -1 ? null : firstLine.slice(colonIdx + 1).trim();

  const m = introCore.match(INTRO_RE);
  if (!m) return null;

  const label = canonicalizeLabel(m[1]);
  const topic = m[2].trim();
  // Guard against the user writing just "email for Sarah" with no
  // value at all — that's a question or a half-typed message, not a
  // follow-up. Without a value there's nothing to attach.
  let value: string | null = null;
  if (introValue && introValue.length > 0) {
    value = introValue;
  } else if (lines.length > 1) {
    // Value lives on subsequent lines — join with a space so multi-line
    // contact blocks (e.g., address + apt) come through as one field.
    value = lines.slice(1).join(" ").trim();
  }
  if (!value || value.length === 0) return null;

  // Last-mile sanity: the value should LOOK like a value, not a full
  // sentence. We allow anything up to 200 chars — long enough for a
  // street address with apartment + city, short enough that we
  // reject paragraphs masquerading as field values.
  if (value.length > 200) return null;

  return { label, topic, value };
}

/**
 * The shape of one recent note as needed by the matcher. We pull only
 * what we need from `clerk_notes` to keep the row footprint small.
 */
export interface RecentNoteRow {
  id: string;
  summary: string;
  items: unknown; // JSONB — typed as unknown so we can defensively normalize
  created_at: string;
}

/**
 * The match returned from findFollowupParent — the caller has everything
 * it needs to perform the attach and build the confirmation message.
 */
export interface FollowupMatch {
  parentNoteId: string;
  parentSummary: string;
  /** The new items[] array to write back (existing items + the new field). */
  nextItems: string[];
  /** Just the new field, e.g. "Email: foo@bar.com" — for the WhatsApp reply. */
  addition: string;
  /** 0..1 — caller may log this for telemetry / threshold tuning. */
  confidence: number;
}

// Score how well a user-supplied topic phrase identifies a recent
// note's summary. The function is intentionally simple — we want
// behavior we can reason about line-by-line, not a black-box
// embedding similarity.
//
// Signals:
//   1. Substring match (the summary CONTAINS the normalized topic)
//      → +0.6. Strongest signal: a user who wrote "Hard Rock"
//      explicitly is pointing at the part of the summary that
//      reads "Hard Rock Stadium examples".
//   2. ≥ 2 shared non-stop-word tokens → +0.2. Anchors multi-word
//      topics even when ordering differs.
//   3. ≥ 1 shared CAPITALIZED token (proper noun) → +0.2. The
//      strongest discriminator for generic-vs-specific match —
//      "Hard Rock" carries proper-noun weight, "the project"
//      doesn't.
//
// Floor: returns 0 if there's no signal at all. There's no
// minimum-score-but-no-signal threshold — every contributing
// signal must come from an actual overlap.
export function topicalMatchScore(topic: string, summary: string): number {
  if (!topic || !summary) return 0;
  const nTopic = normalize(topic);
  const nSummary = normalize(summary);
  if (nTopic.length === 0 || nSummary.length === 0) return 0;

  let score = 0;

  // Signal 1 — substring containment, either direction.
  if (nSummary.includes(nTopic) || nTopic.includes(nSummary)) {
    score += 0.6;
  }

  // Signal 2 — multi-token shared content (≥ 2 shared meaningful tokens).
  const topicTokens = tokenize(nTopic);
  const summaryTokens = new Set(tokenize(nSummary));
  let sharedMeaningful = 0;
  for (const t of topicTokens) {
    if (summaryTokens.has(t)) sharedMeaningful++;
  }
  if (sharedMeaningful >= 2) score += 0.2;

  // Signal 3 — capitalized proper-noun anchor (any cap-word in topic
  // also appears as a cap-word in summary). Runs against ORIGINAL
  // strings, not the lowercased normalized versions — capitalization
  // is exactly the signal we're measuring.
  const topicCaps = capitalizedTokens(topic);
  if (topicCaps.size > 0) {
    const summaryCaps = capitalizedTokens(summary);
    let sharedCaps = 0;
    for (const c of topicCaps) {
      if (summaryCaps.has(c)) sharedCaps++;
    }
    if (sharedCaps >= 1) score += 0.2;
  }

  return Math.min(score, 1.0);
}

// Stop-word list trimmed to the words most likely to cause false
// positives in the topic/summary token overlap — articles and
// generic nouns. Multi-language coverage matches the rest of Olive.
const STOP_WORDS = new Set([
  // English
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "with",
  "thing", "things", "stuff", "note", "notes", "list", "item", "items",
  "meeting", "call", "appointment", "task", "tasks", "project",
  // Spanish
  "el", "la", "los", "las", "un", "una", "unos", "unas", "y", "o",
  "para", "de", "del", "en", "con", "cosa", "cosas", "lista", "tarea",
  // Italian
  "il", "lo", "la", "i", "gli", "le", "un", "uno", "una",
  "per", "di", "in", "con", "cosa", "cose", "elenco", "compito",
]);

function tokenize(s: string): string[] {
  return s
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function capitalizedTokens(s: string): Set<string> {
  const out = new Set<string>();
  const m = s.match(/\b[A-ZÁÉÍÓÚÜÑÀÈÌÒÙ][a-záéíóúüñàèìòù]+\b/g);
  if (!m) return out;
  for (const w of m) {
    // Normalize to lowercase for set comparison — case-insensitive
    // match on the underlying lexeme.
    out.add(w.toLowerCase());
  }
  return out;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Normalize the raw `items` JSONB field into a string[]. Items may be
// missing, null, an array of strings (the canonical shape), or — for
// legacy / migrated rows — an array of objects with a `text` field.
// We coerce everything to strings here so the caller doesn't have to
// branch on the shape when appending.
function readExistingItems(rawItems: unknown): string[] {
  if (!Array.isArray(rawItems)) return [];
  const out: string[] = [];
  for (const it of rawItems) {
    if (typeof it === "string") {
      const trimmed = it.trim();
      if (trimmed.length > 0) out.push(trimmed);
    } else if (it && typeof it === "object" && "text" in (it as Record<string, unknown>)) {
      const tx = (it as { text?: unknown }).text;
      if (typeof tx === "string" && tx.trim().length > 0) out.push(tx.trim());
    }
  }
  return out;
}

/**
 * Find the best parent-note candidate for a follow-up message.
 *
 * Algorithm:
 *   1. Parse the message via extractFollowupIntent. Bail if not a
 *      structured follow-up.
 *   2. Query the user's last N notes within the look-back window.
 *      Couple-shared notes are included via the OR clause when a
 *      couple_id is provided.
 *   3. Score each candidate's summary against the extracted topic.
 *      Return the first candidate whose score crosses the threshold,
 *      with the new items[] array pre-computed for the caller's
 *      UPDATE.
 *
 * Returns null when no follow-up intent was extracted OR no candidate
 * meets the threshold. Both cases mean "fall through to normal note
 * creation."
 */
export async function findFollowupParent(
  supabase: SupabaseClientLike,
  userId: string,
  coupleId: string | null,
  messageText: string,
  options: { windowMs?: number; scanLimit?: number; threshold?: number } = {},
): Promise<FollowupMatch | null> {
  const extracted = extractFollowupIntent(messageText);
  if (!extracted) return null;

  const windowMs = options.windowMs ?? FOLLOWUP_WINDOW_MS;
  const scanLimit = options.scanLimit ?? FOLLOWUP_SCAN_LIMIT;
  const threshold = options.threshold ?? FOLLOWUP_MATCH_THRESHOLD;
  const sinceIso = new Date(Date.now() - windowMs).toISOString();

  // Query recent notes the user has access to. Couple-shared notes via
  // couple_id OR personal notes via author_id — RLS still enforces the
  // policy; this OR is just to widen the candidate pool, not to bypass
  // any access check.
  let query = supabase
    .from("clerk_notes")
    .select("id, summary, items, created_at")
    .gte("created_at", sinceIso)
    .eq("completed", false)
    .order("created_at", { ascending: false })
    .limit(scanLimit);

  if (coupleId) {
    query = query.or(`author_id.eq.${userId},couple_id.eq.${coupleId}`);
  } else {
    query = query.eq("author_id", userId);
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data) || data.length === 0) {
    if (error) {
      console.warn("[topical-followup] recent-notes query failed:", error.message);
    }
    return null;
  }

  let best: { row: RecentNoteRow; score: number } | null = null;
  for (const row of data as RecentNoteRow[]) {
    const score = topicalMatchScore(extracted.topic, row.summary || "");
    if (score >= threshold && (!best || score > best.score)) {
      best = { row, score };
    }
  }
  if (!best) return null;

  const existingItems = readExistingItems(best.row.items);
  const addition = `${extracted.label}: ${extracted.value}`;
  // Defensive: if the user is sending the same email twice, don't
  // double-attach. Case-insensitive substring check on the items
  // array — if any existing entry contains the new value, bail.
  const lowerAddition = extracted.value.toLowerCase();
  const alreadyPresent = existingItems.some((it) =>
    it.toLowerCase().includes(lowerAddition)
  );
  if (alreadyPresent) {
    console.log("[topical-followup] value already in parent items[], skipping attach");
    return null;
  }
  const nextItems = [...existingItems, addition];

  return {
    parentNoteId: best.row.id,
    parentSummary: best.row.summary,
    nextItems,
    addition,
    confidence: best.score,
  };
}

/**
 * Persist the attach: write the new items[] array onto the parent note.
 * Returns true on success, false if the UPDATE failed. The caller
 * should treat false as "fall back to normal note creation."
 *
 * We do NOT update the `summary` or any other field — the parent's
 * identity is preserved exactly; only the sub-details grow.
 */
export async function attachToParent(
  supabase: SupabaseClientLike,
  parentNoteId: string,
  nextItems: string[],
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("clerk_notes")
      .update({ items: nextItems })
      .eq("id", parentNoteId);
    if (error) {
      console.warn("[topical-followup] attachToParent UPDATE failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[topical-followup] attachToParent exception:", err);
    return false;
  }
}

// Multilingual "undo this attach" detector. Matches short replies the
// user is likely to send within the offer TTL to reverse a silent
// attach: "undo", "no", "split", "keep separate", "separate", "save
// separately", plus Spanish / Italian equivalents.
//
// Why a dedicated regex instead of reusing classifyConfirmationReply's
// DENY: a plain "no" should ALSO undo (and DENY catches it), but
// task-shaped intents like "split" / "separate" / "as a new note" are
// outside DENY's vocabulary because they're attach-specific. We layer
// them on top here so the undo handler doesn't have to OR-combine two
// classifiers at the call site.
const UNDO_RE = new RegExp(
  "^(?:" +
    "undo|" +
    "no(?:\\s+thanks|\\s+thank\\s+you)?|nope|nah|" +
    "split|split\\s+(?:it|them)|" +
    "separate(?:\\s+(?:it|them|note|notes))?|" +
    "keep\\s+(?:it\\s+)?separate|" +
    "save\\s+(?:it|them)?\\s*(?:as\\s+)?separately?|" +
    "make\\s+(?:it|them)\\s+separate|" +
    "as\\s+(?:a\\s+)?(?:new|separate)\\s+note|" +
    // Spanish
    "deshacer|deshazlo|" +
    "no\\s+gracias|" +
    "separa(?:r(?:lo|la)?|do|los|las)?|" +
    "por\\s+separado|aparte|" +
    "como\\s+(?:una\\s+)?nota\\s+nueva|" +
    // Italian
    "annulla|annulla(?:lo|la)|" +
    "no\\s+grazie|" +
    "separa(?:to|li|le|lo|rli|rle)?|" +
    "a\\s+parte|" +
    "come\\s+(?:una\\s+)?nota\\s+nuova" +
  ")$",
  "i",
);

/**
 * Decide whether a short reply means "undo the silent attach I just
 * made." Returns true for: "undo", "no", "split", "keep separate",
 * and the Spanish/Italian equivalents. Returns false for everything
 * else — including longer messages that may CONTAIN an undo word but
 * aren't a clean reply (e.g., "split the bill with Sarah").
 *
 * Length-gated at 40 chars so a regular note that happens to start
 * with "no" or "split" never trips the undo path.
 */
export function isUndoReply(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 40) return false;
  const cleaned = trimmed
    .toLowerCase()
    .replace(/[!?¡¿.,;:"'()\[\]{}🌿🫒👍👎✅❌😊😄🙏]/g, " ")
    .replace(/[“”‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return false;
  return UNDO_RE.test(cleaned);
}

/**
 * Revert an attach: restore the parent note's items[] to a prior
 * snapshot. Used by the undo handler in whatsapp-webhook when the user
 * replies "undo" / "no" / "split" within the offer TTL.
 *
 * The caller is responsible for ALSO creating a standalone note from
 * the original follow-up message — this function just removes the
 * attach side-effect.
 */
export async function revertAttach(
  supabase: SupabaseClientLike,
  parentNoteId: string,
  priorItems: string[],
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("clerk_notes")
      .update({ items: priorItems })
      .eq("id", parentNoteId);
    if (error) {
      console.warn("[topical-followup] revertAttach UPDATE failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[topical-followup] revertAttach exception:", err);
    return false;
  }
}
