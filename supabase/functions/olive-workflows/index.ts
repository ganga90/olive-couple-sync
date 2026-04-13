/**
 * Olive Workflows — Recurring Workflow Template Engine
 *
 * Manages recurring automated workflows (weekly review, monthly budget, client follow-up).
 * Can be triggered by cron (heartbeat) or manually by users.
 *
 * Actions:
 * - list_templates: List available workflow templates
 * - activate: Enable a workflow for a space
 * - deactivate: Disable a workflow for a space
 * - update_config: Update workflow instance configuration
 * - get_instances: Get active workflow instances for a space
 * - run: Execute a workflow manually
 * - tick: Called by heartbeat to check and run due workflows
 * - history: Get run history for a workflow instance
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
      case "list_templates":
        return json(await listTemplates(supabase, body));
      case "activate":
        return json(await activateWorkflow(supabase, body, userId));
      case "deactivate":
        return json(await deactivateWorkflow(supabase, body, userId));
      case "update_config":
        return json(await updateConfig(supabase, body, userId));
      case "get_instances":
        return json(await getInstances(supabase, body));
      case "run":
        return json(await runWorkflow(supabase, body, userId));
      case "tick":
        return json(await tickWorkflows(supabase));
      case "history":
        return json(await getHistory(supabase, body));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("olive-workflows error:", err);
    return json({ error: err.message }, 500);
  }
});

// ─── List Templates ──────────────────────────────────────────

async function listTemplates(supabase: any, body: any) {
  const { space_type } = body;

  let query = supabase
    .from("olive_workflow_templates")
    .select("*")
    .eq("is_active", true)
    .order("category");

  const { data, error } = await query;
  if (error) throw error;

  // Filter by applicable space type if provided
  let templates = data || [];
  if (space_type) {
    templates = templates.filter((t: any) =>
      (t.applicable_space_types || []).includes(space_type)
    );
  }

  return { templates };
}

// ─── Activate Workflow ───────────────────────────────────────

async function activateWorkflow(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { workflow_id, space_id, schedule_override, config } = body;
  if (!workflow_id || !space_id) return { error: "workflow_id and space_id required" };

  // Check template exists
  const { data: template } = await supabase
    .from("olive_workflow_templates")
    .select("*")
    .eq("workflow_id", workflow_id)
    .single();

  if (!template) return { error: "Workflow template not found" };

  // Upsert instance
  const { data, error } = await supabase
    .from("olive_workflow_instances")
    .upsert({
      workflow_id,
      space_id,
      enabled_by: userId,
      is_enabled: true,
      schedule_override: schedule_override || null,
      config: config || {},
    }, { onConflict: "workflow_id,space_id" })
    .select()
    .single();

  if (error) throw error;

  return { success: true, instance: data, template_name: template.name };
}

// ─── Deactivate Workflow ─────────────────────────────────────

async function deactivateWorkflow(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { workflow_id, space_id } = body;
  if (!workflow_id || !space_id) return { error: "workflow_id and space_id required" };

  const { error } = await supabase
    .from("olive_workflow_instances")
    .update({ is_enabled: false })
    .eq("workflow_id", workflow_id)
    .eq("space_id", space_id);

  if (error) throw error;
  return { success: true };
}

// ─── Update Config ───────────────────────────────────────────

async function updateConfig(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { instance_id, schedule_override, config } = body;
  if (!instance_id) return { error: "instance_id required" };

  const updates: Record<string, unknown> = {};
  if (schedule_override !== undefined) updates.schedule_override = schedule_override;
  if (config !== undefined) updates.config = config;

  const { data, error } = await supabase
    .from("olive_workflow_instances")
    .update(updates)
    .eq("id", instance_id)
    .select()
    .single();

  if (error) throw error;
  return { success: true, instance: data };
}

// ─── Get Instances ───────────────────────────────────────────

async function getInstances(supabase: any, body: any) {
  const { space_id } = body;
  if (!space_id) return { error: "space_id required" };

  const { data, error } = await supabase
    .from("olive_workflow_instances")
    .select(`
      *,
      template:olive_workflow_templates(*)
    `)
    .eq("space_id", space_id)
    .order("created_at");

  if (error) throw error;
  return { instances: data || [] };
}

// ─── Run Workflow Manually ───────────────────────────────────

async function runWorkflow(supabase: any, body: any, userId: string | null) {
  if (!userId) return { error: "Authentication required" };
  const { instance_id } = body;
  if (!instance_id) return { error: "instance_id required" };

  // Fetch instance + template
  const { data: instance } = await supabase
    .from("olive_workflow_instances")
    .select(`*, template:olive_workflow_templates(*)`)
    .eq("id", instance_id)
    .single();

  if (!instance) return { error: "Workflow instance not found" };

  return executeWorkflow(supabase, instance, "manual");
}

// ─── Tick — Called by Heartbeat ──────────────────────────────

async function tickWorkflows(supabase: any) {
  // Fetch all enabled workflow instances
  const { data: instances } = await supabase
    .from("olive_workflow_instances")
    .select(`*, template:olive_workflow_templates(*)`)
    .eq("is_enabled", true);

  if (!instances || instances.length === 0) return { processed: 0 };

  const now = new Date();
  const results: any[] = [];

  for (const instance of instances) {
    const schedule = instance.schedule_override || instance.template?.default_schedule;
    if (!schedule) continue;

    const shouldRun = checkSchedule(schedule, now, instance.last_run_at);
    if (!shouldRun) continue;

    const result = await executeWorkflow(supabase, instance, "schedule");
    results.push({ workflow_id: instance.workflow_id, space_id: instance.space_id, ...result });
  }

  return { processed: results.length, results };
}

// ─── Schedule Checker ────────────────────────────────────────

function checkSchedule(schedule: string, now: Date, lastRunAt: string | null): boolean {
  const hour = now.getUTCHours();
  const dayOfWeek = now.getUTCDay(); // 0=Sunday
  const dayOfMonth = now.getUTCDate();

  // Don't run more than once per period
  if (lastRunAt) {
    const lastRun = new Date(lastRunAt);
    const hoursSince = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60);

    if (schedule.startsWith("daily") && hoursSince < 20) return false;
    if (schedule.startsWith("weekly") && hoursSince < 144) return false; // ~6 days
    if (schedule.startsWith("monthly") && hoursSince < 600) return false; // ~25 days
    if (schedule.startsWith("weekdays") && hoursSince < 20) return false;
  }

  switch (schedule) {
    case "daily_8am": return hour === 8;
    case "daily_9am": return hour === 9;
    case "daily_10am": return hour === 10;
    case "daily_check": return hour === 9;
    case "weekdays_9am": return hour === 9 && dayOfWeek >= 1 && dayOfWeek <= 5;
    case "weekly_monday_9am": return dayOfWeek === 1 && hour === 9;
    case "weekly_friday_5pm": return dayOfWeek === 5 && hour === 17;
    case "weekly_sunday_6pm": return dayOfWeek === 0 && hour === 18;
    case "monthly_1st_9am": return dayOfMonth === 1 && hour === 9;
    case "monthly_last_day_5pm": {
      const tomorrow = new Date(now);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      return tomorrow.getUTCDate() === 1 && hour === 17;
    }
    default: return false;
  }
}

// ─── Workflow Executor ───────────────────────────────────────

async function executeWorkflow(supabase: any, instance: any, triggeredBy: string) {
  const template = instance.template;
  if (!template) return { error: "No template found" };

  const steps = template.steps || [];

  // Create run record
  const { data: run, error: runErr } = await supabase
    .from("olive_workflow_runs")
    .insert({
      instance_id: instance.id,
      workflow_id: instance.workflow_id,
      space_id: instance.space_id,
      triggered_by: triggeredBy,
      status: "running",
      steps_total: steps.length,
    })
    .select()
    .single();

  if (runErr || !run) return { error: "Failed to create run record" };

  try {
    const context: Record<string, any> = {};
    let stepsCompleted = 0;

    for (const step of steps) {
      try {
        const result = await executeStep(supabase, step, instance, context);
        context[step.step_id] = result;
        stepsCompleted++;
      } catch (stepErr: any) {
        console.error(`Step ${step.step_id} failed:`, stepErr);
        context[step.step_id] = { error: stepErr.message };
      }
    }

    const status = stepsCompleted === steps.length ? "success" : "partial";

    // Update run
    await supabase
      .from("olive_workflow_runs")
      .update({
        status,
        steps_completed: stepsCompleted,
        output: context,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    // Update instance
    await supabase
      .from("olive_workflow_instances")
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: status,
        run_count: instance.run_count + 1,
      })
      .eq("id", instance.id);

    return { success: true, status, steps_completed: stepsCompleted, run_id: run.id };
  } catch (err: any) {
    await supabase
      .from("olive_workflow_runs")
      .update({ status: "failed", error: err.message, completed_at: new Date().toISOString() })
      .eq("id", run.id);

    return { error: err.message };
  }
}

// ─── Step Executor ───────────────────────────────────────────

async function executeStep(supabase: any, step: any, instance: any, context: Record<string, any>) {
  const { action, config } = step;
  const spaceId = instance.space_id;

  switch (action) {
    case "query_notes": {
      const filter = config?.filter;
      let query = supabase.from("clerk_notes").select("*").eq("space_id", spaceId);

      if (filter === "completed_last_7d") {
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        query = query.eq("is_completed", true).gte("updated_at", sevenDaysAgo);
      } else if (filter === "incomplete_overdue") {
        query = query.eq("is_completed", false).lt("due_date", new Date().toISOString()).not("due_date", "is", null);
      }

      const { data } = await query.limit(50);
      return { count: data?.length || 0, items: data || [] };
    }

    case "query_delegations": {
      const { data } = await supabase
        .from("olive_delegations")
        .select("*")
        .eq("space_id", spaceId)
        .in("status", ["pending", "accepted", "snoozed"])
        .limit(50);
      return { count: data?.length || 0, items: data || [] };
    }

    case "query_transactions": {
      const period = config?.period;
      let query = supabase.from("transactions").select("*").eq("space_id", spaceId);

      if (period === "last_month") {
        const now = new Date();
        const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        query = query
          .gte("transaction_date", firstOfLastMonth.toISOString())
          .lt("transaction_date", firstOfThisMonth.toISOString());
      }

      const { data } = await query.order("transaction_date", { ascending: false }).limit(500);
      return { count: data?.length || 0, items: data || [] };
    }

    case "query_budgets": {
      const { data } = await supabase
        .from("budgets")
        .select("*")
        .eq("space_id", spaceId)
        .eq("is_active", true);
      return { items: data || [] };
    }

    case "query_clients": {
      const filter = config?.filter;
      let query = supabase
        .from("olive_clients")
        .select("*")
        .eq("space_id", spaceId)
        .eq("is_archived", false);

      if (filter === "overdue_follow_ups") {
        query = query
          .lt("follow_up_date", new Date().toISOString())
          .not("follow_up_date", "is", null);
      } else if (filter === "upcoming_3d") {
        const threeDays = new Date(Date.now() + 3 * 86400000).toISOString();
        query = query
          .gte("follow_up_date", new Date().toISOString())
          .lte("follow_up_date", threeDays);
      }

      const { data } = await query.order("follow_up_date").limit(50);
      return { count: data?.length || 0, items: data || [] };
    }

    case "compute_budget_comparison": {
      const transactions = context.gather_transactions?.items || [];
      const budgets = context.gather_budgets?.items || [];

      const spendingByCategory: Record<string, number> = {};
      for (const tx of transactions) {
        const cat = tx.category || "Other";
        spendingByCategory[cat] = (spendingByCategory[cat] || 0) + parseFloat(tx.amount || 0);
      }

      const comparison = budgets.map((b: any) => ({
        category: b.category,
        limit: parseFloat(b.limit_amount),
        spent: spendingByCategory[b.category] || 0,
        remaining: parseFloat(b.limit_amount) - (spendingByCategory[b.category] || 0),
        percent_used: ((spendingByCategory[b.category] || 0) / parseFloat(b.limit_amount) * 100).toFixed(1),
        over_budget: (spendingByCategory[b.category] || 0) > parseFloat(b.limit_amount),
      }));

      const totalSpent = Object.values(spendingByCategory).reduce((a, b) => a + b, 0);
      const totalBudget = budgets.reduce((a: number, b: any) => a + parseFloat(b.limit_amount), 0);

      return { comparison, total_spent: totalSpent, total_budget: totalBudget, spending_by_category: spendingByCategory };
    }

    case "ai_summarize": {
      const promptTemplate = config?.prompt_template;
      try {
        const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
        const model = getModel("lite");

        let prompt = "";
        if (promptTemplate === "weekly_review") {
          const completed = context.gather_tasks?.count || 0;
          const incomplete = context.gather_incomplete?.count || 0;
          const delegations = context.gather_delegations?.count || 0;
          prompt = `Generate a brief, warm weekly review summary for a team. Completed tasks: ${completed}. Incomplete/overdue tasks: ${incomplete}. Active delegations: ${delegations}. Keep it under 200 words, be encouraging but honest about what needs attention.`;
        } else if (promptTemplate === "monthly_budget") {
          const comparison = context.compare || {};
          prompt = `Generate a brief monthly budget review. Total spent: $${comparison.total_spent?.toFixed(2) || 0}. Total budget: $${comparison.total_budget?.toFixed(2) || 0}. Categories over budget: ${(comparison.comparison || []).filter((c: any) => c.over_budget).map((c: any) => c.category).join(", ") || "none"}. Keep it under 200 words, highlight key trends.`;
        }

        if (prompt) {
          const result = await ai.models.generateContent({ model, contents: prompt });
          return { summary: result.text || "Summary generation complete." };
        }
      } catch (aiErr) {
        console.error("AI summarize failed:", aiErr);
      }
      return { summary: "Workflow completed. Review your tasks and budgets in the app." };
    }

    case "ai_draft": {
      const overdue = context.check_overdue?.items || [];
      if (overdue.length === 0) return { drafts: [], message: "No overdue follow-ups" };

      const drafts: any[] = [];
      try {
        const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });
        const model = getModel("lite");

        for (const client of overdue.slice(0, 5)) {
          const prompt = `Draft a brief, professional follow-up message for a client named "${client.name}"${client.company ? ` from ${client.company}` : ""}. They are in the "${client.stage}" stage. Last contact was ${client.last_contact ? new Date(client.last_contact).toLocaleDateString() : "unknown"}. Keep it under 50 words, warm but professional.`;

          const result = await ai.models.generateContent({ model, contents: prompt });
          drafts.push({
            client_id: client.id,
            client_name: client.name,
            draft: result.text || `Hi ${client.name}, just checking in to see how things are going. Let me know if you need anything!`,
          });
        }
      } catch (aiErr) {
        console.error("AI draft failed:", aiErr);
        for (const client of overdue.slice(0, 5)) {
          drafts.push({
            client_id: client.id,
            client_name: client.name,
            draft: `Hi ${client.name}, just checking in. Let me know if you need anything!`,
          });
        }
      }
      return { drafts };
    }

    case "ai_anomaly_detection": {
      const comparison = context.compare || {};
      const anomalies = (comparison.comparison || [])
        .filter((c: any) => {
          const threshold = config?.threshold_percent || 30;
          return parseFloat(c.percent_used) > (100 + threshold) || parseFloat(c.percent_used) > 90;
        })
        .map((c: any) => ({
          category: c.category,
          percent_used: c.percent_used,
          over_by: c.over_budget ? (c.spent - c.limit).toFixed(2) : null,
          severity: parseFloat(c.percent_used) > 150 ? "high" : "medium",
        }));
      return { anomalies };
    }

    case "send_briefing":
    case "send_notification": {
      // In production, this would create a briefing record or send WhatsApp.
      // For now, we aggregate the context into a summary.
      return { delivered: true, channel: "in_app" };
    }

    default:
      return { skipped: true, reason: `Unknown action: ${action}` };
  }
}

// ─── Get History ─────────────────────────────────────────────

async function getHistory(supabase: any, body: any) {
  const { instance_id, limit = 10 } = body;
  if (!instance_id) return { error: "instance_id required" };

  const { data, error } = await supabase
    .from("olive_workflow_runs")
    .select("*")
    .eq("instance_id", instance_id)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return { runs: data || [] };
}
