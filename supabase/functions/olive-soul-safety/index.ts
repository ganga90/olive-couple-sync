/**
 * Olive Soul Safety — Evolution Safety Rails
 *
 * Provides drift detection, rollback, and rate limiting for soul evolution.
 * Called by olive-soul-evolve before/after applying changes, and by users
 * to roll back unwanted evolution.
 *
 * Actions:
 * - check_drift: Compare two soul versions and compute drift score
 * - rollback: Revert a soul layer to a previous version
 * - get_evolution_history: View evolution log with drift scores
 * - get_rollback_history: View rollback history
 * - check_rate_limit: Check if evolution is rate-limited for a user
 * - lock_layer: Lock a soul layer to prevent further evolution
 * - unlock_layer: Unlock a soul layer
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Safety thresholds
const MAX_DRIFT_SCORE = 0.6;           // Block evolution above this drift
const MAX_EVOLUTIONS_PER_DAY = 2;      // Rate limit: max evolutions per 24h
const MAX_TOKEN_DELTA_PERCENT = 50;    // Flag if token count changes by >50%
const MAX_FIELDS_CHANGED_PER_CYCLE = 5; // Block if >5 fields change at once

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      userId = payload.sub;
      if (!userId) throw new Error("No sub");
    } catch {
      return json({ error: "Invalid token" }, 401);
    }

    const body = await req.json();
    const { action, ...params } = body;

    switch (action) {
      case "check_drift":
        return json(await checkDrift(supabase, userId, params));
      case "rollback":
        return json(await rollback(supabase, userId, params));
      case "get_evolution_history":
        return json(await getEvolutionHistory(supabase, userId, params));
      case "get_rollback_history":
        return json(await getRollbackHistory(supabase, userId, params));
      case "check_rate_limit":
        return json(await checkRateLimit(supabase, userId));
      case "lock_layer":
        return json(await setLayerLock(supabase, userId, params.layer_type, true));
      case "unlock_layer":
        return json(await setLayerLock(supabase, userId, params.layer_type, false));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("olive-soul-safety error:", err);
    return json({ error: "Internal error" }, 500);
  }
});

// ─── Drift Detection ──────────────────────────────────────────

interface DriftResult {
  drift_score: number;     // 0.0 to 1.0
  fields_changed: string[];
  token_delta: number;
  token_delta_percent: number;
  is_safe: boolean;
  blocked_reasons: string[];
  details: Record<string, any>;
}

async function checkDrift(
  supabase: any,
  userId: string,
  params: { layer_type?: string; before_content?: Record<string, any>; after_content?: Record<string, any> }
): Promise<DriftResult> {
  const layerType = params.layer_type || "user";

  let before = params.before_content;
  let after = params.after_content;

  // If not provided, compare current vs previous version
  if (!before || !after) {
    const { data: layer } = await supabase
      .from("olive_soul_layers")
      .select("id, content, token_count, version")
      .eq("layer_type", layerType)
      .eq("owner_type", "user")
      .eq("owner_id", userId)
      .maybeSingle();

    if (!layer) {
      return {
        drift_score: 0,
        fields_changed: [],
        token_delta: 0,
        token_delta_percent: 0,
        is_safe: true,
        blocked_reasons: [],
        details: { message: "No soul layer found" },
      };
    }

    after = after || layer.content;

    // Get previous version
    const { data: prevVersion } = await supabase
      .from("olive_soul_versions")
      .select("content, content_rendered")
      .eq("layer_id", layer.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    before = before || prevVersion?.content || {};
  }

  // Compute drift
  const fieldsChanged = computeFieldsChanged(before, after);
  const beforeTokens = estimateTokens(JSON.stringify(before));
  const afterTokens = estimateTokens(JSON.stringify(after));
  const tokenDelta = afterTokens - beforeTokens;
  const tokenDeltaPercent = beforeTokens > 0
    ? Math.abs(tokenDelta / beforeTokens) * 100
    : 0;

  // Compute semantic drift score (0-1)
  const totalFields = new Set([...Object.keys(before), ...Object.keys(after)]).size;
  const fieldDrift = totalFields > 0 ? fieldsChanged.length / totalFields : 0;
  const tokenDrift = Math.min(1, tokenDeltaPercent / 100);
  const driftScore = Math.min(1, (fieldDrift * 0.6 + tokenDrift * 0.4));

  // Check safety
  const blockedReasons: string[] = [];
  if (driftScore > MAX_DRIFT_SCORE) {
    blockedReasons.push(`Drift score ${driftScore.toFixed(2)} exceeds threshold ${MAX_DRIFT_SCORE}`);
  }
  if (fieldsChanged.length > MAX_FIELDS_CHANGED_PER_CYCLE) {
    blockedReasons.push(`${fieldsChanged.length} fields changed exceeds limit of ${MAX_FIELDS_CHANGED_PER_CYCLE}`);
  }
  if (tokenDeltaPercent > MAX_TOKEN_DELTA_PERCENT) {
    blockedReasons.push(`Token count changed by ${tokenDeltaPercent.toFixed(0)}% (limit: ${MAX_TOKEN_DELTA_PERCENT}%)`);
  }

  return {
    drift_score: Math.round(driftScore * 100) / 100,
    fields_changed: fieldsChanged,
    token_delta: tokenDelta,
    token_delta_percent: Math.round(tokenDeltaPercent * 10) / 10,
    is_safe: blockedReasons.length === 0,
    blocked_reasons: blockedReasons,
    details: {
      before_tokens: beforeTokens,
      after_tokens: afterTokens,
      field_drift: Math.round(fieldDrift * 100) / 100,
      token_drift: Math.round(tokenDrift * 100) / 100,
    },
  };
}

// ─── Rollback ─────────────────────────────────────────────────

async function rollback(
  supabase: any,
  userId: string,
  params: { layer_type?: string; to_version?: number; reason?: string }
) {
  const layerType = params.layer_type || "user";
  const reason = params.reason || "user_request";

  // Get current layer
  const { data: layer } = await supabase
    .from("olive_soul_layers")
    .select("id, version, content, content_rendered, token_count")
    .eq("layer_type", layerType)
    .eq("owner_type", "user")
    .eq("owner_id", userId)
    .maybeSingle();

  if (!layer) return { error: "Soul layer not found" };

  // Get target version
  let targetVersion = params.to_version;
  if (!targetVersion) {
    // Default: roll back to previous version
    targetVersion = layer.version - 1;
  }

  if (targetVersion <= 0) return { error: "Cannot rollback below version 1" };
  if (targetVersion >= layer.version) return { error: "Target version must be older than current" };

  // Fetch the target version content
  const { data: versionData } = await supabase
    .from("olive_soul_versions")
    .select("content, content_rendered, version")
    .eq("layer_id", layer.id)
    .eq("version", targetVersion)
    .maybeSingle();

  if (!versionData) return { error: `Version ${targetVersion} not found in history` };

  // Create rollback record
  const { data: rollbackRecord } = await supabase
    .from("olive_soul_rollbacks")
    .insert({
      user_id: userId,
      layer_id: layer.id,
      layer_type: layerType,
      from_version: layer.version,
      to_version: targetVersion,
      reason,
      requested_by: reason === "drift_exceeded" || reason === "safety_violation" ? "system" : "user",
      status: "pending",
    })
    .select("id")
    .single();

  // Store current as a version snapshot before rollback
  await supabase.from("olive_soul_versions").insert({
    layer_id: layer.id,
    version: layer.version,
    content: layer.content,
    content_rendered: layer.content_rendered,
    change_summary: `Pre-rollback snapshot (rolling back to v${targetVersion})`,
    trigger: "manual",
  });

  // Apply the rollback
  const newVersion = layer.version + 1;
  const { error: updateError } = await supabase
    .from("olive_soul_layers")
    .update({
      content: versionData.content,
      content_rendered: versionData.content_rendered,
      token_count: estimateTokens(versionData.content_rendered || JSON.stringify(versionData.content)),
      version: newVersion,
      evolved_at: new Date().toISOString(),
    })
    .eq("id", layer.id);

  if (updateError) {
    await supabase
      .from("olive_soul_rollbacks")
      .update({ status: "failed", error_message: updateError.message })
      .eq("id", rollbackRecord.id);
    return { error: updateError.message };
  }

  // Mark rollback as applied
  await supabase
    .from("olive_soul_rollbacks")
    .update({ status: "applied", applied_at: new Date().toISOString() })
    .eq("id", rollbackRecord.id);

  // Log in evolution history
  await supabase.from("olive_soul_evolution_log").insert({
    user_id: userId,
    layer_type: layerType,
    was_rollback: true,
    rollback_reason: reason,
    rollback_to_version: targetVersion,
    pre_snapshot_version: layer.version,
    post_snapshot_version: newVersion,
    trigger: "manual",
    changes_summary: [`Rolled back from v${layer.version} to v${targetVersion}: ${reason}`],
  });

  return {
    success: true,
    from_version: layer.version,
    to_version: targetVersion,
    new_version: newVersion,
  };
}

// ─── Evolution History ────────────────────────────────────────

async function getEvolutionHistory(
  supabase: any,
  userId: string,
  params: { limit?: number; layer_type?: string }
) {
  let query = supabase
    .from("olive_soul_evolution_log")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(params.limit || 10);

  if (params.layer_type) {
    query = query.eq("layer_type", params.layer_type);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };

  return { history: data || [] };
}

// ─── Rollback History ─────────────────────────────────────────

async function getRollbackHistory(
  supabase: any,
  userId: string,
  params: { limit?: number }
) {
  const { data, error } = await supabase
    .from("olive_soul_rollbacks")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(params.limit || 10);

  if (error) return { error: error.message };
  return { rollbacks: data || [] };
}

// ─── Rate Limiting ────────────────────────────────────────────

async function checkRateLimit(supabase: any, userId: string) {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count } = await supabase
    .from("olive_soul_evolution_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("was_rollback", false)
    .gte("created_at", twentyFourHoursAgo);

  const evolutionsToday = count || 0;
  const isLimited = evolutionsToday >= MAX_EVOLUTIONS_PER_DAY;

  return {
    evolutions_today: evolutionsToday,
    max_per_day: MAX_EVOLUTIONS_PER_DAY,
    is_rate_limited: isLimited,
    next_available: isLimited ? "Wait 24 hours since last evolution" : "Available now",
  };
}

// ─── Lock/Unlock Layer ────────────────────────────────────────

async function setLayerLock(supabase: any, userId: string, layerType: string, locked: boolean) {
  if (!layerType) return { error: "layer_type required" };

  // Don't allow unlocking the base layer
  if (layerType === "base" && !locked) {
    return { error: "Base layer cannot be unlocked" };
  }

  const { error } = await supabase
    .from("olive_soul_layers")
    .update({ is_locked: locked })
    .eq("layer_type", layerType)
    .eq("owner_type", layerType === "base" ? "system" : "user")
    .eq("owner_id", layerType === "base" ? null : userId);

  if (error) return { error: error.message };
  return { success: true, layer_type: layerType, is_locked: locked };
}

// ─── Helpers ──────────────────────────────────────────────────

function computeFieldsChanged(before: Record<string, any>, after: Record<string, any>): string[] {
  const changed: string[] = [];
  const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

  for (const key of allKeys) {
    const beforeVal = JSON.stringify((before || {})[key]);
    const afterVal = JSON.stringify((after || {})[key]);
    if (beforeVal !== afterVal) {
      changed.push(key);
    }
  }
  return changed;
}

function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
}
