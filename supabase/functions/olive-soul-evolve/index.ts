/**
 * olive-soul-evolve — SOUL.MD Evolution Engine
 * ===============================================
 * Analyzes user behavior over the last 7 days and evolves the SOUL.MD
 * layers accordingly. Implements the Observe → Reflect → Evolve pipeline.
 *
 * Can be called:
 *   1. By pg_cron (weekly for Plus, daily for Team/Business)
 *   2. Manually via POST for testing
 *
 * POST /olive-soul-evolve
 * Body: { user_id: string } (optional — if omitted, processes all eligible users)
 *
 * The function is designed to be safe:
 *   - Never evolves locked layers
 *   - Major changes require user confirmation (flagged, not auto-applied)
 *   - Maximum one evolution per 24 hours per user
 *   - All changes are logged with rollback capability
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@1.0.0";
import { GEMINI_KEY, getModel } from "../_shared/gemini.ts";
import { getUserSoulContent, upsertSoulLayer } from "../_shared/soul.ts";
import { proposeMajorChange } from "../_shared/soul-proposals.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Types ──────────────────────────────────────────────────────

interface ObservationData {
  notes_by_category: Record<string, number>;
  total_notes_created: number;
  tasks_completed: number;
  tasks_overdue: number;
  proactive_accepted: number;
  proactive_ignored: number;
  proactive_rejected: number;
  new_people_mentioned: string[];
  active_hours: number[];
  channel_usage: Record<string, number>;
  reflections_summary: {
    action_type: string;
    accepted: number;
    modified: number;
    rejected: number;
    ignored: number;
  }[];
}

interface EvolutionProposal {
  section: string;        // which SOUL.MD section to modify
  change_type: string;    // 'add_domain', 'adjust_tone', 'add_relationship', 'adjust_proactivity', 'enable_skill', 'adjust_trust'
  description: string;    // human-readable summary
  is_major: boolean;      // requires user confirmation?
  new_value: any;         // the proposed change
  reason: string;         // why Olive is making this change
}

// ─── Stage 1: OBSERVE ───────────────────────────────────────────

async function observeUserBehavior(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<ObservationData> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Notes created in last 7 days, grouped by category
  const { data: notes } = await supabase
    .from("clerk_notes")
    .select("category, created_at")
    .eq("author_id", userId)
    .gte("created_at", sevenDaysAgo);

  const notesByCategory: Record<string, number> = {};
  for (const note of notes || []) {
    const cat = note.category || "uncategorized";
    notesByCategory[cat] = (notesByCategory[cat] || 0) + 1;
  }

  // Tasks completed
  const { count: tasksCompleted } = await supabase
    .from("clerk_notes")
    .select("id", { count: "exact", head: true })
    .eq("author_id", userId)
    .eq("completed", true)
    .gte("updated_at", sevenDaysAgo);

  // Tasks overdue
  const { count: tasksOverdue } = await supabase
    .from("clerk_notes")
    .select("id", { count: "exact", head: true })
    .eq("author_id", userId)
    .eq("completed", false)
    .lt("due_date", new Date().toISOString())
    .not("due_date", "is", null);

  // Proactive message engagement (from engagement metrics)
  const { data: engagement } = await supabase
    .from("olive_engagement_metrics")
    .select("proactive_accepted_7d, proactive_ignored_7d, proactive_rejected_7d")
    .eq("user_id", userId)
    .maybeSingle();

  // Reflections from last 7 days
  const { data: reflections } = await supabase
    .from("olive_reflections")
    .select("action_type, outcome")
    .eq("user_id", userId)
    .gte("created_at", sevenDaysAgo);

  // Aggregate reflections by action_type
  const reflectionMap: Record<string, { accepted: number; modified: number; rejected: number; ignored: number }> = {};
  for (const r of reflections || []) {
    if (!reflectionMap[r.action_type]) {
      reflectionMap[r.action_type] = { accepted: 0, modified: 0, rejected: 0, ignored: 0 };
    }
    if (r.outcome in reflectionMap[r.action_type]) {
      (reflectionMap[r.action_type] as any)[r.outcome]++;
    }
  }

  return {
    notes_by_category: notesByCategory,
    total_notes_created: (notes || []).length,
    tasks_completed: tasksCompleted || 0,
    tasks_overdue: tasksOverdue || 0,
    proactive_accepted: engagement?.proactive_accepted_7d || 0,
    proactive_ignored: engagement?.proactive_ignored_7d || 0,
    proactive_rejected: engagement?.proactive_rejected_7d || 0,
    new_people_mentioned: [], // TODO: extract from notes via NER in future
    active_hours: [],         // TODO: compute from interaction timestamps
    channel_usage: {},        // TODO: compute from router_log
    reflections_summary: Object.entries(reflectionMap).map(([type, counts]) => ({
      action_type: type,
      ...counts,
    })),
  };
}

// ─── Stage 2: REFLECT (via Gemini) ──────────────────────────────

async function reflectOnObservations(
  currentSoul: Record<string, any>,
  observations: ObservationData
): Promise<EvolutionProposal[]> {
  if (!GEMINI_KEY) {
    console.error("[soul-evolve] No Gemini API key");
    return [];
  }

  const genAI = new GoogleGenAI({ apiKey: GEMINI_KEY });

  const prompt = `You are the SOUL.MD Evolution Engine for Olive, an AI assistant.

Your job: analyze this user's behavior over the last 7 days and propose specific, concrete changes to their SOUL.MD configuration.

## Current SOUL.MD
${JSON.stringify(currentSoul, null, 2)}

## Observations (last 7 days)
${JSON.stringify(observations, null, 2)}

## Rules
1. Only propose changes supported by clear evidence in the observations.
2. Never propose changes that contradict explicit user preferences (locked fields).
3. Mark as is_major=true if the change significantly alters Olive's personality or enables a new domain.
4. Mark as is_major=false for minor adjustments (proactivity tuning, confidence updates).
5. Maximum 5 proposals per evolution cycle.
6. If observations show no significant patterns, return an empty array.
7. Focus on the most impactful changes first.

## Change types you can propose:
- add_domain: Add new domain knowledge (when 10+ notes in a new category)
- adjust_tone: Change communication tone (when reflections show consistent modifications)
- add_relationship: Add a person to the relationship map (when name appears 5+ times)
- adjust_proactivity: Change proactive frequency (when acceptance rate drops below 40% or rises above 80%)
- enable_skill: Activate a new skill (when usage patterns match a skill)
- adjust_trust: Change trust level for an action type (when 10+ consecutive accepts or 3+ rejects)

Return a JSON array of proposals. If no changes needed, return [].`;

  try {
    const result = await genAI.models.generateContent({
      model: getModel("lite"), // Use lite model — this is structured extraction, not creative
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              section: { type: Type.STRING },
              change_type: { type: Type.STRING },
              description: { type: Type.STRING },
              is_major: { type: Type.BOOLEAN },
              new_value: { type: Type.STRING }, // JSON-encoded value
              reason: { type: Type.STRING },
            },
            required: ["section", "change_type", "description", "is_major", "new_value", "reason"],
          },
        },
        temperature: 0.2,
        maxOutputTokens: 1000,
      },
    });

    const text = result.text || "[]";
    const proposals: EvolutionProposal[] = JSON.parse(text);

    // Safety: limit to 5 proposals max
    return proposals.slice(0, 5);
  } catch (err) {
    console.error("[soul-evolve] Gemini reflection error:", err);
    return [];
  }
}

// ─── Stage 3: EVOLVE (apply proposals) ──────────────────────────

/**
 * Pure helper: apply a single Gemini-suggested change to a soul object.
 * Mutates `soul` in place and returns true if the change actually
 * landed (false means no-op — e.g. relationship already existed).
 *
 * Extracted so both paths use it:
 *   - Minor changes mutate `updatedSoul` directly (existing behavior)
 *   - Major changes mutate a deep-cloned snapshot (becomes
 *     `proposed_content` for proposeMajorChange in C-3.c)
 */
