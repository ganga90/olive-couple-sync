// handlers/web-search.ts — WEB_SEARCH handler.
// ============================================================================
// Initiative 1.5 of OLIVE_REFACTOR_PLAN.md. Sibling to contextual-ask.ts.
// Extracts the Perplexity-powered external search pipeline (formerly
// inline at `index.ts:6329–6569`).
//
// Responsibilities (in order):
//   1. Context-aware query rewriter — produces a SEARCH_QUERY (entity +
//      location + topic, optimized for Perplexity) and a USER_QUESTION
//      (pronouns resolved, fully self-contained). Uses recent
//      conversation history as anchor.
//   2. Fetch related saved items (clerk_notes) to inject as
//      disambiguation context into the Perplexity call.
//   3. Call Perplexity directly — `sonar` model, temperature 0.1.
//   4. Format the result via Gemini (lite tier) blending personal
//      memories from `user_memories` for warmth.
//   5. Return a Reply with after_reply callbacks for:
//      (a) saveReferencedEntity (conversation history append; no task)
//      (b) session.context_data update with last_assistant_* slots and
//          a structured `pending_offer` (type=save_artifact) when the
//          formatted response contains a "save this" tail. The
//          artifact_content captures `formattedResponse.substring(0, 4000)`
//          — frozen at offer time so the next "yes" / "sí" survives
//          intervening CHAT turns and resolves to this artifact.
//   6. Error fallback paths matching the monolith verbatim:
//      - Missing OLIVE_PERPLEXITY env → `web_search_unavailable`
//      - Perplexity API error → `web_search_unavailable_hint`
//      - Empty Perplexity result → "couldn't find relevant results"
//      - Formatter failure → raw Perplexity result + first citation
//      - Anything thrown → `web_search_error`

import {
  buildWaWebSearchFormatPrompt,
  WA_REWRITER_PROMPT_VERSION,
  WA_WEB_SEARCH_FORMAT_PROMPT_VERSION,
} from "../../_shared/prompts/whatsapp-prompts.ts";
import { langName } from "../../_shared/whatsapp-localization.ts";
import type { PendingOffer } from "../../_shared/pending-offer.ts";
import type { LLMTracker } from "../../_shared/llm-tracker.ts";
import type {
  ConversationContext,
  Handler,
  HandlerContext,
  Reply,
} from "../../_shared/types.ts";
import {
  responseOffersSave,
  type SaveReferencedEntityFn,
} from "./contextual-ask.ts";

// ─── Type definitions ──────────────────────────────────────────────────

/** Signature of the webhook's `callAI` helper (same shape as CHAT/CTX_ASK). */
export type WebSearchCallAI = (
  systemPrompt: string,
  userMessage: string,
  temperature: number,
  tier: string,
  tracker?: LLMTracker | null,
  promptVersion?: string,
  mediaUrls?: string[],
  userId?: string,
) => Promise<string>;

/** Override the `fetch` used to call Perplexity. Defaults to global
 *  `fetch`. Tests pass a stub. */
