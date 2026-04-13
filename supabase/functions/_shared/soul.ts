/**
 * Olive SOUL.MD — Composable Soul Assembly
 * ==========================================
 * Assembles the soul stack for each Gemini request:
 *
 *   Layer 0: BASE    — Universal Olive identity (~120 tokens, always loaded)
 *   Layer 1: USER    — Personal preferences, domain knowledge, tone (~300-500 tokens)
 *   Layer 2: SPACE   — Space-level dynamics, shared knowledge (~200-400 tokens)
 *   Layer 3: SKILL   — Active skill instructions, loaded per-intent (~100-300 tokens)
 *   Layer 4: CONTEXT — Ephemeral per-request context (fills remaining budget)
 *   Layer 5: TRUST   — Action-level trust permissions (~100-200 tokens)
 *
 * Token budget: ~2,500 tokens total for the full soul stack.
 *
 * IMPORTANT: This module is designed to be non-breaking. If soul_enabled is
 * false for a user (or no soul layers exist), assembleSoulContext() returns
 * an empty string and the caller falls through to existing behavior.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ──────────────────────────────────────────────────────

export type SoulLayerType = "base" | "user" | "space" | "skill" | "trust";
export type SoulOwnerType = "system" | "user" | "space";

export interface SoulLayer {
  id: string;
  layer_type: SoulLayerType;
  owner_type: SoulOwnerType;
  owner_id: string | null;
  version: number;
  content: Record<string, any>;
  content_rendered: string | null;
  token_count: number;
  is_locked: boolean;
}

export interface SoulAssemblyOptions {
  userId: string;
  spaceId?: string | null;
  matchedSkillId?: string | null;
  likelyActions?: string[];
  contextBudget?: number; // tokens reserved for Layer 4 (ephemeral context)
}

export interface SoulAssemblyResult {
  /** The assembled soul prompt to inject as system context */
  prompt: string;
  /** Total tokens used by the soul stack */
  tokensUsed: number;
  /** Whether a soul was found (false = user has no soul, use legacy behavior) */
  hasSoul: boolean;
  /** Individual layers loaded (for debugging/logging) */
  layersLoaded: string[];
}

// ─── Constants ──────────────────────────────────────────────────

/** Maximum tokens for the entire soul stack */
const SOUL_TOKEN_BUDGET = 2500;

/** Rough estimate: 1 token ≈ 4 characters for English text */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Layer Cache ────────────────────────────────────────────────
// In-memory cache for the base layer (same for all users, never changes).
// Avoids a DB hit on every single request.

let _baseSoulCache: SoulLayer | null = null;
let _baseSoulCacheExpiry = 0;
const BASE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Core Functions ─────────────────────────────────────────────

/**
 * Check if soul is enabled for a user.
 * Returns false if no preference row exists or soul_enabled is false.
 */
export async function isSoulEnabled(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("olive_user_preferences")
      .select("soul_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    return data?.soul_enabled === true;
  } catch {
    return false;
  }
}

/**
 * Fetch a single soul layer by type and owner.
 * Returns null if not found.
 */
async function getSoulLayer(
  supabase: ReturnType<typeof createClient<any>>,
  layerType: SoulLayerType,
  ownerType: SoulOwnerType,
  ownerId: string | null
): Promise<SoulLayer | null> {
  // Use cache for base layer
  if (layerType === "base" && ownerType === "system") {
    if (_baseSoulCache && Date.now() < _baseSoulCacheExpiry) {
      return _baseSoulCache;
    }
  }

  try {
    let query = supabase
      .from("olive_soul_layers")
      .select("*")
      .eq("layer_type", layerType)
      .eq("owner_type", ownerType);

    if (ownerId) {
      query = query.eq("owner_id", ownerId);
    } else {
      query = query.is("owner_id", null);
    }

    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;

    const layer = data as SoulLayer;

    // Cache base layer
    if (layerType === "base" && ownerType === "system") {
      _baseSoulCache = layer;
      _baseSoulCacheExpiry = Date.now() + BASE_CACHE_TTL_MS;
    }

    return layer;
  } catch {
    return null;
  }
}