function applyChangeToSoul(
  soul: Record<string, any>,
  proposal: EvolutionProposal,
): boolean {
  let newValue: any;
  try {
    newValue = typeof proposal.new_value === "string"
      ? JSON.parse(proposal.new_value)
      : proposal.new_value;
  } catch {
    newValue = proposal.new_value;
  }

  switch (proposal.change_type) {
    case "add_domain": {
      if (!soul.domain_knowledge) soul.domain_knowledge = [];
      const existingIdx = soul.domain_knowledge.findIndex(
        (d: any) => d.area === newValue.area,
      );
      if (existingIdx >= 0) {
        const existing = soul.domain_knowledge[existingIdx];
        const mergedConcepts = [...new Set([...(existing.concepts || []), ...(newValue.concepts || [])])];
        soul.domain_knowledge[existingIdx] = {
          ...existing,
          concepts: mergedConcepts,
          confidence: Math.min((existing.confidence || 0.5) + 0.1, 1.0),
        };
      } else {
        soul.domain_knowledge.push({
          ...newValue,
          learned_from: "pattern_detection",
          confidence: 0.5,
        });
      }
      return true;
    }
    case "adjust_proactivity": {
      if (soul.communication) {
        if (typeof newValue === "number") {
          soul.communication.max_proactive_per_day = Math.max(1, Math.min(10, newValue));
        } else if (newValue.max_proactive_per_day) {
          soul.communication.max_proactive_per_day = Math.max(1, Math.min(10, newValue.max_proactive_per_day));
        }
        return true;
      }
      return false;
    }
    case "add_relationship": {
      if (!soul.relationships) soul.relationships = [];
      const exists = soul.relationships.some(
        (r: any) => r.name.toLowerCase() === (newValue.name || "").toLowerCase(),
      );
      if (!exists && newValue.name) {
        soul.relationships.push({
          name: newValue.name,
          role: newValue.role || "contact",
          patterns: newValue.patterns || [],
        });
        return true;
      }
      return false;
    }
    case "enable_skill": {
      if (!soul.skills_active) soul.skills_active = [];
      const skillName = typeof newValue === "string" ? newValue : newValue.skill;
      if (skillName && !soul.skills_active.includes(skillName)) {
        soul.skills_active.push(skillName);
        return true;
      }
      return false;
    }
    case "adjust_tone": {
      // Tone changes are always major — should have been caught
      // by the major-path branch. But handle defensively.
      if (soul.identity && newValue.tone) {
        soul.identity.tone = newValue.tone;
        return true;
      }
      return false;
    }
    default:
      console.warn(`[soul-evolve] Unknown change_type: ${proposal.change_type}`);
      return false;
  }
}

