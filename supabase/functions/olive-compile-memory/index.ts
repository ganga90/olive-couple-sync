/**
 * Olive Compile Memory — Karpathy "Second Brain" Compilation Layer
 *
 * Converts raw memory chunks, notes, and user memories into structured
 * wiki-style markdown files that Olive's AI can reference instantly.
 *
 * File types produced:
 *   - profile:      Who the user is, preferences, personal info
 *   - patterns:     Behavioral patterns, routines, recurring themes
 *   - relationship: Partner dynamics, shared goals, couple activities
 *   - household:    Home management, logistics, shared responsibilities
 *
 * Runs on pg_cron daily at 2am, or on-demand via API call.
 * Inspired by Karpathy's "raw data → LLM compile → structured wiki" pattern.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createLLMTracker } from "../_shared/llm-tracker.ts";
import { getCompilePromptVersion } from "../_shared/prompts/compile-prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface CompileRequest {
  action: "compile" | "compile_user" | "lint" | "status";
  user_id?: string;
  force?: boolean; // Recompile even if content hash unchanged
}

type FileType = "profile" | "patterns" | "relationship" | "household";

interface RawContext {
  notes: Array<{
    summary: string;
    category: string;
    original_text: string;
    priority: string;
    completed: boolean;
    due_date: string | null;
    created_at: string;
  }>;
  memories: Array<{
    title: string;
    content: string;
    category: string;
    importance: number;
  }>;
  entities: Array<{
    name: string;
    entity_type: string;
    mention_count: number;
    metadata: Record<string, any>;
  }>;
  relationships: Array<{
    source_name: string;
    target_name: string;
    relationship_type: string;
    strength: number;
  }>;
  existingFiles: Record<FileType, { content: string; content_hash: string } | null>;
  coupleId: string | null;
  partnerEntities: Array<{ name: string; entity_type: string; mention_count: number; user_id: string }>;
  partnerRelationships: Array<{ source_name: string; target_name: string; relationship_type: string; strength: number }>;
  partnerName: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function generateWithGemini(
  prompt: string,
  maxTokens = 2048
): Promise<string | null> {
  const GEMINI_API_KEY =
    Deno.env.get("GEMINI_API") || Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) {
    console.error("[compile-memory] No Gemini API key");
    return null;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: maxTokens,
          },
        }),
      }
    );

    if (!response.ok) {
      console.error(
        "[compile-memory] Gemini error:",
        response.status,
        await response.text()
      );
      return null;
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (error) {
    console.error("[compile-memory] Gemini call failed:", error);
    return null;
  }
}

async function generateEmbedding(text: string): Promise<number[] | null> {
  const GEMINI_API_KEY =
    Deno.env.get("GEMINI_API") || Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) return null;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { parts: [{ text: text.slice(0, 2000) }] },
          outputDimensionality: 768,
        }),
      }
    );

    if (!response.ok) return null;
    const data = await response.json();
    return data.embedding?.values || null;
  } catch {
    return null;
  }
}

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Data Gathering ──────────────────────────────────────────────────────────

async function gatherRawContext(
  supabase: any,
  userId: string
): Promise<RawContext> {
  // Fetch all sources in parallel
  const [notesRes, memoriesRes, entitiesRes, relsRes, filesRes, profileRes] =
    await Promise.all([
      // Recent notes (last 90 days, max 200)
      supabase
        .from("clerk_notes")
        .select(
          "summary, category, original_text, priority, completed, due_date, created_at"
        )
        .eq("author_id", userId)
        .gte(
          "created_at",
          new Date(Date.now() - 90 * 86400000).toISOString()
        )
        .order("created_at", { ascending: false })
        .limit(200),

      // All active user memories
      supabase
        .from("user_memories")
        .select("title, content, category, importance")
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("importance", { ascending: false })
        .limit(50),

      // Knowledge graph entities
      supabase
        .from("olive_entities")
        .select("name, entity_type, mention_count, metadata")
        .eq("user_id", userId)
        .order("mention_count", { ascending: false })
        .limit(50),

      // Knowledge graph relationships
      supabase
        .from("olive_relationships")
        .select(
          "source:source_entity_id(name), target:target_entity_id(name), relationship_type, strength"
        )
        .eq("user_id", userId)
        .order("strength", { ascending: false })
        .limit(30),

      // Existing compiled files
      supabase
        .from("olive_memory_files")
        .select("file_type, content, content_hash")
        .eq("user_id", userId)
        .in("file_type", ["profile", "patterns", "relationship", "household"])
        .is("file_date", null),

      // Couple membership
      supabase
        .from("clerk_profiles")
        .select("couple_id")
        .eq("id", userId)
        .single(),
    ]);

  // Build existing files map
  const existingFiles: Record<FileType, { content: string; content_hash: string } | null> = {
    profile: null,
    patterns: null,
    relationship: null,
    household: null,
  };
  for (const f of filesRes.data || []) {
    existingFiles[f.file_type as FileType] = {
      content: f.content,
      content_hash: f.content_hash,
    };
  }

  // Flatten relationships (handle joined data)
  const relationships = (relsRes.data || [])
    .filter((r: any) => r.source?.name && r.target?.name)
    .map((r: any) => ({
      source_name: r.source.name,
      target_name: r.target.name,
      relationship_type: r.relationship_type,
      strength: r.strength,
    }));

  const coupleId = profileRes.data?.couple_id || null;

  // Fetch partner data if couple exists
  let partnerEntities: RawContext["partnerEntities"] = [];
  let partnerRelationships: RawContext["partnerRelationships"] = [];
  let partnerName: string | null = null;

  if (coupleId) {
    try {
      // Find partner user_ids via couple members
      const { data: coupleMembers } = await supabase
        .from("clerk_couple_members")
        .select("user_id")
        .eq("couple_id", coupleId)
        .neq("user_id", userId);

      const partnerIds = (coupleMembers || []).map((m: any) => m.user_id);

      if (partnerIds.length > 0) {
        const [pEntitiesRes, pRelsRes, pProfileRes] = await Promise.all([
          supabase
            .from("olive_entities")
            .select("name, entity_type, mention_count, user_id")
            .in("user_id", partnerIds)
            .order("mention_count", { ascending: false })
            .limit(50),

          supabase
            .from("olive_relationships")
            .select(
              "source:source_entity_id(name), target:target_entity_id(name), relationship_type, strength"
            )
            .in("user_id", partnerIds)
            .order("strength", { ascending: false })
            .limit(30),

          supabase
            .from("clerk_profiles")
            .select("first_name, last_name")
            .eq("id", partnerIds[0])
            .single(),
        ]);

        partnerEntities = (pEntitiesRes.data || []).map((e: any) => ({
          name: e.name,
          entity_type: e.entity_type,
          mention_count: e.mention_count,
          user_id: e.user_id,
        }));

        partnerRelationships = (pRelsRes.data || [])
          .filter((r: any) => r.source?.name && r.target?.name)
          .map((r: any) => ({
            source_name: r.source.name,
            target_name: r.target.name,
            relationship_type: r.relationship_type,
            strength: r.strength,
          }));

        if (pProfileRes.data) {
          partnerName = [pProfileRes.data.first_name, pProfileRes.data.last_name]
            .filter(Boolean)
            .join(" ") || null;
        }
      }
    } catch (err) {
      console.error("[compile-memory] Partner data fetch failed (non-fatal):", err);
    }
  }

  return {
    notes: notesRes.data || [],
    memories: memoriesRes.data || [],
    entities: entitiesRes.data || [],
    relationships,
    existingFiles,
    coupleId,
    partnerEntities,
    partnerRelationships,
    partnerName,
  };
}

// ─── Compilation Prompts ─────────────────────────────────────────────────────

function buildCompilePrompt(
  fileType: FileType,
  raw: RawContext
): string | null {
  // Build a data summary for the LLM
  const notesSummary = raw.notes
    .slice(0, 100)
    .map(
      (n) =>
        `[${n.category}] ${n.summary || n.original_text?.slice(0, 100)}${n.priority === "high" ? " (HIGH)" : ""}${n.completed ? " (DONE)" : ""}`
    )
    .join("\n");

  const memoriesSummary = raw.memories
    .map((m) => `[${m.category}, importance:${m.importance}] ${m.title}: ${m.content}`)
    .join("\n");

  const entitiesSummary = raw.entities
    .map((e) => `${e.name} (${e.entity_type}, mentioned ${e.mention_count}x)`)
    .join("\n");

  const relsSummary = raw.relationships
    .map(
      (r) =>
        `${r.source_name} --[${r.relationship_type}]--> ${r.target_name} (strength: ${r.strength})`
    )
    .join("\n");

  const existing = raw.existingFiles[fileType]?.content || "(none yet)";

  // Skip if not enough data
  const totalData =
    notesSummary.length + memoriesSummary.length + entitiesSummary.length;
  if (totalData < 50) return null;

  const baseContext = `
=== USER'S NOTES (last 90 days) ===
${notesSummary || "(none)"}

=== STORED MEMORIES ===
${memoriesSummary || "(none)"}

=== KNOWN ENTITIES ===
${entitiesSummary || "(none)"}

=== RELATIONSHIPS ===
${relsSummary || "(none)"}

=== CURRENT COMPILED ${fileType.toUpperCase()} FILE ===
${existing}
`.trim();

  switch (fileType) {
    case "profile":
      return `You are compiling a user profile wiki from raw data. Extract and organize:
- Name, location, language preferences
- Personal preferences and habits
- Dietary restrictions, allergies
- Interests, hobbies
- Work/career info
- Important dates (birthdays, anniversaries)
- Communication style preferences

Write as concise structured markdown with sections and bullet points.
Keep it factual — only include information clearly supported by the data.
If the current compiled file exists, UPDATE it with new information (don't lose existing facts).
Max 600 words.

${baseContext}

OUTPUT (markdown only, no preamble):`;

    case "patterns":
      return `You are compiling a behavioral patterns file from raw data. Extract and organize:
- Daily/weekly routines and schedules
- Recurring task types and frequencies
- Category usage patterns (what they track most)
- Priority patterns (what they mark urgent)
- Time-of-day activity patterns
- Seasonal or periodic behaviors
- Productivity patterns

Write as concise structured markdown with sections and bullet points.
Only include patterns with clear evidence from the data (2+ occurrences).
If the current compiled file exists, UPDATE it — preserve established patterns, add new ones.
Max 500 words.

${baseContext}

OUTPUT (markdown only, no preamble):`;

    case "relationship": {
      let partnerSection = "";
      if (raw.partnerEntities.length > 0) {
        const partnerEntitiesSummary = raw.partnerEntities
          .map((e) => `${e.name} (${e.entity_type}, mentioned ${e.mention_count}x)`)
          .join("\n");
        partnerSection = `

=== PARTNER'S KNOWN ENTITIES ===
${raw.partnerName ? `Partner name: ${raw.partnerName}` : ""}
${partnerEntitiesSummary}`;
      }

      return `You are compiling a relationship dynamics file from raw data. Extract and organize:
- Partner information (if couple data exists)
- Shared activities and interests
- Communication patterns with partner
- Shared goals and plans
- Task delegation patterns (who does what)
- Date ideas and shared experiences
- Gift ideas and occasions
- Cross-referenced entities (things both partners track or mention)

If no partner/couple data exists, note that and focus on social relationships.
Write as concise structured markdown with sections and bullet points.
If the current compiled file exists, UPDATE it with new information.
Max 400 words.

${baseContext}${partnerSection}

OUTPUT (markdown only, no preamble):`;
    }

    case "household": {
      let partnerHouseholdSection = "";
      if (raw.partnerEntities.length > 0) {
        const partnerEntitiesSummary = raw.partnerEntities
          .map((e) => `${e.name} (${e.entity_type}, mentioned ${e.mention_count}x)`)
          .join("\n");
        const partnerRelsSummary = raw.partnerRelationships
          .map(
            (r) =>
              `${r.source_name} --[${r.relationship_type}]--> ${r.target_name} (strength: ${r.strength})`
          )
          .join("\n");
        partnerHouseholdSection = `

=== PARTNER'S KNOWN ENTITIES ===
${raw.partnerName ? `Partner name: ${raw.partnerName}` : ""}
${partnerEntitiesSummary}

=== PARTNER'S RELATIONSHIPS ===
${partnerRelsSummary || "(none)"}`;
      }

      return `You are compiling a household management file from raw data. Extract and organize:
- Home-related tasks and their frequency
- Shopping patterns and preferred stores
- Grocery lists and common items
- Home improvement projects (active and completed)
- Pet care routines (if applicable)
- Automotive maintenance
- Meal planning and recipes
- Recurring expenses and budget categories
- Shared household responsibilities across both partners (if couple data available)

Write as concise structured markdown with sections and bullet points.
Only include information clearly supported by the data.
If partner data is available, cross-reference to build a complete household picture.
If the current compiled file exists, UPDATE it with new information.
Max 500 words.

${baseContext}${partnerHouseholdSection}

OUTPUT (markdown only, no preamble):`;
    }

    default:
      return null;
  }
}

// ─── Compile & Upsert ────────────────────────────────────────────────────────

async function compileFile(
  supabase: any,
  userId: string,
  fileType: FileType,
  raw: RawContext,
  force: boolean
): Promise<{ fileType: FileType; status: string; changed: boolean }> {
  const prompt = buildCompilePrompt(fileType, raw);
  if (!prompt) {
    return { fileType, status: "skipped_no_data", changed: false };
  }

  // Generate compiled content via tracked LLM call
  const tracker = createLLMTracker(supabase, "olive-compile-memory", userId);
  const trackerResponse = await tracker.generate(
    { model: "gemini-2.0-flash", contents: prompt, config: { temperature: 0.2, maxOutputTokens: 2048 } },
    { promptVersion: getCompilePromptVersion(fileType as any) }
  );
  const compiled = trackerResponse?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  if (!compiled || compiled.trim().length < 20) {
    return { fileType, status: "gemini_failed", changed: false };
  }

  // Check if content actually changed
  const newHash = await sha256(compiled);
  const existing = raw.existingFiles[fileType];

  if (!force && existing?.content_hash === newHash) {
    return { fileType, status: "unchanged", changed: false };
  }

  // Estimate token count
  const tokenCount = Math.ceil(compiled.length / 4);

  // Generate embedding for the compiled content
  const embedding = await generateEmbedding(compiled);

  // Check if file exists (NULL file_date requires explicit IS NULL check)
  const { data: existingRow } = await supabase
    .from("olive_memory_files")
    .select("id")
    .eq("user_id", userId)
    .eq("file_type", fileType)
    .is("file_date", null)
    .single();

  const writeData: Record<string, any> = {
    content: compiled,
    content_hash: newHash,
    token_count: tokenCount,
    metadata: {
      compiled_at: new Date().toISOString(),
      source_notes: raw.notes.length,
      source_memories: raw.memories.length,
      source_entities: raw.entities.length,
    },
    updated_at: new Date().toISOString(),
  };

  if (embedding) {
    writeData.embedding = JSON.stringify(embedding);
  }

  // For household files, store couple_id so both partners can access
  if (fileType === "household" && raw.coupleId) {
    writeData.couple_id = raw.coupleId;
  }

  let error;
  if (existingRow?.id) {
    // Update existing
    ({ error } = await supabase
      .from("olive_memory_files")
      .update(writeData)
      .eq("id", existingRow.id));
  } else {
    // Insert new
    ({ error } = await supabase
      .from("olive_memory_files")
      .insert({
        user_id: userId,
        file_type: fileType,
        file_date: null,
        ...writeData,
      }));
  }

  if (error) {
    console.error(
      `[compile-memory] Upsert error for ${fileType}:`,
      error
    );
    return { fileType, status: `error: ${error.message}`, changed: false };
  }

  console.log(
    `[compile-memory] Compiled ${fileType}: ${tokenCount} tokens, hash=${newHash.slice(0, 8)}`
  );
  return { fileType, status: "compiled", changed: true };
}

async function compileAllForUser(
  supabase: any,
  userId: string,
  force: boolean
): Promise<{
  user_id: string;
  results: Array<{ fileType: FileType; status: string; changed: boolean }>;
}> {
  console.log(`[compile-memory] Starting compilation for user: ${userId}`);

  // Gather all raw data
  const raw = await gatherRawContext(supabase, userId);

  console.log(
    `[compile-memory] Gathered: ${raw.notes.length} notes, ${raw.memories.length} memories, ${raw.entities.length} entities`
  );

  // Compile each file type (sequentially to avoid rate limits)
  const fileTypes: FileType[] = [
    "profile",
    "patterns",
    "relationship",
    "household",
  ];
  const results = [];

  for (const ft of fileTypes) {
    const result = await compileFile(supabase, userId, ft, raw, force);
    results.push(result);

    // Small delay between calls to respect rate limits
    if (result.status === "compiled") {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // Cross-user entity resolution for couples
  if (raw.coupleId) {
    try {
      const resolution = await resolveSharedEntities(supabase, raw.coupleId);
      console.log(
        `[compile-memory] Entity resolution for couple ${raw.coupleId}: ${resolution.resolved} resolved, ${resolution.errors.length} errors`
      );
    } catch (err) {
      console.error("[compile-memory] Entity resolution failed (non-fatal):", err);
    }
  }

  return { user_id: userId, results };
}

// ─── Cross-User Entity Resolution ───────────────────────────────────────────

async function resolveSharedEntities(
  supabase: any,
  coupleId: string
): Promise<{ resolved: number; errors: string[] }> {
  const errors: string[] = [];
  let resolved = 0;

  try {
    const { data: sharedEntities, error: rpcError } = await supabase.rpc(
      "find_shared_entities",
      { p_couple_id: coupleId }
    );

    if (rpcError) {
      errors.push(`RPC error: ${rpcError.message}`);
      return { resolved, errors };
    }

    if (!sharedEntities || sharedEntities.length === 0) {
      return { resolved, errors };
    }

    // Fetch mention counts for the entities we need to merge
    const entityIds = sharedEntities
      .filter((p: any) => p.name_similarity >= 0.9)
      .flatMap((p: any) => [p.entity_a_id, p.entity_b_id]);

    if (entityIds.length === 0) return { resolved, errors };

    const { data: entityDetails } = await supabase
      .from("olive_entities")
      .select("id, mention_count, couple_id")
      .in("id", entityIds);

    const mentionMap = new Map<string, number>();
    const alreadyMerged = new Set<string>();
    for (const e of entityDetails || []) {
      mentionMap.set(e.id, e.mention_count || 1);
      // Skip entities already marked with couple_id (already resolved)
      if (e.couple_id) alreadyMerged.add(e.id);
    }

    for (const pair of sharedEntities) {
      try {
        if (pair.name_similarity < 0.9) continue;
        // Skip if already resolved in a previous run
        if (alreadyMerged.has(pair.entity_a_id) && alreadyMerged.has(pair.entity_b_id)) continue;

        const countA = mentionMap.get(pair.entity_a_id) || 1;
        const countB = mentionMap.get(pair.entity_b_id) || 1;
        const keepId = countA >= countB ? pair.entity_a_id : pair.entity_b_id;
        const mergeId = keepId === pair.entity_a_id ? pair.entity_b_id : pair.entity_a_id;
        const totalMentions = countA + countB;

        // Update the keep entity with merged count and mark with couple_id
        const { error: updateError } = await supabase
          .from("olive_entities")
          .update({ mention_count: totalMentions, couple_id: coupleId })
          .eq("id", keepId);

        if (updateError) {
          errors.push(`Failed to update entity ${keepId}: ${updateError.message}`);
          continue;
        }

        // Mark the merge entity with couple_id so it's skipped next run
        await supabase
          .from("olive_entities")
          .update({ couple_id: coupleId })
          .eq("id", mergeId);

        resolved++;
        console.log(
          `[compile-memory] Resolved shared entity: "${pair.entity_a_name}" + "${pair.entity_b_name}" → merged mentions to ${totalMentions}`
        );
      } catch (err) {
        errors.push(`Entity pair merge failed: ${String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`resolveSharedEntities failed: ${String(err)}`);
  }

  return { resolved, errors };
}

// ─── Lint / Health Check ─────────────────────────────────────────────────────

async function lintMemory(
  supabase: any,
  userId: string
): Promise<Record<string, any>> {
  const issues: string[] = [];
  const stats: Record<string, any> = {};

  // Check compiled files
  const { data: files } = await supabase
    .from("olive_memory_files")
    .select("file_type, content, content_hash, token_count, updated_at")
    .eq("user_id", userId)
    .in("file_type", ["profile", "patterns", "relationship", "household"])
    .is("file_date", null);

  const fileTypes: FileType[] = [
    "profile",
    "patterns",
    "relationship",
    "household",
  ];
  const foundTypes = new Set((files || []).map((f: any) => f.file_type));

  for (const ft of fileTypes) {
    if (!foundTypes.has(ft)) {
      issues.push(`Missing compiled file: ${ft}`);
    }
  }

  for (const f of files || []) {
    const age =
      (Date.now() - new Date(f.updated_at).getTime()) / (1000 * 3600);
    stats[f.file_type] = {
      tokens: f.token_count,
      age_hours: Math.round(age),
      has_hash: !!f.content_hash,
    };

    if (age > 48) {
      issues.push(`${f.file_type} is stale (${Math.round(age)}h old)`);
    }

    if (f.token_count > 2000) {
      issues.push(
        `${f.file_type} is too long (${f.token_count} tokens, max 2000)`
      );
    }

    if (!f.content || f.content.trim().length < 10) {
      issues.push(`${f.file_type} has empty or near-empty content`);
    }
  }

  // Check source data health
  const { count: noteCount } = await supabase
    .from("clerk_notes")
    .select("id", { count: "exact", head: true })
    .eq("author_id", userId);

  const { count: memoryCount } = await supabase
    .from("user_memories")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_active", true);

  const { count: embeddingCount } = await supabase
    .from("user_memories")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_active", true)
    .not("embedding", "is", null);

  stats.sources = {
    notes: noteCount || 0,
    memories: memoryCount || 0,
    memories_with_embeddings: embeddingCount || 0,
  };

  if (memoryCount > 0 && embeddingCount < memoryCount) {
    issues.push(
      `${memoryCount - embeddingCount} memories missing embeddings`
    );
  }

  return {
    healthy: issues.length === 0,
    issues,
    stats,
    checked_at: new Date().toISOString(),
  };
}

// ─── Main Handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY"
    )!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body: CompileRequest = await req.json();
    const { action, user_id, force = false } = body;

    console.log("[compile-memory] Action:", action, "User:", user_id || "all");

    switch (action) {
      // ── Compile single user ──
      case "compile_user": {
        if (!user_id) {
          return new Response(
            JSON.stringify({ success: false, error: "user_id required" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        const result = await compileAllForUser(supabase, user_id, force);

        return new Response(
          JSON.stringify({ success: true, ...result }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // ── Compile all active users (for pg_cron) ──
      case "compile": {
        // Get all users with at least 10 notes (worth compiling)
        const { data: activeUsers, error: usersErr } = await supabase.rpc(
          "get_active_compilation_users"
        );

        // Fallback: query directly if RPC doesn't exist
        let userIds: string[] = [];
        if (usersErr || !activeUsers) {
          console.log(
            "[compile-memory] RPC not found, querying directly"
          );
          const { data: users } = await supabase
            .from("clerk_notes")
            .select("author_id")
            .gte(
              "created_at",
              new Date(Date.now() - 90 * 86400000).toISOString()
            )
            .limit(1000);

          if (users) {
            const counts: Record<string, number> = {};
            for (const u of users) {
              counts[u.author_id] = (counts[u.author_id] || 0) + 1;
            }
            userIds = Object.entries(counts)
              .filter(([, c]) => c >= 10)
              .map(([id]) => id);
          }
        } else {
          userIds = activeUsers.map((u: any) => u.user_id);
        }

        console.log(
          `[compile-memory] Compiling for ${userIds.length} users`
        );

        const allResults = [];
        for (const uid of userIds) {
          try {
            const result = await compileAllForUser(supabase, uid, force);
            allResults.push(result);
          } catch (err) {
            console.error(
              `[compile-memory] Error compiling user ${uid}:`,
              err
            );
            allResults.push({
              user_id: uid,
              results: [],
              error: String(err),
            });
          }
          // Rate limit between users
          await new Promise((r) => setTimeout(r, 1000));
        }

        return new Response(
          JSON.stringify({
            success: true,
            users_compiled: allResults.length,
            results: allResults,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // ── Lint / health check ──
      case "lint": {
        if (!user_id) {
          return new Response(
            JSON.stringify({ success: false, error: "user_id required" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        const lintResult = await lintMemory(supabase, user_id);

        return new Response(
          JSON.stringify({ success: true, ...lintResult }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // ── Status check ──
      case "status": {
        const { data: fileStats } = await supabase
          .from("olive_memory_files")
          .select("file_type, user_id, token_count, updated_at")
          .in("file_type", [
            "profile",
            "patterns",
            "relationship",
            "household",
          ])
          .is("file_date", null)
          .order("updated_at", { ascending: false })
          .limit(50);

        return new Response(
          JSON.stringify({
            success: true,
            compiled_files: fileStats?.length || 0,
            files: fileStats || [],
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
    }
  } catch (error) {
    console.error("[compile-memory] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
