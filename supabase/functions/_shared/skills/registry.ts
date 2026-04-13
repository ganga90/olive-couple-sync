/**
 * Olive Skills Registry
 * =====================
 * Central registry for all external tools available to the Gemini pipeline.
 * Collects skills, builds functionDeclarations for Gemini's native Function Calling,
 * and dispatches execution to the matching skill.
 *
 * Adding a new skill:
 * 1. Create a new file in _shared/skills/ implementing IOliveSkill
 * 2. Import it here
 * 3. Add it to the SKILLS array
 * That's it — callAI() and ask-olive-individual automatically pick it up.
 */

import type { IOliveSkill } from "./types.ts";
import { scrapeWebsiteSkill } from "./firecrawl-scraper.ts";
import { deepResearchSkill } from "./perplexity-research.ts";
import { scheduleEventSkill } from "./google-calendar.ts";

// ─── Configuration ──────────────────────────────────────────

/**
 * Maximum tool calls per single user request.
 * Prevents infinite loops and API cost overruns.
 * A single request can invoke at most 2 tools (e.g., scrape 2 URLs).
 */
export const MAX_TOOL_CALLS = 2;

// ─── Skill Collection ───────────────────────────────────────

/** All registered skills. Order doesn't matter. */
const SKILLS: IOliveSkill[] = [
  scrapeWebsiteSkill,
  deepResearchSkill,
  scheduleEventSkill,
  // Future skills (just implement IOliveSkill and add here):
  // googleTasksSkill,
];

// ─── Public API ─────────────────────────────────────────────

/**
 * Build the functionDeclarations array for Gemini SDK config.tools.
 * Returns the declarations in the format expected by @google/genai@1.0.0:
 * [{ name, description, parameters }]
 */
export function getSkillDeclarations(): Array<{
  name: string;
  description: string;
  parameters: IOliveSkill["parameters"];
}> {
  return SKILLS.map((skill) => ({
    name: skill.name,
    description: skill.description,
    parameters: skill.parameters,
  }));
}

/**
 * Dispatch execution to the matching skill by name.
 * Called from the function calling loop in callAI / ask-olive-individual.
 *
 * @param name - The function name from Gemini's functionCall
 * @param args - The parsed arguments from Gemini's functionCall
 * @param userId - The authenticated user's UUID
 * @returns A string result that Gemini will read and incorporate into its response
 */
export async function executeSkill(
  name: string,
  args: Record<string, any>,
  userId: string
): Promise<string> {
  const skill = SKILLS.find((s) => s.name === name);
  if (!skill) {
    console.warn(`[Skills Registry] Unknown skill requested: "${name}"`);
    return `Error: Unknown skill "${name}". Available skills: ${SKILLS.map((s) => s.name).join(", ")}`;
  }

  console.log(`[Skills Registry] Executing "${name}" for user ${userId.substring(0, 8)}...`);
  const startTime = Date.now();

  try {
    const result = await skill.execute(args, userId);
    const elapsed = Date.now() - startTime;
    console.log(`[Skills Registry] "${name}" completed in ${elapsed}ms (${result.length} chars)`);
    return result;
  } catch (e: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[Skills Registry] "${name}" failed after ${elapsed}ms:`, e);
    return `Error executing ${name}: ${e.message || "Unknown error"}`;
  }
}