async function applyEvolution(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  currentSoul: Record<string, any>,
  proposals: EvolutionProposal[]
): Promise<{ applied: number; deferred: number; proposed: number; changes: string[] }> {
  if (proposals.length === 0) {
    return { applied: 0, deferred: 0, proposed: 0, changes: [] };
  }

  const updatedSoul = { ...currentSoul };
  let applied = 0;
  let deferred = 0;
  let proposed = 0;
  const changes: string[] = [];

  for (const proposal of proposals) {
    // ─── Major change → propose for user approval (Phase C-3.c) ──
    // Until C-3.c, this branch silently dropped major changes via a
    // console.log. Now: build a deep-cloned soul with just THIS one
    // change applied, hand the snapshot to proposeMajorChange, and
    // let the user accept/reject via the web UI. The minor-change
    // path below is unchanged.
    if (proposal.is_major) {
      // Deep-clone the current soul so the proposed_content reflects
      // ONLY this proposal applied to "now-state", independent of
      // the in-progress updatedSoul (which has minor changes applied
      // earlier in the loop).
      const proposedContent = JSON.parse(JSON.stringify(currentSoul));
      const didApply = applyChangeToSoul(proposedContent, proposal);

      if (!didApply) {
        // No-op (e.g., relationship already exists) — nothing to propose.
        changes.push(`[major no-op] ${proposal.description}`);
        continue;
      }

      try {
        const result = await proposeMajorChange(supabase, {
          userId,
          layerType: "user",
          proposedContent,
          summary: proposal.description,
          // Map change_type to trigger. Tone/domain shifts get the
          // dedicated 'industry_shift' bucket so analytics can
          // separate them from generic pattern detection later.
          trigger:
            proposal.change_type === "adjust_tone" || proposal.change_type === "add_domain"
              ? "industry_shift"
              : "pattern_detection",
        });

        if (result.ok) {
          proposed++;
          changes.push(`[PROPOSED ${result.proposal_id}] ${proposal.description}`);
        } else {
          // Propose failed — fall back to deferred-log behavior so the
          // change isn't completely lost from the audit trail.
          console.warn(
            `[soul-evolve] proposeMajorChange failed for ${userId}: ${result.reason || result.error}`,
          );
          deferred++;
          changes.push(`[DEFERRED — propose failed: ${result.reason}] ${proposal.description}`);
        }
      } catch (err) {
        console.warn(`[soul-evolve] propose exception: ${proposal.description}`, err);
        deferred++;
        changes.push(`[DEFERRED — propose exception] ${proposal.description}`);
      }
      continue;
    }

    // ─── Minor change → apply directly (existing behavior) ──
    try {
      const didApply = applyChangeToSoul(updatedSoul, proposal);
      if (didApply) {
        applied++;
        changes.push(proposal.description);
      }
    } catch (err) {
      console.warn(`[soul-evolve] Error applying proposal: ${proposal.description}`, err);
    }
  }

  // Write updated soul if any minor changes were applied. Major changes
  // do NOT touch the live layer here — they wait for user approval via
  // olive-soul-safety/approve_change.
  if (applied > 0) {
    await upsertSoulLayer(supabase, "user", "user", userId, updatedSoul, "pattern_detection");
  }

  // Handle trust evolution separately (from reflections)
  await evolveTrust(supabase, userId);

  return { applied, deferred, proposed, changes };
}

