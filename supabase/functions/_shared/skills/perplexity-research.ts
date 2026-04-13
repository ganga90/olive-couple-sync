/**
 * Perplexity Deep Research Skill
 * ==============================
 * Performs real-time web search using the Perplexity API (Sonar model)
 * to answer complex questions requiring up-to-date information.
 *
 * Use cases:
 * - Market research & competitor analysis
 * - Product comparisons & pricing lookups
 * - Current events & news
 * - Factual questions requiring live data
 * - Travel/location research
 *
 * Safeguards:
 * - 10s timeout via AbortController
 * - 8000 char response truncation (~2K tokens)
 * - All errors return human-readable strings (Gemini relays them to user)
 * - Citations from Perplexity appended as markdown sources
 */

import type { IOliveSkill } from "./types.ts";

/** Timeout for the Perplexity API call. Sonar is fast but we protect edge function limits. */
const PERPLEXITY_TIMEOUT_MS = 10000;

/** Max response length in characters (~2K tokens). Prevents context explosion. */
const MAX_RESPONSE_LENGTH = 8000;

export const deepResearchSkill: IOliveSkill = {
  name: "deep_research",
  description:
    "Performs real-time web search to answer complex questions requiring up-to-date information, market research, competitor analysis, product comparisons, current events, pricing, or factual lookups that need live web data. Returns a well-researched answer with web citations. Use this ONLY when the user needs current, real-time information from the web — NOT for questions about the user's own saved items or tasks.",
  parameters: {
    type: "OBJECT",
    properties: {
      query: {
        type: "STRING",
        description:
          "The research question to search the web for. Be specific and detailed for better results.",
      },
    },
    required: ["query"],
  },

  execute: async (args: Record<string, any>, _userId: string): Promise<string> => {
    const apiKey = Deno.env.get("OLIVE_PERPLEXITY");
    if (!apiKey) {
      return "Error: Deep research service is not configured. The OLIVE_PERPLEXITY API key is missing.";
    }

    const { query } = args;
    if (!query || typeof query !== "string" || query.trim().length < 3) {
      return "Error: Please provide a meaningful research query (at least 3 characters).";
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PERPLEXITY_TIMEOUT_MS);

      console.log(`[deep_research] Querying Perplexity: "${query.substring(0, 100)}"`);

      const response = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "sonar",
          messages: [
            {
              role: "system",
              content:
                "Be precise, thorough, and cite your sources. Format your response in clean Markdown. Provide factual, up-to-date information with specific details like prices, dates, and names when available.",
            },
            {
              role: "user",
              content: query,
            },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const status = response.status;
        console.warn(`[deep_research] Perplexity returned HTTP ${status}`);
        if (status === 401) {
          return "Error: Deep research API key is invalid or expired.";
        }
        if (status === 429) {
          return "Error: Too many research requests. Please wait a moment and try again.";
        }
        return `Error: Research service returned HTTP ${status}. Please try again later.`;
      }

      const data = await response.json();
      let answer = data.choices?.[0]?.message?.content || "";

      if (!answer || answer.trim().length === 0) {
        return "Error: The research service returned no results for this query. Try rephrasing your question.";
      }

      // Append citations if available (Perplexity returns them alongside the response)
      const citations = data.citations;
      if (citations && Array.isArray(citations) && citations.length > 0) {
        answer +=
          "\n\n**Sources:**\n" +
          citations.map((url: string, i: number) => `${i + 1}. ${url}`).join("\n");
      }

      // Truncate if needed to prevent token explosion
      if (answer.length > MAX_RESPONSE_LENGTH) {
        answer =
          answer.substring(0, MAX_RESPONSE_LENGTH) +
          "\n\n[Response truncated — showing first ~8000 characters]";
      }

      console.log(`[deep_research] Success (${answer.length} chars, ${citations?.length || 0} citations)`);

      return answer;
    } catch (e: any) {
      if (e.name === "AbortError") {
        console.warn(`[deep_research] Timeout for query: "${query.substring(0, 60)}"`);
        return "Error: The research request timed out (exceeded 10-second limit). Try a simpler or more specific query.";
      }
      console.error(`[deep_research] Error:`, e);
      return `Error: Research failed: ${e.message || "Unknown error"}`;
    }
  },
};
