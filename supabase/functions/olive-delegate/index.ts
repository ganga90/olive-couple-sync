/**
 * Olive Delegate — Agentic Task Delegation Engine
 *
 * Handles task routing and delegation between space members:
 * - create: Create a new delegation (user or Olive-initiated)
 * - accept: Delegatee accepts the task
 * - snooze: Delegatee defers (with snooze-until)
 * - reassign: Delegatee passes to someone else
 * - decline: Delegatee declines
 * - complete: Mark delegation as done
 * - cancel: Delegator cancels
 * - list_incoming: Get delegations assigned to me
 * - list_outgoing: Get delegations I created
 * - smart_route: Olive suggests who should handle a task
 * - who_needs_to_know: Identify who should be notified about changes
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
      case "create":
        return json(await createDelegation(supabase, userId, params));
      case "accept":
        return json(await respondToDelegation(supabase, userId, params.id, "accepted", params));
      case "snooze":
        return json(await snoozeDelegation(supabase, userId, params.id, params));
      case "reassign":
        return json(await reassignDelegation(supabase, userId, params.id, params));
      case "decline":
        return json(await respondToDelegation(supabase, userId, params.id, "declined", params));
      case "complete":
        return json(await completeDelegation(supabase, userId, params.id, params));
      case "cancel":
        return json(await cancelDelegation(supabase, userId, params.id));
      case "list_incoming":
        return json(await listIncoming(supabase, userId, params));
      case "list_outgoing":
        return json(await listOutgoing(supabase, userId, params));
      case "smart_route":
        return json(await smartRoute(supabase, userId, params));
      case "who_needs_to_know":
        return json(await whoNeedsToKnow(supabase, userId, params));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("olive-delegate error:", err);
    return json({ error: "Internal error" }, 500);
  }
});

// ─── Create Delegation ────────────────────────────────────────

interface CreateParams {
  space_id: string;
  delegated_to: string;
  title: string;
  description?: string;
  priority?: string;
  note_id?: string;
  suggested_by?: string;
  reasoning?: string;
  agent_execution_id?: string;
  notify_whatsapp?: boolean;
}

async function createDelegation(supabase: any, userId: string, params: CreateParams) {
  const { space_id, delegated_to, title, description, priority, note_id, suggested_by, reasoning, agent_execution_id } = params;

  if (!space_id || !delegated_to || !title) {
    return { error: "space_id, delegated_to, and title are required" };
  }

  // Verify both users are members of the space
  const { data: members } = await supabase
    .from("olive_space_members")
    .select("user_id")
    .eq("space_id", space_id)
    .in("user_id", [userId, delegated_to]);

  if (!members || members.length < 2) {
    return { error: "Both users must be members of the space" };
  }

  const { data: delegation, error } = await supabase
    .from("olive_delegations")
    .insert({
      space_id,
      delegated_by: userId,
      delegated_to,
      title,
      description: description || null,
      priority: priority || "normal",
      note_id: note_id || null,
      suggested_by: suggested_by || "user",
      reasoning: reasoning || null,
      agent_execution_id: agent_execution_id || null,
      notified_via: ["app"],
    })
    .select()
    .single();

  if (error) return { error: error.message };

  // Log engagement event
  await supabase.from("olive_engagement_events").insert({
    user_id: userId,
    event_type: "delegation_created",
    metadata: { delegation_id: delegation.id, delegated_to, title },
  });

  // Notify delegatee via WhatsApp if requested and connected
  if (params.notify_whatsapp) {
    await notifyViaWhatsApp(supabase, delegated_to, delegation);
  }

  return { success: true, delegation };
}

// ─── Respond (Accept / Decline) ───────────────────────────────

async function respondToDelegation(
  supabase: any,
  userId: string,
  delegationId: string,
  newStatus: "accepted" | "declined",
  params: { response_note?: string }
) {
  if (!delegationId) return { error: "id is required" };

  const { data: existing } = await supabase
    .from("olive_delegations")
    .select("*")
    .eq("id", delegationId)
    .single();

  if (!existing) return { error: "Delegation not found" };
  if (existing.delegated_to !== userId && existing.reassigned_to !== userId) {
    return { error: "You are not the delegatee" };
  }
  if (existing.status !== "pending" && existing.status !== "snoozed") {
    return { error: `Cannot ${newStatus} a delegation with status: ${existing.status}` };
  }

  const { error } = await supabase
    .from("olive_delegations")
    .update({
      status: newStatus,
      response_note: params.response_note || null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", delegationId);

  if (error) return { error: error.message };

  // Log engagement event
  await supabase.from("olive_engagement_events").insert({
    user_id: userId,
    event_type: newStatus === "accepted" ? "delegation_accepted" : "delegation_declined",
    metadata: { delegation_id: delegationId },
  });

  return { success: true, status: newStatus };
}

// ─── Snooze ───────────────────────────────────────────────────

async function snoozeDelegation(
  supabase: any,
  userId: string,
  delegationId: string,
  params: { snoozed_until?: string; response_note?: string }
) {
  if (!delegationId) return { error: "id is required" };

  const { data: existing } = await supabase
    .from("olive_delegations")
    .select("delegated_to, reassigned_to, status")
    .eq("id", delegationId)
    .single();

  if (!existing) return { error: "Delegation not found" };
  if (existing.delegated_to !== userId && existing.reassigned_to !== userId) {
    return { error: "You are not the delegatee" };
  }
  if (existing.status !== "pending") {
    return { error: "Can only snooze pending delegations" };
  }

  // Default snooze: 4 hours from now
  const snoozeUntil = params.snoozed_until || new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("olive_delegations")
    .update({
      status: "snoozed",
      snoozed_until: snoozeUntil,
      response_note: params.response_note || null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", delegationId);

  if (error) return { error: error.message };

  await supabase.from("olive_engagement_events").insert({
    user_id: userId,
    event_type: "delegation_snoozed",
    metadata: { delegation_id: delegationId, snoozed_until: snoozeUntil },
  });

  return { success: true, status: "snoozed", snoozed_until: snoozeUntil };
}

// ─── Reassign ─────────────────────────────────────────────────

async function reassignDelegation(
  supabase: any,
  userId: string,
  delegationId: string,
  params: { reassign_to: string; reason?: string }
) {
  if (!delegationId || !params.reassign_to) {
    return { error: "id and reassign_to are required" };
  }

  const { data: existing } = await supabase
    .from("olive_delegations")
    .select("*")
    .eq("id", delegationId)
    .single();

  if (!existing) return { error: "Delegation not found" };
  if (existing.delegated_to !== userId && existing.reassigned_to !== userId) {
    return { error: "You are not the delegatee" };
  }
  if (!["pending", "accepted", "snoozed"].includes(existing.status)) {
    return { error: "Cannot reassign with current status" };
  }

  // Verify new assignee is in the space
  const { data: member } = await supabase
    .from("olive_space_members")
    .select("user_id")
    .eq("space_id", existing.space_id)
    .eq("user_id", params.reassign_to)
    .maybeSingle();

  if (!member) return { error: "Target user is not a member of this space" };

  const { error } = await supabase
    .from("olive_delegations")
    .update({
      status: "reassigned",
      reassigned_to: params.reassign_to,
      reassign_reason: params.reason || null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", delegationId);

  if (error) return { error: error.message };

  // Create a new delegation for the reassigned person
  const { data: newDelegation } = await supabase
    .from("olive_delegations")
    .insert({
      space_id: existing.space_id,
      delegated_by: existing.delegated_by,
      delegated_to: params.reassign_to,
      title: existing.title,
      description: existing.description,
      priority: existing.priority,
      note_id: existing.note_id,
      suggested_by: "reassignment",
      reasoning: `Reassigned from ${userId}: ${params.reason || "no reason given"}`,
      notified_via: ["app"],
    })
    .select()
    .single();

  await supabase.from("olive_engagement_events").insert({
    user_id: userId,
    event_type: "delegation_reassigned",
    metadata: { delegation_id: delegationId, reassigned_to: params.reassign_to },
  });

  return { success: true, status: "reassigned", new_delegation: newDelegation };
}

// ─── Complete ─────────────────────────────────────────────────

async function completeDelegation(
  supabase: any,
  userId: string,
  delegationId: string,
  params: { response_note?: string }
) {
  if (!delegationId) return { error: "id is required" };

  const { data: existing } = await supabase
    .from("olive_delegations")
    .select("delegated_to, reassigned_to, status")
    .eq("id", delegationId)
    .single();

  if (!existing) return { error: "Delegation not found" };
  if (existing.delegated_to !== userId && existing.reassigned_to !== userId) {
    return { error: "You are not the delegatee" };
  }
  if (existing.status !== "accepted") {
    return { error: "Can only complete accepted delegations" };
  }

  const { error } = await supabase
    .from("olive_delegations")
    .update({
      status: "completed",
      response_note: params.response_note || null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", delegationId);

  if (error) return { error: error.message };

  await supabase.from("olive_engagement_events").insert({
    user_id: userId,
    event_type: "delegation_completed",
    metadata: { delegation_id: delegationId },
  });

  return { success: true, status: "completed" };
}

// ─── Cancel ───────────────────────────────────────────────────

async function cancelDelegation(supabase: any, userId: string, delegationId: string) {
  if (!delegationId) return { error: "id is required" };

  const { data: existing } = await supabase
    .from("olive_delegations")
    .select("delegated_by, status")
    .eq("id", delegationId)
    .single();

  if (!existing) return { error: "Delegation not found" };
  if (existing.delegated_by !== userId) {
    return { error: "Only the delegator can cancel" };
  }
  if (existing.status === "completed" || existing.status === "cancelled") {
    return { error: "Cannot cancel a completed or already cancelled delegation" };
  }

  const { error } = await supabase
    .from("olive_delegations")
    .update({ status: "cancelled" })
    .eq("id", delegationId);

  if (error) return { error: error.message };

  return { success: true, status: "cancelled" };
}

// ─── List Incoming ────────────────────────────────────────────

async function listIncoming(
  supabase: any,
  userId: string,
  params: { status?: string; space_id?: string; limit?: number }
) {
  let query = supabase
    .from("olive_delegations")
    .select("*")
    .or(`delegated_to.eq.${userId},reassigned_to.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(params.limit || 20);

  if (params.status) {
    query = query.eq("status", params.status);
  } else {
    // Default: show active delegations
    query = query.in("status", ["pending", "accepted", "snoozed"]);
  }

  if (params.space_id) {
    query = query.eq("space_id", params.space_id);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };

  // Enrich with display names
  const userIds = new Set<string>();
  (data || []).forEach((d: any) => {
    userIds.add(d.delegated_by);
    userIds.add(d.delegated_to);
    if (d.reassigned_to) userIds.add(d.reassigned_to);
  });

  const nameMap = await getUserNames(supabase, Array.from(userIds));

  const enriched = (data || []).map((d: any) => ({
    ...d,
    delegated_by_name: nameMap[d.delegated_by] || "Unknown",
    delegated_to_name: nameMap[d.delegated_to] || "Unknown",
    reassigned_to_name: d.reassigned_to ? nameMap[d.reassigned_to] || "Unknown" : null,
  }));

  return { delegations: enriched };
}

// ─── List Outgoing ────────────────────────────────────────────

async function listOutgoing(
  supabase: any,
  userId: string,
  params: { status?: string; space_id?: string; limit?: number }
) {
  let query = supabase
    .from("olive_delegations")
    .select("*")
    .eq("delegated_by", userId)
    .order("created_at", { ascending: false })
    .limit(params.limit || 20);

  if (params.status) {
    query = query.eq("status", params.status);
  }
  if (params.space_id) {
    query = query.eq("space_id", params.space_id);
  }

  const { data, error } = await query;
  if (error) return { error: error.message };

  const userIds = new Set<string>();
  (data || []).forEach((d: any) => {
    userIds.add(d.delegated_by);
    userIds.add(d.delegated_to);
    if (d.reassigned_to) userIds.add(d.reassigned_to);
  });

  const nameMap = await getUserNames(supabase, Array.from(userIds));

  const enriched = (data || []).map((d: any) => ({
    ...d,
    delegated_by_name: nameMap[d.delegated_by] || "Unknown",
    delegated_to_name: nameMap[d.delegated_to] || "Unknown",
    reassigned_to_name: d.reassigned_to ? nameMap[d.reassigned_to] || "Unknown" : null,
  }));

  return { delegations: enriched };
}

// ─── Smart Route ──────────────────────────────────────────────
// "Who should handle this?" — Olive analyzes space members' workload,
// skills, and recent activity to suggest the best assignee.

async function smartRoute(
  supabase: any,
  userId: string,
  params: { space_id: string; task_title: string; task_description?: string; category?: string }
) {
  const { space_id, task_title, task_description, category } = params;
  if (!space_id || !task_title) {
    return { error: "space_id and task_title are required" };
  }

  // Get space members
  const { data: members } = await supabase
    .from("olive_space_members")
    .select("user_id, role")
    .eq("space_id", space_id);

  if (!members || members.length === 0) {
    return { error: "No members in this space" };
  }

  const memberIds = members.map((m: any) => m.user_id);
  const nameMap = await getUserNames(supabase, memberIds);

  // Get current delegation load per member
  const { data: activeDelegations } = await supabase
    .from("olive_delegations")
    .select("delegated_to")
    .eq("space_id", space_id)
    .in("status", ["pending", "accepted"])
    .in("delegated_to", memberIds);

  const loadMap: Record<string, number> = {};
  memberIds.forEach((id: string) => { loadMap[id] = 0; });
  (activeDelegations || []).forEach((d: any) => {
    loadMap[d.delegated_to] = (loadMap[d.delegated_to] || 0) + 1;
  });

  // Get recent task completions (last 30 days) per member — as a competence signal
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: completedTasks } = await supabase
    .from("clerk_notes")
    .select("task_owner")
    .eq("is_task", true)
    .eq("status", "completed")
    .gte("updated_at", thirtyDaysAgo)
    .in("task_owner", memberIds);

  const completionMap: Record<string, number> = {};
  memberIds.forEach((id: string) => { completionMap[id] = 0; });
  (completedTasks || []).forEach((t: any) => {
    if (t.task_owner) {
      completionMap[t.task_owner] = (completionMap[t.task_owner] || 0) + 1;
    }
  });

  // Score each member: lower load + higher completions = better candidate
  // Exclude the requesting user by default (they're asking "who else?")
  const candidates = memberIds
    .filter((id: string) => id !== userId)
    .map((id: string) => {
      const load = loadMap[id] || 0;
      const completions = completionMap[id] || 0;
      // Score: higher is better. Penalize high load, reward completions.
      const score = Math.max(0, 100 - (load * 15) + (completions * 3));
      return {
        user_id: id,
        name: nameMap[id] || "Unknown",
        role: members.find((m: any) => m.user_id === id)?.role || "member",
        active_delegations: load,
        recent_completions: completions,
        score,
      };
    })
    .sort((a: any, b: any) => b.score - a.score);

  return {
    suggestions: candidates,
    top_suggestion: candidates.length > 0 ? candidates[0] : null,
    reasoning: candidates.length > 0
      ? `${candidates[0].name} has the lightest workload (${candidates[0].active_delegations} active tasks) and ${candidates[0].recent_completions} completions in the last 30 days.`
      : "No other members available to delegate to.",
  };
}

// ─── Who Needs to Know ────────────────────────────────────────
// Given a change (note update, task completion, etc.), determine
// which space members should be notified.

async function whoNeedsToKnow(
  supabase: any,
  userId: string,
  params: { space_id: string; event_type: string; entity_id?: string; entity_title?: string }
) {
  const { space_id, event_type, entity_id, entity_title } = params;
  if (!space_id || !event_type) {
    return { error: "space_id and event_type are required" };
  }

  // Get all space members except the actor
  const { data: members } = await supabase
    .from("olive_space_members")
    .select("user_id, role")
    .eq("space_id", space_id)
    .neq("user_id", userId);

  if (!members || members.length === 0) {
    return { notify: [] };
  }

  const memberIds = members.map((m: any) => m.user_id);
  const nameMap = await getUserNames(supabase, memberIds);

  // Determine who should be notified based on event type
  const notifyList: Array<{ user_id: string; name: string; reason: string; channel: string }> = [];

  for (const member of members) {
    const name = nameMap[member.user_id] || "Unknown";
    let reason = "";
    let channel = "app"; // default notification channel

    switch (event_type) {
      case "task_completed":
        // Notify if they delegated this task or are assigned
        if (entity_id) {
          const { data: delegation } = await supabase
            .from("olive_delegations")
            .select("delegated_by")
            .eq("note_id", entity_id)
            .eq("delegated_by", member.user_id)
            .maybeSingle();
          if (delegation) {
            reason = "Delegated this task";
            channel = "whatsapp";
          }
        }
        // Admins always get notified of completions
        if (!reason && member.role === "admin") {
          reason = "Space admin";
        }
        break;

      case "task_created":
      case "note_updated":
        // Notify mentioned users and admins
        if (member.role === "admin") {
          reason = "Space admin";
        }
        break;

      case "delegation_response":
        // Notify the original delegator (handled by the delegation flow itself)
        break;

      case "urgent_task":
        // Everyone gets notified for urgent items
        reason = "Urgent task in shared space";
        channel = "whatsapp";
        break;

      default:
        // Admins get all notifications
        if (member.role === "admin") {
          reason = "Space admin";
        }
    }

    if (reason) {
      notifyList.push({ user_id: member.user_id, name, reason, channel });
    }
  }

  return { notify: notifyList, event_type, entity_title };
}

// ─── Helpers ──────────────────────────────────────────────────

async function getUserNames(supabase: any, userIds: string[]): Promise<Record<string, string>> {
  if (userIds.length === 0) return {};

  const { data: profiles } = await supabase
    .from("clerk_profiles")
    .select("user_id, display_name, first_name")
    .in("user_id", userIds);

  const map: Record<string, string> = {};
  (profiles || []).forEach((p: any) => {
    map[p.user_id] = p.display_name || p.first_name || "Unknown";
  });
  return map;
}

async function notifyViaWhatsApp(supabase: any, recipientUserId: string, delegation: any) {
  try {
    // Check if user has WhatsApp connected
    const { data: profile } = await supabase
      .from("clerk_profiles")
      .select("phone_number, display_name")
      .eq("user_id", recipientUserId)
      .maybeSingle();

    if (!profile?.phone_number) return;

    // Send via gateway
    await supabase.functions.invoke("whatsapp-gateway", {
      body: {
        action: "send",
        message: {
          user_id: recipientUserId,
          message_type: "task_update",
          content: `📋 New task delegated to you: "${delegation.title}"${delegation.priority === "urgent" ? " ⚡ URGENT" : ""}. Reply with ✅ to accept, ⏰ to snooze, or ❌ to decline.`,
          priority: delegation.priority === "urgent" ? "high" : "normal",
          metadata: {
            delegation_id: delegation.id,
            type: "delegation_notification",
          },
        },
      },
    });

    // Update notified_via
    await supabase
      .from("olive_delegations")
      .update({
        notified_via: ["app", "whatsapp"],
        last_notified_at: new Date().toISOString(),
      })
      .eq("id", delegation.id);
  } catch (err) {
    console.error("WhatsApp notification failed:", err);
  }
}