// ─── Trust Evolution (separate from main soul) ──────────────────

async function evolveTrust(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<void> {
  try {
    const trustSoul = await getUserSoulContent(supabase, userId, "trust");
    if (!trustSoul || !trustSoul.trust_matrix) return;

    const matrix = { ...trustSoul.trust_matrix };
    let changed = false;

    // Get last 30 days of reflections grouped by action_type
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: reflections } = await supabase
      .from("olive_reflections")
      .select("action_type, outcome")
      .eq("user_id", userId)
      .gte("created_at", thirtyDaysAgo);

    if (!reflections || reflections.length === 0) return;

    // Group by action_type
    const byAction: Record<string, { accepted: number; rejected: number; total: number }> = {};
    for (const r of reflections) {
      if (!byAction[r.action_type]) {
        byAction[r.action_type] = { accepted: 0, rejected: 0, total: 0 };
      }
      byAction[r.action_type].total++;
      if (r.outcome === "accepted") byAction[r.action_type].accepted++;
      if (r.outcome === "rejected") byAction[r.action_type].rejected++;
    }

    // Apply trust escalation/de-escalation rules
    for (const [action, counts] of Object.entries(byAction)) {
      if (!(action in matrix)) continue;
      const currentLevel = matrix[action];

      // Escalation: 10+ consecutive accepts and current level < 3
      if (counts.accepted >= 10 && counts.rejected === 0 && currentLevel < 3) {
        // Don't auto-escalate high-risk actions past level 2
        const maxLevel = ["send_whatsapp_to_client", "send_invoice", "delete_note"].includes(action) ? 2 : 3;
        if (currentLevel < maxLevel) {
          // TODO: Instead of auto-escalating, create a notification asking user
          // For now, just log the opportunity
          console.log(`[soul-evolve] Trust escalation opportunity: ${action} from ${currentLevel} to ${currentLevel + 1}`);
        }
      }

      // De-escalation: 3+ rejections
      if (counts.rejected >= 3 && currentLevel > 0) {
        matrix[action] = Math.max(0, currentLevel - 1);
        changed = true;
        console.log(`[soul-evolve] Trust de-escalated: ${action} from ${currentLevel} to ${matrix[action]}`);
      }
    }

    if (changed) {
      await upsertSoulLayer(supabase, "trust", "user", userId, { trust_matrix: matrix }, "reflection");
    }
  } catch (err) {
    console.warn("[soul-evolve] Trust evolution error (non-blocking):", err);
  }
}

