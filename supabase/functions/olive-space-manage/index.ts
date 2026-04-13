/**
 * olive-space-manage — Space CRUD & Membership Management
 * =========================================================
 * Handles creating, updating, and managing spaces and their members.
 * Also generates a Space Soul (Layer 2) when a space is created.
 *
 * POST /olive-space-manage
 * Body: {
 *   action: 'create' | 'update' | 'list' | 'get' | 'invite' | 'accept_invite' |
 *           'remove_member' | 'leave' | 'get_members' | 'delete',
 *   user_id: string,
 *   ...action-specific params
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertSoulLayer } from "../_shared/soul.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Space Soul Templates ───────────────────────────────────────

const SPACE_SOUL_TEMPLATES: Record<string, Record<string, any>> = {
  couple: {
    tone: "warm-playful",
    description: "A shared space for partners to stay organized and connected.",
    proactive_focus: ["shared_tasks", "budget_tracking", "date_reminders", "meal_planning"],
    dynamics: "two-person partnership with shared responsibilities",
  },
  family: {
    tone: "warm-organized",
    description: "A family space for coordinating schedules, chores, meals, and more.",
    proactive_focus: ["school_events", "chore_rotation", "meal_planning", "family_calendar", "allowance"],
    dynamics: "multi-generational family with varied needs and schedules",
  },
  household: {
    tone: "practical-fair",
    description: "A household space for managing shared living responsibilities.",
    proactive_focus: ["bill_splitting", "chore_rotation", "grocery_runs", "maintenance"],
    dynamics: "roommates or housemates sharing practical responsibilities equally",
  },
  business: {
    tone: "professional-concise",
    description: "A business space for team coordination, client management, and operations.",
    proactive_focus: ["client_followups", "deadlines", "expense_tracking", "decision_logging", "pipeline"],
    dynamics: "small team focused on deliverables and client satisfaction",
  },
  custom: {
    tone: "balanced",
    description: "A custom shared space.",
    proactive_focus: ["shared_tasks", "reminders"],
    dynamics: "a group of people working together",
  },
};

/**
 * Generate a Space Soul (Layer 2) for a newly created space.
 */
async function generateSpaceSoul(
  supabase: ReturnType<typeof createClient>,
  spaceId: string,
  spaceType: string,
  spaceName: string,
  members: Array<{ user_id: string; role: string; nickname?: string }>
): Promise<void> {
  const template = SPACE_SOUL_TEMPLATES[spaceType] || SPACE_SOUL_TEMPLATES.custom;

  const soulContent = {
    space_identity: {
      name: spaceName,
      type: spaceType,
      tone: template.tone,
      description: template.description,
    },
    group_dynamics: {
      description: template.dynamics,
      member_count: members.length,
      members: members.map((m) => ({
        user_id: m.user_id,
        role: m.role,
        nickname: m.nickname || null,
        patterns: [], // Will be learned over time
      })),
    },
    proactive_focus: template.proactive_focus,
    shared_knowledge: [], // Will be populated by observation
    space_rules: [], // Will be learned or set by owner
  };

  await upsertSoulLayer(supabase, "space", "space", spaceId, soulContent, "onboarding");
}

// ─── Action Handlers ────────────────────────────────────────────

async function handleCreate(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  params: Record<string, any>
) {
  const { name, type = "custom", icon, settings = {} } = params;

  if (!name) {
    return { error: "name is required", status: 400 };
  }

  // Create space
  const { data: space, error: spaceError } = await supabase
    .from("olive_spaces")
    .insert({
      name,
      type,
      icon: icon || null,
      settings,
      created_by: userId,
    })
    .select()
    .single();

  if (spaceError) {
    return { error: `Failed to create space: ${spaceError.message}`, status: 500 };
  }

  // Add creator as owner
  const { error: memberError } = await supabase
    .from("olive_space_members")
    .insert({
      space_id: space.id,
      user_id: userId,
      role: "owner",
      nickname: params.creator_nickname || null,
    });

  if (memberError) {
    // Rollback space creation
    await supabase.from("olive_spaces").delete().eq("id", space.id);
    return { error: `Failed to add creator as member: ${memberError.message}`, status: 500 };
  }

  // Generate Space Soul (Layer 2)
  try {
    await generateSpaceSoul(supabase, space.id, type, name, [
      { user_id: userId, role: "owner", nickname: params.creator_nickname },
    ]);
  } catch (err) {
    // Non-blocking — space still works without soul
    console.warn("[space-manage] Soul generation error (non-blocking):", err);
  }

  return {
    data: {
      ...space,
      user_role: "owner",
      member_count: 1,
    },
    status: 200,
  };
}

