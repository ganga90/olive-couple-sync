/**
 * Olive Polls — Quick Team Decision Making
 *
 * Enables space members to create polls, vote, and see results.
 * Supports single-choice, multiple-choice, and ranked polls.
 *
 * Actions:
 * - create: Create a new poll
 * - vote: Cast a vote
 * - results: Get poll results
 * - list: List polls for a space
 * - close: Close a poll
 * - delete: Delete a poll
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { action } = body;

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    let userId: string | null = null;
    if (token && token !== Deno.env.get("SUPABASE_ANON_KEY")) {
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id ?? null;
    }

    switch (action) {
      case "create":
        return json(await createPoll(supabase, body, userId));
      case "vote":
        return json(await castVote(supabase, body, userId));
      case "results":
        return json(await getResults(supabase, body));
      case "list":
        return json(await listPolls(supabase, body));
      case "close":
        return json(await closePoll(supabase, body, userId));
      case "delete":
        return json(await deletePoll(supabase, body, userId));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("olive-polls error:", err);
    return json({ error: err.message }, 500);
  }
});

// ─── Create Poll ─────────────────────────────────────────────

async function createPoll(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { space_id, question, description, options, poll_type, allow_add_options, anonymous, closes_at } = body;
  if (!space_id || !question || !options || options.length < 2) {
    return { error: "space_id, question, and at least 2 options required" };
  }

  // Assign IDs to options
  const indexedOptions = options.map((opt: any, i: number) => ({
    id: opt.id || `opt_${i}`,
    text: typeof opt === "string" ? opt : opt.text,
    color: opt.color || null,
  }));

  const { data, error } = await supabase
    .from("olive_polls")
    .insert({
      space_id,
      created_by: userId,
      question,
      description: description || null,
      poll_type: poll_type || "single",
      options: indexedOptions,
      allow_add_options: allow_add_options || false,
      anonymous: anonymous || false,
      closes_at: closes_at || null,
    })
    .select()
    .single();

  if (error) throw error;
  return { success: true, poll: data };
}

// ─── Cast Vote ───────────────────────────────────────────────

async function castVote(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { poll_id, option_ids, ranking } = body;
  if (!poll_id) return { error: "poll_id required" };

  // Check poll is open
  const { data: poll } = await supabase
    .from("olive_polls")
    .select("*")
    .eq("id", poll_id)
    .single();

  if (!poll) return { error: "Poll not found" };
  if (poll.status !== "open") return { error: "Poll is closed" };
  if (poll.closes_at && new Date(poll.closes_at) < new Date()) {
    // Auto-close expired poll
    await supabase.from("olive_polls").update({ status: "closed" }).eq("id", poll_id);
    return { error: "Poll has expired" };
  }

  // Validate option_ids
  const validIds = new Set((poll.options || []).map((o: any) => o.id));
  const selectedIds = option_ids || [];
  for (const id of selectedIds) {
    if (!validIds.has(id)) return { error: `Invalid option: ${id}` };
  }

  // For single-choice, only one option allowed
  if (poll.poll_type === "single" && selectedIds.length > 1) {
    return { error: "Single-choice poll: select only one option" };
  }

  // Upsert vote (allows changing vote)
  const { data, error } = await supabase
    .from("olive_poll_votes")
    .upsert({
      poll_id,
      user_id: userId,
      option_ids: selectedIds,
      ranking: ranking || null,
      voted_at: new Date().toISOString(),
    }, { onConflict: "poll_id,user_id" })
    .select()
    .single();

  if (error) throw error;
  return { success: true, vote: data };
}

// ─── Get Results ─────────────────────────────────────────────

async function getResults(supabase: any, body: any) {
  const { poll_id } = body;
  if (!poll_id) return { error: "poll_id required" };

  const { data: poll } = await supabase
    .from("olive_polls")
    .select("*")
    .eq("id", poll_id)
    .single();

  if (!poll) return { error: "Poll not found" };

  const { data: votes } = await supabase
    .from("olive_poll_votes")
    .select("*")
    .eq("poll_id", poll_id);

  const allVotes = votes || [];
  const totalVoters = allVotes.length;

  // Tally votes per option
  const tally: Record<string, number> = {};
  for (const opt of poll.options || []) {
    tally[opt.id] = 0;
  }

  for (const vote of allVotes) {
    for (const optId of vote.option_ids || []) {
      tally[optId] = (tally[optId] || 0) + 1;
    }
  }

  const results = (poll.options || []).map((opt: any) => ({
    ...opt,
    votes: tally[opt.id] || 0,
    percentage: totalVoters > 0 ? ((tally[opt.id] || 0) / totalVoters * 100).toFixed(1) : "0",
  }));

  // Sort by votes descending
  results.sort((a: any, b: any) => b.votes - a.votes);

  return {
    poll,
    results,
    total_voters: totalVoters,
    // Only include voter IDs if not anonymous
    voters: poll.anonymous ? undefined : allVotes.map((v: any) => v.user_id),
  };
}

// ─── List Polls ──────────────────────────────────────────────

async function listPolls(supabase: any, body: any) {
  const { space_id, status, limit = 20 } = body;
  if (!space_id) return { error: "space_id required" };

  let query = supabase
    .from("olive_polls")
    .select("*")
    .eq("space_id", space_id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;

  // Attach vote counts
  const pollIds = (data || []).map((p: any) => p.id);
  const { data: voteCounts } = await supabase
    .from("olive_poll_votes")
    .select("poll_id")
    .in("poll_id", pollIds);

  const countMap: Record<string, number> = {};
  for (const v of voteCounts || []) {
    countMap[v.poll_id] = (countMap[v.poll_id] || 0) + 1;
  }

  const polls = (data || []).map((p: any) => ({
    ...p,
    vote_count: countMap[p.id] || 0,
  }));

  return { polls };
}

// ─── Close Poll ──────────────────────────────────────────────

async function closePoll(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { poll_id } = body;
  if (!poll_id) return { error: "poll_id required" };

  const { error } = await supabase
    .from("olive_polls")
    .update({ status: "closed" })
    .eq("id", poll_id);

  if (error) throw error;
  return { success: true };
}

// ─── Delete Poll ─────────────────────────────────────────────

async function deletePoll(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { poll_id } = body;
  if (!poll_id) return { error: "poll_id required" };

  // Only creator can delete
  const { data: poll } = await supabase
    .from("olive_polls")
    .select("created_by")
    .eq("id", poll_id)
    .single();

  if (!poll) return { error: "Poll not found" };
  if (poll.created_by !== userId) return { error: "Only the creator can delete this poll" };

  const { error } = await supabase.from("olive_polls").delete().eq("id", poll_id);
  if (error) throw error;

  return { success: true };
}
