/**
 * onboarding-finalize — Seed Olive's User Soul (Layer "user") from onboarding answers
 * ====================================================================================
 *
 * Why this exists:
 *   The onboarding quiz captures rich signal about who the user is and what
 *   takes up their mental load. Until now, those answers were dropped into
 *   `user_memories` as a single freeform string — which never reaches the
 *   Soul system that Olive uses to shape her tone, focus, and behavior.
 *
 *   This function bridges the gap. It takes the structured quiz answers
 *   plus the chosen Space context and writes a properly-shaped User Soul
 *   layer (matching the renderer in `_shared/soul.ts`).
 *
 * It also (optionally) augments the auto-generated Space Soul that
 * `olive-space-manage` already wrote on space creation, adding the user's
 * mental-load focus areas to the space's `proactive_focus`. This means a
 * "Family" space whose owner cares mostly about "Health & Fitness" gets
 * those proactive nudges too — not just the generic family template.
 *
 * Idempotent: safe to call multiple times; `upsertSoulLayer` versions
 * existing layers rather than duplicating.
 *
 * POST /onboarding-finalize
 * Body: {
 *   user_id: string,                    // Clerk user ID
 *   space_id: string | null,            // Space chosen during onboarding (may be null if skipped)
 *   scope: string | null,               // Quiz answer: 'Just Me' | 'Me & My Partner' | 'My Family' | 'My Business'
 *   mental_load: string[],              // Quiz answer: ['Home & Errands', 'Work & Career', ...]
 *   display_name?: string,              // User's first name from Clerk
 *   timezone?: string,                  // From auto-detect or quiz
 *   language?: string,                  // From auto-detect or quiz
 *   partner_name?: string,              // For couple-type spaces
 * }
 *
 * Returns: { ok: true, user_soul_id?: string, space_soul_augmented?: boolean }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertSoulLayer } from "../_shared/soul.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Scope → user_context mapping ──────────────────────────────────────
//
// The Soul renderer expects `user_context.type` and (optionally) `life_stage`.
// We translate the onboarding scope into those slots so they appear in the
// rendered context every LLM call sees.

const SCOPE_TO_USER_CONTEXT: Record<
  string,
  { type: string; life_stage?: string }
> = {
  "Just Me": { type: "individual", life_stage: "solo" },
  "Me & My Partner": { type: "couple_partner", life_stage: "partnered" },
  "My Family": { type: "family_organizer", life_stage: "family" },
  "My Business": { type: "business_owner", life_stage: "professional" },
};

// ─── Mental-load → domain_knowledge concept seeds ──────────────────────
//
// We seed the user's domain_knowledge with the areas they self-identified.
// `confidence: 0.6` means "user told us this directly" — high enough to
// surface in renderUserSoul (threshold 0.5) but low enough that learned
// patterns over time can override it.

const MENTAL_LOAD_TO_DOMAIN: Record<string, string[]> = {
  "Home & Errands": ["groceries", "household chores", "maintenance", "errands"],
  "Work & Career": ["meetings", "deadlines", "projects", "career"],
  "Studies": ["assignments", "exams", "study schedule", "deadlines"],
  "Health & Fitness": [
    "workouts",
    "meal prep",
    "sleep",
    "wellness",
    "appointments",
  ],
};

// ─── Mental-load → space proactive_focus mapping ──────────────────────
//
// When we augment the Space Soul, these are the focus tags we add. Stays
// in sync with what the heartbeat agents look for.

const MENTAL_LOAD_TO_FOCUS: Record<string, string[]> = {
  "Home & Errands": ["grocery_runs", "chore_rotation", "maintenance"],
  "Work & Career": ["deadlines", "meeting_prep", "project_followups"],
  "Studies": ["study_reminders", "deadlines", "exam_prep"],
  "Health & Fitness": ["workout_reminders", "meal_planning", "sleep_tracking"],
};

// ─── Default trust matrix ──────────────────────────────────────────────
//
// Mirrors the matrix in olive-soul-seed (which is no longer reachable from
// the client). Levels: 0=inform, 1=suggest, 2=act+report, 3=autonomous.
// Safe/reversible defaults run autonomously; anything that touches another
// person or money starts at suggest-or-lower until trust is earned.

const DEFAULT_TRUST_MATRIX: Record<string, number> = {
  categorize_note: 3,
  create_reminder: 3,
  create_task: 3,
  process_receipt: 3,
  save_memory: 3,
  send_whatsapp_to_self: 2,
  assign_task: 1,
  send_whatsapp_to_partner: 1,
  send_whatsapp_to_client: 0,
  modify_budget: 1,
  delete_note: 1,
  send_invoice: 0,
  book_appointment: 0,
};

function buildTrustMatrix(scope: string | null | undefined): Record<string, number> {
  const matrix: Record<string, number> = { ...DEFAULT_TRUST_MATRIX };

  // Couple/family contexts: partner messaging and task assignment are
  // expected day-one — keep at "suggest" so the user sees the first few
  // before reflection promotes to autonomous.
  if (scope === "Me & My Partner" || scope === "My Family") {
    matrix.send_whatsapp_to_partner = 1;
    matrix.assign_task = 1;
  }

  // Business contexts: never auto-message a client or send an invoice
  // until the user explicitly grants trust.
  if (scope === "My Business") {
    matrix.send_whatsapp_to_client = 0;
    matrix.send_invoice = 0;
  }

  return matrix;
}

interface FinalizeBody {
  user_id: string;
  space_id?: string | null;
  scope?: string | null;
  mental_load?: string[];
  display_name?: string;
  timezone?: string;
  language?: string;
  partner_name?: string;
}

function buildUserSoulContent(
  body: FinalizeBody,
): Record<string, any> {
  const ctx = body.scope ? SCOPE_TO_USER_CONTEXT[body.scope] : undefined;

  const domainKnowledge = (body.mental_load || [])
    .map((area) => ({
      area,
      concepts: MENTAL_LOAD_TO_DOMAIN[area] || [],
      confidence: 0.6,
    }))
    .filter((d) => d.concepts.length > 0);

  const relationships: Array<Record<string, any>> = [];
  if (body.partner_name && body.partner_name.trim()) {
    relationships.push({
      name: body.partner_name.trim(),
      role: "partner",
      patterns: [],
    });
  }

  return {
    identity: {
      // Onboarding gives us a starting tone. The Reflection system will
      // evolve this over time as it learns the user's actual style.
      tone: "warm",
      verbosity: "balanced",
      humor: true,
      emoji_level: "minimal",
      display_name: body.display_name || null,
      timezone: body.timezone || null,
      language: body.language || null,
    },
    user_context: ctx || { type: "individual" },
    domain_knowledge: domainKnowledge,
    relationships,
    communication: {
      response_style: "concise",
      preferred_channel: "whatsapp",
    },
    proactive_rules: [], // Heartbeat agents populate these as patterns emerge.
    source: "onboarding",
    seeded_at: new Date().toISOString(),
  };
}

async function augmentSpaceSoul(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  spaceId: string,
  mentalLoad: string[],
): Promise<boolean> {
  // Read the space soul written by olive-space-manage on creation.
  const { data: existing, error } = await supabase
    .from("olive_soul_layers")
    .select("id, content")
    .eq("layer_type", "space")
    .eq("owner_type", "space")
    .eq("owner_id", spaceId)
    .maybeSingle();

  if (error || !existing) return false;

  const content = (existing.content as Record<string, any>) || {};
  const currentFocus: string[] = Array.isArray(content.proactive_focus)
    ? content.proactive_focus
    : [];

  const additionalFocus = mentalLoad.flatMap(
    (area) => MENTAL_LOAD_TO_FOCUS[area] || [],
  );

  const mergedFocus = [...new Set([...currentFocus, ...additionalFocus])];

  if (mergedFocus.length === currentFocus.length) {
    // Nothing new to add — skip the upsert (and the version snapshot).
    return false;
  }

  const newContent = { ...content, proactive_focus: mergedFocus };

  await upsertSoulLayer(
    supabase,
    "space",
    "space",
    spaceId,
    newContent,
    "onboarding-augment",
  );

  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as FinalizeBody;

    if (!body.user_id) {
      return new Response(
        JSON.stringify({ error: "user_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Write the User Soul
    const userSoulContent = buildUserSoulContent(body);
    const userSoul = await upsertSoulLayer(
      supabase,
      "user",
      "user",
      body.user_id,
      userSoulContent,
      "onboarding",
    );

    // 2. Write the Trust Soul layer. Without this, every action falls back
    // to hardcoded defaults in olive-trust-gate and there is no per-user
    // record to evolve via reflection. Scope shapes the starting matrix.
    const trustSoul = await upsertSoulLayer(
      supabase,
      "trust",
      "user",
      body.user_id,
      { trust_matrix: buildTrustMatrix(body.scope ?? null) },
      "onboarding",
    );

    // 3. Initialize engagement metrics so olive-soul-evolve and the
    // proactivity gate have a row to read on day one.
    await supabase
      .from("olive_engagement_metrics")
      .upsert(
        {
          user_id: body.user_id,
          score: 50,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    // 4. Flip the soul_enabled feature flag. Until this is true the entire
    // soul stack is short-circuited inside assembleSoulContext. PR #6
    // wrote the layer but never flipped this — without step 4 the user
    // soul we just wrote in step 1 is never loaded into a Gemini call.
    await supabase
      .from("olive_user_preferences")
      .upsert(
        { user_id: body.user_id, soul_enabled: true },
        { onConflict: "user_id" },
      );

    // 5. Augment the Space Soul with mental-load focus areas (best effort).
    let spaceSoulAugmented = false;
    if (body.space_id && body.mental_load && body.mental_load.length > 0) {
      try {
        spaceSoulAugmented = await augmentSpaceSoul(
          supabase,
          body.space_id,
          body.mental_load,
        );
      } catch (err) {
        // Non-blocking — onboarding still succeeds without space augmentation.
        console.warn("[onboarding-finalize] Space soul augment failed:", err);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        user_soul_id: userSoul?.id ?? null,
        trust_soul_id: trustSoul?.id ?? null,
        soul_enabled: true,
        space_soul_augmented: spaceSoulAugmented,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err: any) {
    console.error("[onboarding-finalize] Error:", err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message || "Unknown error",
      }),
      {
        // Return 200 so the client never sees a hard failure during onboarding.
        // The frontend treats `ok: false` as a soft failure.
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
