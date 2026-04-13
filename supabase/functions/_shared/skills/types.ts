/**
 * IOliveSkill — External Tool Interface
 * ======================================
 * The contract for every external tool Olive can use.
 * Drop a new file in _shared/skills/, implement this interface,
 * and register it in registry.ts — the pipeline picks it up automatically.
 *
 * Gemini uses native Function Calling to decide when to invoke skills.
 * The LLM reads the description and parameters to determine relevance.
 */

export interface IOliveSkill {
  /** Unique function name (used in Gemini functionDeclarations) */
  name: string;

  /** Human-readable description (Gemini reads this to decide when to call) */
  description: string;

  /** JSON Schema for the tool's input parameters (OpenAPI format) */
  parameters: {
    type: "OBJECT";
    properties: Record<string, {
      type: "STRING" | "NUMBER" | "BOOLEAN";
      description: string;
    }>;
    required: string[];
  };

  /**
   * Execute the skill.
   * @param args - Parsed arguments from Gemini's function call
   * @param userId - The authenticated user's UUID (for user-scoped operations)
   * @returns A string result for Gemini to consume. MUST return a string
   *          even on error — Gemini reads the error and tells the user gracefully.
   */
  execute: (args: Record<string, any>, userId: string) => Promise<string>;
}
