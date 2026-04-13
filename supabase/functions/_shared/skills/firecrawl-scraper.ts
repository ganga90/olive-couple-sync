/**
 * Firecrawl Web Scraper Skill
 * ===========================
 * Extracts clean, readable markdown content from any URL using the Firecrawl API.
 * Uses the /v1/scrape endpoint (not /v1/search) for single-URL content extraction.
 *
 * Safeguards:
 * - 15s timeout via AbortController
 * - 8000 char content truncation (~2K tokens)
 * - All errors return human-readable strings (Gemini relays them to user)
 * - URL validation before calling API
 */

import type { IOliveSkill } from "./types.ts";

/** Max scraped content length in characters (~2K tokens). Prevents context explosion. */
const MAX_CONTENT_LENGTH = 8000;

/** Timeout for the Firecrawl API call. Protects Supabase edge function timeouts (30s default). */
const SCRAPE_TIMEOUT_MS = 15000;

export const scrapeWebsiteSkill: IOliveSkill = {
  name: "scrape_website",
  description:
    "Extracts clean, readable markdown content from any URL provided by the user. Use this when the user shares a link and wants you to read, summarize, analyze, compare, or extract specific information from the webpage content. Works with articles, listings, product pages, documentation, and most public websites.",
  parameters: {
    type: "OBJECT",
    properties: {
      url: {
        type: "STRING",
        description:
          "The full URL to scrape. Must start with http:// or https://.",
      },
    },
    required: ["url"],
  },

  execute: async (args: Record<string, any>, _userId: string): Promise<string> => {
    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    if (!FIRECRAWL_API_KEY) {
      return "Error: Web scraping service is not configured. The FIRECRAWL_API_KEY is missing.";
    }

    const { url } = args;
    if (
      !url ||
      typeof url !== "string" ||
      (!url.startsWith("http://") && !url.startsWith("https://"))
    ) {
      return "Error: Invalid URL. Please provide a full URL starting with http:// or https://.";
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

      console.log(`[scrape_website] Scraping: ${url.substring(0, 120)}`);

      const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          formats: ["markdown"],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const status = response.status;
        console.warn(`[scrape_website] Firecrawl returned HTTP ${status} for ${url.substring(0, 80)}`);
        if (status === 402) {
          return "Error: Web scraping quota exceeded. Please try again later.";
        }
        if (status === 429) {
          return "Error: Too many scraping requests. Please wait a moment and try again.";
        }
        return `Error: Could not scrape the website (HTTP ${status}). The site may be blocking automated access or the URL may be invalid.`;
      }

      const data = await response.json();

      if (!data.success && data.error) {
        return `Error: Firecrawl could not process this URL: ${data.error}`;
      }

      let markdown = data.data?.markdown || data.data?.content || "";

      if (!markdown || markdown.trim().length === 0) {
        return "Error: The website returned no readable content. It may require login, use heavy JavaScript rendering, or block automated access.";
      }

      // Truncate to prevent token explosion
      if (markdown.length > MAX_CONTENT_LENGTH) {
        markdown =
          markdown.substring(0, MAX_CONTENT_LENGTH) +
          "\n\n[Content truncated — showing first ~8000 characters of the page]";
      }

      const title = data.data?.metadata?.title || "Untitled page";
      const description = data.data?.metadata?.description
        ? `> ${data.data.metadata.description}\n\n`
        : "";

      console.log(`[scrape_website] Success: "${title}" (${markdown.length} chars)`);

      return `# ${title}\n\n${description}${markdown}`;
    } catch (e: any) {
      if (e.name === "AbortError") {
        console.warn(`[scrape_website] Timeout for ${url.substring(0, 80)}`);
        return "Error: The website took too long to respond (exceeded 15-second timeout). Try a different URL or try again later.";
      }
      console.error(`[scrape_website] Error:`, e);
      return `Error: Failed to scrape the website: ${e.message || "Unknown error"}`;
    }
  },
};
