/**
 * useBusinessTools — Frontend hook for B2B features.
 *
 * Wraps olive-templates, olive-client-pipeline, and olive-decisions
 * edge functions with typed interfaces and convenience methods.
 */

import { useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";

// ─── Types ────────────────────────────────────────────────────

export interface IndustryTemplate {
  id: string;
  industry: string;
  name: string;
  description: string | null;
  icon: string | null;
  version: number;
  lists: Array<{ name: string; items: string[]; category: string }>;
  skills: string[];
  budget_categories: Array<{ category: string; suggested_limit: number }>;
  proactive_rules: Array<{ trigger: string; action: string; description: string }>;
  soul_hints: Record<string, unknown>;
  note_categories: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AppliedTemplate {
  id: string;
  space_id: string;
  template_id: string;
  applied_by: string;
  applied_at: string;
  config_overrides: Record<string, unknown>;
  template: IndustryTemplate;
}

export interface Client {
  id: string;
  space_id: string;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  stage: "lead" | "prospect" | "active" | "completed" | "lost" | "paused";
  source: string | null;
  estimated_value: number | null;
  actual_value: number | null;
  currency: string;
  tags: string[];
  notes: string | null;
  follow_up_date: string | null;
  last_contact: string | null;
  stage_changed_at: string;
  metadata: Record<string, unknown>;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClientActivity {
  id: string;
  client_id: string;
  user_id: string;
  activity_type: string;
  from_value: string | null;
  to_value: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface PipelineStats {
  counts: Record<string, number>;
  values: Record<string, number>;
  total_active: number;
  total_pipeline_value: number;
  overdue_follow_ups: number;
  recent_activity_7d: number;
}

export interface FollowUp {
  id: string;
  name: string;
  company: string | null;
  stage: string;
  follow_up_date: string;
  last_contact: string | null;
}

export interface ExpenseSplit {
  id: string;
  space_id: string;
  transaction_id: string | null;
  created_by: string;
  description: string;
  total_amount: number;
  currency: string;
  split_type: "equal" | "percentage" | "exact" | "shares";
  is_settled: boolean;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
  shares?: ExpenseSplitShare[];
}

export interface ExpenseSplitShare {
  id: string;
  split_id: string;
  user_id: string;
  amount: number;
  percentage: number | null;
  is_paid: boolean;
  paid_at: string | null;
}

export interface Decision {
  id: string;
  space_id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string | null;
  status: "proposed" | "discussed" | "decided" | "implemented" | "revisited" | "reversed";
  decision_date: string;
  participants: string[];
  context: string | null;
  rationale: string | null;
  alternatives: Array<{ option: string; pros: string; cons: string }>;
  outcome: string | null;
  outcome_date: string | null;
  related_note_ids: string[];
  tags: string[];
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface DecisionStats {
  total: number;
  by_status: Record<string, number>;
  by_category: Record<string, number>;
  recent_30d: number;
  implementation_rate: string;
}

export interface WorkflowTemplate {
  id: string;
  workflow_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  category: string;
  default_schedule: string;
  schedule_options: Array<{ value: string; label: string }>;
  steps: Array<{ step_id: string; name: string; action: string; config: Record<string, unknown> }>;
  output_type: string;
  output_channel: string;
  requires_feature: string[];
  min_space_members: number;
  applicable_space_types: string[];
  is_builtin: boolean;
  is_active: boolean;
  created_at: string;
}

export interface WorkflowInstance {
  id: string;
  workflow_id: string;
  space_id: string;
  enabled_by: string;
  is_enabled: boolean;
  schedule_override: string | null;
  config: Record<string, unknown>;
  last_run_at: string | null;
  last_run_status: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
  template: WorkflowTemplate;
}

export interface WorkflowRun {
  id: string;
  instance_id: string;
  workflow_id: string;
  space_id: string;
  triggered_by: string;
  status: string;
  steps_completed: number;
  steps_total: number;
  output: Record<string, unknown>;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────

export function useBusinessTools() {
  const invokeTemplates = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("olive-templates", { body });
    if (error) {
      console.error("olive-templates error:", error);
      return { error: error.message };
    }
    return data;
  }, []);

  const invokePipeline = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("olive-client-pipeline", { body });
    if (error) {
      console.error("olive-client-pipeline error:", error);
      return { error: error.message };
    }
    return data;
  }, []);

  const invokeDecisions = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("olive-decisions", { body });
    if (error) {
      console.error("olive-decisions error:", error);
      return { error: error.message };
    }
    return data;
  }, []);

  const invokeWorkflows = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("olive-workflows", { body });
    if (error) {
      console.error("olive-workflows error:", error);
      return { error: error.message };
    }
    return data;
  }, []);

  // ── Templates ──

  const listTemplates = useCallback(
    async (industry?: string): Promise<IndustryTemplate[]> => {
      const result = await invokeTemplates({ action: "list", industry });
      return result?.templates || [];
    },
    [invokeTemplates]
  );

  const getTemplate = useCallback(
    async (templateId: string): Promise<IndustryTemplate | null> => {
      const result = await invokeTemplates({ action: "get", template_id: templateId });
      if (result?.error) return null;
      return result as IndustryTemplate;
    },
    [invokeTemplates]
  );

  const applyTemplate = useCallback(
    async (spaceId: string, templateId: string, configOverrides?: Record<string, unknown>) => {
      return invokeTemplates({
        action: "apply",
        space_id: spaceId,
        template_id: templateId,
        config_overrides: configOverrides,
      });
    },
    [invokeTemplates]
  );

  const getAppliedTemplates = useCallback(
    async (spaceId: string): Promise<AppliedTemplate[]> => {
      const result = await invokeTemplates({ action: "get_applied", space_id: spaceId });
      return result?.applied_templates || [];
    },
    [invokeTemplates]
  );

  const removeTemplate = useCallback(
    async (spaceId: string, templateId: string) => {
      return invokeTemplates({ action: "remove", space_id: spaceId, template_id: templateId });
    },
    [invokeTemplates]
  );

  // ── Client Pipeline ──

  const createClient = useCallback(
    async (data: {
      space_id: string;
      name: string;
      email?: string;
      phone?: string;
      company?: string;
      source?: string;
      estimated_value?: number;
      currency?: string;
      tags?: string[];
      notes?: string;
    }) => {
      return invokePipeline({ action: "create", ...data });
    },
    [invokePipeline]
  );

  const updateClient = useCallback(
    async (clientId: string, updates: Partial<Client>) => {
      return invokePipeline({ action: "update", client_id: clientId, ...updates });
    },
    [invokePipeline]
  );

  const getClient = useCallback(
    async (clientId: string): Promise<{ client: Client; activity: ClientActivity[] } | null> => {
      const result = await invokePipeline({ action: "get", client_id: clientId });
      if (result?.error) return null;
      return result;
    },
    [invokePipeline]
  );

  const listClients = useCallback(
    async (
      spaceId: string,
      opts?: { stage?: string; search?: string; limit?: number; offset?: number }
    ): Promise<{ clients: Client[]; total: number }> => {
      const result = await invokePipeline({ action: "list", space_id: spaceId, ...opts });
      return { clients: result?.clients || [], total: result?.total || 0 };
    },
    [invokePipeline]
  );

  const addClientActivity = useCallback(
    async (clientId: string, activityType: string, description?: string) => {
      return invokePipeline({
        action: "add_activity",
        client_id: clientId,
        activity_type: activityType,
        description,
      });
    },
    [invokePipeline]
  );

  const getPipelineStats = useCallback(
    async (spaceId: string): Promise<PipelineStats | null> => {
      const result = await invokePipeline({ action: "pipeline_stats", space_id: spaceId });
      if (result?.error) return null;
      return result as PipelineStats;
    },
    [invokePipeline]
  );

  const getFollowUps = useCallback(
    async (spaceId: string, daysAhead?: number): Promise<{ overdue: FollowUp[]; upcoming: FollowUp[] }> => {
      const result = await invokePipeline({ action: "follow_ups", space_id: spaceId, days_ahead: daysAhead });
      return { overdue: result?.overdue || [], upcoming: result?.upcoming || [] };
    },
    [invokePipeline]
  );

  const archiveClient = useCallback(
    async (clientId: string) => {
      return invokePipeline({ action: "archive", client_id: clientId });
    },
    [invokePipeline]
  );

  // ── Decisions ──

  const createDecision = useCallback(
    async (data: {
      space_id: string;
      title: string;
      description?: string;
      category?: string;
      context?: string;
      rationale?: string;
      alternatives?: Array<{ option: string; pros: string; cons: string }>;
      participants?: string[];
      tags?: string[];
    }) => {
      return invokeDecisions({ action: "create", ...data });
    },
    [invokeDecisions]
  );

  const updateDecision = useCallback(
    async (decisionId: string, updates: Partial<Decision>) => {
      return invokeDecisions({ action: "update", decision_id: decisionId, ...updates });
    },
    [invokeDecisions]
  );

  const getDecision = useCallback(
    async (decisionId: string): Promise<Decision | null> => {
      const result = await invokeDecisions({ action: "get", decision_id: decisionId });
      return result?.decision || null;
    },
    [invokeDecisions]
  );

  const listDecisions = useCallback(
    async (
      spaceId: string,
      opts?: { category?: string; status?: string; limit?: number; offset?: number }
    ): Promise<{ decisions: Decision[]; total: number }> => {
      const result = await invokeDecisions({ action: "list", space_id: spaceId, ...opts });
      return { decisions: result?.decisions || [], total: result?.total || 0 };
    },
    [invokeDecisions]
  );

  const searchDecisions = useCallback(
    async (spaceId: string, query: string): Promise<Decision[]> => {
      const result = await invokeDecisions({ action: "search", space_id: spaceId, query });
      return result?.decisions || [];
    },
    [invokeDecisions]
  );

  const getDecisionStats = useCallback(
    async (spaceId: string): Promise<DecisionStats | null> => {
      const result = await invokeDecisions({ action: "stats", space_id: spaceId });
      if (result?.error) return null;
      return result as DecisionStats;
    },
    [invokeDecisions]
  );

  // ── Workflows ──

  const listWorkflowTemplates = useCallback(
    async (spaceType?: string): Promise<WorkflowTemplate[]> => {
      const result = await invokeWorkflows({ action: "list_templates", space_type: spaceType });
      return result?.templates || [];
    },
    [invokeWorkflows]
  );

  const activateWorkflow = useCallback(
    async (workflowId: string, spaceId: string, scheduleOverride?: string, config?: Record<string, unknown>) => {
      return invokeWorkflows({
        action: "activate",
        workflow_id: workflowId,
        space_id: spaceId,
        schedule_override: scheduleOverride,
        config,
      });
    },
    [invokeWorkflows]
  );

  const deactivateWorkflow = useCallback(
    async (workflowId: string, spaceId: string) => {
      return invokeWorkflows({ action: "deactivate", workflow_id: workflowId, space_id: spaceId });
    },
    [invokeWorkflows]
  );

  const getWorkflowInstances = useCallback(
    async (spaceId: string): Promise<WorkflowInstance[]> => {
      const result = await invokeWorkflows({ action: "get_instances", space_id: spaceId });
      return result?.instances || [];
    },
    [invokeWorkflows]
  );

  const runWorkflow = useCallback(
    async (instanceId: string) => {
      return invokeWorkflows({ action: "run", instance_id: instanceId });
    },
    [invokeWorkflows]
  );

  const getWorkflowHistory = useCallback(
    async (instanceId: string, limit?: number): Promise<WorkflowRun[]> => {
      const result = await invokeWorkflows({ action: "history", instance_id: instanceId, limit });
      return result?.runs || [];
    },
    [invokeWorkflows]
  );

  return {
    // Templates
    listTemplates,
    getTemplate,
    applyTemplate,
    getAppliedTemplates,
    removeTemplate,
    // Client Pipeline
    createClient,
    updateClient,
    getClient,
    listClients,
    addClientActivity,
    getPipelineStats,
    getFollowUps,
    archiveClient,
    // Decisions
    createDecision,
    updateDecision,
    getDecision,
    listDecisions,
    searchDecisions,
    getDecisionStats,
    // Workflows
    listWorkflowTemplates,
    activateWorkflow,
    deactivateWorkflow,
    getWorkflowInstances,
    runWorkflow,
    getWorkflowHistory,
  };
}

export default useBusinessTools;
