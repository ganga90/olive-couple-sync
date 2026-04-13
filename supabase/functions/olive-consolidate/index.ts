/**
 * Olive Consolidate — Nightly Memory Consolidation Pipeline
 *
 * Runs as a nightly cron job to keep the memory system healthy:
 * 1. DEDUPLICATE — Find and merge near-identical memories
 * 2. COMPACT — Summarize old daily logs into weekly summaries
 * 3. DECAY — Apply time-weighted relevance decay, archive stale memories
 * 4. MERGE — Combine fragmented memories about the same topic
 *
 * Can also be triggered manually via POST.
 *
 * Actions:
 * - run: Execute full consolidation pipeline for a user (or all eligible)
 * - status: Get consolidation health metrics
 * - restore: Restore an archived memory
 * - history: Get consolidation run history
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI } from "https://esm.sh/@google/genai@1.0.0";
import { GEMINI_KEY, getModel } from "../_shared/gemini.ts";

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

// Similarity threshold for deduplication (0-1, higher = stricter)
const DEDUP_SIMILARITY_THRESHOLD = 0.92;
// Days after which daily logs get compacted
const DAILY_LOG_COMPACT_DAYS = 30;
// Maximum memories to process per user per run
const MAX_MEMORIES_PER_RUN = 500;
// Archive threshold for relevance score
const ARCHIVE_THRESHOLD = 0.1;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth (optional for cron calls)
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      try {
        const token = authHeader.replace("Bearer ", "");
        const payload = JSON.parse(atob(token.split(".")[1]));
        userId = payload.sub || null;
      } catch {
        // Non-fatal — cron calls may not have auth
      }
    }

    let body: Record<string, any> = {};
    try {
      body = await req.json();
    } catch {
      // Empty body for cron
    }

    const action = body.action || "run";

    switch (action) {
      case "run":
        return json(await runConsolidation(supabase, body.user_id || userId, body.run_type));
      case "status":
        return json(await getHealthStatus(supabase, body.user_id || userId!));
      case "restore":
        return json(await restoreMemory(supabase, body.user_id || userId!, body.memory_id));
      case "history":
        return json(await getHistory(supabase, body.user_id || userId!, body.limit));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("olive-consolidate error:", err);
    return json({ error: "Internal error" }, 500);
  }
});

// ─── Main Pipeline ────────────────────────────────────────────

async function runConsolidation(
  supabase: any,
  targetUserId: string | null,
  runType: string = "nightly"
) {
  let userIds: string[] = [];

  if (targetUserId) {
    userIds = [targetUserId];
  } else {
    // Find all users with active memories who haven't been consolidated in 24h
    const { data: users } = await supabase
      .from("user_memories")
      .select("user_id")
      .eq("is_active", true)
      .limit(100);

    const uniqueUsers = [...new Set((users || []).map((u: any) => u.user_id))];

    // Filter out users consolidated in last 24h
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentRuns } = await supabase
      .from("olive_consolidation_runs")
      .select("user_id")
      .eq("status", "completed")
      .gte("completed_at", twentyFourHoursAgo);

    const recentlyConsolidated = new Set((recentRuns || []).map((r: any) => r.user_id));
    userIds = uniqueUsers.filter((id: string) => !recentlyConsolidated.has(id)).slice(0, 50);
  }

  if (userIds.length === 0) {
    return { message: "No users eligible for consolidation", processed: 0 };
  }

  const results: Array<{ user_id: string; success: boolean; stats?: any; error?: string }> = [];

  for (const uid of userIds) {
    try {
      const stats = await consolidateUser(supabase, uid, runType);
      results.push({ user_id: uid, success: true, stats });
    } catch (err) {
      console.error(`[consolidate] Error for ${uid}:`, err);
      results.push({ user_id: uid, success: false, error: String(err) });
    }
  }

  return { processed: results.length, results };
}

// ─── Per-User Consolidation ───────────────────────────────────

async function consolidateUser(supabase: any, userId: string, runType: string) {
  // Create run record
  const { data: run } = await supabase
    .from("olive_consolidation_runs")
    .insert({ user_id: userId, run_type: runType })
    .select("id")
    .single();

  const runId = run?.id;
  const stats = {
    memories_scanned: 0,
    memories_merged: 0,
    memories_archived: 0,
    memories_deduplicated: 0,
    chunks_compacted: 0,
    daily_logs_compacted: 0,
    token_savings: 0,
  };
  const mergeDetails: any[] = [];

  try {
    // Step 1: DEDUPLICATE — find near-identical memories
    const dedupResult = await deduplicateMemories(supabase, userId);
    stats.memories_scanned += dedupResult.scanned;
    stats.memories_deduplicated += dedupResult.deduplicated;
    stats.token_savings += dedupResult.tokensSaved;
    mergeDetails.push(...dedupResult.details);

    // Step 2: COMPACT — summarize old daily logs
    const compactResult = await compactDailyLogs(supabase, userId);
    stats.daily_logs_compacted += compactResult.compacted;
    stats.chunks_compacted += compactResult.chunksRemoved;
    stats.token_savings += compactResult.tokensSaved;

    // Step 3: DECAY — apply relevance decay and archive
    const decayResult = await applyDecay(supabase, userId);
    stats.memories_archived += decayResult.archived;

    // Step 4: MERGE — combine fragmented memories about the same topic
    const mergeResult = await mergeFragmentedMemories(supabase, userId);
    stats.memories_merged += mergeResult.merged;
    stats.token_savings += mergeResult.tokensSaved;
    mergeDetails.push(...mergeResult.details);

    // Update run record
    await supabase
      .from("olive_consolidation_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        ...stats,
        merge_details: mergeDetails,
      })
      .eq("id", runId);

    return stats;
  } catch (err) {
    // Mark run as failed
    await supabase
      .from("olive_consolidation_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        ...stats,
        error_message: String(err),
      })
      .eq("id", runId);
    throw err;
  }
}

// ─── Step 1: Deduplication ────────────────────────────────────

async function deduplicateMemories(supabase: any, userId: string) {
  const { data: memories } = await supabase
    .from("user_memories")
    .select("id, title, content, category, importance, embedding")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(MAX_MEMORIES_PER_RUN);

  if (!memories || memories.length < 2) {
    return { scanned: memories?.length || 0, deduplicated: 0, tokensSaved: 0, details: [] };
  }

  const duplicateGroups: Array<{ keep: any; remove: any[]; reason: string }> = [];

  // Group by title similarity (exact or near-exact)
  const titleMap = new Map<string, any[]>();
  for (const mem of memories) {
    const normalizedTitle = mem.title.toLowerCase().trim();
    if (!titleMap.has(normalizedTitle)) {
      titleMap.set(normalizedTitle, []);
    }
    titleMap.get(normalizedTitle)!.push(mem);
  }

  // Find duplicates within same-title groups
  for (const [title, group] of titleMap) {
    if (group.length <= 1) continue;

    // Keep the one with highest importance, then most recent
    group.sort((a: any, b: any) => {
      if (b.importance !== a.importance) return b.importance - a.importance;
      return 0; // already sorted by created_at DESC
    });

    const keep = group[0];
    const remove = group.slice(1);

    // Check content similarity for same-title memories
    for (const dup of remove) {
      const similarity = textSimilarity(keep.content, dup.content);
      if (similarity >= DEDUP_SIMILARITY_THRESHOLD) {
        duplicateGroups.push({
          keep,
          remove: [dup],
          reason: `Duplicate title "${title}" with ${(similarity * 100).toFixed(0)}% content similarity`,
        });
      }
    }
  }

  let deduplicated = 0;
  let tokensSaved = 0;
  const details: any[] = [];

  for (const group of duplicateGroups) {
    for (const dup of group.remove) {
      // Soft-delete the duplicate
      await supabase
        .from("user_memories")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", dup.id);

      deduplicated++;
      tokensSaved += Math.ceil((dup.content || "").length / 4);
      details.push({
        memory_ids: [group.keep.id, dup.id],
        merged_into: group.keep.id,
        reason: group.reason,
      });
    }
  }

  return { scanned: memories.length, deduplicated, tokensSaved, details };
}

// ─── Step 2: Compact Daily Logs ───────────────────────────────

async function compactDailyLogs(supabase: any, userId: string) {
  const cutoffDate = new Date(Date.now() - DAILY_LOG_COMPACT_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]; // YYYY-MM-DD

  // Find old daily log files that haven't been compacted
  const { data: oldLogs } = await supabase
    .from("olive_memory_files")
    .select("id, file_date, content, token_count")
    .eq("user_id", userId)
    .eq("file_type", "daily")
    .lt("file_date", cutoffDate)
    .not("content", "like", "%[COMPACTED]%")
    .order("file_date", { ascending: true })
    .limit(30); // Process up to 30 old daily logs per run

  if (!oldLogs || oldLogs.length === 0) {
    return { compacted: 0, chunksRemoved: 0, tokensSaved: 0 };
  }

  let compacted = 0;
  let chunksRemoved = 0;
  let tokensSaved = 0;

  // Group logs by week for summarization
  const weekGroups = new Map<string, any[]>();
  for (const log of oldLogs) {
    const date = new Date(log.file_date);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay()); // Sunday
    const weekKey = weekStart.toISOString().split("T")[0];
    if (!weekGroups.has(weekKey)) weekGroups.set(weekKey, []);
    weekGroups.get(weekKey)!.push(log);
  }

  for (const [weekKey, logs] of weekGroups) {
    if (logs.length === 0) continue;

    // Combine all log content for the week
    const combinedContent = logs.map((l: any) => `[${l.file_date}]\n${l.content}`).join("\n\n");
    const originalTokens = logs.reduce((sum: number, l: any) => sum + (l.token_count || 0), 0);

    // Summarize via Gemini (or simple truncation if no key)
    let summary: string;
    if (GEMINI_KEY && combinedContent.length > 500) {
      summary = await summarizeWithGemini(combinedContent, weekKey);
    } else {
      // Simple truncation: keep first 500 chars per day
      summary = logs
        .map((l: any) => `[${l.file_date}] ${(l.content || "").slice(0, 500)}`)
        .join("\n");
    }

    // Mark original logs as compacted
    for (const log of logs) {
      await supabase
        .from("olive_memory_files")
        .update({
          content: `[COMPACTED] Week of ${weekKey}. See weekly summary.\n\nOriginal snippet: ${(log.content || "").slice(0, 200)}...`,
          token_count: 50,
          updated_at: new Date().toISOString(),
        })
        .eq("id", log.id);

      // Remove associated chunks (they're now summarized)
      const { count } = await supabase
        .from("olive_memory_chunks")
        .delete()
        .eq("memory_file_id", log.id);

      chunksRemoved += count || 0;
      compacted++;
    }

    // Create weekly summary file
    await supabase.from("olive_memory_files").insert({
      user_id: userId,
      file_type: "patterns",
      content: `Weekly Summary (${weekKey}):\n${summary}`,
      token_count: Math.ceil(summary.length / 4),
      metadata: {
        type: "weekly_compaction",
        week_start: weekKey,
        source_logs: logs.length,
        original_tokens: originalTokens,
      },
    });

    tokensSaved += Math.max(0, originalTokens - Math.ceil(summary.length / 4));
  }

  return { compacted, chunksRemoved, tokensSaved };
}

// ─── Step 3: Apply Decay ──────────────────────────────────────

async function applyDecay(supabase: any, userId: string) {
  // Ensure all active memories have relevance scores
  const { data: memories } = await supabase
    .from("user_memories")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (memories && memories.length > 0) {
    // Batch upsert relevance records for memories that don't have one yet
    for (const mem of memories) {
      await supabase.from("olive_memory_relevance").upsert(
        {
          memory_id: mem.id,
          user_id: userId,
          relevance_score: 1.0,
        },
        { onConflict: "memory_id,user_id", ignoreDuplicates: true }
      );
    }
  }

  // Call the decay RPC
  const { data: archivedCount } = await supabase.rpc("apply_memory_decay", {
    p_user_id: userId,
    p_archive_threshold: ARCHIVE_THRESHOLD,
  });

  return { archived: archivedCount || 0 };
}

// ─── Step 4: Merge Fragmented ─────────────────────────────────

async function mergeFragmentedMemories(supabase: any, userId: string) {
  // Find memories with similar categories that could be combined
  const { data: memories } = await supabase
    .from("user_memories")
    .select("id, title, content, category, importance")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("category")
    .limit(200);

  if (!memories || memories.length < 3) {
    return { merged: 0, tokensSaved: 0, details: [] };
  }

  // Group by category
  const catGroups = new Map<string, any[]>();
  for (const mem of memories) {
    const cat = mem.category || "personal";
    if (!catGroups.has(cat)) catGroups.set(cat, []);
    catGroups.get(cat)!.push(mem);
  }

  let merged = 0;
  let tokensSaved = 0;
  const details: any[] = [];

  for (const [category, group] of catGroups) {
    if (group.length < 3) continue;

    // Find short fragmented memories in same category (< 100 chars each)
    const fragments = group.filter((m: any) => (m.content || "").length < 100);
    if (fragments.length < 2) continue;

    // Group fragments by title keyword overlap
    const fragmentGroups = groupByTitleSimilarity(fragments);

    for (const fgroup of fragmentGroups) {
      if (fgroup.length < 2) continue;

      // Merge: combine contents, keep highest importance
      const combinedContent = fgroup
        .map((f: any) => f.content.trim())
        .filter((c: string) => c.length > 0)
        .join(". ");

      const maxImportance = Math.max(...fgroup.map((f: any) => f.importance || 3));
      const keepId = fgroup[0].id;

      // Update the keeper with merged content
      await supabase
        .from("user_memories")
        .update({
          content: combinedContent,
          importance: maxImportance,
          updated_at: new Date().toISOString(),
        })
        .eq("id", keepId);

      // Soft-delete the rest
      const removeIds = fgroup.slice(1).map((f: any) => f.id);
      for (const rid of removeIds) {
        await supabase
          .from("user_memories")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq("id", rid);
      }

      merged += removeIds.length;
      const savedChars = fgroup.slice(1).reduce((sum: number, f: any) => sum + (f.content || "").length, 0);
      tokensSaved += Math.ceil(savedChars / 4);
      details.push({
        memory_ids: fgroup.map((f: any) => f.id),
        merged_into: keepId,
        reason: `Merged ${fgroup.length} fragments in "${category}"`,
      });
    }
  }

  return { merged, tokensSaved, details };
}

// ─── Status Endpoint ──────────────────────────────────────────

async function getHealthStatus(supabase: any, userId: string) {
  if (!userId) return { error: "user_id required" };

  // Total active memories
  const { count: totalMemories } = await supabase
    .from("user_memories")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_active", true);

  // Archived memories
  const { count: archivedMemories } = await supabase
    .from("olive_memory_relevance")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_archived", true);

  // Low relevance (at risk of archival)
  const { count: atRiskMemories } = await supabase
    .from("olive_memory_relevance")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_archived", false)
    .lt("relevance_score", 0.3);

  // Last consolidation
  const { data: lastRun } = await supabase
    .from("olive_consolidation_runs")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Daily log count
  const { count: dailyLogs } = await supabase
    .from("olive_memory_files")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("file_type", "daily");

  // Memory chunks
  const { count: totalChunks } = await supabase
    .from("olive_memory_chunks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  return {
    total_memories: totalMemories || 0,
    archived_memories: archivedMemories || 0,
    at_risk_memories: atRiskMemories || 0,
    daily_logs: dailyLogs || 0,
    total_chunks: totalChunks || 0,
    last_consolidation: lastRun
      ? {
          completed_at: lastRun.completed_at,
          memories_merged: lastRun.memories_merged,
          memories_archived: lastRun.memories_archived,
          memories_deduplicated: lastRun.memories_deduplicated,
          token_savings: lastRun.token_savings,
        }
      : null,
    health: calculateHealthScore(totalMemories || 0, archivedMemories || 0, atRiskMemories || 0, lastRun),
  };
}

function calculateHealthScore(
  total: number,
  archived: number,
  atRisk: number,
  lastRun: any
): { score: number; label: string; color: string } {
  let score = 100;

  // Penalize high at-risk ratio
  if (total > 0) {
    const atRiskRatio = atRisk / total;
    score -= Math.floor(atRiskRatio * 30);
  }

  // Penalize no recent consolidation
  if (!lastRun) {
    score -= 20;
  } else {
    const daysSince = (Date.now() - new Date(lastRun.completed_at).getTime()) / (24 * 60 * 60 * 1000);
    if (daysSince > 7) score -= 15;
    else if (daysSince > 3) score -= 5;
  }

  // Penalize very high memory count (bloat)
  if (total > 200) score -= 10;
  if (total > 500) score -= 10;

  score = Math.max(0, Math.min(100, score));

  const label = score >= 80 ? "Healthy" : score >= 50 ? "Needs attention" : "Degraded";
  const color = score >= 80 ? "emerald" : score >= 50 ? "amber" : "red";

  return { score, label, color };
}

// ─── Restore Endpoint ─────────────────────────────────────────

async function restoreMemory(supabase: any, userId: string, memoryId: string) {
  if (!memoryId) return { error: "memory_id required" };

  // Re-activate the memory
  const { error: memError } = await supabase
    .from("user_memories")
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq("id", memoryId)
    .eq("user_id", userId);

  if (memError) return { error: memError.message };

  // Reset relevance score
  await supabase
    .from("olive_memory_relevance")
    .update({
      is_archived: false,
      archived_at: null,
      archive_reason: null,
      relevance_score: 0.5,
      updated_at: new Date().toISOString(),
    })
    .eq("memory_id", memoryId)
    .eq("user_id", userId);

  return { success: true, restored: memoryId };
}

// ─── History Endpoint ─────────────────────────────────────────

async function getHistory(supabase: any, userId: string, limit: number = 10) {
  if (!userId) return { error: "user_id required" };

  const { data, error } = await supabase
    .from("olive_consolidation_runs")
    .select("id, run_type, status, memories_scanned, memories_merged, memories_archived, memories_deduplicated, chunks_compacted, daily_logs_compacted, token_savings, started_at, completed_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) return { error: error.message };
  return { runs: data || [] };
}

// ─── Helpers ──────────────────────────────────────────────────

function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

function groupByTitleSimilarity(memories: any[]): any[][] {
  const groups: any[][] = [];
  const used = new Set<string>();

  for (let i = 0; i < memories.length; i++) {
    if (used.has(memories[i].id)) continue;
    const group = [memories[i]];
    used.add(memories[i].id);

    const wordsA = new Set(memories[i].title.toLowerCase().split(/\s+/));

    for (let j = i + 1; j < memories.length; j++) {
      if (used.has(memories[j].id)) continue;
      const wordsB = new Set(memories[j].title.toLowerCase().split(/\s+/));
      const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
      // At least 50% word overlap in titles
      if (intersection.size / Math.min(wordsA.size, wordsB.size) >= 0.5) {
        group.push(memories[j]);
        used.add(memories[j].id);
      }
    }

    groups.push(group);
  }

  return groups;
}

async function summarizeWithGemini(content: string, weekKey: string): Promise<string> {
  try {
    const genAI = new GoogleGenAI({ apiKey: GEMINI_KEY });
    const result = await genAI.models.generateContent({
      model: getModel("lite"),
      contents: `Summarize these daily logs from the week of ${weekKey} into a concise weekly summary. Keep key facts, decisions, and events. Remove redundancy. Max 300 words.\n\n${content.slice(0, 8000)}`,
      config: {
        temperature: 0.1,
        maxOutputTokens: 500,
      },
    });
    return result.text || content.slice(0, 1000);
  } catch {
    return content.slice(0, 1000);
  }
}