/**
 * Render a user soul layer's JSONB content into an LLM-injectable markdown string.
 * This is used when content_rendered is null (not yet cached).
 */
function renderUserSoul(content: Record<string, any>): string {
  const parts: string[] = [];

  // Identity / Tone
  if (content.identity) {
    const id = content.identity;
    const toneDesc = id.tone || "warm";
    const verbosity = id.verbosity || "balanced";
    parts.push(`Communication style: ${toneDesc}, ${verbosity}.`);
    if (id.humor === false) parts.push("Avoid humor.");
    if (id.emoji_level) parts.push(`Emoji usage: ${id.emoji_level}.`);
  }

  // User context
  if (content.user_context) {
    const ctx = content.user_context;
    const segments: string[] = [];
    if (ctx.type) segments.push(`User type: ${ctx.type}`);
    if (ctx.industry) segments.push(`Industry: ${ctx.industry}`);
    if (ctx.role) segments.push(`Role: ${ctx.role}`);
    if (ctx.life_stage) segments.push(`Life stage: ${ctx.life_stage}`);
    if (segments.length > 0) parts.push(segments.join(". ") + ".");
  }

  // Domain knowledge
  if (content.domain_knowledge && Array.isArray(content.domain_knowledge)) {
    const domains = content.domain_knowledge
      .filter((d: any) => d.confidence >= 0.5)
      .map((d: any) => `${d.area}: ${(d.concepts || []).join(", ")}`)
      .join("; ");
    if (domains) parts.push(`Domain knowledge: ${domains}.`);
  }

  // Relationships
  if (content.relationships && Array.isArray(content.relationships)) {
    const rels = content.relationships
      .map((r: any) => {
        const patterns = (r.patterns || []).join(", ");
        return `${r.name} (${r.role})${patterns ? ": " + patterns : ""}`;
      })
      .join("; ");
    if (rels) parts.push(`Key people: ${rels}.`);
  }

  // Communication preferences
  if (content.communication) {
    const comm = content.communication;
    const prefs: string[] = [];
    if (comm.response_style) prefs.push(`Response style: ${comm.response_style}`);
    if (comm.preferred_channel) prefs.push(`Preferred channel: ${comm.preferred_channel}`);
    if (prefs.length > 0) parts.push(prefs.join(". ") + ".");
  }

  // Proactive rules summary (don't dump full rules, just count)
  if (content.proactive_rules && Array.isArray(content.proactive_rules)) {
    const activeRules = content.proactive_rules.filter((r: any) => r.enabled);
    if (activeRules.length > 0) {
      parts.push(`${activeRules.length} proactive rules active.`);
    }
  }

  return parts.join("\n");
}

/**
 * Render a trust layer into LLM-injectable text.
 */
function renderTrustContext(content: Record<string, any>, likelyActions?: string[]): string {
  const matrix = content.trust_matrix || {};
  if (Object.keys(matrix).length === 0) return "";

  const TRUST_LABELS: Record<number, string> = {
    0: "INFORM ONLY (explain what you would do, but do not act)",
    1: "SUGGEST (propose the action and wait for approval)",
    2: "ACT AND REPORT (do it, then tell the user what you did)",
    3: "AUTONOMOUS (act silently, user sees in activity log)",
  };

  // If we know likely actions, only show relevant trust levels
  const relevantActions = likelyActions && likelyActions.length > 0
    ? likelyActions.filter((a) => a in matrix)
    : Object.keys(matrix);

  if (relevantActions.length === 0) return "";

  const lines = relevantActions.map((action) => {
    const level = matrix[action] ?? 0;
    return `- ${action}: ${TRUST_LABELS[level] || TRUST_LABELS[0]}`;
  });

  return "Trust permissions for this interaction:\n" + lines.join("\n");
}