async function handleUpdate(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  params: Record<string, any>
) {
  const { space_id, name, icon, settings } = params;

  if (!space_id) {
    return { error: "space_id is required", status: 400 };
  }

  // Verify user is owner or admin
  const { data: membership } = await supabase
    .from("olive_space_members")
    .select("role")
    .eq("space_id", space_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { error: "Only owners and admins can update spaces", status: 403 };
  }

  const updates: Record<string, any> = { updated_at: new Date().toISOString() };
  if (name !== undefined) updates.name = name;
  if (icon !== undefined) updates.icon = icon;
  if (settings !== undefined) updates.settings = settings;

  const { data, error } = await supabase
    .from("olive_spaces")
    .update(updates)
    .eq("id", space_id)
    .select()
    .single();

  if (error) {
    return { error: `Failed to update space: ${error.message}`, status: 500 };
  }

  return { data, status: 200 };
}

async function handleList(
  supabase: ReturnType<typeof createClient>,
  userId: string
) {
  // Get all spaces for this user with their role and member count
  const { data: memberships, error } = await supabase
    .from("olive_space_members")
    .select(`
      role,
      space_id,
      olive_spaces!inner (
        id, name, type, icon, max_members, settings,
        couple_id, created_by, created_at, updated_at
      )
    `)
    .eq("user_id", userId);

  if (error) {
    return { error: `Failed to list spaces: ${error.message}`, status: 500 };
  }

  // Get member counts
  const spaces = await Promise.all(
    (memberships || []).map(async (m: any) => {
      const space = m.olive_spaces;
      const { count } = await supabase
        .from("olive_space_members")
        .select("id", { count: "exact", head: true })
        .eq("space_id", space.id);

      return {
        ...space,
        user_role: m.role,
        member_count: count || 0,
      };
    })
  );

  return { data: spaces, status: 200 };
}

async function handleGet(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  params: Record<string, any>
) {
  const { space_id } = params;

  if (!space_id) {
    return { error: "space_id is required", status: 400 };
  }

  // Verify membership
  const { data: membership } = await supabase
    .from("olive_space_members")
    .select("role")
    .eq("space_id", space_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return { error: "Not a member of this space", status: 403 };
  }

  const { data: space, error } = await supabase
    .from("olive_spaces")
    .select("*")
    .eq("id", space_id)
    .single();

  if (error) {
    return { error: `Failed to get space: ${error.message}`, status: 500 };
  }

  // Get members
  const { data: members } = await supabase
    .from("olive_space_members")
    .select("user_id, role, nickname, joined_at")
    .eq("space_id", space_id);

  return {
    data: {
      ...space,
      user_role: membership.role,
      members: members || [],
    },
    status: 200,
  };
}

async function handleInvite(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  params: Record<string, any>
) {
  const { space_id, invited_email, role = "member" } = params;

  if (!space_id) {
    return { error: "space_id is required", status: 400 };
  }

  // Verify membership
  const { data: membership } = await supabase
    .from("olive_space_members")
    .select("role")
    .eq("space_id", space_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return { error: "Not a member of this space", status: 403 };
  }

  // Check member limit
  const { data: space } = await supabase
    .from("olive_spaces")
    .select("max_members")
    .eq("id", space_id)
    .single();

  const { count: currentCount } = await supabase
    .from("olive_space_members")
    .select("id", { count: "exact", head: true })
    .eq("space_id", space_id);

  if (space && currentCount && currentCount >= space.max_members) {
    return { error: `Space is at maximum capacity (${space.max_members} members)`, status: 400 };
  }

  // Create invite
  const { data: invite, error } = await supabase
    .from("olive_space_invites")
    .insert({
      space_id,
      role: role === "admin" ? "admin" : "member",
      invited_email: invited_email || null,
      invited_by: userId,
    })
    .select()
    .single();

  if (error) {
    return { error: `Failed to create invite: ${error.message}`, status: 500 };
  }

  return { data: invite, status: 200 };
}

