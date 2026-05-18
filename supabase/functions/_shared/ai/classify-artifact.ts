// classify-artifact.ts — pure AI-classification helper for SAVE_ARTIFACT.
// ============================================================================
// Initiative 1.2 of OLIVE_REFACTOR_PLAN.md. Extracted from the inline
// SAVE_ARTIFACT block in whatsapp-webhook/index.ts so it can be unit-tested
// in isolation.
//
// Concerns:
//   * Ask Gemini Flash-Lite to derive {title, category, tags} from the
//     artifact's content + the user's original request.
//   * NEVER fail the save because the classifier had a bad moment — every
//     error path falls back to deterministic title extraction.
//
// Pure-ish: the AI invocation is injected as `callAI` so this module
// stays trivially mockable. The webhook wires its real `callAI` at the
// dispatch site; tests pass a stub.
//
// What this module does NOT do:
//   * Insert into clerk_notes (that's the handler's job).
//   * Touch user_sessions (that's the handler's job).
//   * Localize anything — title/category/tags stay raw; the handler
//     formats user-facing copy via its own `t()` dependency.

import { isBadTitle, looksLikeConfirmation } from "../pending-offer.ts";

/** Signature the handler-side `callAI` must satisfy. Matches the
 *  webhook's existing function shape so the dispatch site can pass it
 *  through verbatim. */
// deno-lint-ignore no-explicit-any
export type ArtifactClassifierCall = (
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  tier: string,
  // deno-lint-ignore no-explicit-any
  tracker: any,
  promptVersion: string,
) => Promise<string>;

export interface ClassifyArtifactInput {
  /** Olive's full assistant output the user wants to save. */
  artifactContent: string;
  /** The user's ORIGINAL request that produced the artifact. May be a
   *  confirmation phrase ("yes please", "save it") — handled defensively. */
  artifactRequest: string;
  /** The injected AI caller. The webhook passes its `callAI`; tests
   *  pass a stub. If undefined or it throws, we use deterministic
   *  fallback for everything. */
  callAI?: ArtifactClassifierCall;
  // deno-lint-ignore no-explicit-any
  tracker?: any;
  /** Version string for prompt-attribution logging. Defaults to the
   *  current registered prompt version, but kept overridable so an
   *  experiment can A/B different versions. */
  promptVersion: string;
  /** The user's current lists, surfaced to the AI so it can route the
   *  artifact into an existing one (or propose a new one). The caller
   *  should pass the most recently-touched lists; we cap at 30 in the
   *  prompt to stay within the flash-lite budget. Optional — when
   *  omitted (e.g. flag off), the AI returns target_list_name=null and
   *  the handler falls back to its prior list_id=null behavior. */
  existingLists?: Array<{
    name: string;
    recent_item_titles?: string[];
  }>;
}

export interface ClassifyArtifactResult {
  title: string;
  category: string;
  tags: string[];
  /** Target list the classifier recommends. NULL when the AI declined
   *  to nominate one (low confidence, generic content, or feature off). */
  target_list_name: string | null;
  /** True iff target_list_name is a PROPOSAL not present in existingLists. */
  is_new_list: boolean;
  /** Classifier's certainty about target_list_name. The resolver uses
   *  this against a configurable floor before auto-creating a new list. */
  confidence: 'high' | 'medium' | 'low';
}

/** Sentinel title used when nothing else parses out. Always passes
 *  `isBadTitle`, which is the trigger for fallback paths. */
const SENTINEL_TITLE = "Saved draft";

/** Versioned prompt identifier — bump when SYSTEM_PROMPT body changes
 *  so `olive_llm_analytics` can attribute regressions. v2.0 adds the
 *  list-routing fields (target_list_name, is_new_list, confidence). */
export const CLASSIFY_ARTIFACT_PROMPT_VERSION = "classify-artifact-v2.0";

/** System prompt for the classifier. v2.0 adds list-routing instructions
 *  so the same call that picks a title/category also nominates a target
 *  list (existing or new). Edits require bumping the version above. */
export const CLASSIFY_ARTIFACT_SYSTEM_PROMPT = `You classify saved content into a structured note. Return JSON with:
- "title": A concise, descriptive title (max 8 words) that captures the TOPIC of the FULL ARTIFACT CONTENT. NEVER base the title on the original request when that request is a short confirmation (e.g. "yes", "yes please", "save it", "ok", "do it", "sì", "sì grazie", "sí", "vale", "claro"). NEVER use generic titles ("Save Note", "Saved Draft", "Clarification Request"). Instead describe what the CONTENT is about. Good examples: "Best Cities to Visit in Italy", "Megaformer Studios — What They Are", "Email Draft to Boss About Vacation", "Gift Ideas for Sara's Birthday".
- "category": One of: task, work, personal, travel, finance, health, shopping, entertainment, recipes, general, contacts
- "tags": Array of 1-3 relevant tags drawn from the CONTENT topic.
- "target_list_name": The list this should be saved to. RULES (in order):
    1. If EXISTING LISTS are provided and one CLEARLY belongs here, return its EXACT name verbatim. Set is_new_list=false, confidence="high".
    2. If no existing list fits AND the content is specific enough to merit its own list (e.g. a trip, a recurring domain), propose a SHORT title-cased NEW list name like "Mallorca Trip", "Restaurants", "Gift Ideas". Set is_new_list=true, confidence="high".
    3. If the content is one-off / generic / unclear, return null. Set is_new_list=false, confidence="low".
    NEVER invent a name close-but-not-equal to an existing list (e.g. "Travels" when "Travel" exists). If any existing list is ≥70% related, USE its exact name.
- "is_new_list": boolean — true ONLY when target_list_name is a proposal that is NOT in EXISTING LISTS.
- "confidence": "high" | "medium" | "low" — your certainty that target_list_name is the right home.

Return ONLY valid JSON, no markdown.`;

