/**
 * Olive Templates — Industry Template Management
 *
 * Provides pre-configured starter kits per industry that bundle
 * lists, skills, budget categories, proactive rules, and soul hints.
 *
 * Actions:
 * - list: List available templates (optionally filtered by industry)
 * - get: Get a single template by ID
 * - apply: Apply a template to a space (creates lists, enables skills, sets budgets)
 * - get_applied: Get templates applied to a space
 * - remove: Remove an applied template from a space
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

    // Get user from auth header
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    let userId: string | null = null;
    if (token && token !== Deno.env.get("SUPABASE_ANON_KEY")) {
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id ?? null;
    }

    switch (action) {
      case "list":
        return json(await listTemplates(supabase, body));
      case "get":
        return json(await getTemplate(supabase, body));
      case "apply":
        return json(await applyTemplate(supabase, body, userId));
      case "get_applied":
        return json(await getAppliedTemplates(supabase, body));
      case "remove":
        return json(await removeAppliedTemplate(supabase, body, userId));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("olive-templates error:", err);
    return json({ error: err.message }, 500);
  }
});

// ─── List Templates ──────────────────────────────────────────

async function listTemplates(supabase: any, body: any) {
  const { industry } = body;
  let query = supabase
    .from("olive_industry_templates")
    .select("*")
    .eq("is_active", true)
    .order("industry");

  if (industry) {
    query = query.eq("industry", industry);
  }

  const { data, error } = await query;
  if (error) throw error;
  return { templates: data };
}

// ─── Get Single Template ─────────────────────────────────────

async function getTemplate(supabase: any, body: any) {
  const { template_id } = body;
  if (!template_id) return { error: "template_id required" };

  const { data, error } = await supabase
    .from("olive_industry_templates")
    .select("*")
    .eq("id", template_id)
    .single();

  if (error) throw error;
  return data;
}

// ─── Apply Template to Space ─────────────────────────────────

async function applyTemplate(supabase: any, body: any, userId: string | null) {
  const { template_id, space_id } = body;
  if (!template_id || !space_id) return { error: "template_id and space_id required" };
  if (!userId) return { error: "Authentication required" };

  // Check if already applied
  const { data: existing } = await supabase
    .from("olive_space_templates")
    .select("id")
    .eq("space_id", space_id)
    .eq("template_id", template_id)
    .maybeSingle();

  if (existing) return { error: "Template already applied to this space" };

  // Fetch template
  const { data: template, error: tplErr } = await supabase
    .from("olive_industry_templates")
    .select("*")
    .eq("id", template_id)
    .single();

  if (tplErr || !template) return { error: "Template not found" };

  // Apply template components
  const results = {
    lists_created: 0,
    skills_enabled: 0,
    budgets_created: 0,
  };

  // 1. Create lists from template
  if (template.lists && Array.isArray(template.lists)) {
    for (const list of template.lists) {
      const { error: listErr } = await supabase.from("clerk_lists").insert({
        name: list.name,
        author_id: userId,
        space_id: space_id,
        is_manual: true,
        description: `Created from ${template.name} template`,
      });
      if (!listErr) results.lists_created++;
    }
  }

  // 2. Enable skills from template
  if (template.skills && Array.isArray(template.skills)) {
    for (const skillId of template.skills) {
      const { error: skillErr } = await supabase
        .from("olive_user_skills")
        .upsert({
          user_id: userId,
          skill_id: skillId,
          is_enabled: true,
          config: { source: "template", template_id: template.id },
        }, { onConflict: "user_id,skill_id" });
      if (!skillErr) results.skills_enabled++;
    }
  }

  // 3. Create budget categories from template
  if (template.budget_categories && Array.isArray(template.budget_categories)) {
    for (const budget of template.budget_categories) {
      const { error: budgetErr } = await supabase.from("budgets").insert({
        user_id: userId,
        space_id: space_id,
        category: budget.category,
        limit_amount: budget.suggested_limit,
        period: "monthly",
        is_active: true,
      });
      if (!budgetErr) results.budgets_created++;
    }
  }

  // Record template application
  const { error: applyErr } = await supabase.from("olive_space_templates").insert({
    space_id,
    template_id,
    applied_by: userId,
    config_overrides: body.config_overrides || {},
  });

  if (applyErr) throw applyErr;

  // Log engagement event
  await supabase.from("olive_engagement_events").insert({
    user_id: userId,
    event_type: "template_applied",
    metadata: { template_id, industry: template.industry, ...results },
  }).catch(() => {});

  return {
    success: true,
    template: template.name,
    industry: template.industry,
    ...results,
  };
}

// ─── Get Applied Templates ───────────────────────────────────

async function getAppliedTemplates(supabase: any, body: any) {
  const { space_id } = body;
  if (!space_id) return { error: "space_id required" };

  const { data, error } = await supabase
    .from("olive_space_templates")
    .select(`
      *,
      template:olive_industry_templates(*)
    `)
    .eq("space_id", space_id)
    .order("applied_at", { ascending: false });

  if (error) throw error;
  return { applied_templates: data };
}

// ─── Remove Applied Template ─────────────────────────────────

async function removeAppliedTemplate(supabase: any, body: any, userId: string | null) {
  const { space_id, template_id } = body;
  if (!space_id || !template_id) return { error: "space_id and template_id required" };
  if (!userId) return { error: "Authentication required" };

  const { error } = await supabase
    .from("olive_space_templates")
    .delete()
    .eq("space_id", space_id)
    .eq("template_id", template_id);

  if (error) throw error;
  return { success: true, message: "Template removed (previously created resources remain)" };
}