/**
 * Assemble the full soul stack for a Gemini request.
 *
 * This is the main entry point. It loads layers bottom-up, respects the
 * token budget, and returns a formatted prompt string.
 *
 * If the user has no soul (soul_enabled=false or no layers exist), it
 * returns { hasSoul: false, prompt: "", tokensUsed: 0 } and the caller
 * should fall back to existing behavior.
 */
export async function assembleSoulContext(
  supabase: ReturnType<typeof createClient<any>>,
  options: SoulAssemblyOptions
): Promise<SoulAssemblyResult> {
  const { userId, spaceId, matchedSkillId, likelyActions } = options;

  // ─── Check feature flag ───────────────────────────────────────
  const enabled = await isSoulEnabled(supabase, userId);
  if (!enabled) {
    return { prompt: "", tokensUsed: 0, hasSoul: false, layersLoaded: [] };
  }

  const sections: string[] = [];
  let tokensUsed = 0;
  const layersLoaded: string[] = [];

  // ─── Layer 0: Base (always loaded, ~120 tokens) ───────────────
  const baseSoul = await getSoulLayer(supabase, "base", "system", null);
  if (baseSoul) {
    const rendered = baseSoul.content_rendered || "You are Olive, an AI assistant.";
    const tokens = baseSoul.token_count || estimateTokens(rendered);
    if (tokensUsed + tokens <= SOUL_TOKEN_BUDGET) {
      sections.push(rendered);
      tokensUsed += tokens;
      layersLoaded.push("base");
    }
  }

  // ─── Layer 1: User Soul (always loaded if exists, ~300-500 tokens) ─
  const userSoul = await getSoulLayer(supabase, "user", "user", userId);
  if (userSoul) {
    const rendered = userSoul.content_rendered || renderUserSoul(userSoul.content);
    const tokens = userSoul.token_count || estimateTokens(rendered);
    if (tokensUsed + tokens <= SOUL_TOKEN_BUDGET) {
      sections.push("\n## About this user\n" + rendered);
      tokensUsed += tokens;
      layersLoaded.push("user");
    }
  }

  // ─── Layer 2: Space Soul (only if in a space context) ─────────
  if (spaceId) {
    const spaceSoul = await getSoulLayer(supabase, "space", "space", spaceId);
    if (spaceSoul) {
      const rendered = spaceSoul.content_rendered || JSON.stringify(spaceSoul.content);
      const tokens = spaceSoul.token_count || estimateTokens(rendered);
      if (tokensUsed + tokens <= SOUL_TOKEN_BUDGET) {
        sections.push("\n## Space context\n" + rendered);
        tokensUsed += tokens;
        layersLoaded.push("space");
      }
    }
  }

  // ─── Layer 3: Skill Soul (loaded per matched skill) ───────────
  // Skill content is already loaded by the skills system.
  // We reserve budget for it but don't load it here — the caller
  // injects skill instructions separately (existing behavior).
  // Just log that we accounted for it.
  if (matchedSkillId) {
    layersLoaded.push("skill-reserved");
  }

  // ─── Layer 5: Trust (loaded based on likely actions) ──────────
  const trustSoul = await getSoulLayer(supabase, "trust", "user", userId);
  if (trustSoul) {
    const rendered = renderTrustContext(trustSoul.content, likelyActions);
    if (rendered) {
      const tokens = estimateTokens(rendered);
      if (tokensUsed + tokens <= SOUL_TOKEN_BUDGET) {
        sections.push("\n## Trust permissions\n" + rendered);
        tokensUsed += tokens;
        layersLoaded.push("trust");
      }
    }
  }

  // ─── Return ───────────────────────────────────────────────────
  if (sections.length === 0) {
    return { prompt: "", tokensUsed: 0, hasSoul: false, layersLoaded: [] };
  }

  return {
    prompt: sections.join("\n"),
    tokensUsed,
    hasSoul: true,
    layersLoaded,
  };
}

// ─── Soul CRUD Helpers ──────────────────────────────────────────

/**
 * Create or update a soul layer. Stores the previous version for rollback.
 */