// ─── Main Handler ───────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let targetUsers: string[] = [];

    // If user_id is provided, evolve just that user
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body.user_id) {
          targetUsers = [body.user_id];
        }
      } catch {
        // Empty body = process all eligible users
      }
    }

    // If no specific user, find all users with soul_enabled who haven't evolved in 24h
    if (targetUsers.length === 0) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: layers } = await supabase
        .from("olive_soul_layers")
        .select("owner_id")
        .eq("layer_type", "user")
        .eq("owner_type", "user")
        .eq("is_locked", false)
        .lt("evolved_at", twentyFourHoursAgo)
        .limit(50); // Process max 50 users per cron run

      targetUsers = (layers || []).map((l: any) => l.owner_id).filter(Boolean);
    }

    if (targetUsers.length === 0) {
      return new Response(
        JSON.stringify({ message: "No users eligible for evolution", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: Array<{ user_id: string; applied: number; deferred: number; changes: string[] }> = [];

    for (const userId of targetUsers) {
      try {
        // Check if soul is enabled
        const { data: prefs } = await supabase
          .from("olive_user_preferences")
          .select("soul_enabled")
          .eq("user_id", userId)
          .maybeSingle();

        if (!prefs?.soul_enabled) continue;

        // Stage 1: Observe
        const observations = await observeUserBehavior(supabase, userId);

        // Skip if very low activity (less than 3 notes in 7 days)
        if (observations.total_notes_created < 3) {
          results.push({ user_id: userId, applied: 0, deferred: 0, changes: ["Skipped: low activity"] });
          continue;
        }

        // Get current soul
        const currentSoul = await getUserSoulContent(supabase, userId, "user");
        if (!currentSoul) {
          results.push({ user_id: userId, applied: 0, deferred: 0, changes: ["Skipped: no soul found"] });
          continue;
        }

        // Stage 2: Reflect
        const proposals = await reflectOnObservations(currentSoul, observations);

        // Stage 3: Evolve
        const result = await applyEvolution(supabase, userId, currentSoul, proposals);
        results.push({ user_id: userId, ...result });
      } catch (err) {
        console.error(`[soul-evolve] Error processing user ${userId}:`, err);
        results.push({ user_id: userId, applied: 0, deferred: 0, changes: [`Error: ${String(err)}`] });
      }
    }

    // Update engagement scores for processed users
    for (const userId of targetUsers) {
      try {
        await updateEngagementScore(supabase, userId);
      } catch {
        // Non-blocking
      }
    }

    return new Response(
      JSON.stringify({
        processed: results.length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[olive-soul-evolve] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── Engagement Score Update ────────────────────────────────────

async function updateEngagementScore(
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<void> {
  const { data: metrics } = await supabase
    .from("olive_engagement_metrics")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!metrics) return;

  const proactiveSent = (metrics.proactive_accepted_7d || 0) +
    (metrics.proactive_ignored_7d || 0) +
    (metrics.proactive_rejected_7d || 0);

  const acceptRate = proactiveSent > 0
    ? (metrics.proactive_accepted_7d || 0) / proactiveSent
    : 0.5;

  const responseRate = metrics.messages_sent_7d > 0
    ? (metrics.messages_responded_7d || 0) / metrics.messages_sent_7d
    : 0.5;

  const recencyDays = metrics.last_interaction
    ? (Date.now() - new Date(metrics.last_interaction).getTime()) / (24 * 60 * 60 * 1000)
    : 7;
  const recencyScore = Math.max(0, 1 - recencyDays / 14); // 0-1, decays over 14 days

  const score = Math.round(
    acceptRate * 40 +
    responseRate * 30 +
    recencyScore * 20 +
    10 // Base score
  );

  await supabase
    .from("olive_engagement_metrics")
    .update({ score: Math.max(0, Math.min(100, score)), updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}
