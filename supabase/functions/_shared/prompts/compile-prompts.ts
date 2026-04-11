/**
 * Compile Memory Prompt Registry
 * ================================
 * Versioned prompts for the Karpathy Second Brain compilation layer.
 * Each file type (profile, patterns, relationship, household) has its own
 * versioned prompt template.
 */

export type CompileFileType = "profile" | "patterns" | "relationship" | "household";

export const COMPILE_PROMPT_VERSIONS: Record<CompileFileType, string> = {
  profile: "compile-profile-v1.0",
  patterns: "compile-patterns-v1.0",
  relationship: "compile-relationship-v1.0",
  household: "compile-household-v1.0",
};

/**
 * Get the prompt version string for a file type.
 */
export function getCompilePromptVersion(fileType: CompileFileType): string {
  return COMPILE_PROMPT_VERSIONS[fileType] || `compile-${fileType}-v1.0`;
}
