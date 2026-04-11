/**
 * Olive Memory Maintenance Service — Phase 3 (Option C)
 * =====================================================
 * Self-improving memory quality loop:
 *
 * 1. Contradiction Detection — find conflicting facts among chunks
 * 2. Importance Decay — reduce weight of stale, low-importance chunks
 * 3. Memory Consolidation — merge semantically similar chunks
 * 4. Entity Deduplication — merge duplicate entities in knowledge graph
 *
 * Triggered weekly via pg_cron (Sundays 3am UTC) or on-demand.
 * verify_jwt: false (called by pg_cron / service role)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Gemini helpers ─────────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[]> {
  const GEMINI_API_KEY =
    Deno.env.get("GEMINI_API") ||
    Deno.env.get("GEMINI_API_KEY") ||
    Deno.env.get("VITE_GEMINI_API_KEY");

  if (!GEMINI_API_KEY) throw new Error("No Gemini API key configured");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini embedding error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const embedding = data.embedding?.values;
  if (!embedding) throw new Error("No embedding values in Gemini response");
  return embedding;
}

async function callGemini(
  prompt: string,
  temperature = 0.2,
  maxTokens = 2048
): Promise<string> {
  const GEMINI_API_KEY =
    Deno.env.get("GEMINI_API") ||
    Deno.env.get("GEMINI_API_KEY") ||
    Deno.env.get("VITE_GEMINI_API_KEY");

  if (!GEMINI_API_KEY) throw new Error("No Gemini API key configured");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ─── Maintenance modules ────────────────────────────────────────────

/**
 * 1. IMPORTANCE DECAY
 * Reduce the effective importance of chunks that haven't been accessed
 * in a long time. Keeps memory fresh and relevant.
 *
 * Formula: decay_factor = max(0.3, 1.0 - (days_stale - threshold) * 0.005)
 * - 90 days stale → 1.0 (no decay)
 * - 180 days stale → 0.55
 * - 300+ days → 0.3 (floor, never fully erased)
 */
async function runImportanceDecay(
  supabase: any,
  userId: string
): Promise<{ decayed: number; deactivated: number }> {
  const { data: candidates } = await supabase.rpc("get_decay_candidates", {
    p_user_id: userId,
    p_stale_days: 90,
    p_limit: 200,
  });

  if (!candidates || candidates.length === 0) {
    return { decayed: 0, deactivated: 0 };
  }

  let decayed = 0;
  let deactivated = 0;

  for (const chunk of candidates) {
    const daysStale = chunk.days_stale;
    const newDecay = Math.max(0.3, 1.0 - (daysStale - 90) * 0.005);

    // If decay is at floor and importance is 1, deactivate the chunk
    if (newDecay <= 0.3 && chunk.importance <= 1) {
      await supabase
        .from("olive_memory_chunks")
        .update({
          is_active: false,
          decay_factor: newDecay,
          metadata: {
            ...((chunk as any).metadata || {}),
            deactivated_reason: "importance_decay",
            deactivated_at: new Date().toISOString(),
          },
        })
        .eq("id", chunk.id);
      deactivated++;
    } else {
      await supabase
        .from("olive_memory_chunks")
        .update({ decay_factor: newDecay })
        .eq("id", chunk.id);
      decayed++;
    }
  }

  return { decayed, deactivated };
}

/**
 * 2. MEMORY CONSOLIDATION
 * Find semantically similar chunks and merge them into a single,
 * richer chunk. Uses vector similarity (>= 0.92 cosine).
 */
