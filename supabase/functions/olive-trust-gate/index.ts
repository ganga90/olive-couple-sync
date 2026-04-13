/**
 * olive-trust-gate — Trust enforcement layer.
 *
 * Called before executing any action to check the user's trust matrix.
 * If trust level is insufficient, queues the action for user approval.
 * Also handles approve/reject flows and pending action management.
 *
 * Actions:
 *   - check         : Check trust level for an action type. Returns { allowed, trust_level, action_id? }
 *   - approve       : User approves a pending action
 *   - reject        : User rejects a pending action
 *   - list_pending   : Get all pending actions for the user
 *   - adjust_trust   : User manually adjusts trust level for an action type
 *   - get_trust_matrix : Get the full trust matrix for the user
 *   - get_engagement : Get engagement score and proactivity level
 *   - propose_escalation : System proposes a trust upgrade to the user
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TRUST_LEVEL_NAMES: Record<number, string> = {
  0: "Inform Only",
  1: "Suggest",
  2: "Act & Report",
  3: "Autonomous",
};

// Actions that should NEVER be fully autonomous (max level 2)
const HIGH_RISK_ACTIONS = new Set([
  "send_whatsapp_to_client",
  "send_invoice",
  "book_appointment",
  "delete_note",
  "modify_budget",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

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
      case "check":
        return json(await checkTrust(supabase, userId, params));
      case "approve":
        return json(await approveAction(supabase, userId, params));
      case "reject":
        return json(await rejectAction(supabase, userId, params));
      case "list_pending":
        return json(await listPending(supabase, userId, params));
      case "adjust_trust":
        return json(await adjustTrust(supabase, userId, params));
      case "get_trust_matrix":
        return json(await getTrustMatrix(supabase, userId));
      case "get_engagement":
        return json(await getEngagement(supabase, userId));
      case "propose_escalation":
        return json(await proposeEscalation(supabase, userId, params));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("[olive-trust-gate] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── Get trust matrix from soul layer ───────────────────────────
async function getUserTrustMatrix(
  supabase: any,
  userId: string
): Promise<Record<string, number>> {
  const { data } = await supabase
    .from("olive_soul_layers")
    .select("content")
    .eq("layer_type", "trust")
    .eq("owner_type", "user")
    .eq("owner_id", userId)
    .maybeSingle();

  if (!data?.content?.trust_matrix) {
    // Return sensible defaults if no trust layer exists
    return {
      categorize_note: 3,
      create_reminder: 3,
      create_task: 3,
      process_receipt: 3,
      save_memory: 3,
      send_whatsapp_to_self: 2,
      assign_task: 1,
      send_whatsapp_to_partner: 1,
      modify_budget: 1,
      delete_note: 1,
      send_whatsapp_to_client: 0,
      send_invoice: 0,
      book_appointment: 0,
    };
  }

  return data.content.trust_matrix;
}

// ─── Check Trust (core gate function) ───────────────────────────
async function checkTrust(supabase: any, userId: string, params: any) {
  const { action_type, action_payload, action_description, space_id, trigger_type } = params;
  if (!action_type) return { error: "action_type is required" };

  const matrix = await getUserTrustMatrix(supabase, userId);
  const trustLevel = matrix[action_type] ?? 0; // Unknown actions default to INFORM
  const requiredLevel = 2; // Minimum level for auto-execution

  // Level 3 (Autonomous) or Level 2 (Act & Report): execute immediately
  if (trustLevel >= requiredLevel) {
    return {
      allowed: true,
      trust_level: trustLevel,
      trust_level_name: TRUST_LEVEL_NAMES[trustLevel],
      action_type,
    };
  }

  // Level 0 (Inform) or Level 1 (Suggest): queue for approval
  const { data: queuedAction, error } = await supabase
    .from("olive_trust_actions")
    .insert({
      user_id: userId,
      space_id: space_id || null,
      action_type,
      action_payload: action_payload || {},
      action_description: action_description || `Olive wants to: ${action_type}`,
      trust_level: trustLevel,
      required_level: requiredLevel,
      trigger_type: trigger_type || "proactive",
      trigger_context: params.trigger_context || {},
    })
    .select()
    .single();

  if (error) {
    console.error("[checkTrust] Queue error:", error);
    return { error: "Failed to queue action" };
  }

  // Create a notification for the user
  const notifTitle =
    trustLevel === 0
      ? `Olive found something: ${action_description}`
      : `Olive suggests: ${action_description}`;

  await supabase.from("olive_trust_notifications").insert({
    user_id: userId,
    type: "action_approval",
    title: notifTitle,
    body:
      trustLevel === 0
        ? `I noticed this and wanted to let you know. Would you like me to proceed?`
        : `I think this would be helpful. Shall I go ahead?`,
    metadata: {
      action_type,
      action_id: queuedAction.id,
      trust_level: trustLevel,
    },
    trust_action_id: queuedAction.id,
  });

  return {
    allowed: false,
    trust_level: trustLevel,
    trust_level_name: TRUST_LEVEL_NAMES[trustLevel],
    action_type,
    action_id: queuedAction.id,
    message:
      trustLevel === 0
        ? "This action requires your explicit approval."
        : "Olive suggests this action. Would you like to proceed?",
  };
}

// ─── Approve Action ─────────────────────────────────────────────
async function approveAction(supabase: any, userId: string, params: any) {
  const { action_id, user_response } = params;
  if (!action_id) return { error: "action_id is required" };

  // Get the pending action
  const { data: trustAction, error: fetchError } = await supabase
    .from("olive_trust_actions")
    .select("*")
    .eq("id", action_id)
    .eq("user_id", userId)
    .eq("status", "pending")
    .single();

  if (fetchError || !trustAction) {
    return { error: "Pending action not found" };
  }

  // Mark as approved
  const { error: updateError } = await supabase
    .from("olive_trust_actions")
    .update({
      status: "approved",
      user_response: user_response || null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", action_id);

  if (updateError) return { error: "Failed to approve action" };

  // Record reflection: accepted
  await supabase.from("olive_reflections").insert({
    user_id: userId,
    space_id: trustAction.space_id,
    action_type: trustAction.action_type,
    action_detail: {
      description: trustAction.action_description,
      payload: trustAction.action_payload,
    },
    outcome: user_response ? "modified" : "accepted",
    user_modification: user_response || null,
    confidence: 0.7,
  });

  // Record engagement event
  await supabase.from("olive_engagement_events").insert({
    user_id: userId,
    event_type: "action_approved",
    metadata: { action_type: trustAction.action_type, action_id },
  });

  // Mark notification as acted on
  await supabase
    .from("olive_trust_notifications")
    .update({ acted_on_at: new Date().toISOString() })
    .eq("trust_action_id", action_id);

  return {
    success: true,
    action: trustAction,
    message: "Action approved. Olive will proceed.",
  };
}

// ─── Reject Action ──────────────────────────────────────────────
async function rejectAction(supabase: any, userId: string, params: any) {
  const { action_id, reason } = params;
  if (!action_id) return { error: "action_id is required" };

  const { data: trustAction, error: fetchError } = await supabase
    .from("olive_trust_actions")
    .select("*")
    .eq("id", action_id)
    .eq("user_id", userId)
    .eq("status", "pending")
    .single();

  if (fetchError || !trustAction) {
    return { error: "Pending action not found" };
  }

  await supabase
    .from("olive_trust_actions")
    .update({
      status: "rejected",
      user_response: reason || null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", action_id);

  // Record reflection: rejected
  await supabase.from("olive_reflections").insert({
    user_id: userId,
    space_id: trustAction.space_id,
    action_type: trustAction.action_type,
    action_detail: {
      description: trustAction.action_description,
      payload: trustAction.action_payload,
    },
    outcome: "rejected",
    user_modification: reason || null,
    lesson: reason ? `User rejected because: ${reason}` : null,
    confidence: 0.8,
  });

  // Record engagement event
  await supabase.from("olive_engagement_events").insert({
    user_id: userId,
    event_type: "action_rejected",
    metadata: { action_type: trustAction.action_type, action_id, reason },
  });

  // Mark notification as acted on
  await supabase
    .from("olive_trust_notifications")
    .update({ acted_on_at: new Date().toISOString() })
    .eq("trust_action_id", action_id);

  return {
    success: true,
    message: "Action rejected. Olive will learn from this.",
  };
}

// ─── List Pending Actions ───────────────────────────────────────
async function listPending(supabase: any, userId: string, params: any) {
  const { limit = 10 } = params;

  // First expire old actions
  await supabase.rpc("expire_old_trust_actions").catch(() => {});

  const { data, error } = await supabase
    .from("olive_trust_actions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { error: "Failed to fetch pending actions" };

  return { actions: data || [], count: data?.length || 0 };
}

// ─── Adjust Trust Level ─────────────────────────────────────────
async function adjustTrust(supabase: any, userId: string, params: any) {
  const { action_type, new_level } = params;
  if (!action_type || new_level === undefined) {
    return { error: "action_type and new_level are required" };
  }

  // Enforce safety caps
  const level = Math.max(0, Math.min(3, new_level));
  const cappedLevel = HIGH_RISK_ACTIONS.has(action_type) ? Math.min(level, 2) : level;

  // Get current trust matrix
  const matrix = await getUserTrustMatrix(supabase, userId);
  matrix[action_type] = cappedLevel;

  // Update the soul layer
  const { data: layer } = await supabase
    .from("olive_soul_layers")
    .select("id, content, version")
    .eq("layer_type", "trust")
    .eq("owner_type", "user")
    .eq("owner_id", userId)
    .maybeSingle();

  if (layer) {
    // Save version for rollback
    await supabase.from("olive_soul_versions").insert({
      layer_id: layer.id,
      version: layer.version,
      content: layer.content,
      change_summary: `User manually adjusted ${action_type} to level ${cappedLevel}`,
      trigger: "user_manual",
    });

    // Update layer
    const content = { ...layer.content, trust_matrix: matrix };
    await supabase
      .from("olive_soul_layers")
      .update({
        content,
        version: layer.version + 1,
        evolved_at: new Date().toISOString(),
      })
      .eq("id", layer.id);
  } else {
    // Create trust layer if it doesn't exist
    await supabase.from("olive_soul_layers").insert({
      layer_type: "trust",
      owner_type: "user",
      owner_id: userId,
      content: { trust_matrix: matrix },
      token_count: 100,
    });
  }

  return {
    success: true,
    action_type,
    old_level: (layer?.content?.trust_matrix || {})[action_type] ?? 0,
    new_level: cappedLevel,
    capped: cappedLevel !== level,
    level_name: TRUST_LEVEL_NAMES[cappedLevel],
  };
}

// ─── Get Trust Matrix ───────────────────────────────────────────
async function getTrustMatrix(supabase: any, userId: string) {
  const matrix = await getUserTrustMatrix(supabase, userId);

  // Enrich with metadata
  const enriched = Object.entries(matrix).map(([actionType, level]) => ({
    action_type: actionType,
    trust_level: level,
    trust_level_name: TRUST_LEVEL_NAMES[level] || "Unknown",
    is_high_risk: HIGH_RISK_ACTIONS.has(actionType),
    max_level: HIGH_RISK_ACTIONS.has(actionType) ? 2 : 3,
    label: formatActionLabel(actionType),
  }));

  return { matrix: enriched };
}

function formatActionLabel(actionType: string): string {
  return actionType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

// ─── Get Engagement Score ───────────────────────────────────────
async function getEngagement(supabase: any, userId: string) {
  // Compute fresh score
  const { data: score } = await supabase.rpc("compute_engagement_score", {
    p_user_id: userId,
  });

  // Get metrics
  const { data: metrics } = await supabase
    .from("olive_engagement_metrics")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  // Determine proactivity level
  const engagementScore = score ?? metrics?.score ?? 50;
  let proactivityLevel: string;
  let proactivityDescription: string;

  if (engagementScore >= 80) {
    proactivityLevel = "full";
    proactivityDescription = "Full proactivity. Anticipatory drafts, cross-space insights.";
  } else if (engagementScore >= 60) {
    proactivityLevel = "normal";
    proactivityDescription = "Normal proactivity. Standard nudges and digests.";
  } else if (engagementScore >= 40) {
    proactivityLevel = "conservative";
    proactivityDescription = "Conservative. Only high-confidence, high-impact suggestions.";
  } else if (engagementScore >= 20) {
    proactivityLevel = "minimal";
    proactivityDescription = "Minimal. Only urgent items like overdue deadlines.";
  } else {
    proactivityLevel = "silent";
    proactivityDescription = "Silent mode. Olive only responds when directly asked.";
  }

  return {
    score: engagementScore,
    proactivity_level: proactivityLevel,
    proactivity_description: proactivityDescription,
    metrics: metrics || null,
  };
}

// ─── Propose Trust Escalation ───────────────────────────────────
async function proposeEscalation(supabase: any, userId: string, params: any) {
  const { action_type, consecutive_accepts } = params;
  if (!action_type) return { error: "action_type is required" };

  const matrix = await getUserTrustMatrix(supabase, userId);
  const currentLevel = matrix[action_type] ?? 0;
  const maxLevel = HIGH_RISK_ACTIONS.has(action_type) ? 2 : 3;

  if (currentLevel >= maxLevel) {
    return { already_max: true, message: "Already at maximum trust level for this action." };
  }

  const proposedLevel = Math.min(currentLevel + 1, maxLevel);

  // Create notification
  await supabase.from("olive_trust_notifications").insert({
    user_id: userId,
    type: "trust_escalation",
    title: `Olive has earned more trust for "${formatActionLabel(action_type)}"`,
    body: `You've approved ${consecutive_accepts || 10}+ "${formatActionLabel(action_type)}" actions. Would you like to upgrade from "${TRUST_LEVEL_NAMES[currentLevel]}" to "${TRUST_LEVEL_NAMES[proposedLevel]}"?`,
    metadata: {
      action_type,
      current_level: currentLevel,
      proposed_level: proposedLevel,
      consecutive_accepts: consecutive_accepts || 10,
    },
  });

  return {
    success: true,
    action_type,
    current_level: currentLevel,
    proposed_level: proposedLevel,
    message: "Escalation proposal created.",
  };
}
