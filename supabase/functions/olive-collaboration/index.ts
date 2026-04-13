/**
 * olive-collaboration — Collaboration primitives edge function.
 *
 * Handles: threads (comments), reactions, @mentions, activity feed.
 * All actions are scoped to spaces via RLS + explicit checks.
 *
 * Actions:
 *   - add_thread      : Post a comment on a note
 *   - list_threads     : Get threads for a note
 *   - update_thread    : Edit a comment
 *   - delete_thread    : Remove a comment
 *   - toggle_reaction  : Add or remove an emoji reaction
 *   - get_reactions     : Get all reactions for a note
 *   - add_mention       : Create an @mention (usually called internally)
 *   - get_mentions      : Get unread mentions for the current user
 *   - mark_mention_read : Mark a mention as read
 *   - get_activity_feed : Get activity feed for a space
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Decode JWT to get user ID
    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      userId = payload.sub;
      if (!userId) throw new Error("No sub in token");
    } catch {
      return json({ error: "Invalid token" }, 401);
    }

    const body = await req.json();
    const { action, ...params } = body;

    switch (action) {
      case "add_thread":
        return json(await addThread(supabase, userId, params));
      case "list_threads":
        return json(await listThreads(supabase, userId, params));
      case "update_thread":
        return json(await updateThread(supabase, userId, params));
      case "delete_thread":
        return json(await deleteThread(supabase, userId, params));
      case "toggle_reaction":
        return json(await toggleReaction(supabase, userId, params));
      case "get_reactions":
        return json(await getReactions(supabase, userId, params));
      case "add_mention":
        return json(await addMention(supabase, userId, params));
      case "get_mentions":
        return json(await getMentions(supabase, userId, params));
      case "mark_mention_read":
        return json(await markMentionRead(supabase, userId, params));
      case "get_activity_feed":
        return json(await getActivityFeed(supabase, userId, params));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("[olive-collaboration] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});

// ─── Helpers ────────────────────────────────────────────────────

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getNoteSpaceId(
  supabase: any,
  noteId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("clerk_notes")
    .select("space_id, couple_id")
    .eq("id", noteId)
    .single();
  return data?.space_id || data?.couple_id || null;
}

async function isUserSpaceMember(
  supabase: any,
  spaceId: string,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("olive_space_members")
    .select("id")
    .eq("space_id", spaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

async function canAccessNote(
  supabase: any,
  noteId: string,
  userId: string
): Promise<boolean> {
  // User can access if they authored it OR are a member of the note's space
  const { data: note } = await supabase
    .from("clerk_notes")
    .select("author_id, space_id, couple_id")
    .eq("id", noteId)
    .single();

  if (!note) return false;
  if (note.author_id === userId) return true;

  const spaceId = note.space_id || note.couple_id;
  if (spaceId) {
    return await isUserSpaceMember(supabase, spaceId, userId);
  }

  return false;
}

async function resolveDisplayName(
  supabase: any,
  userId: string
): Promise<string> {
  const { data } = await supabase
    .from("clerk_profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  return data?.display_name || userId;
}

async function resolveDisplayNames(
  supabase: any,
  userIds: string[]
): Promise<Record<string, string>> {
  if (userIds.length === 0) return {};
  const unique = [...new Set(userIds)];
  const { data } = await supabase
    .from("clerk_profiles")
    .select("id, display_name")
    .in("id", unique);

  const map: Record<string, string> = {};
  for (const row of data || []) {
    map[row.id] = row.display_name || row.id;
  }
  return map;
}

// Parse @mentions from text and return user IDs
async function parseMentions(
  supabase: any,
  text: string,
  spaceId: string | null
): Promise<string[]> {
  // Match @DisplayName patterns
  const mentionPattern = /@([A-Za-z0-9\s._-]+?)(?=\s|$|[,.!?;:])/g;
  const matches = [...text.matchAll(mentionPattern)];
  if (matches.length === 0 || !spaceId) return [];

  // Get all space member display names
  const { data: members } = await supabase
    .from("olive_space_members")
    .select("user_id")
    .eq("space_id", spaceId);

  if (!members || members.length === 0) return [];

  const memberIds = members.map((m: any) => m.user_id);
  const nameMap = await resolveDisplayNames(supabase, memberIds);

  // Reverse map: lowercase display name → user_id
  const reverseMap: Record<string, string> = {};
  for (const [uid, name] of Object.entries(nameMap)) {
    reverseMap[name.toLowerCase()] = uid;
  }

  const mentioned: string[] = [];
  for (const match of matches) {
    const name = match[1].trim().toLowerCase();
    if (reverseMap[name]) {
      mentioned.push(reverseMap[name]);
    }
  }

  return [...new Set(mentioned)];
}

// ─── Thread Actions ─────────────────────────────────────────────

async function addThread(supabase: any, userId: string, params: any) {
  const { note_id, body: threadBody, parent_id } = params;
  if (!note_id || !threadBody?.trim()) {
    return { error: "note_id and body are required" };
  }

  if (!(await canAccessNote(supabase, note_id, userId))) {
    return { error: "Cannot access this note" };
  }

  const spaceId = await getNoteSpaceId(supabase, note_id);

  const { data: thread, error } = await supabase
    .from("note_threads")
    .insert({
      note_id,
      author_id: userId,
      body: threadBody.trim().substring(0, 2000),
      parent_id: parent_id || null,
      space_id: spaceId,
    })
    .select()
    .single();

  if (error) {
    console.error("[addThread] Error:", error);
    return { error: "Failed to create thread" };
  }

  // Parse and create mentions
  if (spaceId) {
    const mentionedIds = await parseMentions(supabase, threadBody, spaceId);
    for (const mentionedId of mentionedIds) {
      if (mentionedId === userId) continue; // don't self-mention
      await supabase.from("note_mentions").insert({
        note_id,
        thread_id: thread.id,
        mentioned_user_id: mentionedId,
        mentioned_by: userId,
        space_id: spaceId,
      });
    }
  }

  // Enrich with display name
  const displayName = await resolveDisplayName(supabase, userId);

  return {
    thread: {
      ...thread,
      author_display_name: displayName,
    },
  };
}

async function listThreads(supabase: any, userId: string, params: any) {
  const { note_id, limit = 50, offset = 0 } = params;
  if (!note_id) return { error: "note_id is required" };

  if (!(await canAccessNote(supabase, note_id, userId))) {
    return { error: "Cannot access this note" };
  }

  const { data: threads, error } = await supabase
    .from("note_threads")
    .select("*")
    .eq("note_id", note_id)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[listThreads] Error:", error);
    return { error: "Failed to fetch threads" };
  }

  // Enrich with display names
  const authorIds = threads.map((t: any) => t.author_id);
  const names = await resolveDisplayNames(supabase, authorIds);

  const enriched = threads.map((t: any) => ({
    ...t,
    author_display_name: names[t.author_id] || t.author_id,
  }));

  return { threads: enriched, count: enriched.length };
}

async function updateThread(supabase: any, userId: string, params: any) {
  const { thread_id, body: threadBody } = params;
  if (!thread_id || !threadBody?.trim()) {
    return { error: "thread_id and body are required" };
  }

  const { data, error } = await supabase
    .from("note_threads")
    .update({
      body: threadBody.trim().substring(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", thread_id)
    .eq("author_id", userId) // only author can edit
    .select()
    .single();

  if (error) {
    console.error("[updateThread] Error:", error);
    return { error: "Failed to update thread" };
  }

  return { thread: data };
}

async function deleteThread(supabase: any, userId: string, params: any) {
  const { thread_id } = params;
  if (!thread_id) return { error: "thread_id is required" };

  const { error } = await supabase
    .from("note_threads")
    .delete()
    .eq("id", thread_id)
    .eq("author_id", userId); // only author can delete

  if (error) {
    console.error("[deleteThread] Error:", error);
    return { error: "Failed to delete thread" };
  }

  return { success: true };
}

// ─── Reaction Actions ───────────────────────────────────────────

async function toggleReaction(supabase: any, userId: string, params: any) {
  const { note_id, emoji } = params;
  if (!note_id || !emoji) {
    return { error: "note_id and emoji are required" };
  }

  if (!(await canAccessNote(supabase, note_id, userId))) {
    return { error: "Cannot access this note" };
  }

  // Check if reaction already exists
  const { data: existing } = await supabase
    .from("note_reactions")
    .select("id")
    .eq("note_id", note_id)
    .eq("user_id", userId)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    // Remove reaction
    await supabase.from("note_reactions").delete().eq("id", existing.id);
    return { action: "removed", emoji };
  } else {
    // Add reaction
    const { data, error } = await supabase
      .from("note_reactions")
      .insert({ note_id, user_id: userId, emoji })
      .select()
      .single();

    if (error) {
      console.error("[toggleReaction] Error:", error);
      return { error: "Failed to add reaction" };
    }

    return { action: "added", reaction: data };
  }
}

async function getReactions(supabase: any, userId: string, params: any) {
  const { note_id } = params;
  if (!note_id) return { error: "note_id is required" };

  const { data: reactions, error } = await supabase
    .from("note_reactions")
    .select("*")
    .eq("note_id", note_id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[getReactions] Error:", error);
    return { error: "Failed to fetch reactions" };
  }

  // Group by emoji with user names
  const userIds = reactions.map((r: any) => r.user_id);
  const names = await resolveDisplayNames(supabase, userIds);

  // Build summary: { "👍": { count: 2, users: ["Alice", "Bob"], reacted_by_me: true } }
  const grouped: Record<
    string,
    { count: number; users: string[]; user_ids: string[]; reacted_by_me: boolean }
  > = {};

  for (const r of reactions) {
    if (!grouped[r.emoji]) {
      grouped[r.emoji] = { count: 0, users: [], user_ids: [], reacted_by_me: false };
    }
    grouped[r.emoji].count++;
    grouped[r.emoji].users.push(names[r.user_id] || r.user_id);
    grouped[r.emoji].user_ids.push(r.user_id);
    if (r.user_id === userId) {
      grouped[r.emoji].reacted_by_me = true;
    }
  }

  return { reactions: grouped };
}

// ─── Mention Actions ────────────────────────────────────────────

async function addMention(supabase: any, userId: string, params: any) {
  const { note_id, thread_id, mentioned_user_id, space_id } = params;
  if (!mentioned_user_id) {
    return { error: "mentioned_user_id is required" };
  }
  if (!note_id && !thread_id) {
    return { error: "note_id or thread_id is required" };
  }

  const { data, error } = await supabase
    .from("note_mentions")
    .insert({
      note_id: note_id || null,
      thread_id: thread_id || null,
      mentioned_user_id,
      mentioned_by: userId,
      space_id: space_id || null,
    })
    .select()
    .single();

  if (error) {
    console.error("[addMention] Error:", error);
    return { error: "Failed to create mention" };
  }

  return { mention: data };
}

async function getMentions(supabase: any, userId: string, params: any) {
  const { unread_only = true, limit = 20 } = params;

  let query = supabase
    .from("note_mentions")
    .select("*, clerk_notes(summary, category)")
    .eq("mentioned_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unread_only) {
    query = query.is("read_at", null);
  }

  const { data: mentions, error } = await query;

  if (error) {
    console.error("[getMentions] Error:", error);
    return { error: "Failed to fetch mentions" };
  }

  // Enrich with mentioner names
  const mentionerIds = mentions.map((m: any) => m.mentioned_by);
  const names = await resolveDisplayNames(supabase, mentionerIds);

  const enriched = mentions.map((m: any) => ({
    ...m,
    mentioned_by_name: names[m.mentioned_by] || m.mentioned_by,
  }));

  return { mentions: enriched, count: enriched.length };
}

async function markMentionRead(supabase: any, userId: string, params: any) {
  const { mention_id, mark_all } = params;

  if (mark_all) {
    const { error } = await supabase
      .from("note_mentions")
      .update({ read_at: new Date().toISOString() })
      .eq("mentioned_user_id", userId)
      .is("read_at", null);

    if (error) {
      console.error("[markMentionRead] Error:", error);
      return { error: "Failed to mark mentions as read" };
    }
    return { success: true };
  }

  if (!mention_id) return { error: "mention_id or mark_all is required" };

  const { error } = await supabase
    .from("note_mentions")
    .update({ read_at: new Date().toISOString() })
    .eq("id", mention_id)
    .eq("mentioned_user_id", userId);

  if (error) {
    console.error("[markMentionRead] Error:", error);
    return { error: "Failed to mark mention as read" };
  }

  return { success: true };
}

// ─── Activity Feed ──────────────────────────────────────────────

async function getActivityFeed(supabase: any, userId: string, params: any) {
  const { space_id, limit = 30, offset = 0, entity_type } = params;
  if (!space_id) return { error: "space_id is required" };

  // Verify membership
  if (!(await isUserSpaceMember(supabase, space_id, userId))) {
    return { error: "Not a member of this space" };
  }

  let query = supabase
    .from("space_activity")
    .select("*")
    .eq("space_id", space_id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (entity_type) {
    query = query.eq("entity_type", entity_type);
  }

  const { data: activities, error } = await query;

  if (error) {
    console.error("[getActivityFeed] Error:", error);
    return { error: "Failed to fetch activity feed" };
  }

  // Enrich with display names
  const actorIds = activities.map((a: any) => a.actor_id);
  const names = await resolveDisplayNames(supabase, actorIds);

  const enriched = activities.map((a: any) => ({
    ...a,
    actor_display_name: names[a.actor_id] || a.actor_id,
  }));

  return { activities: enriched, count: enriched.length };
}