function buildUserPrompt(
  content: string,
  request: string,
  existingLists?: Array<{ name: string; recent_item_titles?: string[] }>,
): string {
  const listsBlock = existingLists && existingLists.length > 0
    ? `\n\nEXISTING LISTS (the user's current lists — prefer one of these over a new name):\n${existingLists
        .slice(0, 30)
        .map((l) => {
          const items = (l.recent_item_titles ?? []).slice(0, 3).filter(Boolean);
          return items.length > 0
            ? `- "${l.name}" — recent items: ${items.map((i) => `"${i}"`).join(', ')}`
            : `- "${l.name}"`;
        })
        .join('\n')}`
    : `\n\nEXISTING LISTS: (none — propose a new list if the content warrants one)`;
  return `ORIGINAL USER REQUEST (context only — do NOT title from this if it looks like a confirmation): "${request.substring(0, 500)}"${listsBlock}\n\nFULL ARTIFACT CONTENT (title MUST describe this):\n${content.substring(0, 2000)}`;
}

/**
 * Deterministic title extraction. Used when:
 *   * The AI call fails entirely (network, timeout, model down).
 *   * The AI returns malformed JSON.
 *   * The AI returns a bad title (generic / confirmation phrase / empty).
 *
 * Strategy:
 *   1. If the user's original request looks substantive (not a
 *      confirmation), use the first 60 chars of it (stripped of common
 *      lead-ins like "can you", "please", "what is").
 *   2. Otherwise, pull the first 6-80 char line from the artifact
 *      content itself, stripped of markdown markers.
 *   3. If neither yields anything, return a safe sentinel — `summary`
 *     is NOT NULL in clerk_notes, so this can never be empty.
 *
 * Pure function — no IO, no AI, fully testable.
 */
export function deriveDeterministicTitle(
  artifactContent: string,
  artifactRequest: string,
): string {
  const requestIsConfirmation = looksLikeConfirmation(artifactRequest);

  if (artifactRequest && !requestIsConfirmation) {
    const requestTitle = artifactRequest
      .replace(/^(can you |please |help me |tell me |what are |what is |search (?:for|what is|what's) )/i, '')
      .substring(0, 60)
      .trim();
    if (requestTitle.length > 5) {
      return requestTitle.charAt(0).toUpperCase() + requestTitle.slice(1);
    }
  }

  const contentLine = artifactContent
    .split('\n')
    .map((l) => l.replace(/[*#>_`]/g, '').trim())
    .find((l) => l.length >= 6 && l.length <= 80);
  if (contentLine) return contentLine;

  return 'Saved from Olive chat';
}

/**
 * Full classifier. Calls the AI; on any failure, falls back to
 * deterministic extraction. The save itself NEVER depends on this
 * succeeding — that's the whole point.
 *
 * Postconditions:
 *   * `title` is non-empty and is NOT a "bad" title per `isBadTitle`.
 *   * `category` is non-empty (defaults to 'task').
 *   * `tags` always includes 'olive-draft' as the last entry so saved
 *     drafts are queryable from the web app regardless of AI output.
 */
export async function classifyArtifact(
  input: ClassifyArtifactInput,
): Promise<ClassifyArtifactResult> {
  let title = SENTINEL_TITLE;
  let category = 'task';
  let tags: string[] = ['olive-draft'];
  let target_list_name: string | null = null;
  let is_new_list = false;
  let confidence: 'high' | 'medium' | 'low' = 'low';

  if (input.callAI) {
    try {
      const raw = await input.callAI(
        CLASSIFY_ARTIFACT_SYSTEM_PROMPT,
        buildUserPrompt(input.artifactContent, input.artifactRequest, input.existingLists),
        0.1,
        'lite',
        input.tracker ?? null,
        input.promptVersion,
      );

      try {
        const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (parsed.title && !isBadTitle(parsed.title)) title = parsed.title;
        if (parsed.category && typeof parsed.category === 'string') category = parsed.category;
        if (Array.isArray(parsed.tags)) {
          tags = [
            ...parsed.tags.filter((t: unknown) => typeof t === 'string'),
            'olive-draft',
          ];
        }
        // v2.0 list-routing fields — all optional; defaults are safe.
        if (typeof parsed.target_list_name === 'string' && parsed.target_list_name.trim()) {
          target_list_name = parsed.target_list_name.trim();
        }
        if (typeof parsed.is_new_list === 'boolean') {
          is_new_list = parsed.is_new_list;
        }
        if (parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low') {
          confidence = parsed.confidence;
        }
      } catch (parseErr) {
        console.warn('[classifyArtifact] JSON parse failed, using fallback:', parseErr);
        const firstLine = input.artifactContent.split('\n')[0]?.replace(/[*#]/g, '').trim();
        if (firstLine && firstLine.length < 80) title = firstLine;
      }
    } catch (aiErr) {
      console.warn('[classifyArtifact] AI call failed, using deterministic fallback:', aiErr);
    }
  }

  // Deterministic safety net — runs whenever the title is still bad
  // after the AI attempt (including when no callAI was injected).
  if (isBadTitle(title)) {
    title = deriveDeterministicTitle(input.artifactContent, input.artifactRequest);
  }

  // Hard floor — `summary` is NOT NULL in clerk_notes. Even after every
  // fallback path this can theoretically be empty if the content is
  // empty + request is empty; cover that.
  if (!title || !title.trim()) title = 'Saved from Olive chat';

  return { title, category, tags, target_list_name, is_new_list, confidence };
}