export type PerplexityFetchFn = (
  url: string,
  init: RequestInit,
) => Promise<{
  ok: boolean;
  status?: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

export interface WebSearchDeps {
  callAI: WebSearchCallAI;
  t: (key: string, lang: string, vars?: Record<string, string>) => string;
  saveReferencedEntity: SaveReferencedEntityFn;
  /** Optional fetch override for tests. Defaults to the global `fetch`. */
  perplexityFetch?: PerplexityFetchFn;
}

// ─── Internal: query rewriter ──────────────────────────────────────────
//
// Lifted verbatim from `index.ts:6346–6406`. Reads up to 12 recent
// conversation turns. Failure is non-blocking — the original
// `effectiveMessage` is used unchanged.

interface RewriterResult {
  searchQuery: string;
  userQuestion: string;
}

async function rewriteQuery(
  effectiveMessage: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> | undefined,
  callAI: WebSearchCallAI,
  tracker: LLMTracker | null,
): Promise<RewriterResult> {
  const base: RewriterResult = { searchQuery: effectiveMessage, userQuestion: effectiveMessage };
  if (!conversationHistory || conversationHistory.length === 0) return base;

  const recentMessages = conversationHistory.slice(-12);
  const conversationContext = recentMessages
    .map((m) => `${m.role === 'user' ? 'User' : 'Olive'}: ${m.content.substring(0, 400)}`)
    .join('\n');

  try {
    const rewriterResult = await callAI(
      `You are a context-aware query rewriter for web search. Given a conversation and the user's latest message, produce TWO things on separate lines:

LINE 1 (SEARCH_QUERY): A concise web search query optimized for a search engine. Include the full entity name (resolved from conversation), location if known, and the specific topic. Max 15 words.
LINE 2 (USER_QUESTION): The user's actual question rewritten as a complete, self-contained sentence with all pronouns resolved. This should be answerable by reading search results.

RULES:
- Resolve ALL pronouns ("they", "it", "their", "that place") using conversation history.
- If the user asks a specific factual question (hours, menu, price, etc.), the SEARCH_QUERY must target that specific fact.
- Do NOT produce a broad query when the user asks something specific.

EXAMPLES:
- Conversation mentions "KeBo Restaurant, Key Biscayne" → User says "Are they open on Sundays?"
  SEARCH_QUERY: KeBo Restaurant Key Biscayne Sunday opening hours
  USER_QUESTION: Is KeBo Restaurant in Key Biscayne open on Sundays?

- Conversation mentions booking at "Nobu Miami" → User says "Do they have valet?"
  SEARCH_QUERY: Nobu Miami valet parking
  USER_QUESTION: Does Nobu Miami offer valet parking?

- User says "Search for Italian restaurants near me" (no prior context)
  SEARCH_QUERY: best Italian restaurants nearby
  USER_QUESTION: What are the best Italian restaurants nearby?

CONVERSATION:
${conversationContext}

USER'S LATEST MESSAGE: "${effectiveMessage}"

Respond with exactly two lines starting with SEARCH_QUERY: and USER_QUESTION:`,
      effectiveMessage,
      0.1,
      'lite',
      tracker,
      WA_REWRITER_PROMPT_VERSION,
    );
    if (rewriterResult) {
      const sqMatch = rewriterResult.match(/SEARCH_QUERY:\s*(.+)/i);
      const uqMatch = rewriterResult.match(/USER_QUESTION:\s*(.+)/i);
      const out = { ...base };
      if (sqMatch?.[1]?.trim()) out.searchQuery = sqMatch[1].trim();
      if (uqMatch?.[1]?.trim()) out.userQuestion = uqMatch[1].trim();
      console.log('[WebSearch] Rewriter: query="' + out.searchQuery + '" | question="' + out.userQuestion + '"');
      return out;
    }
  } catch (resolveErr) {
    console.warn('[WebSearch] Query rewriter failed, using original:', resolveErr);
  }
  return base;
}

// ─── Factory ──────────────────────────────────────────────────────────

export function makeWebSearchHandler(deps: WebSearchDeps): Handler {
  const doFetch = deps.perplexityFetch ?? ((url, init) => fetch(url, init));

  return async (ctx: HandlerContext): Promise<Reply> => {
    console.log('[WhatsApp] Processing WEB_SEARCH for:', ctx.effectiveMessage?.substring(0, 80));

    try {
      const PERPLEXITY_KEY = Deno.env.get('OLIVE_PERPLEXITY');
      if (!PERPLEXITY_KEY) {
        console.error('[WebSearch] OLIVE_PERPLEXITY not configured');
        return { text: deps.t('web_search_unavailable', ctx.userLang) };
      }

      const sessionContext = (ctx.session.context_data || {}) as ConversationContext;
      const { searchQuery, userQuestion } = await rewriteQuery(
        ctx.effectiveMessage || '',
        sessionContext.conversation_history,
        deps.callAI,
        ctx.tracker,
      );

      // ── Saved-item disambiguation context.
      let savedItemContext = '';
      const { data: matchingItems } = await ctx.supabase
        .from('clerk_notes')
        .select('summary, items, category, original_text')
        .or(`author_id.eq.${ctx.userId}${ctx.coupleId ? `,couple_id.eq.${ctx.coupleId}` : ''}`)
        .eq('completed', false)
        .order('created_at', { ascending: false })
        .limit(100);

      if (matchingItems) {
        const searchLower = searchQuery.toLowerCase();
        const originalLower = (ctx.effectiveMessage || '').toLowerCase();
        // deno-lint-ignore no-explicit-any
        const relevant = matchingItems.filter((item: any) => {
          const summaryLower = item.summary.toLowerCase();
          const queryWords = searchLower.split(/\s+/).filter((w: string) => w.length > 2);
          const originalWords = originalLower.split(/\s+/).filter((w: string) => w.length > 2);
          const allWords = [...new Set([...queryWords, ...originalWords])];
          return allWords.some((w) => summaryLower.includes(w));
        }).slice(0, 5);

        if (relevant.length > 0) {
          savedItemContext = '\n\nUser has these related saved items (use to disambiguate):\n';
          // deno-lint-ignore no-explicit-any
          relevant.forEach((item: any) => {
            savedItemContext += `- ${item.summary}`;
            if (item.items && item.items.length > 0) {
              savedItemContext += ` [${item.items.slice(0, 3).join(', ')}]`;
            }
            savedItemContext += '\n';
          });
        }
      }

      // ── Call Perplexity.
      console.log('[WebSearch] Perplexity query:', searchQuery, '| question:', userQuestion);
      const perplexityResponse = await doFetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PERPLEXITY_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sonar',
          messages: [
            {
              role: 'system',
              content: `You are a precise search assistant. The user has a SPECIFIC question. Answer ONLY that question with factual details. Do not dump unrelated information. Include relevant links, hours, phone numbers, or addresses ONLY if they are part of the answer.${savedItemContext}`,
            },
            {
              role: 'user',
              content: `Question: ${userQuestion}\n\nSearch for: ${searchQuery}`,
            },
          ],
          temperature: 0.1,
        }),
      });

      if (!perplexityResponse.ok) {
        const errText = await perplexityResponse.text();
        console.error('[WebSearch] Perplexity API error:', perplexityResponse.status, errText);
        return {
          text: deps.t('web_search_unavailable_hint', ctx.userLang, {
            hint: searchQuery.split(' ').slice(0, 3).join(' '),
          }),
        };
      }

      // deno-lint-ignore no-explicit-any
      const perplexityData = (await perplexityResponse.json()) as any;
      const searchResult = perplexityData.choices?.[0]?.message?.content || '';
      const citations: string[] = perplexityData.citations || [];

      if (!searchResult) {
        return { text: '🔍 I couldn\'t find relevant results. Try rephrasing your search.' };
      }

      // ── Personal-context blend.
      let personalContext = '';
      try {
        const { data: userMems } = await ctx.supabase
          .from('user_memories')
          .select('title, content, category')
          .eq('user_id', ctx.userId)
          .eq('is_active', true)
          .order('importance', { ascending: false })
          .limit(10);
        if (userMems && userMems.length > 0) {
          // deno-lint-ignore no-explicit-any
          personalContext = `\nUSER'S PERSONAL CONTEXT (weave in naturally if relevant):\n${userMems.map((m: any) => `- [${m.category}] ${m.title}: ${m.content}`).join('\n')}\n`;
        }
      } catch (_) {
        /* non-blocking */
      }

      // ── Format response.
      const ctxLangName = langName(ctx.userLang);
      let formattedResponse: string;
      try {
        formattedResponse = await deps.callAI(
          buildWaWebSearchFormatPrompt({
            langName: ctxLangName,
            userQuestion,
            savedItemContext,
            personalContext,
            searchResult,
            citations,
          }),
          searchResult,
          0.5,
          'lite',
          ctx.tracker,
          WA_WEB_SEARCH_FORMAT_PROMPT_VERSION,
        );
      } catch (formatErr) {
        console.warn('[WebSearch] Formatting failed, using raw result');
        formattedResponse = `🔍 Here's what I found:\n\n${searchResult.slice(0, 1200)}`;
        if (citations.length > 0) {
          formattedResponse += `\n\n🔗 ${citations[0]}`;
        }
      }

      // ── Citation guard: generalized form of the formatErr-fallback
      // append. Even with v2.0's strengthened prompt, Gemini sometimes
      // produces a warm prose answer with no URL. If Perplexity gave us
      // citations and the formatted text contains no http(s) link,
      // append the top source. WhatsApp `preview_url: true` linkifies
      // bare URLs (see _shared/whatsapp-messaging.ts).
      if (citations.length > 0 && !/https?:\/\//i.test(formattedResponse)) {
        formattedResponse = `${formattedResponse.trim()}\n\n🔗 ${citations[0]}`;
        console.log('[WebSearch] Citation guard fired — appended top source');
      }

      // ── Build pending_offer (artifact freezing).
      const requestForSave = (ctx.effectiveMessage || '').substring(0, 500);
      const offeredArtifact = formattedResponse.substring(0, 4000);
      const responseSuggestsSave = responseOffersSave(formattedResponse);
      const pendingOffer: PendingOffer | null = responseSuggestsSave
        ? {
            type: 'save_artifact',
            artifact_content: offeredArtifact,
            artifact_request: requestForSave,
            artifact_kind: 'web_search',
            offered_at: new Date().toISOString(),
          }
        : null;

      // ── After-reply callbacks.
      const after_reply: Array<() => Promise<void>> = [
        async () => {
          try {
            await deps.saveReferencedEntity(null, formattedResponse);
          } catch (refErr) {
            console.warn('[WEB_SEARCH] saveReferencedEntity failed (non-blocking):', refErr);
          }
        },
        async () => {
          try {
            const currentCtxWS = (ctx.session.context_data || {}) as ConversationContext;
            const nowIsoWS = new Date().toISOString();
            await ctx.supabase
              .from('user_sessions')
              .update({
                context_data: {
                  ...currentCtxWS,
                  last_assistant_output: offeredArtifact,
                  last_assistant_output_at: nowIsoWS,
                  last_assistant_request: requestForSave,
                  pending_offer: pendingOffer,
                },
                updated_at: nowIsoWS,
              })
              .eq('id', ctx.session.id);
            console.log(`[WEB_SEARCH] Stored output for save-artifact follow-up — pending_offer=${pendingOffer ? 'yes' : 'no'}`);
          } catch (storeErr) {
            console.warn('[Context] Error saving context after WEB_SEARCH:', storeErr);
          }
        },
      ];

      return {
        text: formattedResponse.slice(0, 1500),
        max_length: 1500,
        after_reply,
      };
    } catch (webSearchErr) {
      console.error('[WebSearch] Unexpected error:', webSearchErr);
      return { text: deps.t('web_search_error', ctx.userLang) };
    }
  };
}
