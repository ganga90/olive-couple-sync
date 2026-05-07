/**
 * Brand-voice lint for Phase D-1 prompt-addendum drafts.
 * =========================================================================
 * Pro-generated addendums become production prompts once an admin
 * approves them. A voice-violating addendum that slips through can
 * propagate forbidden phrasing into every Gemini response in the rollout
 * bucket — the cumulative effect is much larger than for a single user
 * interaction. So we lint the draft text BEFORE it lands as a proposal.
 *
 * # What we lint for
 *
 * Per OLIVE_BRAND_BIBLE.md and the olive-brand skill:
 *
 * 1. **Forbidden buzzwords** that violate the "warm but not saccharine,
 *    confident not arrogant, direct not cute" voice. Conservative list —
 *    only phrases with no legitimate use in instruction prose.
 *      "supercharge", "10x", "AI-powered", "leveraging machine learning",
 *      "leading provider", "next-gen"
 *    Pointedly NOT included: "leverage" (valid: "leverage prior context"),
 *    "platform" (valid in some technical contexts), "solution" (too
 *    common). False-positives on those would be more harmful than the
 *    rare violation they catch.
 *
 * 2. **Excessive exclamation marks**. Olive's voice ("Got it" beats
 *    "Got it!" every time, per skill §2) means an addendum that pushes
 *    Olive toward exclamation-heavy responses degrades the voice. >3
 *    exclamation marks in a 5-10 line addendum is the threshold.
 *
 * 3. **Non-🌿 emoji** in prompt text. The 🌿 leaf is the only emoji
 *    Olive should use. Any other emoji in an addendum is either an
 *    instruction to use it (bad) or accidental Pro hallucination (also
 *    bad — addendums are instruction prose, not decoration).
 *
 * # What we DON'T lint for
 *
 * - Semantic violations of the "say less" rule. Detecting verbosity
 *   needs a model in the loop and false-positives are too costly.
 *   Reviewer judgment handles this in the admin approval step.
 * - Tone of individual instructions ("be enthusiastic!" → bad, but
 *   regex-detecting that risks too many false-positives on legitimate
 *   instructions like "address users with warmth").
 *
 * # Contract
 *
 * - Pure: no I/O, no env reads, no side effects. Deterministic.
 * - Returns ALL violations found (not first-match) so the admin
 *   reviewer / log line gets the full picture. Hard-rejection in
 *   olive-prompt-evolve treats any violation as a skip.
 */

export interface BrandVoiceLintResult {
  ok: boolean;
  violations: string[];
}

// Word-boundary regexes so "tense" doesn't match "intense", etc.
// All case-insensitive.
const FORBIDDEN_PHRASE_PATTERNS: { pattern: RegExp; label: string }[] = [
  // 'supercharging' drops the trailing 'e', so the alternation has to
  // span the 'e'-or-not edge: 'supercharge', 'supercharged', 'supercharges',
  // 'supercharging' all root at 'supercharg'.
  { pattern: /\bsupercharg(?:e|ed|es|ing)\b/i, label: 'forbidden phrase: "supercharge"' },
  { pattern: /\b10x\b/i, label: 'forbidden phrase: "10x"' },
  { pattern: /\bAI[-\s]?powered\b/i, label: 'forbidden phrase: "AI-powered"' },
  { pattern: /\bleveraging\s+machine\s+learning\b/i, label: 'forbidden phrase: "leveraging machine learning"' },
  { pattern: /\bleading\s+provider\b/i, label: 'forbidden phrase: "leading provider"' },
  { pattern: /\bnext[-\s]?gen\b/i, label: 'forbidden phrase: "next-gen"' },
];

/** Maximum number of '!' allowed in a 5–10 line addendum. */
const MAX_EXCLAMATIONS = 3;

/**
 * Olive's signature leaf — the ONE emoji Olive uses. U+1F33F.
 * Every other emoji in addendum text is a violation.
 */
const OLIVE_LEAF = "\u{1F33F}";

/**
 * Match common emoji ranges. Not exhaustive (the full Unicode Emoji
 * spec spans dozens of blocks) but covers the categories Pro is most
 * likely to emit: Misc Symbols & Pictographs (1F300–1F5FF),
 * Emoticons (1F600–1F64F), Transport (1F680–1F6FF), Misc Symbols
 * (2600–26FF), Dingbats (2700–27BF), Supplemental Symbols (1F900–1F9FF).
 */
const EMOJI_REGEX = /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{27BF}]/gu;

export function lintBrandVoice(text: string): BrandVoiceLintResult {
  const violations: string[] = [];
  const safeText = typeof text === "string" ? text : "";

  // 1. Forbidden phrase patterns
  for (const { pattern, label } of FORBIDDEN_PHRASE_PATTERNS) {
    if (pattern.test(safeText)) {
      violations.push(label);
    }
  }

  // 2. Exclamation-mark count
  const exclamationMatches = safeText.match(/!/g);
  const exclamationCount = exclamationMatches ? exclamationMatches.length : 0;
  if (exclamationCount > MAX_EXCLAMATIONS) {
    violations.push(
      `excessive exclamation marks (${exclamationCount}, limit ${MAX_EXCLAMATIONS})`,
    );
  }

  // 3. Non-🌿 emoji
  const allEmojis = safeText.match(EMOJI_REGEX) || [];
  const nonOliveEmojis = allEmojis.filter((e) => e !== OLIVE_LEAF);
  if (nonOliveEmojis.length > 0) {
    // De-dupe so the violation message is concise even if the addendum
    // has e.g. five 🎉s.
    const distinct = Array.from(new Set(nonOliveEmojis)).slice(0, 5);
    violations.push(
      `non-🌿 emoji detected (${nonOliveEmojis.length} occurrences: ${distinct.join(" ")})`,
    );
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}