async function runMemoryConsolidation(
  supabase: any,
  userId: string
): Promise<{ consolidated: number; merged_groups: number }> {
  // Get all active chunks with embeddings
  const { data: chunks } = await supabase
    .from("olive_memory_chunks")
    .select("id, content, chunk_type, importance, source, embedding, created_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .not("embedding", "is", null)
    .order("created_at", { ascending: true })
    .limit(500);

  if (!chunks || chunks.length < 2) {
    return { consolidated: 0, merged_groups: 0 };
  }

  const mergedIds = new Set<string>();
  let consolidated = 0;
  let merged_groups = 0;

  for (const chunk of chunks) {
    if (mergedIds.has(chunk.id)) continue;

    // Find similar chunks using DB function
    const { data: similar } = await supabase.rpc("find_similar_chunks", {
      p_user_id: userId,
      p_embedding: chunk.embedding,
      p_threshold: 0.92,
      p_limit: 5,
    });

    if (!similar || similar.length <= 1) continue;

    // Filter out already-merged chunks and self
    const candidates = similar.filter(
      (s: any) => s.id !== chunk.id && !mergedIds.has(s.id)
    );

    if (candidates.length === 0) continue;

    // Use AI to merge the chunks into a single, better statement
    const allContents = [chunk.content, ...candidates.map((c: any) => c.content)];
    const mergePrompt = `Merge these similar memory facts into a single, comprehensive statement that preserves all unique information. Keep it concise (1-3 sentences max).

Facts to merge:
${allContents.map((c: string, i: number) => `${i + 1}. ${c}`).join("\n")}

Return ONLY the merged statement, nothing else.`;

    try {
      const mergedContent = await callGemini(mergePrompt, 0.1, 256);
      if (!mergedContent || mergedContent.trim().length < 10) continue;

      const cleanMerged = mergedContent.trim();

      // Generate embedding FIRST — if this fails, we abort the merge
      // to avoid corrupting the chunk with missing embedding data
      let newEmbedding: number[];
      try {
        newEmbedding = await generateEmbedding(cleanMerged);
      } catch (embErr) {
        console.warn("[Consolidation] Embedding failed, skipping merge for chunk", chunk.id, embErr);
        continue;
      }

      // Keep the highest importance from the group
      const maxImportance = Math.max(
        chunk.importance,
        ...candidates.map((c: any) => c.importance)
      );

      // Update the oldest chunk with merged content
      const { error: updateErr } = await supabase
        .from("olive_memory_chunks")
        .update({
          content: cleanMerged,
          importance: maxImportance,
          embedding: newEmbedding,
          metadata: {
            consolidated: true,
            merged_from: [chunk.id, ...candidates.map((c: any) => c.id)],
            merged_at: new Date().toISOString(),
            original_content: chunk.content,
          },
        })
        .eq("id", chunk.id);

      if (updateErr) {
        console.error("[Consolidation] Update failed:", updateErr);
        continue;
      }

      // Deactivate the merged-away chunks
      for (const candidate of candidates) {
        await supabase
          .from("olive_memory_chunks")
          .update({
            is_active: false,
            consolidated_into: chunk.id,
          })
          .eq("id", candidate.id);
        mergedIds.add(candidate.id);
        consolidated++;
      }

      mergedIds.add(chunk.id);
      merged_groups++;
    } catch (e) {
      console.error("[Consolidation] Merge failed for chunk", chunk.id, e);
    }
  }

  return { consolidated, merged_groups };
}

/**
 * 3. CONTRADICTION DETECTION
 * Compare chunks pairwise (within importance tiers) to find
 * conflicting facts. Uses AI to judge contradictions.
 */
async function runContradictionDetection(
  supabase: any,
  userId: string
): Promise<{ detected: number; auto_resolved: number }> {
  // Get high-importance active chunks (focus on facts that matter)
  const { data: chunks } = await supabase
    .from("olive_memory_chunks")
    .select("id, content, chunk_type, importance, created_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .in("chunk_type", ["fact", "preference", "personal_info"])
    .gte("importance", 3)
    .order("importance", { ascending: false })
    .limit(100);

  if (!chunks || chunks.length < 2) {
    return { detected: 0, auto_resolved: 0 };
  }

  // Build a batch of facts for AI analysis
  const factsText = chunks
    .map((c: any, i: number) => `[${i}] ${c.content}`)
    .join("\n");

  const prompt = `Analyze these memory facts and identify any contradictions (conflicting or inconsistent statements about the same topic).

Facts:
${factsText}

For each contradiction found, return a JSON array of objects with:
- "a": index of first fact
- "b": index of second fact
- "type": one of "factual", "preference", "temporal", "behavioral"
- "confidence": 0.0-1.0 (how certain is the contradiction)
- "resolution": "keep_newer" if the newer fact supersedes, "merge" if both have partial truth, "ask_user" if ambiguous

Return ONLY a JSON array. If no contradictions, return [].
Example: [{"a":0,"b":3,"type":"preference","confidence":0.9,"resolution":"keep_newer"}]`;

  let detected = 0;
  let auto_resolved = 0;

  try {
    const response = await callGemini(prompt, 0.1, 1024);

    // Robust JSON extraction: try full response first, then regex
    let contradictions: any[];
    try {
      contradictions = JSON.parse(response.trim());
    } catch {
      // Try extracting first valid JSON array
      const jsonMatch = response.match(/\[(?:[^\[\]]*|\[(?:[^\[\]]*|\[[^\[\]]*\])*\])*\]/);
      if (!jsonMatch) return { detected: 0, auto_resolved: 0 };
      try {
        contradictions = JSON.parse(jsonMatch[0]);
      } catch {
        console.warn("[Contradiction] Failed to parse AI response:", response.substring(0, 200));
        return { detected: 0, auto_resolved: 0 };
      }
    }

    if (!Array.isArray(contradictions)) return { detected: 0, auto_resolved: 0 };

    for (const c of contradictions) {
      if (
        typeof c.a !== "number" ||
        typeof c.b !== "number" ||
        c.a >= chunks.length ||
        c.b >= chunks.length
      )
        continue;

      const chunkA = chunks[c.a];
      const chunkB = chunks[c.b];

      // Check if this contradiction pair already exists
      const { data: existing } = await supabase
        .from("olive_memory_contradictions")
        .select("id")
        .eq("user_id", userId)
        .or(
          `and(chunk_a_id.eq.${chunkA.id},chunk_b_id.eq.${chunkB.id}),and(chunk_a_id.eq.${chunkB.id},chunk_b_id.eq.${chunkA.id})`
        )
        .limit(1);

      if (existing && existing.length > 0) continue;

      // Log the contradiction
      await supabase.from("olive_memory_contradictions").insert({
        user_id: userId,
        chunk_a_id: chunkA.id,
        chunk_b_id: chunkB.id,
        chunk_a_content: chunkA.content,
        chunk_b_content: chunkB.content,
        contradiction_type: c.type || "factual",
        confidence: c.confidence || 0.5,
        resolution: c.resolution === "ask_user" ? "unresolved" : c.resolution || "unresolved",
      });
      detected++;

      // Auto-resolve "keep_newer" contradictions
      if (c.resolution === "keep_newer" && c.confidence >= 0.8) {
        const older =
          new Date(chunkA.created_at) < new Date(chunkB.created_at)
            ? chunkA
            : chunkB;
        const newer =
          older.id === chunkA.id ? chunkB : chunkA;

        // Deactivate the older chunk
        await supabase
          .from("olive_memory_chunks")
          .update({
            is_active: false,
            metadata: {
              deactivated_reason: "contradiction_superseded",
              superseded_by: newer.id,
              deactivated_at: new Date().toISOString(),
            },
          })
          .eq("id", older.id);

        // Mark contradiction as resolved
        await supabase
          .from("olive_memory_contradictions")
          .update({
            resolution: "keep_newer",
            resolved_content: newer.content,
            resolved_at: new Date().toISOString(),
          })
          .eq("user_id", userId)
          .eq("chunk_a_id", chunkA.id)
          .eq("chunk_b_id", chunkB.id);

        auto_resolved++;
      }
    }
  } catch (e) {
    console.error("[Contradiction] Detection failed:", e);
  }

  return { detected, auto_resolved };
}

/**
 * 4. ENTITY DEDUPLICATION
 * Find and merge duplicate entities in the knowledge graph.
 * Uses name similarity + type matching.
 */
async function runEntityDedup(
  supabase: any,
  userId: string
): Promise<{ duplicates_found: number; merged: number }> {
  const { data: entities } = await supabase
    .from("olive_entities")
    .select("id, name, entity_type, mention_count, first_seen, metadata")
    .eq("user_id", userId)
    .order("mention_count", { ascending: false })
    .limit(200);

  if (!entities || entities.length < 2) {
    return { duplicates_found: 0, merged: 0 };
  }

  let duplicates_found = 0;
  let merged = 0;
  const processedIds = new Set<string>();

  for (let i = 0; i < entities.length; i++) {
    if (processedIds.has(entities[i].id)) continue;

    const dupes: any[] = [];

    for (let j = i + 1; j < entities.length; j++) {
      if (processedIds.has(entities[j].id)) continue;

      // Same type + similar name
      if (entities[i].entity_type !== entities[j].entity_type) continue;

      const nameA = entities[i].name.toLowerCase().trim();
      const nameB = entities[j].name.toLowerCase().trim();

      // Exact match (case-insensitive)
      if (nameA === nameB) {
        dupes.push(entities[j]);
        continue;
      }

      // One is substring of other (e.g., "Marco" vs "Marco Rossi")
      if (nameA.includes(nameB) || nameB.includes(nameA)) {
        // Short name is likely an abbreviation of the longer one
        if (Math.abs(nameA.length - nameB.length) <= 15) {
          dupes.push(entities[j]);
          continue;
        }
      }

      // Levenshtein-like: very similar names (typos)
      if (nameA.length > 3 && nameB.length > 3) {
        const maxLen = Math.max(nameA.length, nameB.length);
        let matches = 0;
        for (let k = 0; k < Math.min(nameA.length, nameB.length); k++) {
          if (nameA[k] === nameB[k]) matches++;
        }
        if (matches / maxLen > 0.85) {
          dupes.push(entities[j]);
        }
      }
    }

    if (dupes.length === 0) continue;
    duplicates_found += dupes.length;

    // Merge: keep the entity with highest mention_count
    const primary = entities[i];
    const totalMentions =
      primary.mention_count +
      dupes.reduce((sum: number, d: any) => sum + d.mention_count, 0);

    // Use the longest name (most complete)
    const allNames = [primary, ...dupes];
    const bestName = allNames.reduce((best: any, e: any) =>
      e.name.length > best.name.length ? e : best
    ).name;

    // Update primary entity
    await supabase
      .from("olive_entities")
      .update({
        name: bestName,
        mention_count: totalMentions,
        metadata: {
          ...(primary.metadata || {}),
          merged_from: dupes.map((d: any) => ({
            id: d.id,
            name: d.name,
            mentions: d.mention_count,
          })),
          merged_at: new Date().toISOString(),
        },
      })
      .eq("id", primary.id);

    // Re-point relationships from dupes to primary
    for (const dupe of dupes) {
      await supabase
        .from("olive_relationships")
        .update({ source_entity_id: primary.id })
        .eq("source_entity_id", dupe.id);

      await supabase
        .from("olive_relationships")
        .update({ target_entity_id: primary.id })
        .eq("target_entity_id", dupe.id);

      // Delete the duplicate entity
      await supabase.from("olive_entities").delete().eq("id", dupe.id);

      processedIds.add(dupe.id);
      merged++;
    }
  }

  return { duplicates_found, merged };
}

// ─── Repair: backfill missing embeddings ────────────────────────────

async function repairMissingEmbeddings(
  supabase: any,
  userId: string
): Promise<{ repaired: number }> {
  const { data: chunks } = await supabase
    .from("olive_memory_chunks")
    .select("id, content")
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("embedding", null)
    .limit(50);

  if (!chunks || chunks.length === 0) return { repaired: 0 };

  let repaired = 0;
  for (const chunk of chunks) {
    try {
      const embedding = await generateEmbedding(chunk.content);
      await supabase
        .from("olive_memory_chunks")
        .update({ embedding })
        .eq("id", chunk.id);
      repaired++;
    } catch (e) {
      console.error("[Repair] Embedding failed for chunk", chunk.id, e);
    }
  }
  return { repaired };
}

// ─── Ritual Detection ──────────────────────────────────────────────

/**
 * 5. RITUAL DETECTION
 * Scan completed clerk_notes (last 60 days) for recurring patterns.
 * Groups by category + summary keyword overlap. When 3+ occurrences
 * span 4+ weeks, creates a user_memory with category='ritual'.
 * No external API calls — pure string matching.
 */
async function detectRituals(
  supabase: any,
  userId: string
): Promise<{ detected: number; skipped_duplicates: number }> {
  try {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    const { data: notes } = await supabase
      .from("clerk_notes")
      .select("id, category, summary, completed_at")
      .eq("author_id", userId)
      .eq("completed", true)
      .gte("completed_at", sixtyDaysAgo)
      .order("completed_at", { ascending: true });

    if (!notes || notes.length < 3) {
      return { detected: 0, skipped_duplicates: 0 };
    }

    // Stop words to exclude from keyword extraction
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "shall", "can", "to", "of", "in", "for",
      "on", "with", "at", "by", "from", "as", "into", "about", "and", "or",
      "but", "not", "no", "so", "if", "then", "than", "too", "very", "just",
      "it", "its", "my", "me", "we", "our", "you", "your", "he", "she",
      "his", "her", "they", "them", "their", "this", "that", "i",
    ]);

    // Extract first 3 significant words from a summary
    function extractKeywords(summary: string): string {
      if (!summary) return "";
      const words = summary
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w));
      return words.slice(0, 3).sort().join("|");
    }

    // Group notes by (category, keyword_group)
    const groups = new Map<string, Array<{ id: string; summary: string; completed_at: string }>>();

    for (const note of notes) {
      const cat = (note.category || "uncategorized").toLowerCase().trim();
      const kw = extractKeywords(note.summary || "");
      if (!kw) continue; // Skip notes with no meaningful keywords

      const key = `${cat}::${kw}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(note);
    }

    let detected = 0;
    let skipped_duplicates = 0;

    for (const [key, entries] of groups) {
      // Need 3+ occurrences
      if (entries.length < 3) continue;

      // Check date spread: must span 4+ weeks (28 days)
      const dates = entries.map((e) => new Date(e.completed_at).getTime());
      const earliest = Math.min(...dates);
      const latest = Math.max(...dates);
      const spreadDays = (latest - earliest) / (1000 * 60 * 60 * 24);
      if (spreadDays < 28) continue;

      const spreadWeeks = Math.round(spreadDays / 7);
      const [category] = key.split("::");

      // Build a human-readable description from the most common summary
      const summaryWords = entries[0].summary || category;
      // Use first ~50 chars of the most representative summary
      const description = summaryWords.length > 50
        ? summaryWords.substring(0, 50).trim()
        : summaryWords.trim();

      const ritualTitle = `Ritual: ${description}`;

      // Check for existing ritual memory to prevent duplicates
      const { data: existing } = await supabase
        .from("user_memories")
        .select("id")
        .eq("user_id", userId)
        .eq("category", "ritual")
        .ilike("title", `%${description.substring(0, 30)}%`)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped_duplicates++;
        continue;
      }

      // Insert new ritual memory
      const { error } = await supabase.from("user_memories").insert({
        user_id: userId,
        title: ritualTitle,
        content: `${description} — detected ${entries.length} times over the past ${spreadWeeks} weeks`,
        category: "ritual",
        importance: 4,
        is_active: true,
      });

      if (!error) {
        detected++;
        console.log(`[Ritual] Detected: "${ritualTitle}" (${entries.length} occurrences over ${spreadWeeks} weeks)`);
      } else {
        console.error("[Ritual] Insert failed:", error);
      }
    }

    return { detected, skipped_duplicates };
  } catch (e) {
    console.error("[Ritual] Detection failed:", e);
    return { detected: 0, skipped_duplicates: 0 };
  }
}

// ─── Main handler ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const body = await req.json().catch(() => ({}));
    const action = body.action || "run_maintenance";
    const runType = body.run_type || "full";
    const targetUserId = body.user_id; // Optional: run for specific user

    console.log(`[Maintenance] Action: ${action}, Type: ${runType}`);

    // ── Health check ──────────────────────────────────────────────
    if (action === "health") {
      if (!targetUserId) {
        return new Response(
          JSON.stringify({ error: "user_id required for health check" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: health } = await supabase.rpc("get_memory_health", {
        p_user_id: targetUserId,
      });

      return new Response(JSON.stringify({ health }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Get users to maintain ─────────────────────────────────────
    let userIds: string[] = [];

    if (targetUserId) {
      userIds = [targetUserId];
    } else {
      // Get all users with enough data
      const { data: users } = await supabase.rpc(
        "get_active_compilation_users"
      );
      userIds = users?.map((u: any) => u.user_id) || [];
    }

    if (userIds.length === 0) {
      console.log("[Maintenance] No users to maintain");
      return new Response(
        JSON.stringify({ message: "No users to maintain", users: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Maintenance] Processing ${userIds.length} users`);

    const allResults: Record<string, any> = {};

    for (const userId of userIds) {
      console.log(`[Maintenance] Processing user: ${userId}`);

      // Log maintenance run start
      const { data: logEntry } = await supabase
        .from("olive_memory_maintenance_log")
        .insert({
          user_id: userId,
          run_type: runType,
          status: "running",
        })
        .select()
        .single();

      const logId = logEntry?.id;
      const stats: Record<string, any> = {};

      try {
        // Step 0: Repair missing embeddings (prerequisite for consolidation)
        const repairResult = await repairMissingEmbeddings(supabase, userId);
        stats.repair = repairResult;
        console.log(`[Maintenance] Repaired ${repairResult.repaired} embeddings`);

        // Step 1: Importance Decay
        if (runType === "full" || runType === "decay") {
          const decayResult = await runImportanceDecay(supabase, userId);
          stats.decay = decayResult;
          console.log(
            `[Maintenance] Decay: ${decayResult.decayed} decayed, ${decayResult.deactivated} deactivated`
          );
        }

        // Step 2: Memory Consolidation
        if (runType === "full" || runType === "consolidation") {
          const consolResult = await runMemoryConsolidation(supabase, userId);
          stats.consolidation = consolResult;
          console.log(
            `[Maintenance] Consolidation: ${consolResult.merged_groups} groups, ${consolResult.consolidated} chunks merged`
          );
        }

        // Step 3: Contradiction Detection
        if (runType === "full" || runType === "contradiction") {
          const contraResult = await runContradictionDetection(supabase, userId);
          stats.contradictions = contraResult;
          console.log(
            `[Maintenance] Contradictions: ${contraResult.detected} found, ${contraResult.auto_resolved} auto-resolved`
          );
        }

        // Step 4: Entity Deduplication
        if (runType === "full" || runType === "entity_dedup") {
          const dedupResult = await runEntityDedup(supabase, userId);
          stats.entity_dedup = dedupResult;
          console.log(
            `[Maintenance] Entity dedup: ${dedupResult.duplicates_found} found, ${dedupResult.merged} merged`
          );
        }

        // Step 5: Ritual Detection
        if (runType === "full" || runType === "ritual_detection") {
          const ritualResult = await detectRituals(supabase, userId);
          stats.rituals = ritualResult;
          console.log(
            `[Maintenance] Rituals: ${ritualResult.detected} detected, ${ritualResult.skipped_duplicates} duplicates skipped`
          );
        }

        // Update log entry
        if (logId) {
          await supabase
            .from("olive_memory_maintenance_log")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
              stats,
            })
            .eq("id", logId);
        }

        allResults[userId] = { status: "completed", stats };
      } catch (userErr) {
        console.error(`[Maintenance] Error for user ${userId}:`, userErr);

        if (logId) {
          await supabase
            .from("olive_memory_maintenance_log")
            .update({
              status: "failed",
              completed_at: new Date().toISOString(),
              error_message: String(userErr),
              stats,
            })
            .eq("id", logId);
        }

        allResults[userId] = { status: "failed", error: String(userErr), stats };
      }
    }

    return new Response(
      JSON.stringify({
        action,
        run_type: runType,
        users_processed: userIds.length,
        results: allResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Maintenance] Fatal error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
