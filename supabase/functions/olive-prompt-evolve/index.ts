/**
 * olive-prompt-evolve — reflection-driven prompt addendum generator
 * ===========================================================================
 * Phase D-1.b. Weekly cron observes the last 7 days of olive_reflections,
 * clusters them by action_type, gates by significance thresholds, and asks
 * Gemini Pro to draft an addendum for each actionable cluster. Drafts are
 * inserted into olive_prompt_addendums with status='pending' for admin
 * review (D-1.d).
 *
 * NO PRODUCTION PROMPT CHANGES happen here. This function only WRITES
 * proposals; the A/B router (D-1.c) and admin endpoints (D-1.d) decide
 * what (if anything) ships to users. By the time this matters in
 * production, two more guardrails sit between this function and any
 * actual user-visible prompt change:
 *
 *   1. PROMPT_EVOLVE_ENABLED env flag (this file's outer gate)
 *   2. isClusterActionable threshold gates (per-cluster)
 *   3. Pro's `is_safe` self-evaluation
 *   4. Per-(prompt_module, pattern_signature) idempotency dedup
 *   5. Pending-status default — never auto-promotes to testing/approved
 *   6. (D-1.c) hash(userId)-based A/B at admin-set rollout_pct
 *   7. (D-1.d) admin must manually flip status pending→testing
 *
 * Contract:
 *   - Idempotent: re-running for the same window produces no duplicates
 *   - Fail-soft on Gemini errors: log + skip the cluster, never throw
 *   - Bounded work: at most one proposal per actionable cluster per run;
 *     skipped when a recent (<14d) pending/testing/approved proposal
 *     exists for the same (module, signature)
 *   - Service-role only: invoked by cron with the project's service-role
 *     bearer token (matches olive-soul-evolve)
 *
 * POST /olive-prompt-evolve
 * Body: {
 *   window_days?: number,        // default 7
 *   force?: boolean              // bypass dedup; for ops/testing
 * }
 *
 * Response: {
 *   feature_enabled: boolean,
 *   total_reflections: number,
 *   clusters_seen: number,
 *   actionable_clusters: number,
 *   proposed: number,
 *   skipped: Array<{ reason: string, action_type?: string, signature?: string }>
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenAI, Type } from "https://esm.sh/@google/genai@1.0.0";
import { GEMINI_KEY, getModel } from "../_shared/gemini.ts";
import { clusterReflections } from "../_shared/prompt-evolution/reflection-cluster.ts";
import {
  buildPatternSignature,
  getRejectionReason,
  isClusterActionable,
} from "../_shared/prompt-evolution/cluster-thresholds.ts";
import {
  ACTION_TYPE_TO_MODULE,
  type AddendumProposal,
  type PromptModuleKey,
  type ReflectionCluster,
  type ReflectionRow,
} from "../_shared/prompt-evolution/types.ts";

// Intent module imports — used to fetch current base text + version.
// We import statically so the bundle stays self-contained; the registry
// itself isn't needed for write-side use.
import { CHAT_MODULE } from "../_shared/prompts/intents/chat.ts";
import { CONTEXTUAL_ASK_MODULE } from "../_shared/prompts/intents/contextual-ask.ts";
import { CREATE_MODULE } from "../_shared/prompts/intents/create.ts";
import { EXPENSE_MODULE } from "../_shared/prompts/intents/expense.ts";
import { HELP_ABOUT_OLIVE_MODULE } from "../_shared/prompts/intents/help-about-olive.ts";
import { PARTNER_MESSAGE_MODULE } from "../_shared/prompts/intents/partner-message.ts";
import { SEARCH_MODULE } from "../_shared/prompts/intents/search.ts";
import { TASK_ACTION_MODULE } from "../_shared/prompts/intents/task-action.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MODULE_TEXT_BY_KEY: Record<PromptModuleKey, { version: string; baseText: string }> = {
  chat: {
    version: CHAT_MODULE.version,
    baseText: `${CHAT_MODULE.system_core}\n\n${CHAT_MODULE.intent_rules}`,
  },
  contextual_ask: {
    version: CONTEXTUAL_ASK_MODULE.version,
    baseText: `${CONTEXTUAL_ASK_MODULE.system_core}\n\n${CONTEXTUAL_ASK_MODULE.intent_rules}`,
  },
  create: {
    version: CREATE_MODULE.version,
    baseText: `${CREATE_MODULE.system_core}\n\n${CREATE_MODULE.intent_rules}`,
  },
  search: {
    version: SEARCH_MODULE.version,
    baseText: `${SEARCH_MODULE.system_core}\n\n${SEARCH_MODULE.intent_rules}`,
  },
  expense: {
    version: EXPENSE_MODULE.version,
    baseText: `${EXPENSE_MODULE.system_core}\n\n${EXPENSE_MODULE.intent_rules}`,
  },
  task_action: {
    version: TASK_ACTION_MODULE.version,
    baseText: `${TASK_ACTION_MODULE.system_core}\n\n${TASK_ACTION_MODULE.intent_rules}`,
  },
  partner_message: {
    version: PARTNER_MESSAGE_MODULE.version,
    baseText: `${PARTNER_MESSAGE_MODULE.system_core}\n\n${PARTNER_MESSAGE_MODULE.intent_rules}`,
  },
  help_about_olive: {
    version: HELP_ABOUT_OLIVE_MODULE.version,
    baseText: `${HELP_ABOUT_OLIVE_MODULE.system_core}\n\n${HELP_ABOUT_OLIVE_MODULE.intent_rules}`,
  },
};

// ─── Stage 1: Observe ──────────────────────────────────────────────

async function fetchRecentReflections(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  windowDays: number,
): Promise<ReflectionRow[]> {
  const since = new Date(Date.now() - windowDays * 86400000).toISOString();
  const { data, error } = await supabase
    .from("olive_reflections")
    .select(
      "id, user_id, action_type, outcome, user_modification, lesson, confidence, action_detail, created_at",
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[prompt-evolve] reflections fetch error:", error);
    return [];
  }
  return (data as ReflectionRow[]) || [];
}

// ─── Stage 2: Dedup (avoid re-proposing) ───────────────────────────

async function hasRecentSimilarProposal(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  promptModule: PromptModuleKey,
  signature: string,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data } = await supabase
    .from("olive_prompt_addendums")
    .select("id")
    .eq("prompt_module", promptModule)
    .eq("pattern_signature", signature)
    .in("status", ["pending", "testing", "approved"])
    .gte("created_at", cutoff)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

// ─── Stage 3: Pro-driven addendum draft ────────────────────────────

interface ProDraftResult {
  addendum_text: string;
  reasoning: string;
  is_safe: boolean;
}

async function draftAddendumWithPro(
  cluster: ReflectionCluster,
  baseText: string,
  windowDays: number,
): Promise<ProDraftResult | null> {
  if (!GEMINI_KEY) {
    console.warn("[prompt-evolve] GEMINI_API not set — skipping draft");
    return null;
  }

  const samplesBlock = cluster.modification_samples
    .map((s, i) =>
      `${i + 1}. AI said: ${s.from ?? "(unknown)"} → User changed to: ${s.to ?? "(unknown)"}${
        s.lesson ? ` (lesson: ${s.lesson})` : ""
      }`,
    )
    .join("\n");

  const prompt =
`You are the Prompt Evolution Engine for Olive. Based on real user
corrections of Olive's outputs, you propose a SHORT addendum to
append to Olive's base prompt that would have produced the right
result.

## Base prompt (excerpt — first 2000 chars)
${baseText.slice(0, 2000)}

## Observed user corrections (last ${windowDays} days)
Cluster: ${cluster.action_type}
Total reflections: ${cluster.total}
Modify+reject rate: ${(cluster.modify_reject_rate * 100).toFixed(0)}%
Average confidence: ${cluster.avg_confidence.toFixed(2)}

Sample modifications:
${samplesBlock || "(no rich samples — only outcome counts available)"}

## Task
Write a SHORT addendum (≤200 tokens, 5–10 lines) that:
  - Addresses the SPECIFIC pattern of corrections shown above
  - Is additive (will be appended to the base prompt — don't try to
    rewrite or remove existing rules)
  - Uses concrete examples from the corrections when illustrative
  - Stays in the same voice and bullet style as the base prompt

You must also self-evaluate safety:
  - is_safe = false if the addendum would change Olive's behavior
    in ways that go beyond the specific correction pattern (e.g.
    adds rules that aren't supported by the evidence)
  - is_safe = true otherwise

If the corrections are too inconsistent or thin to extract a
coherent rule, return is_safe=false and a short reasoning
explaining why.`;

  try {
    const genAI = new GoogleGenAI({ apiKey: GEMINI_KEY });
    const result = await genAI.models.generateContent({
      model: getModel("pro"),
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            addendum_text: { type: Type.STRING },
            reasoning: { type: Type.STRING },
            is_safe: { type: Type.BOOLEAN },
          },
          required: ["addendum_text", "reasoning", "is_safe"],
        },
        temperature: 0.2,
        maxOutputTokens: 800,
      },
    });
    const text = result.text || "{}";
    const parsed = JSON.parse(text) as ProDraftResult;

    // Defensive validation — Pro can hallucinate around schemas.
    if (
      typeof parsed.addendum_text !== "string" ||
      typeof parsed.reasoning !== "string" ||
      typeof parsed.is_safe !== "boolean"
    ) {
      console.warn("[prompt-evolve] Pro returned malformed shape:", parsed);
      return null;
    }
    if (parsed.addendum_text.length === 0 || parsed.addendum_text.length > 2000) {
      console.warn("[prompt-evolve] addendum_text length out of range:", parsed.addendum_text.length);
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn("[prompt-evolve] Pro draft failed:", err);
    return null;
  }
}

// ─── Stage 4: Insert proposal ───────────────────────────────────────

async function insertProposal(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  proposal: AddendumProposal,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("olive_prompt_addendums")
    .insert({
      prompt_module: proposal.prompt_module,
      base_version: proposal.base_version,
      addendum_text: proposal.addendum_text,
      reasoning: proposal.reasoning,
      reflections_observed_count: proposal.reflections_observed_count,
      reflections_window_start: proposal.reflections_window_start,
      reflections_window_end: proposal.reflections_window_end,
      pattern_signature: proposal.pattern_signature,
      // status defaults to 'pending', rollout_pct defaults to 0
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[prompt-evolve] proposal insert failed:", error);
    return null;
  }
  return data as { id: string };
}

// ─── Testable core ──────────────────────────────────────────────────
// Exported so unit tests can inject mocks for `supabase` and `draftFn`.
// The serve() handler below is a thin wrapper — all real logic is here.

export interface RunSummary {
  feature_enabled: boolean;
  window_days: number;
  total_reflections: number;
  clusters_seen: number;
  actionable_clusters: number;
  proposed: number;
  skipped: Array<{ reason: string; action_type?: string; signature?: string }>;
}

export interface RunOptions {
  windowDays: number;
  force: boolean;
}

/** Injection point for tests — by default the real Pro call. */
export type DraftFn = (
  cluster: ReflectionCluster,
  baseText: string,
  windowDays: number,
) => Promise<ProDraftResult | null>;

