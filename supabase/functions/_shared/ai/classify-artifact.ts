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
}

export interface ClassifyArtifactResult {
  title: string;
  category: string;
  tags: string[];
}

/** Sentinel title used when nothing else parses out. Always passes
 *  `isBadTitle`, which is the trigger for fallback paths. */
const SENTINEL_TITLE = "Saved draft";

/** System prompt for the classifier. Constant so versioning is
 *  external (`promptVersion`). Edits require bumping the version. */
const SYSTEM_PROMPT = `You classify saved content into a structured note. Return JSON with:
- "title": A concise, descriptive title (max 8 words) that captures the TOPIC of the FULL ARTIFACT CONTENT. NEVER base the title on the original request when that request is a short confirmation (e.g. "yes", "yes please", "save it", "ok", "do it", "sì", "sì grazie", "sí", "vale", "claro"). NEVER use generic titles ("Save Note", "Saved Draft", "Clarification Request"). Instead describe what the CONTENT is about. Good examples: "Best Cities to Visit in Italy", "Megaformer Studios — What They Are", "Email Draft to Boss About Vacation", "Gift Ideas for Sara's Birthday".
- "category": One of: task, work, personal, travel, finance, health, shopping, entertainment, recipes, general, contacts
- "tags": Array of 1-3 relevant tags drawn from the CONTENT topic.

Return ONLY valid JSON, no markdown.`;

function buildUserPrompt(content: string, request: string): string {
  return `ORIGINAL USER REQUEST (context only — do NOT title from this if it looks like a confirmation): "${request.substring(0, 500)}"\n\nFULL ARTIFACT CONTENT (title MUST describe this):\n${content.substring(0, 2000)}`;
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

  if (input.callAI) {
    try {
      const raw = await input.callAI(
        SYSTEM_PROMPT,
        buildUserPrompt(input.artifactContent, input.artifactRequest),
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

  return { title, category, tags };
}