export async function upsertSoulLayer(
  supabase: ReturnType<typeof createClient<any>>,
  layerType: SoulLayerType,
  ownerType: SoulOwnerType,
  ownerId: string | null,
  content: Record<string, any>,
  trigger: string = "system"
): Promise<SoulLayer | null> {
  try {
    // Render content to markdown
    const rendered = layerType === "user"
      ? renderUserSoul(content)
      : layerType === "trust"
        ? renderTrustContext(content)
        : JSON.stringify(content, null, 2);
    const tokenCount = estimateTokens(rendered);

    // Check if layer exists
    const existing = await getSoulLayer(supabase, layerType, ownerType, ownerId);

    if (existing) {
      // Don't update locked layers
      if (existing.is_locked && layerType !== "base") {
        console.warn(`[Soul] Layer ${layerType} for ${ownerId} is locked, skipping update`);
        return existing;
      }

      // Store previous version for rollback
      await supabase.from("olive_soul_versions").insert({
        layer_id: existing.id,
        version: existing.version,
        content: existing.content,
        content_rendered: existing.content_rendered,
        change_summary: `Pre-update snapshot (trigger: ${trigger})`,
        trigger,
      });

      // Prune old versions (keep last 20)
      const { data: versions } = await supabase
        .from("olive_soul_versions")
        .select("id, version")
        .eq("layer_id", existing.id)
        .order("version", { ascending: false })
        .range(20, 100); // Get versions beyond the 20th

      if (versions && versions.length > 0) {
        const idsToDelete = versions.map((v: any) => v.id);
        await supabase.from("olive_soul_versions").delete().in("id", idsToDelete);
      }

      // Update the layer
      const { data, error } = await supabase
        .from("olive_soul_layers")
        .update({
          content,
          content_rendered: rendered,
          token_count: tokenCount,
          version: existing.version + 1,
          evolved_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select()
        .single();

      if (error) {
        console.error("[Soul] Update error:", error);
        return null;
      }

      // Invalidate cache if base layer
      if (layerType === "base") _baseSoulCache = null;

      return data as SoulLayer;
    } else {
      // Create new layer
      const { data, error } = await supabase
        .from("olive_soul_layers")
        .insert({
          layer_type: layerType,
          owner_type: ownerType,
          owner_id: ownerId,
          version: 1,
          content,
          content_rendered: rendered,
          token_count: tokenCount,
        })
        .select()
        .single();

      if (error) {
        console.error("[Soul] Insert error:", error);
        return null;
      }
      return data as SoulLayer;
    }
  } catch (err) {
    console.error("[Soul] Upsert error:", err);
    return null;
  }
}

/**
 * Get a user's soul layer content by type.
 * Convenience wrapper over getSoulLayer.
 */
export async function getUserSoulContent(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  layerType: SoulLayerType = "user"
): Promise<Record<string, any> | null> {
  const ownerType: SoulOwnerType = layerType === "base" ? "system" : "user";
  const ownerId = layerType === "base" ? null : userId;
  const layer = await getSoulLayer(supabase, layerType, ownerType, ownerId);
  return layer?.content || null;
}

/**
 * Record a reflection (action outcome) for the self-improvement loop.
 */
export async function recordReflection(
  supabase: ReturnType<typeof createClient<any>>,
  userId: string,
  actionType: string,
  outcome: "accepted" | "modified" | "rejected" | "ignored",
  detail?: {
    spaceId?: string;
    actionDetail?: Record<string, any>;
    userModification?: string;
    lesson?: string;
    confidence?: number;
  }
): Promise<void> {
  try {
    await supabase.from("olive_reflections").insert({
      user_id: userId,
      space_id: detail?.spaceId || null,
      action_type: actionType,
      action_detail: detail?.actionDetail || {},
      outcome,
      user_modification: detail?.userModification || null,
      lesson: detail?.lesson || null,
      confidence: detail?.confidence ?? 0.5,
    });
  } catch (err) {
    // Non-blocking: don't fail the main operation if reflection logging fails
    console.warn("[Soul] Reflection insert error (non-blocking):", err);
  }
}