export async function runPromptEvolution(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  options: RunOptions,
  draftFn: DraftFn = draftAddendumWithPro,
): Promise<RunSummary> {
  const summary: RunSummary = {
    feature_enabled: true,
    window_days: options.windowDays,
    total_reflections: 0,
    clusters_seen: 0,
    actionable_clusters: 0,
    proposed: 0,
    skipped: [],
  };

  // 1. Observe
  const reflections = await fetchRecentReflections(supabase, options.windowDays);
  summary.total_reflections = reflections.length;
  if (reflections.length === 0) {
    summary.skipped.push({ reason: "no_reflections_in_window" });
    return summary;
  }

  // 2. Cluster + threshold
  const clusters = clusterReflections(reflections);
  summary.clusters_seen = clusters.length;

  const actionable: ReflectionCluster[] = [];
  for (const c of clusters) {
    if (!isClusterActionable(c)) {
      summary.skipped.push({
        reason: `gate_failed: ${getRejectionReason(c)}`,
        action_type: c.action_type,
      });
      continue;
    }
    actionable.push(c);
  }
  summary.actionable_clusters = actionable.length;

  // 3. For each actionable cluster: dedup → draft → insert
  for (const cluster of actionable) {
    const moduleKey = ACTION_TYPE_TO_MODULE[cluster.action_type];
    if (!moduleKey) {
      // Defense in depth — getRejectionReason already covers this,
      // but if thresholds change to permit unmapped types we'd crash
      // on MODULE_TEXT_BY_KEY[undefined].
      summary.skipped.push({
        reason: "no_module_mapping",
        action_type: cluster.action_type,
      });
      continue;
    }

    const moduleInfo = MODULE_TEXT_BY_KEY[moduleKey];
    const signature = buildPatternSignature(cluster);

    if (!options.force) {
      const dup = await hasRecentSimilarProposal(supabase, moduleKey, signature);
      if (dup) {
        summary.skipped.push({
          reason: "duplicate_recent_proposal",
          action_type: cluster.action_type,
          signature,
        });
        continue;
      }
    }

    const draft = await draftFn(cluster, moduleInfo.baseText, options.windowDays);
    if (!draft) {
      summary.skipped.push({
        reason: "pro_draft_failed_or_unavailable",
        action_type: cluster.action_type,
      });
      continue;
    }
    if (!draft.is_safe) {
      summary.skipped.push({
        reason: `pro_marked_unsafe: ${draft.reasoning.slice(0, 200)}`,
        action_type: cluster.action_type,
      });
      continue;
    }

    const windowStart = new Date(Date.now() - options.windowDays * 86400000).toISOString();
    const windowEnd = new Date().toISOString();

    const proposal: AddendumProposal = {
      prompt_module: moduleKey,
      base_version: moduleInfo.version,
      addendum_text: draft.addendum_text,
      reasoning: draft.reasoning,
      reflections_observed_count: cluster.total,
      reflections_window_start: windowStart,
      reflections_window_end: windowEnd,
      pattern_signature: signature,
    };

    const inserted = await insertProposal(supabase, proposal);
    if (inserted) {
      summary.proposed += 1;
      console.log(
        `[prompt-evolve] proposal=${inserted.id} module=${moduleKey} signature="${signature}"`,
      );
    } else {
      summary.skipped.push({
        reason: "insert_failed",
        action_type: cluster.action_type,
        signature,
      });
    }
  }

  return summary;
}

// ─── HTTP handler ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Outer feature flag — same gating discipline as C-4.c. Default off,
  // flag flipped via `supabase secrets set PROMPT_EVOLVE_ENABLED=true`.
  const enabled = Deno.env.get("PROMPT_EVOLVE_ENABLED") === "true";

  let body: { window_days?: number; force?: boolean } = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      // empty body is fine
    }
  }
  const windowDays = body.window_days ?? 7;
  const force = body.force === true;

  if (!enabled) {
    const summary: RunSummary = {
      feature_enabled: false,
      window_days: windowDays,
      total_reflections: 0,
      clusters_seen: 0,
      actionable_clusters: 0,
      proposed: 0,
      skipped: [{ reason: "feature_disabled" }],
    };
    return json(summary, 200);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const summary = await runPromptEvolution(supabase, { windowDays, force });
    return json(summary, 200);
  } catch (err) {
    console.error("[prompt-evolve] unexpected error:", err);
    return json({
      feature_enabled: true,
      window_days: windowDays,
      total_reflections: 0,
      clusters_seen: 0,
      actionable_clusters: 0,
      proposed: 0,
      skipped: [{ reason: `unexpected_error: ${String(err)}` }],
    }, 200); // 200 always — cron retry would compound errors
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
