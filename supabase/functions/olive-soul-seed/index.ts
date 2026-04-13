/**
 * olive-soul-seed — Generate initial SOUL.MD from onboarding
 * ============================================================
 * Called after onboarding completes. Takes the user's onboarding answers
 * and generates their initial User Soul (Layer 1) and Trust Soul (Layer 5).
 *
 * Also enables the soul_enabled feature flag for this user.
 *
 * POST /olive-soul-seed
 * Body: {
 *   user_id: string,
 *   onboarding: {
 *     use_case: "individual" | "couple" | "family" | "business",
 *     industry?: string,         // only if use_case = "business"
 *     pain_points: string[],     // what's drowning them
 *     tone_preference: "warm" | "professional" | "direct" | "playful" | "warm-professional",
 *     proactive_level: number,   // 0-100 slider
 *     people: Array<{ name: string, role: string }>,
 *   }
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertSoulLayer } from "../_shared/soul.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Pain point → skill/rule mapping ────────────────────────────

interface OnboardingMapping {
  skills: string[];
  proactive_rules: Array<{
    trigger: string;
    action: string;
    enabled: boolean;
    source: string;
    trust_level: number;
  }>;
  domain_area?: string;
}

const PAIN_POINT_MAP: Record<string, OnboardingMapping> = {
  "forgetting_tasks": {
    skills: ["reminder_manager"],
    proactive_rules: [
      { trigger: "task_overdue_48h", action: "nudge owner via whatsapp", enabled: true, source: "default", trust_level: 2 },
      { trigger: "morning_8am", action: "send daily task briefing", enabled: true, source: "default", trust_level: 2 },
    ],
  },
  "receipts_expenses": {
    skills: ["budget_tracker", "receipt_scanner"],
    proactive_rules: [
      { trigger: "receipt_scanned", action: "categorize and check budget", enabled: true, source: "default", trust_level: 3 },
      { trigger: "budget_80_percent", action: "warn about spending limit", enabled: true, source: "default", trust_level: 2 },
    ],
    domain_area: "finance",
  },
  "client_tracking": {
    skills: ["client_pipeline"],
    proactive_rules: [
      { trigger: "client_inactive_14d", action: "suggest check-in message", enabled: true, source: "default", trust_level: 1 },
      { trigger: "friday_5pm", action: "weekly pipeline summary", enabled: true, source: "default", trust_level: 2 },
    ],
    domain_area: "sales",
  },
  "partner_coordination": {
    skills: ["shared_lists", "delegation"],
    proactive_rules: [
      { trigger: "task_assigned", action: "notify assignee via whatsapp", enabled: true, source: "default", trust_level: 2 },
    ],
  },
  "ideas_notes": {
    skills: ["knowledge_vault"],
    proactive_rules: [],
  },
  "missing_calls": {
    skills: ["call_handler"],
    proactive_rules: [
      { trigger: "missed_call", action: "create follow-up task", enabled: true, source: "default", trust_level: 2 },
    ],
    domain_area: "communications",
  },
};

// ─── Industry → domain knowledge mapping ────────────────────────

const INDUSTRY_DOMAINS: Record<string, { area: string; concepts: string[] }> = {
  realtor: {
    area: "real_estate",
    concepts: ["MLS listings", "showings", "offers", "escrow", "comps", "buyer leads", "open houses"],
  },
  contractor: {
    area: "trades_service",
    concepts: ["job sites", "estimates", "parts", "invoicing", "service calls", "permits"],
  },
  freelancer: {
    area: "freelance",
    concepts: ["projects", "invoices", "clients", "deadlines", "time tracking"],
  },
  small_team: {
    area: "team_management",
    concepts: ["tasks", "delegation", "deadlines", "meetings", "decisions"],
  },
};

// ─── Default trust matrix ───────────────────────────────────────

const DEFAULT_TRUST_MATRIX: Record<string, number> = {
  categorize_note: 3,       // Autonomous — safe, reversible
  create_reminder: 3,       // Autonomous — safe, reversible
  create_task: 3,           // Autonomous — safe, reversible
  process_receipt: 3,       // Autonomous — safe, reversible
  save_memory: 3,           // Autonomous — safe, reversible
  send_whatsapp_to_self: 2, // Act & report — low risk
  assign_task: 1,           // Suggest — affects another person
  send_whatsapp_to_partner: 1, // Suggest — affects another person
  send_whatsapp_to_client: 0,  // Inform only — high risk
  modify_budget: 1,         // Suggest — sensitive
  delete_note: 1,           // Suggest — destructive
  send_invoice: 0,          // Inform only — financial
  book_appointment: 0,      // Inform only — external commitment
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user_id, onboarding } = await req.json();

    if (!user_id || !onboarding) {
      return new Response(
        JSON.stringify({ error: "user_id and onboarding data required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ─── Build User Soul (Layer 1) ──────────────────────────────

    const {
      use_case = "individual",
      industry,
      pain_points = [],
      tone_preference = "warm",
      proactive_level = 50,
      people = [],
    } = onboarding;

    // Collect skills and proactive rules from pain points
    const allSkills = new Set<string>();
    const allRules: Array<any> = [];
    const domainAreas: Array<{ area: string; concepts: string[]; learned_from: string; confidence: number }> = [];

    for (const pain of pain_points) {
      const mapping = PAIN_POINT_MAP[pain];
      if (mapping) {
        mapping.skills.forEach((s) => allSkills.add(s));
        allRules.push(...mapping.proactive_rules);
        if (mapping.domain_area) {
          domainAreas.push({
            area: mapping.domain_area,
            concepts: [],
            learned_from: "onboarding",
            confidence: 0.7,
          });
        }
      }
    }

    // Add industry-specific domain knowledge
    if (industry && INDUSTRY_DOMAINS[industry]) {
      const indDomain = INDUSTRY_DOMAINS[industry];
      domainAreas.push({
        area: indDomain.area,
        concepts: indDomain.concepts,
        learned_from: "onboarding",
        confidence: 0.9,
      });

      // Add industry-specific skills
      if (industry === "realtor") {
        allSkills.add("client_pipeline");
        allSkills.add("showing_scheduler");
      } else if (industry === "contractor") {
        allSkills.add("job_tracker");
        allSkills.add("invoice_helper");
      } else if (industry === "freelancer") {
        allSkills.add("project_tracker");
        allSkills.add("invoice_tracker");
      }
    }

    // Map proactive_level (0-100) to max_proactive_per_day
    const maxProactive = proactive_level <= 20 ? 1
      : proactive_level <= 40 ? 3
      : proactive_level <= 60 ? 5
      : proactive_level <= 80 ? 7
      : 10;

    // Build relationships from people
    const relationships = people.map((p: { name: string; role: string }) => ({
      name: p.name,
      role: p.role,
      patterns: [], // Will be populated by observation over time
    }));

    const userSoulContent = {
      identity: {
        tone: tone_preference,
        verbosity: "balanced",
        humor: tone_preference !== "professional" && tone_preference !== "direct",
        emoji_level: tone_preference === "playful" ? "moderate" : "minimal",
      },
      user_context: {
        type: use_case,
        industry: industry || null,
        role: null, // Will be learned from usage
        experience_level: "new",
        life_stage: null, // Will be learned from usage
      },
      domain_knowledge: domainAreas,
      proactive_rules: allRules,
      skills_active: Array.from(allSkills),
      communication: {
        preferred_channel: "whatsapp",
        quiet_hours: { start: "22:00", end: "07:00" },
        digest_time: "07:30",
        max_proactive_per_day: maxProactive,
        response_style: "action_first",
      },
      relationships,
    };

    // ─── Write User Soul Layer ──────────────────────────────────

    const userSoul = await upsertSoulLayer(
      supabase, "user", "user", user_id, userSoulContent, "onboarding"
    );

    // ─── Write Trust Soul Layer ─────────────────────────────────

    const trustContent = { trust_matrix: { ...DEFAULT_TRUST_MATRIX } };

    // If business user, start client comms at level 0 (inform only)
    if (use_case === "business") {
      trustContent.trust_matrix.send_whatsapp_to_client = 0;
      trustContent.trust_matrix.send_invoice = 0;
    }

    // If couple/family, allow partner messages at level 1 (suggest)
    if (use_case === "couple" || use_case === "family") {
      trustContent.trust_matrix.send_whatsapp_to_partner = 1;
      trustContent.trust_matrix.assign_task = 1;
    }

    const trustSoul = await upsertSoulLayer(
      supabase, "trust", "user", user_id, trustContent, "onboarding"
    );

    // ─── Enable soul feature flag ───────────────────────────────

    await supabase
      .from("olive_user_preferences")
      .upsert(
        { user_id, soul_enabled: true },
        { onConflict: "user_id" }
      );

    // ─── Initialize engagement metrics ──────────────────────────

    await supabase
      .from("olive_engagement_metrics")
      .upsert(
        { user_id, score: 50, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      );

    return new Response(
      JSON.stringify({
        success: true,
        soul_version: userSoul?.version || 1,
        trust_version: trustSoul?.version || 1,
        skills_enabled: Array.from(allSkills),
        proactive_rules_count: allRules.length,
        max_proactive_per_day: maxProactive,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[olive-soul-seed] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