async function handleAcceptInvite(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  params: Record<string, any>
) {
  const { token } = params;

  if (!token) {
    return { error: "token is required", status: 400 };
  }

  // Find invite
  const { data: invite, error: findError } = await supabase
    .from("olive_space_invites")
    .select("*")
    .eq("token", token)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (findError || !invite) {
    return { error: "Invalid or expired invite", status: 400 };
  }

  // Add user to space
  const { data: member, error: memberError } = await supabase
    .from("olive_space_members")
    .upsert(
      {
        space_id: invite.space_id,
        user_id: userId,
        role: invite.role,
      },
      { onConflict: "space_id,user_id" }
    )
    .select()
    .single();

  if (memberError) {
    return { error: `Failed to join space: ${memberError.message}`, status: 500 };
  }

  // Mark invite as accepted
  await supabase
    .from("olive_space_invites")
    .update({
      status: "accepted",
      accepted_by: userId,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", invite.id);

  // Update space soul with new member
  try {
    const { data: allMembers } = await supabase
      .from("olive_space_members")
      .select("user_id, role, nickname")
      .eq("space_id", invite.space_id);

    const { data: space } = await supabase
      .from("olive_spaces")
      .select("type, name")
      .eq("id", invite.space_id)
      .single();

    if (space && allMembers) {
      await generateSpaceSoul(
        supabase,
        invite.space_id,
        space.type,
        space.name,
        allMembers
      );
    }
  } catch (err) {
    console.warn("[space-manage] Soul update error (non-blocking):", err);
  }

  return {
    data: {
      space_id: invite.space_id,
      member,
    },
    status: 200,
  };
}

async function handleGetMembers(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  params: Record<string, any>
) {
  const { space_id } = params;

  if (!space_id) {
    return { error: "space_id is required", status: 400 };
  }

  // Verify membership
  const { data: membership } = await supabase
    .from("olive_space_members")
    .select("role")
    .eq("space_id", space_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return { error: "Not a member of this space", status: 403 };
  }

  const { data: members, error } = await supabase
    .from("olive_space_members")
    .select("user_id, role, nickname, joined_at")
    .eq("space_id", space_id)
    .order("joined_at", { ascending: true });

  if (error) {
    return { error: `Failed to get members: ${error.message}`, status: 500 };
  }

  // Enrich with profile display names
  const enriched = await Promise.all(
    (members || []).map(async (m: any) => {
      const { data: profile } = await supabase
        .from("clerk_profiles")
        .select("display_name")
        .eq("id", m.user_id)
        .maybeSingle();
      return {
        ...m,
        display_name: profile?.display_name || m.nickname || "Unknown",
      };
    })
  );

  return { data: enriched, status: 200 };
}

async function handleRemoveMember(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  params: Record<string, any>
) {
  const { space_id, target_user_id } = params;

  if (!space_id || !target_user_id) {
    return { error: "space_id and target_user_id are required", status: 400 };
  }

  // Verify user is owner
  const { data: membership } = await supabase
    .from("olive_space_members")
    .select("role")
    .eq("space_id", space_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership || membership.role !== "owner") {
    return { error: "Only owners can remove members", status: 403 };
  }

  // Can't remove yourself (use leave instead)
  if (target_user_id === userId) {
    return { error: "Use 'leave' action to leave a space", status: 400 };
  }

  const { error } = await supabase
    .from("olive_space_members")
    .delete()
    .eq("space_id", space_id)
    .eq("user_id", target_user_id);

  if (error) {
    return { error: `Failed to remove member: ${error.message}`, status: 500 };
  }

  return { data: { removed: target_user_id }, status: 200 };
}

async function handleLeave(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  params: Record<string, any>
) {
  const { space_id } = params;

  if (!space_id) {
    return { error: "space_id is required", status: 400 };
  }

  // Check if user is the sole owner
  const { data: owners } = await supabase
    .from("olive_space_members")
    .select("user_id")
    .eq("space_id", space_id)
    .eq("role", "owner");

  if (owners && owners.length === 1 && owners[0].user_id === userId) {
    // Check if there are other members
    const { count: memberCount } = await supabase
      .from("olive_space_members")
      .select("id", { count: "exact", head: true })
      .eq("space_id", space_id);

    if (memberCount && memberCount > 1) {
      return { error: "Transfer ownership before leaving. You are the only owner.", status: 400 };
    }
    // If sole member + sole owner, allow leaving (space becomes orphaned)
  }

  // Move user's shared notes to personal (set space_id = null)
  await supabase
    .from("clerk_notes")
    .update({ space_id: null, couple_id: null })
    .eq("space_id", space_id)
    .eq("author_id", userId);

  // Remove membership
  const { error } = await supabase
    .from("olive_space_members")
    .delete()
    .eq("space_id", space_id)
    .eq("user_id", userId);

  if (error) {
    return { error: `Failed to leave space: ${error.message}`, status: 500 };
  }

  return { data: { left: space_id }, status: 200 };
}

async function handleDelete(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  params: Record<string, any>
) {
  const { space_id } = params;

  if (!space_id) {
    return { error: "space_id is required", status: 400 };
  }

  // Verify user is owner
  const { data: membership } = await supabase
    .from("olive_space_members")
    .select("role")
    .eq("space_id", space_id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership || membership.role !== "owner") {
    return { error: "Only owners can delete spaces", status: 403 };
  }

  // Check if this is a couple-linked space
  const { data: space } = await supabase
    .from("olive_spaces")
    .select("couple_id")
    .eq("id", space_id)
    .single();

  if (space?.couple_id) {
    return {
      error: "Cannot delete a couple-linked space. Unlink the couple first.",
      status: 400,
    };
  }

  // Move all notes to personal
  await supabase
    .from("clerk_notes")
    .update({ space_id: null, couple_id: null })
    .eq("space_id", space_id);

  // Delete space (cascades to members and invites)
  const { error } = await supabase
    .from("olive_spaces")
    .delete()
    .eq("id", space_id);

  if (error) {
    return { error: `Failed to delete space: ${error.message}`, status: 500 };
  }

  return { data: { deleted: space_id }, status: 200 };
}

// ─── Main Handler ───────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, user_id, ...params } = body;

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "user_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!action) {
      return new Response(
        JSON.stringify({ error: "action is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let result: { data?: any; error?: string; status: number };

    switch (action) {
      case "create":
        result = await handleCreate(supabase, user_id, params);
        break;
      case "update":
        result = await handleUpdate(supabase, user_id, params);
        break;
      case "list":
        result = await handleList(supabase, user_id);
        break;
      case "get":
        result = await handleGet(supabase, user_id, params);
        break;
      case "invite":
        result = await handleInvite(supabase, user_id, params);
        break;
      case "accept_invite":
        result = await handleAcceptInvite(supabase, user_id, params);
        break;
      case "get_members":
        result = await handleGetMembers(supabase, user_id, params);
        break;
      case "remove_member":
        result = await handleRemoveMember(supabase, user_id, params);
        break;
      case "leave":
        result = await handleLeave(supabase, user_id, params);
        break;
      case "delete":
        result = await handleDelete(supabase, user_id, params);
        break;
      default:
        result = { error: `Unknown action: ${action}`, status: 400 };
    }

    return new Response(
      JSON.stringify(result.error ? { error: result.error } : { success: true, ...result.data }),
      { status: result.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[olive-space-manage] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
