-- =====================================================
-- Olive baseline schema dump (post-Lovable reconciliation)
-- Generated 2026-04-27 from project wtfspzvcetxmcfftwonq
-- Constructed via Postgres introspection (pg_get_*def + information_schema)
-- =====================================================

-- ===== 01 EXTENSIONS =====
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS wrappers WITH SCHEMA extensions;

-- ===== 02 ENUM TYPES =====
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.expense_split_type AS ENUM ('you_paid_split', 'you_owed_full', 'partner_paid_split', 'partner_owed_full', 'individual');
CREATE TYPE public.invite_status AS ENUM ('pending', 'accepted', 'revoked');
CREATE TYPE public.member_role AS ENUM ('owner', 'member');
CREATE TYPE public.note_priority AS ENUM ('low', 'medium', 'high');
CREATE TYPE public.space_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE public.space_type AS ENUM ('couple', 'family', 'household', 'business', 'custom');

-- ===== 03 TABLES (columns only — constraints applied separately below) =====
CREATE TABLE IF NOT EXISTS public.beta_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category text NOT NULL DEFAULT 'general'::text,
  message text NOT NULL,
  contact_email text,
  user_name text,
  user_id text,
  page text,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.calendar_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  couple_id uuid,
  google_user_id text NOT NULL,
  google_email text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expiry timestamp with time zone,
  primary_calendar_id text NOT NULL,
  calendar_name text,
  calendar_type text DEFAULT 'individual'::text,
  sync_enabled boolean DEFAULT true,
  sync_direction text DEFAULT 'both'::text,
  auto_create_events boolean DEFAULT true,
  last_sync_time timestamp with time zone,
  is_active boolean DEFAULT true,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  show_google_events boolean DEFAULT true,
  auto_add_to_calendar boolean DEFAULT true,
  tasks_enabled boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.calendar_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  google_event_id text NOT NULL,
  title text NOT NULL,
  description text,
  location text,
  start_time timestamp with time zone NOT NULL,
  end_time timestamp with time zone NOT NULL,
  all_day boolean DEFAULT false,
  timezone text DEFAULT 'UTC'::text,
  event_type text DEFAULT 'from_calendar'::text,
  note_id uuid,
  etag text,
  last_synced_at timestamp with time zone DEFAULT now(),
  is_synced boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.calendar_sync_state (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  sync_token text,
  last_sync_time timestamp with time zone,
  sync_status text DEFAULT 'idle'::text,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clerk_couple_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  couple_id uuid,
  user_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  role member_role NOT NULL DEFAULT 'member'::member_role,
  display_name text
);

CREATE TABLE IF NOT EXISTS public.clerk_couples (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text,
  you_name text,
  partner_name text,
  created_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  max_members integer NOT NULL DEFAULT 10
);

CREATE TABLE IF NOT EXISTS public.clerk_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL,
  token text NOT NULL,
  invited_email text,
  status text NOT NULL DEFAULT 'pending'::text,
  created_by text NOT NULL,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '7 days'::interval),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  role member_role NOT NULL DEFAULT 'member'::member_role,
  accepted_by text,
  accepted_at timestamp with time zone,
  revoked boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.clerk_lists (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  couple_id uuid,
  author_id text,
  is_manual boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  space_id uuid
);

CREATE TABLE IF NOT EXISTS public.clerk_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  couple_id uuid,
  author_id text,
  original_text text NOT NULL,
  summary text NOT NULL,
  category text NOT NULL,
  items text[],
  tags text[],
  due_date timestamp with time zone,
  completed boolean NOT NULL DEFAULT false,
  priority note_priority,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  list_id uuid,
  task_owner text,
  location jsonb,
  media_urls text[],
  reminder_time timestamp with time zone,
  recurrence_frequency text,
  recurrence_interval integer DEFAULT 1,
  last_reminded_at timestamp with time zone,
  auto_reminders_sent text[] DEFAULT '{}'::text[],
  olive_tips jsonb,
  embedding vector(768),
  source text,
  source_ref text,
  is_sensitive boolean NOT NULL DEFAULT false,
  encrypted_original_text text,
  encrypted_summary text,
  space_id uuid,
  assigned_to text
);

CREATE TABLE IF NOT EXISTS public.clerk_profiles (
  id text NOT NULL,
  display_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  phone_number text,
  timezone text DEFAULT 'UTC'::text,
  note_style text DEFAULT 'auto'::text,
  language_preference text DEFAULT 'en'::text,
  last_user_message_at timestamp with time zone,
  last_outbound_context jsonb,
  default_privacy text NOT NULL DEFAULT 'shared'::text,
  expense_tracking_mode text DEFAULT 'individual'::text,
  expense_default_split text DEFAULT 'you_paid_split'::text,
  expense_default_currency text DEFAULT 'USD'::text
);

CREATE TABLE IF NOT EXISTS public.couple_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role member_role NOT NULL DEFAULT 'member'::member_role,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.couples (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by uuid,
  title text,
  you_name text,
  partner_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.decryption_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  note_id uuid NOT NULL,
  function_name text NOT NULL,
  ip_address text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.expense_budget_limits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  couple_id uuid,
  category text NOT NULL,
  monthly_limit numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.expense_settlements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  couple_id uuid,
  user_id text NOT NULL,
  settled_by text NOT NULL,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD'::text,
  expense_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  space_id uuid
);

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  couple_id uuid,
  note_id uuid,
  name text NOT NULL,
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD'::text,
  category text NOT NULL DEFAULT 'Other'::text,
  category_icon text DEFAULT '📄'::text,
  split_type expense_split_type NOT NULL DEFAULT 'individual'::expense_split_type,
  paid_by text NOT NULL,
  is_shared boolean NOT NULL DEFAULT false,
  is_settled boolean NOT NULL DEFAULT false,
  settled_at timestamp with time zone,
  settlement_id uuid,
  receipt_url text,
  expense_date timestamp with time zone NOT NULL DEFAULT now(),
  original_text text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  is_recurring boolean NOT NULL DEFAULT false,
  recurrence_frequency text,
  recurrence_interval integer DEFAULT 1,
  next_recurrence_date timestamp with time zone,
  parent_recurring_id uuid,
  space_id uuid
);

CREATE TABLE IF NOT EXISTS public.invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL,
  token text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'::text),
  invited_email text NOT NULL,
  invited_by text,
  status invite_status NOT NULL DEFAULT 'pending'::invite_status,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.linking_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  token text NOT NULL,
  user_id text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.memory_insights (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  suggested_content text NOT NULL,
  source text DEFAULT 'analysis_agent'::text,
  confidence_score double precision,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.note_mentions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  note_id uuid,
  thread_id uuid,
  mentioned_user_id text NOT NULL,
  mentioned_by text NOT NULL,
  space_id uuid,
  read_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.note_reactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL,
  user_id text NOT NULL,
  emoji text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.note_threads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL,
  author_id text NOT NULL,
  body text NOT NULL,
  parent_id uuid,
  space_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL,
  author_id uuid,
  original_text text NOT NULL,
  summary text NOT NULL,
  category text NOT NULL,
  due_date timestamp with time zone,
  tags text[],
  items text[],
  completed boolean NOT NULL DEFAULT false,
  priority note_priority,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  type text NOT NULL DEFAULT 'general'::text,
  title text NOT NULL,
  message text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  priority integer DEFAULT 5,
  read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_agent_executions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  space_id uuid,
  agent_id text NOT NULL,
  agent_name text,
  status text NOT NULL DEFAULT 'queued'::text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_step integer NOT NULL DEFAULT 0,
  total_steps integer NOT NULL DEFAULT 1,
  checkpoint jsonb DEFAULT '{}'::jsonb,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error_message text,
  trust_action_id uuid,
  required_trust_level integer DEFAULT 0,
  queued_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3,
  next_retry_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.olive_agent_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id text NOT NULL,
  user_id text NOT NULL,
  couple_id text,
  status text DEFAULT 'running'::text,
  state jsonb DEFAULT '{}'::jsonb,
  result jsonb,
  steps_completed integer DEFAULT 0,
  error_message text,
  started_at timestamp with time zone DEFAULT now(),
  completed_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.olive_briefings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  space_id uuid,
  briefing_type text NOT NULL DEFAULT 'daily'::text,
  title text NOT NULL,
  summary text NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  covers_from timestamp with time zone,
  covers_to timestamp with time zone,
  task_count integer DEFAULT 0,
  delegation_count integer DEFAULT 0,
  delivered_via text[] DEFAULT '{}'::text[],
  read_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_chat_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  couple_id uuid,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  last_message_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_client_activity (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  user_id text NOT NULL,
  activity_type text NOT NULL,
  from_value text,
  to_value text,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_clients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  user_id text NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  company text,
  stage text NOT NULL DEFAULT 'lead'::text,
  source text,
  estimated_value numeric(12,2),
  actual_value numeric(12,2),
  currency text NOT NULL DEFAULT 'USD'::text,
  tags jsonb DEFAULT '[]'::jsonb,
  notes text,
  follow_up_date timestamp with time zone,
  last_contact timestamp with time zone,
  stage_changed_at timestamp with time zone NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_conflicts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  user_id text NOT NULL,
  conflict_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium'::text,
  title text NOT NULL,
  description text,
  entity_a_type text NOT NULL,
  entity_a_id text NOT NULL,
  entity_b_type text NOT NULL,
  entity_b_id text NOT NULL,
  status text NOT NULL DEFAULT 'open'::text,
  resolution text,
  resolved_by text,
  resolved_at timestamp with time zone,
  detected_at timestamp with time zone NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.olive_consolidation_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  run_type text NOT NULL DEFAULT 'nightly'::text,
  status text NOT NULL DEFAULT 'running'::text,
  memories_scanned integer DEFAULT 0,
  memories_merged integer DEFAULT 0,
  memories_archived integer DEFAULT 0,
  memories_deduplicated integer DEFAULT 0,
  chunks_compacted integer DEFAULT 0,
  daily_logs_compacted integer DEFAULT 0,
  token_savings integer DEFAULT 0,
  merge_details jsonb DEFAULT '[]'::jsonb,
  error_message text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.olive_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  note_id uuid NOT NULL,
  interaction_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_cross_space_insights (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  insight_type text NOT NULL,
  source_spaces jsonb NOT NULL DEFAULT '[]'::jsonb,
  title text NOT NULL,
  description text NOT NULL,
  suggestion text,
  confidence double precision DEFAULT 0.5,
  status text NOT NULL DEFAULT 'new'::text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.olive_decisions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  user_id text NOT NULL,
  title text NOT NULL,
  description text,
  category text,
  status text NOT NULL DEFAULT 'proposed'::text,
  decision_date timestamp with time zone NOT NULL DEFAULT now(),
  participants jsonb DEFAULT '[]'::jsonb,
  context text,
  rationale text,
  alternatives jsonb DEFAULT '[]'::jsonb,
  outcome text,
  outcome_date timestamp with time zone,
  related_note_ids jsonb DEFAULT '[]'::jsonb,
  tags jsonb DEFAULT '[]'::jsonb,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_delegations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  note_id uuid,
  title text NOT NULL,
  description text,
  priority text DEFAULT 'normal'::text,
  delegated_by text NOT NULL,
  delegated_to text NOT NULL,
  suggested_by text DEFAULT 'user'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  snoozed_until timestamp with time zone,
  reassigned_to text,
  reassign_reason text,
  response_note text,
  responded_at timestamp with time zone,
  completed_at timestamp with time zone,
  agent_execution_id uuid,
  reasoning text,
  notified_via text[] DEFAULT '{}'::text[],
  last_notified_at timestamp with time zone,
  reminder_count integer DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_email_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  provider text NOT NULL DEFAULT 'gmail'::text,
  email_address text,
  access_token text,
  refresh_token text,
  token_expiry timestamp with time zone,
  scopes text[],
  last_sync_at timestamp with time zone,
  is_active boolean DEFAULT true,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  triage_frequency text DEFAULT 'manual'::text,
  triage_lookback_days integer DEFAULT 3,
  auto_save_tasks boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.olive_engagement_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  event_type text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_engagement_metrics (
  user_id text NOT NULL,
  score integer NOT NULL DEFAULT 50,
  messages_sent_7d integer NOT NULL DEFAULT 0,
  messages_responded_7d integer NOT NULL DEFAULT 0,
  proactive_accepted_7d integer NOT NULL DEFAULT 0,
  proactive_ignored_7d integer NOT NULL DEFAULT 0,
  proactive_rejected_7d integer NOT NULL DEFAULT 0,
  avg_response_time_seconds integer,
  last_interaction timestamp with time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_entities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  couple_id uuid,
  name text NOT NULL,
  canonical_name text NOT NULL,
  entity_type text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  mention_count integer DEFAULT 1,
  first_seen timestamp with time zone DEFAULT now(),
  last_seen timestamp with time zone DEFAULT now(),
  embedding vector(768),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_entity_communities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  label text NOT NULL,
  entity_ids uuid[] NOT NULL,
  cohesion double precision DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_expense_split_shares (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  split_id uuid NOT NULL,
  user_id text NOT NULL,
  amount numeric(12,2) NOT NULL,
  percentage numeric(5,2),
  is_paid boolean NOT NULL DEFAULT false,
  paid_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.olive_expense_splits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  transaction_id uuid,
  created_by text NOT NULL,
  description text NOT NULL,
  total_amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD'::text,
  split_type text NOT NULL DEFAULT 'equal'::text,
  is_settled boolean NOT NULL DEFAULT false,
  settled_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_gateway_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  channel text DEFAULT 'whatsapp'::text,
  conversation_context jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  last_activity timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_heartbeat_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  job_type text NOT NULL,
  scheduled_for timestamp with time zone NOT NULL,
  status text DEFAULT 'pending'::text,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_heartbeat_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  job_type text NOT NULL,
  status text NOT NULL,
  message_preview text,
  execution_time_ms integer,
  created_at timestamp with time zone DEFAULT now(),
  channel text,
  reflection_captured boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.olive_industry_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  industry text NOT NULL,
  name text NOT NULL,
  description text,
  icon text,
  version integer NOT NULL DEFAULT 1,
  lists jsonb NOT NULL DEFAULT '[]'::jsonb,
  skills jsonb NOT NULL DEFAULT '[]'::jsonb,
  budget_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  proactive_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  soul_hints jsonb NOT NULL DEFAULT '{}'::jsonb,
  note_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_llm_calls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text,
  function_name text NOT NULL,
  model text NOT NULL,
  prompt_version text,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,
  cost_usd numeric(10,6),
  status text NOT NULL DEFAULT 'success'::text,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_memory_chunks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  memory_file_id uuid,
  user_id text NOT NULL,
  chunk_index integer DEFAULT 0,
  content text NOT NULL,
  chunk_type text DEFAULT 'fact'::text,
  importance integer DEFAULT 3,
  embedding vector(1536),
  source text DEFAULT 'auto'::text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  last_accessed_at timestamp with time zone,
  decay_factor double precision NOT NULL DEFAULT 1.0,
  consolidated_into uuid,
  is_active boolean NOT NULL DEFAULT true,
  source_message_id text
);

CREATE TABLE IF NOT EXISTS public.olive_memory_contradictions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  chunk_a_id uuid,
  chunk_b_id uuid,
  chunk_a_content text NOT NULL,
  chunk_b_content text NOT NULL,
  contradiction_type text NOT NULL,
  confidence double precision NOT NULL DEFAULT 0.5,
  resolution text DEFAULT 'unresolved'::text,
  resolved_content text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_memory_files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  couple_id uuid,
  file_type text NOT NULL,
  file_date date,
  content text NOT NULL DEFAULT ''::text,
  content_hash text,
  token_count integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  embedding vector(1536),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  space_id text
);

CREATE TABLE IF NOT EXISTS public.olive_memory_maintenance_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  run_type text NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  stats jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'running'::text,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_memory_relevance (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL,
  user_id text NOT NULL,
  relevance_score double precision NOT NULL DEFAULT 1.0,
  access_count integer DEFAULT 0,
  last_accessed_at timestamp with time zone,
  decay_rate double precision DEFAULT 0.02,
  is_archived boolean DEFAULT false,
  archived_at timestamp with time zone,
  archive_reason text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_outbound_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  message_type text NOT NULL,
  content text NOT NULL,
  media_url text,
  priority text DEFAULT 'normal'::text,
  status text DEFAULT 'pending'::text,
  scheduled_for timestamp with time zone DEFAULT now(),
  sent_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_patterns (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  couple_id uuid,
  pattern_type text NOT NULL,
  pattern_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence double precision DEFAULT 0.5,
  sample_count integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  space_id text
);

CREATE TABLE IF NOT EXISTS public.olive_poll_votes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL,
  user_id text NOT NULL,
  option_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ranking jsonb,
  voted_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_polls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  created_by text NOT NULL,
  question text NOT NULL,
  description text,
  poll_type text NOT NULL DEFAULT 'single'::text,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  allow_add_options boolean NOT NULL DEFAULT false,
  anonymous boolean NOT NULL DEFAULT false,
  closes_at timestamp with time zone,
  status text NOT NULL DEFAULT 'open'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_pricing_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  plan_id text NOT NULL,
  name text NOT NULL,
  description text,
  max_spaces integer NOT NULL DEFAULT 1,
  max_members_per_space integer NOT NULL DEFAULT 2,
  max_notes_per_month integer NOT NULL DEFAULT 100,
  max_ai_requests_per_day integer NOT NULL DEFAULT 20,
  max_whatsapp_messages_per_day integer NOT NULL DEFAULT 10,
  max_file_storage_mb integer NOT NULL DEFAULT 100,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_monthly_cents integer NOT NULL DEFAULT 0,
  price_yearly_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD'::text,
  stripe_price_id_monthly text,
  stripe_price_id_yearly text,
  sort_order integer NOT NULL DEFAULT 0,
  is_popular boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_reflections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  space_id text,
  action_type text NOT NULL,
  action_detail jsonb DEFAULT '{}'::jsonb,
  outcome text NOT NULL,
  user_modification text,
  lesson text,
  confidence double precision DEFAULT 0.5,
  applied_to_soul boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_relationships (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  source_entity_id uuid NOT NULL,
  target_entity_id uuid NOT NULL,
  relationship_type text NOT NULL,
  confidence text NOT NULL DEFAULT 'INFERRED'::text,
  confidence_score double precision DEFAULT 0.7,
  rationale text,
  source_note_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  couple_id uuid
);

CREATE TABLE IF NOT EXISTS public.olive_router_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text,
  source text NOT NULL,
  raw_text text,
  classified_intent text,
  confidence double precision,
  chat_type text,
  classification_model text,
  response_model text,
  route_reason text,
  classification_latency_ms integer,
  total_latency_ms integer,
  created_at timestamp with time zone DEFAULT now(),
  media_present boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.olive_skills (
  skill_id text NOT NULL,
  name text NOT NULL,
  description text,
  category text DEFAULT 'general'::text,
  triggers jsonb DEFAULT '[]'::jsonb,
  content text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  agent_type text DEFAULT 'skill'::text,
  schedule text,
  agent_config jsonb DEFAULT '{}'::jsonb,
  requires_approval boolean DEFAULT false,
  requires_connection text
);

CREATE TABLE IF NOT EXISTS public.olive_soul_evolution_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  layer_type text NOT NULL,
  proposals_count integer DEFAULT 0,
  proposals_applied integer DEFAULT 0,
  proposals_deferred integer DEFAULT 0,
  proposals_blocked integer DEFAULT 0,
  drift_score double precision DEFAULT 0.0,
  drift_details jsonb DEFAULT '{}'::jsonb,
  was_rate_limited boolean DEFAULT false,
  was_rollback boolean DEFAULT false,
  rollback_reason text,
  rollback_to_version integer,
  trigger text,
  changes_summary text[],
  pre_snapshot_version integer,
  post_snapshot_version integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_soul_layers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  layer_type text NOT NULL,
  owner_type text NOT NULL,
  owner_id text,
  version integer NOT NULL DEFAULT 1,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_rendered text,
  token_count integer DEFAULT 0,
  is_locked boolean NOT NULL DEFAULT false,
  evolved_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_soul_rollbacks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  layer_id uuid NOT NULL,
  layer_type text NOT NULL,
  from_version integer NOT NULL,
  to_version integer NOT NULL,
  reason text NOT NULL,
  requested_by text NOT NULL DEFAULT 'user'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  applied_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_soul_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  layer_id uuid NOT NULL,
  version integer NOT NULL,
  content jsonb NOT NULL,
  content_rendered text,
  change_summary text,
  trigger text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_space_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  token text NOT NULL DEFAULT (gen_random_uuid())::text,
  space_id uuid NOT NULL,
  role space_role NOT NULL DEFAULT 'member'::space_role,
  invited_email text,
  invited_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '7 days'::interval),
  accepted_by text,
  accepted_at timestamp with time zone,
  status text NOT NULL DEFAULT 'pending'::text
);

CREATE TABLE IF NOT EXISTS public.olive_space_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  user_id text NOT NULL,
  role space_role NOT NULL DEFAULT 'member'::space_role,
  nickname text,
  joined_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_space_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  template_id uuid NOT NULL,
  applied_by text NOT NULL,
  applied_at timestamp with time zone NOT NULL DEFAULT now(),
  config_overrides jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.olive_spaces (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT ''::text,
  type space_type NOT NULL DEFAULT 'couple'::space_type,
  icon text,
  max_members integer NOT NULL DEFAULT 10,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  couple_id uuid,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  plan_id text NOT NULL,
  status text NOT NULL DEFAULT 'active'::text,
  billing_cycle text NOT NULL DEFAULT 'monthly'::text,
  stripe_customer_id text,
  stripe_subscription_id text,
  revenucat_subscriber_id text,
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  trial_end timestamp with time zone,
  canceled_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_trust_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  space_id uuid,
  action_type text NOT NULL,
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_description text NOT NULL,
  trust_level integer NOT NULL DEFAULT 0,
  required_level integer NOT NULL DEFAULT 2,
  status text NOT NULL DEFAULT 'pending'::text,
  user_response text,
  responded_at timestamp with time zone,
  executed_at timestamp with time zone,
  execution_result jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + '24:00:00'::interval),
  trigger_type text DEFAULT 'proactive'::text,
  trigger_context jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.olive_trust_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  trust_action_id uuid,
  read_at timestamp with time zone,
  acted_on_at timestamp with time zone,
  dismissed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_usage_meters (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  meter_date date NOT NULL DEFAULT CURRENT_DATE,
  notes_created integer NOT NULL DEFAULT 0,
  ai_requests integer NOT NULL DEFAULT 0,
  whatsapp_messages_sent integer NOT NULL DEFAULT 0,
  whatsapp_messages_received integer NOT NULL DEFAULT 0,
  file_uploads integer NOT NULL DEFAULT 0,
  file_storage_bytes bigint NOT NULL DEFAULT 0,
  delegations_created integer NOT NULL DEFAULT 0,
  workflow_runs integer NOT NULL DEFAULT 0,
  search_queries integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_user_preferences (
  user_id text NOT NULL,
  proactive_enabled boolean DEFAULT true,
  max_daily_messages integer DEFAULT 5,
  quiet_hours_start time without time zone DEFAULT '22:00:00'::time without time zone,
  quiet_hours_end time without time zone DEFAULT '07:00:00'::time without time zone,
  morning_briefing_enabled boolean DEFAULT false,
  evening_review_enabled boolean DEFAULT false,
  weekly_summary_enabled boolean DEFAULT false,
  overdue_nudge_enabled boolean DEFAULT true,
  pattern_suggestions_enabled boolean DEFAULT true,
  timezone text DEFAULT 'UTC'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  morning_briefing_time text DEFAULT '08:00'::text,
  evening_review_time text DEFAULT '20:00'::text,
  weekly_summary_time text DEFAULT '10:00'::text,
  weekly_summary_day integer DEFAULT 0,
  reminder_advance_intervals text[] NOT NULL DEFAULT '{}'::text[],
  soul_enabled boolean NOT NULL DEFAULT false,
  plan_id text DEFAULT 'free'::text
);

CREATE TABLE IF NOT EXISTS public.olive_user_skills (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  skill_id text,
  enabled boolean DEFAULT true,
  config jsonb DEFAULT '{}'::jsonb,
  usage_count integer DEFAULT 0,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_workflow_instances (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workflow_id text NOT NULL,
  space_id uuid NOT NULL,
  enabled_by text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  schedule_override text,
  config jsonb DEFAULT '{}'::jsonb,
  last_run_at timestamp with time zone,
  last_run_status text,
  run_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.olive_workflow_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL,
  workflow_id text NOT NULL,
  space_id uuid NOT NULL,
  triggered_by text NOT NULL DEFAULT 'schedule'::text,
  status text NOT NULL DEFAULT 'running'::text,
  steps_completed integer DEFAULT 0,
  steps_total integer DEFAULT 0,
  output jsonb DEFAULT '{}'::jsonb,
  error text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.olive_workflow_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workflow_id text NOT NULL,
  name text NOT NULL,
  description text,
  icon text,
  category text NOT NULL DEFAULT 'productivity'::text,
  default_schedule text NOT NULL,
  schedule_options jsonb DEFAULT '[]'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_type text NOT NULL DEFAULT 'briefing'::text,
  output_channel text NOT NULL DEFAULT 'in_app'::text,
  requires_feature jsonb DEFAULT '[]'::jsonb,
  min_space_members integer DEFAULT 1,
  applicable_space_types jsonb DEFAULT '["couple", "family", "household", "business", "custom"]'::jsonb,
  is_builtin boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.oura_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  oura_user_id text,
  oura_email text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expiry timestamp with time zone,
  scopes text[] DEFAULT ARRAY['email'::text, 'personal'::text, 'daily'::text, 'heartrate'::text, 'workout'::text, 'session'::text, 'spo2'::text, 'tag'::text],
  is_active boolean DEFAULT true,
  last_sync_time timestamp with time zone,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  share_wellness_with_partner boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.oura_daily_data (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  user_id text NOT NULL,
  day date NOT NULL,
  sleep_score integer,
  sleep_duration_seconds integer,
  sleep_efficiency integer,
  deep_sleep_seconds integer,
  rem_sleep_seconds integer,
  light_sleep_seconds integer,
  awake_seconds integer,
  sleep_latency_seconds integer,
  bedtime_start timestamp with time zone,
  bedtime_end timestamp with time zone,
  readiness_score integer,
  readiness_temperature_deviation real,
  readiness_hrv_balance integer,
  readiness_resting_heart_rate integer,
  activity_score integer,
  steps integer,
  active_calories integer,
  total_calories integer,
  active_minutes integer,
  sedentary_minutes integer,
  raw_data jsonb,
  synced_at timestamp with time zone DEFAULT now(),
  stress_high_minutes integer,
  recovery_high_minutes integer,
  stress_day_summary text,
  resilience_level text,
  resilience_sleep_recovery numeric,
  resilience_daytime_recovery numeric
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL,
  display_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.space_activity (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_memories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  category text DEFAULT 'personal'::text,
  importance integer DEFAULT 3,
  embedding vector(768),
  metadata jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  couple_id uuid
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  role app_role NOT NULL DEFAULT 'user'::app_role,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  conversation_state text NOT NULL DEFAULT 'IDLE'::text,
  context_data jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- ===== 04 FUNCTIONS =====
CREATE OR REPLACE FUNCTION public.accept_invite(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invite record;
  v_current_count integer;
  v_max integer;
  v_display_name text;
  v_user_id text;
BEGIN
  v_user_id := (auth.jwt() ->> 'sub');

  -- Get invite details
  SELECT * INTO v_invite
  FROM public.clerk_invites i
  WHERE i.token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITE_NOT_FOUND';
  END IF;

  IF v_invite.accepted_at IS NOT NULL THEN
    IF v_invite.accepted_by = v_user_id THEN
      RETURN v_invite.couple_id;
    END IF;
    RAISE EXCEPTION 'INVITE_ALREADY_ACCEPTED';
  END IF;

  IF v_invite.expires_at <= NOW() THEN
    RAISE EXCEPTION 'INVITE_EXPIRED';
  END IF;

  IF COALESCE(v_invite.revoked, false) THEN
    RAISE EXCEPTION 'INVITE_REVOKED';
  END IF;

  -- Check member cap
  SELECT count(*), COALESCE(c.max_members, 10)
  INTO v_current_count, v_max
  FROM public.clerk_couple_members m
  JOIN public.clerk_couples c ON c.id = m.couple_id
  WHERE m.couple_id = v_invite.couple_id
  GROUP BY c.max_members;

  IF v_current_count IS NULL THEN v_current_count := 0; END IF;
  IF v_max IS NULL THEN v_max := 10; END IF;

  IF v_current_count >= v_max THEN
    RAISE EXCEPTION 'SPACE_FULL: Maximum % members reached', v_max;
  END IF;

  -- Get display name from profile
  SELECT p.display_name INTO v_display_name
  FROM public.clerk_profiles p
  WHERE p.id = v_user_id;

  -- Add user to couple with display_name
  INSERT INTO public.clerk_couple_members(couple_id, user_id, role, display_name)
  VALUES (v_invite.couple_id, v_user_id, v_invite.role::public.member_role, v_display_name)
  ON CONFLICT (couple_id, user_id) DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, clerk_couple_members.display_name);

  -- Mark invite as accepted
  UPDATE public.clerk_invites
  SET accepted_at = NOW(), accepted_by = v_user_id
  WHERE token = p_token;

  RETURN v_invite.couple_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.accept_space_invite(p_token text)
 RETURNS olive_space_members
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_id text := auth.jwt() ->> 'sub';
  v_invite olive_space_invites;
  v_member olive_space_members;
BEGIN
  SELECT * INTO v_invite FROM olive_space_invites WHERE token = p_token AND status = 'pending' AND expires_at > now();
  IF v_invite IS NULL THEN RAISE EXCEPTION 'Invalid or expired invite'; END IF;
  INSERT INTO olive_space_members (space_id, user_id, role) VALUES (v_invite.space_id, v_user_id, v_invite.role)
  ON CONFLICT (space_id, user_id) DO UPDATE SET role = EXCLUDED.role
  RETURNING * INTO v_member;
  UPDATE olive_space_invites SET status = 'accepted', accepted_by = v_user_id, accepted_at = now() WHERE id = v_invite.id;
  RETURN v_member;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.add_clerk_creator_as_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.created_by is not null then
    insert into public.clerk_couple_members (couple_id, user_id, role)
    values (new.id, new.created_by, 'owner'::member_role)
    on conflict do nothing;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_creator_as_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.created_by is not null then
    insert into public.couple_members (couple_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict (couple_id, user_id) do nothing;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_member_to_space(p_couple_id uuid, p_user_id text, p_display_name text, p_role member_role DEFAULT 'member'::member_role)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_count integer;
  v_max integer;
  v_member_id uuid;
BEGIN
  -- Get current member count and max
  SELECT count(*), COALESCE(c.max_members, 10)
  INTO v_current_count, v_max
  FROM public.clerk_couple_members m
  JOIN public.clerk_couples c ON c.id = m.couple_id
  WHERE m.couple_id = p_couple_id
  GROUP BY c.max_members;

  -- If no members found, set defaults
  IF v_current_count IS NULL THEN
    v_current_count := 0;
    SELECT COALESCE(c.max_members, 10) INTO v_max
    FROM public.clerk_couples c WHERE c.id = p_couple_id;
  END IF;

  IF v_current_count >= v_max THEN
    RAISE EXCEPTION 'SPACE_FULL: Maximum % members reached', v_max;
  END IF;

  INSERT INTO public.clerk_couple_members (couple_id, user_id, role, display_name)
  VALUES (p_couple_id, p_user_id, p_role, p_display_name)
  ON CONFLICT (couple_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO v_member_id;

  RETURN v_member_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_memory_decay(p_user_id text, p_archive_threshold double precision DEFAULT 0.1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_archived_count INT;
BEGIN
  UPDATE olive_memory_relevance SET
    relevance_score = GREATEST(0.0, relevance_score - (decay_rate * EXTRACT(EPOCH FROM (now() - COALESCE(last_accessed_at, created_at))) / 86400.0)),
    updated_at = now()
  WHERE user_id = p_user_id AND is_archived = false;

  UPDATE olive_memory_relevance SET is_archived = true, archived_at = now(), archive_reason = 'decay'
  WHERE user_id = p_user_id AND is_archived = false AND relevance_score < p_archive_threshold;
  GET DIAGNOSTICS v_archived_count = ROW_COUNT;

  UPDATE user_memories SET is_active = false, updated_at = now()
  WHERE user_id = p_user_id AND id IN (
    SELECT memory_id FROM olive_memory_relevance WHERE user_id = p_user_id AND is_archived = true AND archive_reason = 'decay'
  ) AND is_active = true;

  RETURN v_archived_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.boost_memory_relevance(p_memory_id uuid, p_user_id text, p_boost double precision DEFAULT 0.15)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO olive_memory_relevance (memory_id, user_id, relevance_score, access_count, last_accessed_at)
  VALUES (p_memory_id, p_user_id, LEAST(1.0, 1.0), 1, now())
  ON CONFLICT (memory_id, user_id) DO UPDATE SET
    relevance_score = LEAST(1.0, olive_memory_relevance.relevance_score + p_boost),
    access_count = olive_memory_relevance.access_count + 1,
    last_accessed_at = now(), updated_at = now();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.capture_category_edit_reflection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  seconds_since_create NUMERIC;
BEGIN
  IF OLD.category IS NOT DISTINCT FROM NEW.category THEN
    RETURN NEW;
  END IF;

  IF NEW.author_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM olive_user_preferences
    WHERE user_id = NEW.author_id AND soul_enabled = true
  ) THEN
    RETURN NEW;
  END IF;

  seconds_since_create := EXTRACT(EPOCH FROM (now() - OLD.created_at));
  IF seconds_since_create > 60 THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO olive_reflections (
      user_id,
      action_type,
      action_detail,
      outcome,
      user_modification,
      lesson,
      confidence
    ) VALUES (
      NEW.author_id,
      'categorize_note',
      jsonb_build_object(
        'note_id', NEW.id::text,
        'from_category', OLD.category,
        'to_category', NEW.category,
        'seconds_after_capture', seconds_since_create,
        'note_summary', LEFT(COALESCE(NEW.summary, ''), 120)
      ),
      'modified',
      OLD.category,
      'User changed AI category from ' || OLD.category || ' to ' || NEW.category
        || ' within ' || ROUND(seconds_since_create)::text || 's of capture',
      0.9
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'capture_category_edit_reflection insert failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_quota(p_user_id text, p_meter text)
 RETURNS TABLE(current_usage integer, max_allowed integer, is_within_quota boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE v_plan_id TEXT; v_current INT; v_max INT;
BEGIN
  SELECT s.plan_id INTO v_plan_id FROM olive_subscriptions s WHERE s.user_id = p_user_id AND s.status IN ('active', 'trialing') LIMIT 1;
  IF v_plan_id IS NULL THEN v_plan_id := 'free'; END IF;
  EXECUTE format('SELECT COALESCE((SELECT %I FROM olive_usage_meters WHERE user_id = $1 AND meter_date = CURRENT_DATE), 0)', p_meter) INTO v_current USING p_user_id;
  EXECUTE format('SELECT COALESCE((SELECT %I FROM olive_pricing_plans WHERE plan_id = $1), 0)',
    CASE p_meter WHEN 'ai_requests' THEN 'max_ai_requests_per_day' WHEN 'whatsapp_messages_sent' THEN 'max_whatsapp_messages_per_day' WHEN 'notes_created' THEN 'max_notes_per_month' ELSE 'max_ai_requests_per_day' END
  ) INTO v_max USING v_plan_id;
  RETURN QUERY SELECT v_current, v_max, v_current < v_max;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_expired_linking_tokens()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.linking_tokens
  WHERE expires_at < now() - interval '1 hour';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.compute_engagement_score(p_user_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_accept_rate FLOAT; v_response_rate FLOAT; v_recency_score FLOAT;
  v_proactive_sent INT; v_proactive_accepted INT;
  v_messages_sent INT; v_messages_responded INT;
  v_last_interaction TIMESTAMPTZ; v_score INT;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE event_type IN ('proactive_accepted', 'proactive_ignored', 'proactive_rejected')),
    COUNT(*) FILTER (WHERE event_type = 'proactive_accepted'),
    COUNT(*) FILTER (WHERE event_type = 'message_sent'),
    COUNT(*) FILTER (WHERE event_type = 'message_responded'),
    MAX(created_at)
  INTO v_proactive_sent, v_proactive_accepted, v_messages_sent, v_messages_responded, v_last_interaction
  FROM olive_engagement_events WHERE user_id = p_user_id AND created_at > (now() - INTERVAL '7 days');

  v_accept_rate := CASE WHEN v_proactive_sent > 0 THEN (v_proactive_accepted::FLOAT / v_proactive_sent) * 40 ELSE 20 END;
  v_response_rate := CASE WHEN v_messages_sent > 0 THEN (v_messages_responded::FLOAT / v_messages_sent) * 30 ELSE 15 END;
  v_recency_score := CASE
    WHEN v_last_interaction IS NULL THEN 5
    WHEN v_last_interaction > (now() - INTERVAL '1 day') THEN 20
    WHEN v_last_interaction > (now() - INTERVAL '3 days') THEN 15
    WHEN v_last_interaction > (now() - INTERVAL '7 days') THEN 10
    WHEN v_last_interaction > (now() - INTERVAL '14 days') THEN 5
    ELSE 0 END;

  v_score := LEAST(100, GREATEST(0, ROUND(v_accept_rate + v_response_rate + v_recency_score + 10)::INT));

  INSERT INTO olive_engagement_metrics (user_id, score, messages_sent_7d, messages_responded_7d,
    proactive_accepted_7d, proactive_ignored_7d, proactive_rejected_7d, last_interaction, updated_at)
  VALUES (
    p_user_id, v_score, v_messages_sent, v_messages_responded, v_proactive_accepted,
    (SELECT COUNT(*) FROM olive_engagement_events WHERE user_id = p_user_id AND event_type = 'proactive_ignored' AND created_at > now() - INTERVAL '7 days'),
    (SELECT COUNT(*) FROM olive_engagement_events WHERE user_id = p_user_id AND event_type = 'proactive_rejected' AND created_at > now() - INTERVAL '7 days'),
    v_last_interaction, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    score = EXCLUDED.score, messages_sent_7d = EXCLUDED.messages_sent_7d,
    messages_responded_7d = EXCLUDED.messages_responded_7d, proactive_accepted_7d = EXCLUDED.proactive_accepted_7d,
    proactive_ignored_7d = EXCLUDED.proactive_ignored_7d, proactive_rejected_7d = EXCLUDED.proactive_rejected_7d,
    last_interaction = EXCLUDED.last_interaction, updated_at = now();

  RETURN v_score;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_couple(p_you_name text, p_partner_name text, p_title text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id  text := (auth.jwt() ->> 'sub');
  v_couple_id uuid;
  v_existing_couple_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Check if user already has a couple (as owner)
  SELECT c.id INTO v_existing_couple_id
  FROM public.clerk_couples c
  JOIN public.clerk_couple_members m ON m.couple_id = c.id
  WHERE m.user_id = v_user_id
    AND m.role = 'owner'
  LIMIT 1;

  -- If they already have a couple, update it and return
  IF v_existing_couple_id IS NOT NULL THEN
    UPDATE public.clerk_couples
    SET title = p_title, you_name = p_you_name, partner_name = p_partner_name, updated_at = now()
    WHERE id = v_existing_couple_id;

    -- Also update owner's display_name
    UPDATE public.clerk_couple_members
    SET display_name = p_you_name
    WHERE couple_id = v_existing_couple_id AND user_id = v_user_id;

    RETURN v_existing_couple_id;
  END IF;

  -- Create new couple
  INSERT INTO public.clerk_couples (title, you_name, partner_name, created_by)
  VALUES (p_title, p_you_name, p_partner_name, v_user_id)
  RETURNING id INTO v_couple_id;

  -- Add owner membership with display_name
  INSERT INTO public.clerk_couple_members (couple_id, user_id, role, display_name)
  VALUES (v_couple_id, v_user_id, 'owner'::public.member_role, p_you_name)
  ON CONFLICT (couple_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

  RETURN v_couple_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_invite(p_couple_id uuid, p_invited_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_token text;
  v_invite_id uuid;
BEGIN
  -- Must be a member of the space (was: owner-only — too restrictive).
  IF NOT EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = p_couple_id
      AND m.user_id = (auth.jwt() ->> 'sub')
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Generate token and insert invite
  v_token := gen_random_uuid()::text;

  INSERT INTO public.clerk_invites(token, couple_id, role, invited_email, created_by, expires_at)
  VALUES (
    v_token,
    p_couple_id,
    'member',
    p_invited_email,
    (auth.jwt() ->> 'sub'),
    now() + interval '7 days'
  )
  RETURNING id INTO v_invite_id;

  RETURN jsonb_build_object(
    'invite_id', v_invite_id,
    'token', v_token,
    'couple_id', p_couple_id
  );
END
$function$
;

CREATE OR REPLACE FUNCTION public.create_space(p_name text, p_type text DEFAULT 'custom'::text, p_icon text DEFAULT NULL::text, p_settings jsonb DEFAULT '{}'::jsonb)
 RETURNS olive_spaces
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_id text := auth.jwt() ->> 'sub';
  v_space olive_spaces;
BEGIN
  INSERT INTO olive_spaces (name, type, icon, settings, created_by)
  VALUES (p_name, p_type::space_type, p_icon, p_settings, v_user_id)
  RETURNING * INTO v_space;
  INSERT INTO olive_space_members (space_id, user_id, role) VALUES (v_space.id, v_user_id, 'owner');
  RETURN v_space;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_space_invite(p_space_id uuid, p_invited_email text DEFAULT NULL::text, p_role text DEFAULT 'member'::text)
 RETURNS olive_space_invites
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_id text := auth.jwt() ->> 'sub';
  v_invite olive_space_invites;
BEGIN
  IF NOT is_space_member(p_space_id, v_user_id) THEN RAISE EXCEPTION 'Not a member of this space'; END IF;
  INSERT INTO olive_space_invites (space_id, role, invited_email, invited_by)
  VALUES (p_space_id, p_role::space_role, p_invited_email, v_user_id)
  RETURNING * INTO v_invite;
  RETURN v_invite;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.debug_claims()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'role',  auth.role(),
    'sub',   auth.jwt()->>'sub',
    'claims', current_setting('request.jwt.claims', true)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.debug_clerk_jwt()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN current_setting('request.jwt.claims', true);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.debug_clerk_user_id()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN COALESCE(
    auth.jwt()->>'sub',
    auth.jwt()->>'user_id',
    'NO_USER_ID_FOUND'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.debug_clerk_user_id_fixed()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN current_setting('request.jwt.claims', true)::json->>'sub';
END;
$function$
;

CREATE OR REPLACE FUNCTION public.debug_jwt_claims()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN auth.jwt();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.expire_old_trust_actions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE olive_trust_actions SET status = 'expired' WHERE status = 'pending' AND expires_at < now();
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fetch_top_memory_chunks(p_user_id text, p_limit integer DEFAULT 8, p_min_importance integer DEFAULT 3)
 RETURNS TABLE(id uuid, content text, chunk_type text, importance integer, source text, decay_factor double precision, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    c.id,
    c.content,
    c.chunk_type,
    c.importance,
    c.source,
    c.decay_factor,
    c.created_at
  FROM olive_memory_chunks c
  WHERE c.user_id = p_user_id
    AND c.is_active = true
    AND c.importance >= p_min_importance
  ORDER BY
    c.importance * COALESCE(c.decay_factor, 1.0) DESC,
    c.created_at DESC
  LIMIT p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.find_shared_entities(p_couple_id uuid, p_min_similarity double precision DEFAULT 0.85)
 RETURNS TABLE(entity_a_id uuid, entity_a_user text, entity_a_name text, entity_b_id uuid, entity_b_user text, entity_b_name text, entity_type text, name_similarity double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT a.id, a.user_id, a.name, b.id, b.user_id, b.name, a.entity_type, similarity(LOWER(a.name), LOWER(b.name))::float
  FROM olive_entities a JOIN olive_entities b ON a.entity_type = b.entity_type AND a.user_id < b.user_id
  JOIN clerk_couple_members ma ON ma.user_id = a.user_id
  JOIN clerk_couple_members mb ON mb.user_id = b.user_id AND mb.couple_id = ma.couple_id
  WHERE ma.couple_id = p_couple_id AND similarity(LOWER(a.name), LOWER(b.name)) >= p_min_similarity;
$function$
;

CREATE OR REPLACE FUNCTION public.find_similar_chunks(p_user_id text, p_embedding vector, p_threshold double precision DEFAULT 0.92, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, content text, chunk_type text, importance integer, source text, similarity double precision, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    c.id,
    c.content,
    c.chunk_type,
    c.importance,
    c.source,
    1 - (c.embedding <=> p_embedding) AS similarity,
    c.created_at
  FROM olive_memory_chunks c
  WHERE c.user_id = p_user_id
    AND c.is_active = true
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> p_embedding) >= p_threshold
  ORDER BY c.embedding <=> p_embedding
  LIMIT p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.find_similar_notes(p_user_id text, p_couple_id uuid, p_query_embedding vector, p_threshold double precision DEFAULT 0.85, p_limit integer DEFAULT 5)
 RETURNS TABLE(id uuid, summary text, similarity double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    n.id,
    n.summary,
    (1 - (n.embedding <=> p_query_embedding))::float AS similarity
  FROM public.clerk_notes n
  WHERE n.embedding IS NOT NULL
    AND n.completed = false
    AND (
      (n.author_id = p_user_id AND n.couple_id IS NULL)
      OR (n.couple_id = p_couple_id AND p_couple_id IS NOT NULL)
    )
    AND (1 - (n.embedding <=> p_query_embedding)) > p_threshold
  ORDER BY n.embedding <=> p_query_embedding ASC
  LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_active_compilation_users()
 RETURNS TABLE(user_id text, note_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT author_id, count(*) FROM clerk_notes WHERE created_at >= now() - interval '90 days' GROUP BY author_id HAVING count(*) >= 10 ORDER BY count(*) DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.get_chunks_needing_embeddings(p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, user_id text, content text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT c.id, c.user_id, c.content
  FROM olive_memory_chunks c
  WHERE c.is_active = true
    AND c.embedding IS NULL
    AND c.content IS NOT NULL
    AND length(c.content) > 5
  ORDER BY c.importance DESC, c.created_at DESC
  LIMIT p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.get_clerk_user_id()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    auth.jwt() ->> 'sub',
    current_setting('request.jwt.claims', true)::json ->> 'sub',
    current_setting('request.jwt.claim.sub', true)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.get_couple_compiled_files(p_couple_id uuid, p_file_types text[] DEFAULT ARRAY['profile'::text, 'patterns'::text, 'relationship'::text, 'household'::text])
 RETURNS TABLE(id uuid, user_id text, file_type text, content text, content_hash text, token_count integer, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT f.id, f.user_id, f.file_type, f.content, f.content_hash, f.token_count, f.updated_at
  FROM olive_memory_files f JOIN clerk_couple_members m ON m.user_id = f.user_id
  WHERE m.couple_id = p_couple_id AND f.file_type = ANY(p_file_types) AND f.file_date IS NULL
  ORDER BY f.user_id, f.file_type;
$function$
;

CREATE OR REPLACE FUNCTION public.get_decay_candidates(p_user_id text, p_stale_days integer DEFAULT 90, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, content text, importance integer, decay_factor double precision, last_accessed_at timestamp with time zone, created_at timestamp with time zone, days_stale integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT c.id, c.content, c.importance, c.decay_factor, c.last_accessed_at, c.created_at,
    EXTRACT(DAY FROM now() - COALESCE(c.last_accessed_at, c.created_at))::INT
  FROM olive_memory_chunks c
  WHERE c.user_id = p_user_id AND c.is_active = true AND c.importance <= 3
    AND COALESCE(c.last_accessed_at, c.created_at) < now() - (p_stale_days || ' days')::interval
  ORDER BY COALESCE(c.last_accessed_at, c.created_at) ASC LIMIT p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.get_memory_health(p_user_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'total_chunks', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id),
    'active_chunks', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true),
    'inactive_chunks', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = false),
    'avg_importance', (SELECT ROUND(AVG(importance)::numeric, 2) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true),
    'avg_decay', (SELECT ROUND(AVG(decay_factor)::numeric, 3) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true),
    'chunks_with_embeddings', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true AND embedding IS NOT NULL),
    'chunks_without_embeddings', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true AND embedding IS NULL),
    'unresolved_contradictions', (SELECT count(*) FROM olive_memory_contradictions WHERE user_id = p_user_id AND resolution = 'unresolved'),
    'total_memories', (SELECT count(*) FROM user_memories WHERE user_id = p_user_id AND is_active = true),
    'total_entities', (SELECT count(*) FROM olive_entities WHERE user_id = p_user_id),
    'total_relationships', (SELECT count(*) FROM olive_relationships WHERE user_id = p_user_id),
    'memory_files', (SELECT count(*) FROM olive_memory_files WHERE user_id = p_user_id),
    'last_maintenance', (SELECT jsonb_build_object('run_type', run_type, 'completed_at', completed_at, 'stats', stats) FROM olive_memory_maintenance_log WHERE user_id = p_user_id AND status = 'completed' ORDER BY completed_at DESC LIMIT 1),
    'last_compilation', (SELECT updated_at FROM olive_memory_files WHERE user_id = p_user_id AND file_type = 'profile' AND file_date IS NULL ORDER BY updated_at DESC LIMIT 1)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.get_notes_needing_embeddings(p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, user_id text, content text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT n.id, n.author_id AS user_id,
         COALESCE(n.original_text, n.summary, '') AS content
  FROM clerk_notes n
  WHERE n.embedding IS NULL
    AND n.original_text IS NOT NULL
    AND length(COALESCE(n.original_text, n.summary, '')) > 5
  ORDER BY n.created_at DESC
  LIMIT p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.get_partner_task_patterns(p_couple_id uuid, p_days integer DEFAULT 90)
 RETURNS TABLE(user_id text, display_name text, category text, total_tasks bigint, completed_tasks bigint, completion_rate numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT n.author_id, p.display_name, COALESCE(n.category, 'general'), COUNT(*),
    COUNT(*) FILTER (WHERE n.completed = true),
    ROUND(COUNT(*) FILTER (WHERE n.completed = true)::numeric / NULLIF(COUNT(*), 0), 2)
  FROM clerk_notes n JOIN clerk_couple_members m ON m.user_id = n.author_id
  JOIN clerk_profiles p ON p.id = n.author_id
  WHERE m.couple_id = p_couple_id AND n.created_at >= now() - (p_days || ' days')::interval
  GROUP BY n.author_id, p.display_name, COALESCE(n.category, 'general')
  HAVING COUNT(*) >= 2 ORDER BY n.author_id, COUNT(*) DESC;
$function$
;

CREATE OR REPLACE FUNCTION public.get_space_members(p_couple_id uuid)
 RETURNS TABLE(member_id uuid, user_id text, display_name text, role member_role, profile_display_name text, joined_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    m.id AS member_id,
    m.user_id,
    COALESCE(m.display_name, p.display_name, 'Member') AS display_name,
    m.role,
    p.display_name AS profile_display_name,
    m.created_at AS joined_at
  FROM public.clerk_couple_members m
  LEFT JOIN public.clerk_profiles p ON p.id = m.user_id
  WHERE m.couple_id = p_couple_id
  ORDER BY
    CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END,
    m.created_at ASC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_spaces()
 RETURNS TABLE(id uuid, name text, type space_type, icon text, max_members integer, settings jsonb, couple_id uuid, created_by text, created_at timestamp with time zone, updated_at timestamp with time zone, user_role space_role, member_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_user_id text := auth.jwt() ->> 'sub';
BEGIN
  RETURN QUERY
  SELECT s.id, s.name, s.type, s.icon, s.max_members, s.settings,
    s.couple_id, s.created_by, s.created_at, s.updated_at,
    sm.role AS user_role,
    (SELECT count(*) FROM olive_space_members WHERE space_id = s.id) AS member_count
  FROM olive_spaces s
  INNER JOIN olive_space_members sm ON sm.space_id = s.id AND sm.user_id = v_user_id
  ORDER BY s.updated_at DESC;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_extract_query_trgm$function$
;

CREATE OR REPLACE FUNCTION public.gin_extract_value_trgm(text, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_extract_value_trgm$function$
;

CREATE OR REPLACE FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_trgm_consistent$function$
;

CREATE OR REPLACE FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal)
 RETURNS "char"
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gin_trgm_triconsistent$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_compress(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_compress$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_consistent(internal, text, smallint, oid, internal)
 RETURNS boolean
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_consistent$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_decompress(internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_decompress$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_distance(internal, text, smallint, oid, internal)
 RETURNS double precision
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_distance$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_in(cstring)
 RETURNS gtrgm
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_in$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_options(internal)
 RETURNS void
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE
AS '$libdir/pg_trgm', $function$gtrgm_options$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_out(gtrgm)
 RETURNS cstring
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_out$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_penalty(internal, internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_penalty$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_picksplit(internal, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_picksplit$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_same(gtrgm, gtrgm, internal)
 RETURNS internal
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_same$function$
;

CREATE OR REPLACE FUNCTION public.gtrgm_union(internal, internal)
 RETURNS gtrgm
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$gtrgm_union$function$
;

CREATE OR REPLACE FUNCTION public.has_role(p_user_id text, p_role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id AND role = p_role
  );
$function$
;

CREATE OR REPLACE FUNCTION public.hybrid_search_notes(p_user_id text, p_couple_id text, p_query text, p_query_embedding vector, p_vector_weight double precision DEFAULT 0.7, p_limit integer DEFAULT 15)
 RETURNS TABLE(id uuid, original_text text, summary text, category text, due_date date, priority text, completed boolean, score double precision)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  WITH vector_results AS (
    SELECT
      n.id,
      1 - (n.embedding <=> p_query_embedding) AS vector_score
    FROM clerk_notes n
    WHERE (n.author_id = p_user_id OR n.couple_id = p_couple_id)
      AND n.embedding IS NOT NULL
    ORDER BY n.embedding <=> p_query_embedding
    LIMIT p_limit * 2
  ),
  text_results AS (
    SELECT
      n.id,
      ts_rank_cd(n.search_vector, websearch_to_tsquery('english', p_query)) AS text_score
    FROM clerk_notes n
    WHERE (n.author_id = p_user_id OR n.couple_id = p_couple_id)
      AND n.search_vector IS NOT NULL
      AND n.search_vector @@ websearch_to_tsquery('english', p_query)
    ORDER BY text_score DESC
    LIMIT p_limit * 2
  ),
  combined AS (
    SELECT
      COALESCE(v.id, t.id) AS note_id,
      COALESCE(v.vector_score, 0) * p_vector_weight
        + COALESCE(t.text_score, 0) * (1 - p_vector_weight) AS combined_score
    FROM vector_results v
    FULL OUTER JOIN text_results t ON v.id = t.id
  )
  SELECT
    n.id,
    n.original_text,
    n.summary,
    n.category,
    n.due_date,
    n.priority,
    n.completed,
    c.combined_score AS score
  FROM combined c
  JOIN clerk_notes n ON n.id = c.note_id
  ORDER BY c.combined_score DESC
  LIMIT p_limit;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_usage(p_user_id text, p_meter text, p_amount integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO olive_usage_meters (user_id, meter_date) VALUES (p_user_id, CURRENT_DATE) ON CONFLICT (user_id, meter_date) DO NOTHING;
  EXECUTE format('UPDATE olive_usage_meters SET %I = %I + $1, updated_at = now() WHERE user_id = $2 AND meter_date = CURRENT_DATE', p_meter, p_meter) USING p_amount, p_user_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_couple_member(couple_uuid uuid, p_user_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clerk_couple_members m
    WHERE m.couple_id = couple_uuid AND m.user_id = p_user_id
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_couple_member_safe(couple_uuid uuid, p_user_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clerk_couple_members cm
    WHERE cm.couple_id = couple_uuid AND cm.user_id = p_user_id
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_couple_owner(couple_uuid uuid, user_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
begin
  return exists (
    select 1 from public.clerk_couple_members m
    where m.couple_id = couple_uuid and m.user_id = user_id and m.role::text = 'owner'
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_couple_owner_safe(p_couple_id uuid, p_user_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.clerk_couple_members
    WHERE couple_id = p_couple_id
      AND user_id = p_user_id
      AND role = 'owner'::member_role
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_member_of_couple(p_couple_id uuid, p_user_id text DEFAULT (auth.jwt() ->> 'sub'::text))
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.clerk_couple_members m
    WHERE m.couple_id = p_couple_id
      AND m.user_id = p_user_id
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_space_member(p_space_id uuid, p_user_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM olive_space_members
    WHERE space_id = p_space_id AND user_id = p_user_id
  );
$function$
;

CREATE OR REPLACE FUNCTION public.jwt()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$function$
;

CREATE OR REPLACE FUNCTION public.jwt_sub()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.jwt()->>'sub'
$function$
;

CREATE OR REPLACE FUNCTION public.log_client_stage_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    NEW.stage_changed_at = now();
    INSERT INTO olive_client_activity (client_id, user_id, activity_type, from_value, to_value, description)
    VALUES (NEW.id, NEW.user_id, 'stage_change', OLD.stage, NEW.stage, 'Stage changed from ' || OLD.stage || ' to ' || NEW.stage);
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_member_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (NEW.space_id, NEW.user_id, 'member_joined', 'member', NEW.user_id, jsonb_build_object('role', NEW.role::text));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (OLD.space_id, OLD.user_id, 'member_left', 'member', OLD.user_id, jsonb_build_object('role', OLD.role::text));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_note_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_space_id UUID;
BEGIN
  v_space_id := COALESCE(NEW.space_id, NEW.couple_id);
  IF v_space_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_space_id, NEW.author_id, 'note_created', 'note', NEW.id::text, jsonb_build_object('category', NEW.category, 'preview', left(NEW.summary, 120)));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.completed = true AND (OLD.completed IS NULL OR OLD.completed = false) THEN
      INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_space_id, NEW.author_id, 'note_completed', 'note', NEW.id::text, jsonb_build_object('category', NEW.category, 'preview', left(NEW.summary, 120)));
    END IF;
    IF NEW.task_owner IS DISTINCT FROM OLD.task_owner AND NEW.task_owner IS NOT NULL THEN
      INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_space_id, NEW.author_id, 'note_assigned', 'note', NEW.id::text, jsonb_build_object('assigned_to', NEW.task_owner, 'preview', left(NEW.summary, 120)));
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_reaction_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_space_id UUID;
BEGIN
  SELECT space_id INTO v_space_id FROM clerk_notes WHERE id = NEW.note_id;
  IF v_space_id IS NOT NULL THEN
    INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_space_id, NEW.user_id, 'reaction_added', 'reaction', NEW.id::text, jsonb_build_object('note_id', NEW.note_id, 'emoji', NEW.emoji));
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.log_thread_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.space_id IS NOT NULL THEN
    INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (NEW.space_id, NEW.author_id, 'thread_created', 'thread', NEW.id::text, jsonb_build_object('note_id', NEW.note_id, 'preview', left(NEW.body, 100)));
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.merge_notes(p_source_id uuid, p_target_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source_note record;
  v_target_note record;
  v_updated_items text[];
  v_combined_summary text;
BEGIN
  -- Fetch both notes
  SELECT * INTO v_source_note FROM public.clerk_notes WHERE id = p_source_id;
  SELECT * INTO v_target_note FROM public.clerk_notes WHERE id = p_target_id;
  
  IF v_source_note.id IS NULL THEN
    RAISE EXCEPTION 'Source note not found: %', p_source_id;
  END IF;
  
  IF v_target_note.id IS NULL THEN
    RAISE EXCEPTION 'Target note not found: %', p_target_id;
  END IF;
  
  -- Combine items: add source summary as a new item with "Update:" prefix
  v_updated_items := COALESCE(v_target_note.items, ARRAY[]::text[]);
  v_updated_items := array_append(v_updated_items, 'Update: ' || v_source_note.summary);
  
  -- If source has items, add them too
  IF v_source_note.items IS NOT NULL AND array_length(v_source_note.items, 1) > 0 THEN
    v_updated_items := v_updated_items || v_source_note.items;
  END IF;
  
  -- Merge media URLs if any
  IF v_source_note.media_urls IS NOT NULL AND array_length(v_source_note.media_urls, 1) > 0 THEN
    UPDATE public.clerk_notes
    SET media_urls = COALESCE(media_urls, ARRAY[]::text[]) || v_source_note.media_urls
    WHERE id = p_target_id;
  END IF;
  
  -- Update target note with combined items
  UPDATE public.clerk_notes
  SET 
    items = v_updated_items,
    updated_at = now()
  WHERE id = p_target_id;
  
  -- Archive (soft delete) the source note by marking as completed and adding archive tag
  -- We use completed = true and add a tag to indicate it was merged
  UPDATE public.clerk_notes
  SET 
    completed = true,
    tags = COALESCE(tags, ARRAY[]::text[]) || ARRAY['_merged_into_' || p_target_id::text],
    updated_at = now()
  WHERE id = p_source_id;
  
  -- Return the updated target note
  RETURN (
    SELECT jsonb_build_object(
      'id', id,
      'summary', summary,
      'items', items,
      'category', category,
      'priority', priority,
      'due_date', due_date,
      'completed', completed
    )
    FROM public.clerk_notes
    WHERE id = p_target_id
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.normalize_category(raw_category text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE cleaned text;
BEGIN
  IF raw_category IS NULL THEN RETURN NULL; END IF;
  cleaned := lower(trim(raw_category));
  cleaned := regexp_replace(cleaned, '\s+', '_', 'g');
  CASE cleaned
    WHEN 'grocery' THEN RETURN 'groceries';
    WHEN 'tasks' THEN RETURN 'task';
    WHEN 'date_idea' THEN RETURN 'date_ideas';
    WHEN 'travel_idea' THEN RETURN 'travel';
    WHEN 'pets' THEN RETURN 'pet_care';
    WHEN 'pet_adoption' THEN RETURN 'pet_care';
    WHEN 'recipe' THEN RETURN 'recipes';
    WHEN 'meal_planning' THEN RETURN 'recipes';
    WHEN 'movies_tv' THEN RETURN 'entertainment';
    WHEN 'sports' THEN RETURN 'entertainment';
    WHEN 'homeimprovement' THEN RETURN 'home_improvement';
    WHEN 'home_maintenance' THEN RETURN 'home_improvement';
    WHEN 'dateideas' THEN RETURN 'date_ideas';
    WHEN 'stocks' THEN RETURN 'finance';
    WHEN 'app_features' THEN RETURN 'app_feedback';
    WHEN 'app_development' THEN RETURN 'app_feedback';
    WHEN 'olive_improvements' THEN RETURN 'app_feedback';
    WHEN 'olive_feature_requests' THEN RETURN 'app_feedback';
    WHEN 'olive_feature_request' THEN RETURN 'app_feedback';
    WHEN 'business_ideas' THEN RETURN 'business';
    WHEN 'errand' THEN RETURN 'errands';
    WHEN 'dry_cleaning' THEN RETURN 'errands';
    WHEN 'laundry' THEN RETURN 'errands';
    ELSE RETURN cleaned;
  END CASE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_entities(p_user_id text, p_query_embedding vector, p_match_threshold double precision DEFAULT 0.7, p_match_count integer DEFAULT 10)
 RETURNS TABLE(id uuid, name text, canonical_name text, entity_type text, metadata jsonb, mention_count integer, similarity double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.name,
    e.canonical_name,
    e.entity_type,
    e.metadata,
    e.mention_count,
    (1 - (e.embedding <=> p_query_embedding))::double precision AS similarity
  FROM public.olive_entities e
  WHERE e.user_id = p_user_id
    AND e.embedding IS NOT NULL
    AND (1 - (e.embedding <=> p_query_embedding)) > p_match_threshold
  ORDER BY e.embedding <=> p_query_embedding ASC
  LIMIT p_match_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.search_memory_chunks(p_user_id text, p_query_embedding vector, p_limit integer DEFAULT 8, p_min_importance integer DEFAULT 2)
 RETURNS TABLE(id uuid, content text, chunk_type text, importance integer, similarity double precision, source text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT
    c.id,
    c.content,
    c.chunk_type,
    c.importance,
    1 - (c.embedding <=> p_query_embedding) AS similarity,
    c.source,
    c.created_at
  FROM olive_memory_chunks c
  WHERE c.user_id = p_user_id
    AND c.is_active = true
    AND c.importance >= p_min_importance
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_limit;
$function$
;

CREATE OR REPLACE FUNCTION public.search_user_memories(p_user_id text, p_query_embedding vector, p_match_threshold double precision DEFAULT 0.5, p_match_count integer DEFAULT 10)
 RETURNS TABLE(id uuid, title text, content text, category text, importance integer, similarity double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.title,
    m.content,
    m.category,
    m.importance,
    (1 - (m.embedding <=> p_query_embedding))::FLOAT AS similarity
  FROM public.user_memories m
  WHERE m.user_id = p_user_id 
    AND m.is_active = true
    AND m.embedding IS NOT NULL
    AND (1 - (m.embedding <=> p_query_embedding)) > p_match_threshold
  ORDER BY m.embedding <=> p_query_embedding ASC
  LIMIT p_match_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.send_invite_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  invite_url text;
BEGIN
  -- Only process new invites with pending status
  IF NEW.status = 'pending' AND OLD.status IS DISTINCT FROM 'pending' THEN
    -- Construct invite URL
    invite_url := 'https://lovable.dev/projects/olive-couple-shared-brain/accept-invite?token=' || NEW.token;
    
    -- Here we would normally call an edge function to send the email
    -- For now, we'll just log the invite URL
    RAISE NOTICE 'Invite URL for %: %', NEW.invited_email, invite_url;
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_created_by_from_jwt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.created_by is null or new.created_by = '' then
    new.created_by := auth.jwt()->>'sub';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_limit(real)
 RETURNS real
 LANGUAGE c
 STRICT
AS '$libdir/pg_trgm', $function$set_limit$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin new.updated_at = now(); return new; end $function$
;

CREATE OR REPLACE FUNCTION public.show_limit()
 RETURNS real
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$show_limit$function$
;

CREATE OR REPLACE FUNCTION public.show_trgm(text)
 RETURNS text[]
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$show_trgm$function$
;

CREATE OR REPLACE FUNCTION public.similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity$function$
;

CREATE OR REPLACE FUNCTION public.similarity_dist(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity_dist$function$
;

CREATE OR REPLACE FUNCTION public.similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$similarity_op$function$
;

CREATE OR REPLACE FUNCTION public.strict_word_similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity$function$
;

CREATE OR REPLACE FUNCTION public.strict_word_similarity_commutator_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_commutator_op$function$
;

CREATE OR REPLACE FUNCTION public.strict_word_similarity_dist_commutator_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_dist_commutator_op$function$
;

CREATE OR REPLACE FUNCTION public.strict_word_similarity_dist_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_dist_op$function$
;

CREATE OR REPLACE FUNCTION public.strict_word_similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$strict_word_similarity_op$function$
;

CREATE OR REPLACE FUNCTION public.sync_couple_member_to_space()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_couple RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Defensive: ensure the space exists before inserting the member.
    -- This makes the function independent of trigger firing order on
    -- clerk_couples. If trg_sync_couple_to_space hasn't run yet (or ever),
    -- we create the space row here. Idempotent via ON CONFLICT.
    IF NOT EXISTS (SELECT 1 FROM olive_spaces WHERE id = NEW.couple_id) THEN
      SELECT id, title, you_name, partner_name, created_by, created_at, updated_at
        INTO v_couple
        FROM clerk_couples
       WHERE id = NEW.couple_id;

      IF FOUND THEN
        INSERT INTO olive_spaces (id, name, type, couple_id, created_by, created_at, updated_at)
        VALUES (
          v_couple.id,
          COALESCE(v_couple.title, COALESCE(v_couple.you_name, '') || ' & ' || COALESCE(v_couple.partner_name, '')),
          'couple'::space_type,
          v_couple.id,
          v_couple.created_by,
          v_couple.created_at,
          v_couple.updated_at
        )
        ON CONFLICT (id) DO NOTHING;
      END IF;
    END IF;

    -- Now the space is guaranteed to exist (if the couple exists), so the
    -- member insert's FK check will succeed.
    INSERT INTO olive_space_members (space_id, user_id, role, joined_at)
    VALUES (
      NEW.couple_id,
      NEW.user_id,
      CASE NEW.role::text WHEN 'owner' THEN 'owner'::space_role ELSE 'member'::space_role END,
      NEW.created_at
    )
    ON CONFLICT (space_id, user_id) DO UPDATE SET
      role = EXCLUDED.role;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM olive_space_members
    WHERE space_id = OLD.couple_id AND user_id = OLD.user_id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_couple_to_space()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO olive_spaces (id, name, type, couple_id, created_by, created_at, updated_at)
    VALUES (
      NEW.id,
      COALESCE(NEW.title, COALESCE(NEW.you_name, '') || ' & ' || COALESCE(NEW.partner_name, '')),
      'couple'::space_type,
      NEW.id,
      NEW.created_by,
      NEW.created_at,
      NEW.updated_at
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      updated_at = EXCLUDED.updated_at;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE olive_spaces SET
      name = COALESCE(NEW.title, COALESCE(NEW.you_name, '') || ' & ' || COALESCE(NEW.partner_name, '')),
      updated_at = NEW.updated_at
    WHERE couple_id = NEW.id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE olive_spaces SET couple_id = NULL WHERE couple_id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_expense_couple_to_space()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.space_id IS DISTINCT FROM OLD.space_id THEN
    IF NEW.space_id IS NULL THEN
      NEW.couple_id := NULL;
    ELSIF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    ELSE
      NEW.couple_id := NULL;
    END IF;
  ELSIF NEW.couple_id IS DISTINCT FROM OLD.couple_id THEN
    NEW.space_id := NEW.couple_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_expense_couple_to_space_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.couple_id IS NOT NULL AND NEW.space_id IS NULL THEN
    NEW.space_id := NEW.couple_id;
  ELSIF NEW.space_id IS NOT NULL AND NEW.couple_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_list_couple_to_space()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.space_id IS DISTINCT FROM OLD.space_id THEN
    IF NEW.space_id IS NULL THEN
      NEW.couple_id := NULL;
    ELSIF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    ELSE
      NEW.couple_id := NULL;
    END IF;
  ELSIF NEW.couple_id IS DISTINCT FROM OLD.couple_id THEN
    NEW.space_id := NEW.couple_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_list_couple_to_space_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.couple_id IS NOT NULL AND NEW.space_id IS NULL THEN
    NEW.space_id := NEW.couple_id;
  ELSIF NEW.space_id IS NOT NULL AND NEW.couple_id IS NULL THEN
    -- Only mirror back if the space has a matching couple (legacy couple-type space).
    -- For non-couple spaces (family/business/custom), leave couple_id NULL.
    IF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_note_couple_to_space()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.space_id IS DISTINCT FROM OLD.space_id THEN
    IF NEW.space_id IS NULL THEN
      NEW.couple_id := NULL;
    ELSIF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    ELSE
      NEW.couple_id := NULL;
    END IF;
  ELSIF NEW.couple_id IS DISTINCT FROM OLD.couple_id THEN
    NEW.space_id := NEW.couple_id;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_note_couple_to_space_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Direction 1 (always safe): couple → space
  IF NEW.couple_id IS NOT NULL AND NEW.space_id IS NULL THEN
    NEW.space_id := NEW.couple_id;
  -- Direction 2 (guarded): space → couple, only for couple-type spaces
  ELSIF NEW.space_id IS NOT NULL AND NEW.couple_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_settlement_couple_to_space_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.couple_id IS NOT NULL AND NEW.space_id IS NULL THEN
    NEW.space_id := NEW.couple_id;
  ELSIF NEW.space_id IS NOT NULL AND NEW.couple_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_delegation_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_log_delegation_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (NEW.space_id, NEW.delegated_by, 'delegated', 'delegation', NEW.id::text, jsonb_build_object('title', NEW.title, 'delegated_to', NEW.delegated_to, 'priority', NEW.priority));
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO space_activity (space_id, actor_id, action, entity_type, entity_id, metadata)
    VALUES (NEW.space_id, NEW.delegated_to,
      CASE NEW.status WHEN 'accepted' THEN 'accepted_delegation' WHEN 'declined' THEN 'declined_delegation' WHEN 'reassigned' THEN 'reassigned_delegation' WHEN 'completed' THEN 'completed_delegation' WHEN 'snoozed' THEN 'snoozed_delegation' ELSE 'updated_delegation' END,
      'delegation', NEW.id::text, jsonb_build_object('title', NEW.title, 'old_status', OLD.status, 'new_status', NEW.status));
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_normalize_category()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.category IS NOT NULL THEN NEW.category := normalize_category(NEW.category); END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_b2b_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$
;

CREATE OR REPLACE FUNCTION public.validate_invite(p_token text)
 RETURNS TABLE(couple_id uuid, role text, title text, you_name text, partner_name text, expires_at timestamp with time zone, revoked boolean, accepted boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    i.couple_id,
    i.role::text,
    c.title,
    c.you_name,
    c.partner_name,
    i.expires_at,
    COALESCE(i.revoked, false) as revoked,
    (i.accepted_at IS NOT NULL) as accepted
  FROM public.clerk_invites i
  JOIN public.clerk_couples c ON c.id = i.couple_id
  WHERE i.token = p_token;
END $function$
;

CREATE OR REPLACE FUNCTION public.validate_invite_expiry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.expires_at is not null and new.expires_at <= now() then
    raise exception 'expires_at must be in the future';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.word_similarity(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity$function$
;

CREATE OR REPLACE FUNCTION public.word_similarity_commutator_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_commutator_op$function$
;

CREATE OR REPLACE FUNCTION public.word_similarity_dist_commutator_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_dist_commutator_op$function$
;

CREATE OR REPLACE FUNCTION public.word_similarity_dist_op(text, text)
 RETURNS real
 LANGUAGE c
 IMMUTABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_dist_op$function$
;

CREATE OR REPLACE FUNCTION public.word_similarity_op(text, text)
 RETURNS boolean
 LANGUAGE c
 STABLE PARALLEL SAFE STRICT
AS '$libdir/pg_trgm', $function$word_similarity_op$function$
;

-- ===== 05 CONSTRAINTS (PK, FK, CHECK, UNIQUE) =====
ALTER TABLE ONLY public.beta_feedback ADD CONSTRAINT beta_feedback_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.calendar_connections ADD CONSTRAINT calendar_connections_calendar_type_check CHECK ((calendar_type = ANY (ARRAY['individual'::text, 'couple'::text])));
ALTER TABLE ONLY public.calendar_connections ADD CONSTRAINT calendar_connections_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES clerk_couples(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.calendar_connections ADD CONSTRAINT calendar_connections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.calendar_connections ADD CONSTRAINT calendar_connections_sync_direction_check CHECK ((sync_direction = ANY (ARRAY['read'::text, 'write'::text, 'both'::text])));
ALTER TABLE ONLY public.calendar_connections ADD CONSTRAINT calendar_connections_user_id_key UNIQUE (user_id);
ALTER TABLE ONLY public.calendar_events ADD CONSTRAINT calendar_events_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES calendar_connections(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.calendar_events ADD CONSTRAINT calendar_events_event_type_check CHECK ((event_type = ANY (ARRAY['from_note'::text, 'from_calendar'::text, 'manual'::text])));
ALTER TABLE ONLY public.calendar_events ADD CONSTRAINT calendar_events_google_event_id_key UNIQUE (google_event_id);
ALTER TABLE ONLY public.calendar_events ADD CONSTRAINT calendar_events_note_id_fkey FOREIGN KEY (note_id) REFERENCES clerk_notes(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.calendar_events ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.calendar_sync_state ADD CONSTRAINT calendar_sync_state_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES calendar_connections(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.calendar_sync_state ADD CONSTRAINT calendar_sync_state_connection_id_key UNIQUE (connection_id);
ALTER TABLE ONLY public.calendar_sync_state ADD CONSTRAINT calendar_sync_state_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.calendar_sync_state ADD CONSTRAINT calendar_sync_state_sync_status_check CHECK ((sync_status = ANY (ARRAY['idle'::text, 'syncing'::text, 'error'::text])));
ALTER TABLE ONLY public.clerk_couple_members ADD CONSTRAINT clerk_couple_members_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES clerk_couples(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.clerk_couple_members ADD CONSTRAINT clerk_couple_members_couple_user_unique UNIQUE (couple_id, user_id);
ALTER TABLE ONLY public.clerk_couple_members ADD CONSTRAINT clerk_couple_members_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.clerk_couples ADD CONSTRAINT clerk_couples_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.clerk_invites ADD CONSTRAINT clerk_invites_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES clerk_couples(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.clerk_invites ADD CONSTRAINT clerk_invites_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.clerk_invites ADD CONSTRAINT clerk_invites_token_key UNIQUE (token);
ALTER TABLE ONLY public.clerk_lists ADD CONSTRAINT clerk_lists_name_couple_id_author_id_key UNIQUE (name, couple_id, author_id);
ALTER TABLE ONLY public.clerk_lists ADD CONSTRAINT clerk_lists_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.clerk_lists ADD CONSTRAINT clerk_lists_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.clerk_notes ADD CONSTRAINT clerk_notes_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES clerk_couples(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.clerk_notes ADD CONSTRAINT clerk_notes_list_id_fkey FOREIGN KEY (list_id) REFERENCES clerk_lists(id);
ALTER TABLE ONLY public.clerk_notes ADD CONSTRAINT clerk_notes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.clerk_notes ADD CONSTRAINT clerk_notes_recurrence_frequency_check CHECK ((recurrence_frequency = ANY (ARRAY['none'::text, 'daily'::text, 'weekly'::text, 'monthly'::text, 'yearly'::text])));
ALTER TABLE ONLY public.clerk_notes ADD CONSTRAINT clerk_notes_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.clerk_profiles ADD CONSTRAINT clerk_profiles_language_preference_check CHECK ((language_preference = ANY (ARRAY['en'::text, 'es-ES'::text, 'it-IT'::text])));
ALTER TABLE ONLY public.clerk_profiles ADD CONSTRAINT clerk_profiles_note_style_check CHECK ((note_style = ANY (ARRAY['auto'::text, 'succinct'::text, 'conversational'::text])));
ALTER TABLE ONLY public.clerk_profiles ADD CONSTRAINT clerk_profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.couple_members ADD CONSTRAINT couple_members_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.couple_members ADD CONSTRAINT couple_members_couple_id_user_id_key UNIQUE (couple_id, user_id);
ALTER TABLE ONLY public.couple_members ADD CONSTRAINT couple_members_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.couple_members ADD CONSTRAINT couple_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.couples ADD CONSTRAINT couples_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.couples ADD CONSTRAINT couples_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.decryption_audit_log ADD CONSTRAINT decryption_audit_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.expense_budget_limits ADD CONSTRAINT expense_budget_limits_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES clerk_couples(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.expense_budget_limits ADD CONSTRAINT expense_budget_limits_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.expense_budget_limits ADD CONSTRAINT expense_budget_limits_user_id_category_key UNIQUE (user_id, category);
ALTER TABLE ONLY public.expense_settlements ADD CONSTRAINT expense_settlements_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES clerk_couples(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.expense_settlements ADD CONSTRAINT expense_settlements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.expense_settlements ADD CONSTRAINT expense_settlements_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.expenses ADD CONSTRAINT expenses_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES clerk_couples(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.expenses ADD CONSTRAINT expenses_note_id_fkey FOREIGN KEY (note_id) REFERENCES clerk_notes(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.expenses ADD CONSTRAINT expenses_parent_recurring_id_fkey FOREIGN KEY (parent_recurring_id) REFERENCES expenses(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.expenses ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.expenses ADD CONSTRAINT expenses_recurrence_frequency_check CHECK ((recurrence_frequency = ANY (ARRAY['weekly'::text, 'monthly'::text, 'yearly'::text])));
ALTER TABLE ONLY public.expenses ADD CONSTRAINT expenses_settlement_id_fkey FOREIGN KEY (settlement_id) REFERENCES expense_settlements(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.expenses ADD CONSTRAINT expenses_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.invites ADD CONSTRAINT invites_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES clerk_couples(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.invites ADD CONSTRAINT invites_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.invites ADD CONSTRAINT invites_token_key UNIQUE (token);
ALTER TABLE ONLY public.linking_tokens ADD CONSTRAINT linking_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.linking_tokens ADD CONSTRAINT linking_tokens_token_key UNIQUE (token);
ALTER TABLE ONLY public.memory_insights ADD CONSTRAINT memory_insights_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.memory_insights ADD CONSTRAINT memory_insights_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE ONLY public.note_mentions ADD CONSTRAINT mention_target CHECK (((note_id IS NOT NULL) OR (thread_id IS NOT NULL)));
ALTER TABLE ONLY public.note_mentions ADD CONSTRAINT note_mentions_note_id_fkey FOREIGN KEY (note_id) REFERENCES clerk_notes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.note_mentions ADD CONSTRAINT note_mentions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.note_mentions ADD CONSTRAINT note_mentions_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.note_mentions ADD CONSTRAINT note_mentions_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES note_threads(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.note_reactions ADD CONSTRAINT note_reactions_note_id_fkey FOREIGN KEY (note_id) REFERENCES clerk_notes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.note_reactions ADD CONSTRAINT note_reactions_note_id_user_id_emoji_key UNIQUE (note_id, user_id, emoji);
ALTER TABLE ONLY public.note_reactions ADD CONSTRAINT note_reactions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.note_threads ADD CONSTRAINT note_threads_note_id_fkey FOREIGN KEY (note_id) REFERENCES clerk_notes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.note_threads ADD CONSTRAINT note_threads_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES note_threads(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.note_threads ADD CONSTRAINT note_threads_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.note_threads ADD CONSTRAINT note_threads_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.notes ADD CONSTRAINT notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.notes ADD CONSTRAINT notes_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES couples(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.notes ADD CONSTRAINT notes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_agent_executions ADD CONSTRAINT olive_agent_executions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_agent_executions ADD CONSTRAINT olive_agent_executions_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.olive_agent_executions ADD CONSTRAINT olive_agent_executions_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'paused'::text, 'awaiting_approval'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.olive_agent_executions ADD CONSTRAINT olive_agent_executions_trust_action_id_fkey FOREIGN KEY (trust_action_id) REFERENCES olive_trust_actions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.olive_agent_runs ADD CONSTRAINT olive_agent_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_agent_runs ADD CONSTRAINT olive_agent_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'awaiting_approval'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.olive_briefings ADD CONSTRAINT olive_briefings_briefing_type_check CHECK ((briefing_type = ANY (ARRAY['daily'::text, 'weekly'::text, 'on_demand'::text, 'delegation_summary'::text])));
ALTER TABLE ONLY public.olive_briefings ADD CONSTRAINT olive_briefings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_briefings ADD CONSTRAINT olive_briefings_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.olive_chat_sessions ADD CONSTRAINT olive_chat_sessions_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES clerk_couples(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.olive_chat_sessions ADD CONSTRAINT olive_chat_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_client_activity ADD CONSTRAINT olive_client_activity_client_id_fkey FOREIGN KEY (client_id) REFERENCES olive_clients(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_client_activity ADD CONSTRAINT olive_client_activity_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_clients ADD CONSTRAINT olive_clients_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_clients ADD CONSTRAINT olive_clients_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_conflicts ADD CONSTRAINT olive_conflicts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_conflicts ADD CONSTRAINT olive_conflicts_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_consolidation_runs ADD CONSTRAINT olive_consolidation_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_consolidation_runs ADD CONSTRAINT olive_consolidation_runs_run_type_check CHECK ((run_type = ANY (ARRAY['nightly'::text, 'manual'::text, 'weekly_deep'::text])));
ALTER TABLE ONLY public.olive_consolidation_runs ADD CONSTRAINT olive_consolidation_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text, 'partial'::text])));
ALTER TABLE ONLY public.olive_conversations ADD CONSTRAINT olive_conversations_note_id_fkey FOREIGN KEY (note_id) REFERENCES clerk_notes(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_conversations ADD CONSTRAINT olive_conversations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_conversations ADD CONSTRAINT olive_conversations_user_id_note_id_key UNIQUE (user_id, note_id);
ALTER TABLE ONLY public.olive_cross_space_insights ADD CONSTRAINT olive_cross_space_insights_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_decisions ADD CONSTRAINT olive_decisions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_decisions ADD CONSTRAINT olive_decisions_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_delegations ADD CONSTRAINT olive_delegations_agent_execution_id_fkey FOREIGN KEY (agent_execution_id) REFERENCES olive_agent_executions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.olive_delegations ADD CONSTRAINT olive_delegations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_delegations ADD CONSTRAINT olive_delegations_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])));
ALTER TABLE ONLY public.olive_delegations ADD CONSTRAINT olive_delegations_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_delegations ADD CONSTRAINT olive_delegations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'snoozed'::text, 'reassigned'::text, 'declined'::text, 'completed'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.olive_email_connections ADD CONSTRAINT olive_email_connections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_email_connections ADD CONSTRAINT olive_email_connections_user_id_key UNIQUE (user_id);
ALTER TABLE ONLY public.olive_engagement_events ADD CONSTRAINT olive_engagement_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_engagement_metrics ADD CONSTRAINT olive_engagement_metrics_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.olive_engagement_metrics ADD CONSTRAINT olive_engagement_metrics_score_check CHECK (((score >= 0) AND (score <= 100)));
ALTER TABLE ONLY public.olive_entities ADD CONSTRAINT olive_entities_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES clerk_couples(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.olive_entities ADD CONSTRAINT olive_entities_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_entity_communities ADD CONSTRAINT olive_entity_communities_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_expense_split_shares ADD CONSTRAINT olive_expense_split_shares_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_expense_split_shares ADD CONSTRAINT olive_expense_split_shares_split_id_fkey FOREIGN KEY (split_id) REFERENCES olive_expense_splits(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_expense_split_shares ADD CONSTRAINT olive_expense_split_shares_split_id_user_id_key UNIQUE (split_id, user_id);
ALTER TABLE ONLY public.olive_expense_splits ADD CONSTRAINT olive_expense_splits_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_expense_splits ADD CONSTRAINT olive_expense_splits_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_gateway_sessions ADD CONSTRAINT olive_gateway_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_heartbeat_jobs ADD CONSTRAINT olive_heartbeat_jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_heartbeat_jobs ADD CONSTRAINT olive_heartbeat_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.olive_heartbeat_log ADD CONSTRAINT olive_heartbeat_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_heartbeat_log ADD CONSTRAINT olive_heartbeat_log_status_check CHECK ((status = ANY (ARRAY['success'::text, 'failed'::text, 'skipped'::text, 'sent'::text])));
ALTER TABLE ONLY public.olive_industry_templates ADD CONSTRAINT olive_industry_templates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_llm_calls ADD CONSTRAINT olive_llm_calls_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_memory_chunks ADD CONSTRAINT olive_memory_chunks_chunk_type_check CHECK ((chunk_type = ANY (ARRAY['fact'::text, 'event'::text, 'decision'::text, 'pattern'::text, 'interaction'::text])));
ALTER TABLE ONLY public.olive_memory_chunks ADD CONSTRAINT olive_memory_chunks_consolidated_into_fkey FOREIGN KEY (consolidated_into) REFERENCES olive_memory_chunks(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.olive_memory_chunks ADD CONSTRAINT olive_memory_chunks_importance_check CHECK (((importance >= 1) AND (importance <= 5)));
ALTER TABLE ONLY public.olive_memory_chunks ADD CONSTRAINT olive_memory_chunks_memory_file_id_fkey FOREIGN KEY (memory_file_id) REFERENCES olive_memory_files(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_memory_chunks ADD CONSTRAINT olive_memory_chunks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_memory_contradictions ADD CONSTRAINT olive_memory_contradictions_chunk_a_id_fkey FOREIGN KEY (chunk_a_id) REFERENCES olive_memory_chunks(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.olive_memory_contradictions ADD CONSTRAINT olive_memory_contradictions_chunk_b_id_fkey FOREIGN KEY (chunk_b_id) REFERENCES olive_memory_chunks(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.olive_memory_contradictions ADD CONSTRAINT olive_memory_contradictions_contradiction_type_check CHECK ((contradiction_type = ANY (ARRAY['factual'::text, 'preference'::text, 'temporal'::text, 'behavioral'::text])));
ALTER TABLE ONLY public.olive_memory_contradictions ADD CONSTRAINT olive_memory_contradictions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_memory_contradictions ADD CONSTRAINT olive_memory_contradictions_resolution_check CHECK ((resolution = ANY (ARRAY['keep_newer'::text, 'keep_older'::text, 'merge'::text, 'ask_user'::text, 'unresolved'::text])));
ALTER TABLE ONLY public.olive_memory_files ADD CONSTRAINT olive_memory_files_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES clerk_couples(id);
ALTER TABLE ONLY public.olive_memory_files ADD CONSTRAINT olive_memory_files_file_type_check CHECK ((file_type = ANY (ARRAY['profile'::text, 'daily'::text, 'patterns'::text, 'relationship'::text, 'household'::text])));
ALTER TABLE ONLY public.olive_memory_files ADD CONSTRAINT olive_memory_files_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_memory_files ADD CONSTRAINT olive_memory_files_user_id_file_type_file_date_key UNIQUE (user_id, file_type, file_date);
ALTER TABLE ONLY public.olive_memory_maintenance_log ADD CONSTRAINT olive_memory_maintenance_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_memory_maintenance_log ADD CONSTRAINT olive_memory_maintenance_log_run_type_check CHECK ((run_type = ANY (ARRAY['consolidation'::text, 'decay'::text, 'contradiction'::text, 'entity_dedup'::text, 'full'::text])));
ALTER TABLE ONLY public.olive_memory_maintenance_log ADD CONSTRAINT olive_memory_maintenance_log_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])));
ALTER TABLE ONLY public.olive_memory_relevance ADD CONSTRAINT olive_memory_relevance_memory_id_user_id_key UNIQUE (memory_id, user_id);
ALTER TABLE ONLY public.olive_memory_relevance ADD CONSTRAINT olive_memory_relevance_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_outbound_queue ADD CONSTRAINT olive_outbound_queue_message_type_check CHECK ((message_type = ANY (ARRAY['proactive'::text, 'reminder'::text, 'notification'::text, 'reply'::text, 'proactive_nudge'::text, 'morning_briefing'::text, 'evening_review'::text, 'weekly_summary'::text, 'task_update'::text, 'partner_notification'::text, 'system_alert'::text])));
ALTER TABLE ONLY public.olive_outbound_queue ADD CONSTRAINT olive_outbound_queue_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_outbound_queue ADD CONSTRAINT olive_outbound_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text, 'rate_limited'::text])));
ALTER TABLE ONLY public.olive_patterns ADD CONSTRAINT olive_patterns_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)));
ALTER TABLE ONLY public.olive_patterns ADD CONSTRAINT olive_patterns_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES clerk_couples(id);
ALTER TABLE ONLY public.olive_patterns ADD CONSTRAINT olive_patterns_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_patterns ADD CONSTRAINT olive_patterns_user_id_pattern_type_key UNIQUE (user_id, pattern_type);
ALTER TABLE ONLY public.olive_poll_votes ADD CONSTRAINT olive_poll_votes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_poll_votes ADD CONSTRAINT olive_poll_votes_poll_id_fkey FOREIGN KEY (poll_id) REFERENCES olive_polls(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_poll_votes ADD CONSTRAINT olive_poll_votes_poll_id_user_id_key UNIQUE (poll_id, user_id);
ALTER TABLE ONLY public.olive_polls ADD CONSTRAINT olive_polls_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_polls ADD CONSTRAINT olive_polls_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_pricing_plans ADD CONSTRAINT olive_pricing_plans_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_pricing_plans ADD CONSTRAINT olive_pricing_plans_plan_id_key UNIQUE (plan_id);
ALTER TABLE ONLY public.olive_reflections ADD CONSTRAINT olive_reflections_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)));
ALTER TABLE ONLY public.olive_reflections ADD CONSTRAINT olive_reflections_outcome_check CHECK ((outcome = ANY (ARRAY['accepted'::text, 'modified'::text, 'rejected'::text, 'ignored'::text])));
ALTER TABLE ONLY public.olive_reflections ADD CONSTRAINT olive_reflections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_relationships ADD CONSTRAINT olive_relationships_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_relationships ADD CONSTRAINT olive_relationships_source_entity_id_fkey FOREIGN KEY (source_entity_id) REFERENCES olive_entities(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_relationships ADD CONSTRAINT olive_relationships_target_entity_id_fkey FOREIGN KEY (target_entity_id) REFERENCES olive_entities(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_router_log ADD CONSTRAINT olive_router_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_skills ADD CONSTRAINT olive_skills_pkey PRIMARY KEY (skill_id);
ALTER TABLE ONLY public.olive_soul_evolution_log ADD CONSTRAINT olive_soul_evolution_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_soul_layers ADD CONSTRAINT olive_soul_layers_layer_type_check CHECK ((layer_type = ANY (ARRAY['base'::text, 'user'::text, 'space'::text, 'skill'::text, 'trust'::text])));
ALTER TABLE ONLY public.olive_soul_layers ADD CONSTRAINT olive_soul_layers_owner_type_check CHECK ((owner_type = ANY (ARRAY['system'::text, 'user'::text, 'space'::text])));
ALTER TABLE ONLY public.olive_soul_layers ADD CONSTRAINT olive_soul_layers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_soul_rollbacks ADD CONSTRAINT olive_soul_rollbacks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_soul_rollbacks ADD CONSTRAINT olive_soul_rollbacks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'applied'::text, 'failed'::text])));
ALTER TABLE ONLY public.olive_soul_versions ADD CONSTRAINT olive_soul_versions_layer_id_fkey FOREIGN KEY (layer_id) REFERENCES olive_soul_layers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_soul_versions ADD CONSTRAINT olive_soul_versions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_soul_versions ADD CONSTRAINT olive_soul_versions_trigger_check CHECK ((trigger = ANY (ARRAY['onboarding'::text, 'pattern_detection'::text, 'explicit_intent'::text, 'engagement_decay'::text, 'feedback'::text, 'reflection'::text, 'trust_escalation'::text, 'manual'::text, 'system'::text])));
ALTER TABLE ONLY public.olive_space_invites ADD CONSTRAINT olive_space_invites_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_space_invites ADD CONSTRAINT olive_space_invites_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_space_invites ADD CONSTRAINT olive_space_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'expired'::text, 'revoked'::text])));
ALTER TABLE ONLY public.olive_space_invites ADD CONSTRAINT olive_space_invites_token_key UNIQUE (token);
ALTER TABLE ONLY public.olive_space_members ADD CONSTRAINT olive_space_members_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_space_members ADD CONSTRAINT olive_space_members_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_space_members ADD CONSTRAINT olive_space_members_space_id_user_id_key UNIQUE (space_id, user_id);
ALTER TABLE ONLY public.olive_space_templates ADD CONSTRAINT olive_space_templates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_space_templates ADD CONSTRAINT olive_space_templates_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_space_templates ADD CONSTRAINT olive_space_templates_space_id_template_id_key UNIQUE (space_id, template_id);
ALTER TABLE ONLY public.olive_space_templates ADD CONSTRAINT olive_space_templates_template_id_fkey FOREIGN KEY (template_id) REFERENCES olive_industry_templates(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_spaces ADD CONSTRAINT olive_spaces_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES clerk_couples(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.olive_spaces ADD CONSTRAINT olive_spaces_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_subscriptions ADD CONSTRAINT olive_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_trust_actions ADD CONSTRAINT olive_trust_actions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_trust_actions ADD CONSTRAINT olive_trust_actions_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.olive_trust_actions ADD CONSTRAINT olive_trust_actions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'expired'::text, 'executed'::text])));
ALTER TABLE ONLY public.olive_trust_notifications ADD CONSTRAINT olive_trust_notifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_trust_notifications ADD CONSTRAINT olive_trust_notifications_trust_action_id_fkey FOREIGN KEY (trust_action_id) REFERENCES olive_trust_actions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.olive_trust_notifications ADD CONSTRAINT olive_trust_notifications_type_check CHECK ((type = ANY (ARRAY['action_approval'::text, 'trust_escalation'::text, 'soul_evolution'::text, 'engagement_drop'::text, 'trust_de_escalation'::text])));
ALTER TABLE ONLY public.olive_usage_meters ADD CONSTRAINT olive_usage_meters_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_usage_meters ADD CONSTRAINT olive_usage_meters_user_id_meter_date_key UNIQUE (user_id, meter_date);
ALTER TABLE ONLY public.olive_user_preferences ADD CONSTRAINT olive_user_preferences_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.olive_user_skills ADD CONSTRAINT olive_user_skills_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_user_skills ADD CONSTRAINT olive_user_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES olive_skills(skill_id);
ALTER TABLE ONLY public.olive_user_skills ADD CONSTRAINT olive_user_skills_user_id_skill_id_key UNIQUE (user_id, skill_id);
ALTER TABLE ONLY public.olive_user_skills ADD CONSTRAINT olive_user_skills_user_skill_unique UNIQUE (user_id, skill_id);
ALTER TABLE ONLY public.olive_workflow_instances ADD CONSTRAINT olive_workflow_instances_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_workflow_instances ADD CONSTRAINT olive_workflow_instances_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_workflow_instances ADD CONSTRAINT olive_workflow_instances_workflow_id_fkey FOREIGN KEY (workflow_id) REFERENCES olive_workflow_templates(workflow_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_workflow_instances ADD CONSTRAINT olive_workflow_instances_workflow_id_space_id_key UNIQUE (workflow_id, space_id);
ALTER TABLE ONLY public.olive_workflow_runs ADD CONSTRAINT olive_workflow_runs_instance_id_fkey FOREIGN KEY (instance_id) REFERENCES olive_workflow_instances(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.olive_workflow_runs ADD CONSTRAINT olive_workflow_runs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_workflow_templates ADD CONSTRAINT olive_workflow_templates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.olive_workflow_templates ADD CONSTRAINT olive_workflow_templates_workflow_id_key UNIQUE (workflow_id);
ALTER TABLE ONLY public.oura_connections ADD CONSTRAINT oura_connections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.oura_connections ADD CONSTRAINT oura_connections_user_id_key UNIQUE (user_id);
ALTER TABLE ONLY public.oura_daily_data ADD CONSTRAINT oura_daily_data_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES oura_connections(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.oura_daily_data ADD CONSTRAINT oura_daily_data_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.oura_daily_data ADD CONSTRAINT oura_daily_data_user_id_day_key UNIQUE (user_id, day);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.space_activity ADD CONSTRAINT space_activity_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.space_activity ADD CONSTRAINT space_activity_space_id_fkey FOREIGN KEY (space_id) REFERENCES olive_spaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_memories ADD CONSTRAINT user_memories_couple_id_fkey FOREIGN KEY (couple_id) REFERENCES clerk_couples(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.user_memories ADD CONSTRAINT user_memories_importance_check CHECK (((importance >= 1) AND (importance <= 5)));
ALTER TABLE ONLY public.user_memories ADD CONSTRAINT user_memories_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
ALTER TABLE ONLY public.user_sessions ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);

-- ===== 06 INDEXES (non-unique, non-PK) =====
CREATE INDEX idx_agent_exec_agent ON public.olive_agent_executions USING btree (agent_id, user_id, queued_at DESC);
CREATE INDEX idx_agent_exec_space ON public.olive_agent_executions USING btree (space_id, status) WHERE (space_id IS NOT NULL);
CREATE INDEX idx_agent_exec_user_status ON public.olive_agent_executions USING btree (user_id, status, queued_at DESC);
CREATE INDEX idx_agent_runs_status ON public.olive_agent_runs USING btree (status, started_at);
CREATE INDEX idx_agent_runs_user ON public.olive_agent_runs USING btree (user_id, agent_id);
CREATE INDEX idx_briefings_user_recent ON public.olive_briefings USING btree (user_id, created_at DESC);
CREATE INDEX idx_briefings_user_type ON public.olive_briefings USING btree (user_id, briefing_type, created_at DESC);
CREATE INDEX idx_calendar_connections_active ON public.calendar_connections USING btree (user_id, is_active);
CREATE INDEX idx_calendar_connections_couple ON public.calendar_connections USING btree (couple_id);
CREATE INDEX idx_calendar_connections_user ON public.calendar_connections USING btree (user_id);
CREATE INDEX idx_calendar_events_connection ON public.calendar_events USING btree (connection_id);
CREATE INDEX idx_calendar_events_google_id ON public.calendar_events USING btree (google_event_id);
CREATE INDEX idx_calendar_events_note ON public.calendar_events USING btree (note_id);
CREATE INDEX idx_calendar_events_start_time ON public.calendar_events USING btree (start_time);
CREATE INDEX idx_chunks_active ON public.olive_memory_chunks USING btree (user_id, is_active, importance DESC) WHERE (is_active = true);
CREATE INDEX idx_chunks_decay ON public.olive_memory_chunks USING btree (user_id, last_accessed_at) WHERE ((is_active = true) AND (last_accessed_at IS NOT NULL));
CREATE INDEX idx_chunks_null_embedding ON public.olive_memory_chunks USING btree (importance DESC, created_at DESC) WHERE ((is_active = true) AND (embedding IS NULL));
CREATE INDEX idx_clerk_couple_members_couple ON public.clerk_couple_members USING btree (couple_id);
CREATE INDEX idx_clerk_couple_members_user ON public.clerk_couple_members USING btree (user_id);
CREATE INDEX idx_clerk_couples_created_by ON public.clerk_couples USING btree (created_by);
CREATE INDEX idx_clerk_lists_space_id ON public.clerk_lists USING btree (space_id) WHERE (space_id IS NOT NULL);
CREATE INDEX idx_clerk_notes_assigned ON public.clerk_notes USING btree (assigned_to) WHERE (assigned_to IS NOT NULL);
CREATE INDEX idx_clerk_notes_embedding ON public.clerk_notes USING ivfflat (embedding vector_cosine_ops) WITH (lists='100');
CREATE INDEX idx_clerk_notes_is_sensitive ON public.clerk_notes USING btree (is_sensitive) WHERE (is_sensitive = true);
CREATE INDEX idx_clerk_notes_location ON public.clerk_notes USING gin (location) WHERE (location IS NOT NULL);
CREATE INDEX idx_clerk_notes_recurring ON public.clerk_notes USING btree (reminder_time, recurrence_frequency) WHERE ((reminder_time IS NOT NULL) AND (completed = false));
CREATE INDEX idx_clerk_notes_reminder_time ON public.clerk_notes USING btree (reminder_time) WHERE ((reminder_time IS NOT NULL) AND (completed = false));
CREATE INDEX idx_clerk_notes_source_ref ON public.clerk_notes USING btree (author_id, source_ref) WHERE (source_ref IS NOT NULL);
CREATE INDEX idx_clerk_profiles_last_user_message ON public.clerk_profiles USING btree (last_user_message_at) WHERE (last_user_message_at IS NOT NULL);
CREATE INDEX idx_clerk_profiles_phone_number ON public.clerk_profiles USING btree (phone_number) WHERE (phone_number IS NOT NULL);
CREATE INDEX idx_clerk_profiles_timezone ON public.clerk_profiles USING btree (timezone);
CREATE INDEX idx_client_activity_client ON public.olive_client_activity USING btree (client_id, created_at DESC);
CREATE INDEX idx_clients_follow_up ON public.olive_clients USING btree (follow_up_date) WHERE ((follow_up_date IS NOT NULL) AND (NOT is_archived));
CREATE INDEX idx_clients_space ON public.olive_clients USING btree (space_id, stage) WHERE (NOT is_archived);
CREATE INDEX idx_clients_user ON public.olive_clients USING btree (user_id, stage) WHERE (NOT is_archived);
CREATE INDEX idx_conflicts_space ON public.olive_conflicts USING btree (space_id, status) WHERE (status = 'open'::text);
CREATE INDEX idx_conflicts_user ON public.olive_conflicts USING btree (user_id, status) WHERE (status = 'open'::text);
CREATE INDEX idx_consolidation_runs_user ON public.olive_consolidation_runs USING btree (user_id, started_at DESC);
CREATE INDEX idx_contradictions_user_unresolved ON public.olive_memory_contradictions USING btree (user_id, resolution) WHERE (resolution = 'unresolved'::text);
CREATE INDEX idx_cross_space_insights_user ON public.olive_cross_space_insights USING btree (user_id, status) WHERE (status = 'new'::text);
CREATE INDEX idx_decisions_category ON public.olive_decisions USING btree (space_id, category) WHERE (NOT is_archived);
CREATE INDEX idx_decisions_date ON public.olive_decisions USING btree (decision_date DESC);
CREATE INDEX idx_decisions_space ON public.olive_decisions USING btree (space_id, status) WHERE (NOT is_archived);
CREATE INDEX idx_decryption_audit_note ON public.decryption_audit_log USING btree (note_id, created_at DESC);
CREATE INDEX idx_decryption_audit_user ON public.decryption_audit_log USING btree (user_id, created_at DESC);
CREATE INDEX idx_delegations_active ON public.olive_delegations USING btree (space_id, delegated_to, status) WHERE (status = ANY (ARRAY['pending'::text, 'accepted'::text]));
CREATE INDEX idx_delegations_delegatee ON public.olive_delegations USING btree (delegated_to, status, created_at DESC) WHERE (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'snoozed'::text]));
CREATE INDEX idx_delegations_delegator ON public.olive_delegations USING btree (delegated_by, status, created_at DESC);
CREATE INDEX idx_delegations_note ON public.olive_delegations USING btree (note_id) WHERE (note_id IS NOT NULL);
CREATE INDEX idx_delegations_space ON public.olive_delegations USING btree (space_id, status, created_at DESC);
CREATE INDEX idx_engagement_events_user_recent ON public.olive_engagement_events USING btree (user_id, created_at DESC);
CREATE INDEX idx_engagement_events_user_type ON public.olive_engagement_events USING btree (user_id, event_type, created_at);
CREATE INDEX idx_expense_settlements_space_id ON public.expense_settlements USING btree (space_id) WHERE (space_id IS NOT NULL);
CREATE INDEX idx_expense_splits_space ON public.olive_expense_splits USING btree (space_id) WHERE (NOT is_settled);
CREATE INDEX idx_expenses_category ON public.expenses USING btree (category);
CREATE INDEX idx_expenses_couple_id ON public.expenses USING btree (couple_id);
CREATE INDEX idx_expenses_expense_date ON public.expenses USING btree (expense_date);
CREATE INDEX idx_expenses_is_settled ON public.expenses USING btree (is_settled);
CREATE INDEX idx_expenses_note_id ON public.expenses USING btree (note_id);
CREATE INDEX idx_expenses_space_id ON public.expenses USING btree (space_id) WHERE (space_id IS NOT NULL);
CREATE INDEX idx_expenses_user_id ON public.expenses USING btree (user_id);
CREATE INDEX idx_heartbeat_log_pending_reflection ON public.olive_heartbeat_log USING btree (created_at) WHERE ((status = 'sent'::text) AND (reflection_captured = false));
CREATE INDEX idx_heartbeat_log_user_status ON public.olive_heartbeat_log USING btree (user_id, status, created_at DESC);
CREATE INDEX idx_industry_templates_industry ON public.olive_industry_templates USING btree (industry) WHERE (is_active = true);
CREATE INDEX idx_linking_tokens_token ON public.linking_tokens USING btree (token);
CREATE INDEX idx_linking_tokens_user_id ON public.linking_tokens USING btree (user_id);
CREATE INDEX idx_llm_calls_created ON public.olive_llm_calls USING btree (created_at DESC);
CREATE INDEX idx_llm_calls_function ON public.olive_llm_calls USING btree (function_name, created_at DESC);
CREATE INDEX idx_llm_calls_model ON public.olive_llm_calls USING btree (model, created_at DESC);
CREATE INDEX idx_llm_calls_user ON public.olive_llm_calls USING btree (user_id, created_at DESC);
CREATE INDEX idx_maintenance_log_user ON public.olive_memory_maintenance_log USING btree (user_id, run_type, started_at DESC);
CREATE INDEX idx_members_couple ON public.clerk_couple_members USING btree (couple_id);
CREATE INDEX idx_members_user ON public.clerk_couple_members USING btree (user_id);
CREATE INDEX idx_memory_files_space_id ON public.olive_memory_files USING btree (space_id) WHERE (space_id IS NOT NULL);
CREATE INDEX idx_memory_insights_user_status ON public.memory_insights USING btree (user_id, status);
CREATE INDEX idx_memory_relevance_archived ON public.olive_memory_relevance USING btree (user_id, is_archived) WHERE (is_archived = true);
CREATE INDEX idx_memory_relevance_user ON public.olive_memory_relevance USING btree (user_id, relevance_score DESC) WHERE (is_archived = false);
CREATE INDEX idx_note_mentions_note ON public.note_mentions USING btree (note_id) WHERE (note_id IS NOT NULL);
CREATE INDEX idx_note_mentions_thread ON public.note_mentions USING btree (thread_id) WHERE (thread_id IS NOT NULL);
CREATE INDEX idx_note_mentions_user ON public.note_mentions USING btree (mentioned_user_id, read_at);
CREATE INDEX idx_note_reactions_note ON public.note_reactions USING btree (note_id);
CREATE INDEX idx_note_reactions_user ON public.note_reactions USING btree (user_id);
CREATE INDEX idx_note_threads_author ON public.note_threads USING btree (author_id);
CREATE INDEX idx_note_threads_note ON public.note_threads USING btree (note_id, created_at);
CREATE INDEX idx_note_threads_space ON public.note_threads USING btree (space_id) WHERE (space_id IS NOT NULL);
CREATE INDEX idx_notes_null_embedding ON public.clerk_notes USING btree (created_at DESC) WHERE ((embedding IS NULL) AND (original_text IS NOT NULL));
CREATE INDEX idx_notes_space_category ON public.clerk_notes USING btree (space_id, category) WHERE (space_id IS NOT NULL);
CREATE INDEX idx_notes_space_id ON public.clerk_notes USING btree (space_id) WHERE (space_id IS NOT NULL);
CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, read) WHERE (read = false);
CREATE INDEX idx_olive_chat_sessions_user_updated ON public.olive_chat_sessions USING btree (user_id, updated_at DESC);
CREATE INDEX idx_olive_conversations_user_note ON public.olive_conversations USING btree (user_id, note_id);
CREATE INDEX idx_olive_entities_canonical ON public.olive_entities USING btree (user_id, canonical_name);
CREATE INDEX idx_olive_entities_mentions ON public.olive_entities USING btree (user_id, mention_count DESC);
CREATE INDEX idx_olive_entities_type ON public.olive_entities USING btree (user_id, entity_type);
CREATE INDEX idx_olive_entities_user ON public.olive_entities USING btree (user_id);
CREATE INDEX idx_olive_entity_communities_user ON public.olive_entity_communities USING btree (user_id);
CREATE INDEX idx_olive_relationships_source ON public.olive_relationships USING btree (source_entity_id);
CREATE INDEX idx_olive_relationships_target ON public.olive_relationships USING btree (target_entity_id);
CREATE INDEX idx_olive_relationships_type ON public.olive_relationships USING btree (user_id, relationship_type);
CREATE INDEX idx_olive_relationships_user ON public.olive_relationships USING btree (user_id);
CREATE INDEX idx_oura_daily_data_connection ON public.oura_daily_data USING btree (connection_id);
CREATE INDEX idx_oura_daily_data_day ON public.oura_daily_data USING btree (day);
CREATE INDEX idx_oura_daily_data_user_day ON public.oura_daily_data USING btree (user_id, day);
CREATE INDEX idx_patterns_space_id ON public.olive_patterns USING btree (space_id) WHERE (space_id IS NOT NULL);
CREATE INDEX idx_poll_votes_poll ON public.olive_poll_votes USING btree (poll_id);
CREATE INDEX idx_polls_space ON public.olive_polls USING btree (space_id, status) WHERE (status = 'open'::text);
CREATE INDEX idx_reflections_action ON public.olive_reflections USING btree (action_type, outcome);
CREATE INDEX idx_reflections_unapplied ON public.olive_reflections USING btree (applied_to_soul) WHERE (applied_to_soul = false);
CREATE INDEX idx_reflections_user ON public.olive_reflections USING btree (user_id, created_at DESC);
CREATE INDEX idx_relationships_couple ON public.olive_relationships USING btree (couple_id) WHERE (couple_id IS NOT NULL);
CREATE INDEX idx_router_log_intent ON public.olive_router_log USING btree (classified_intent, created_at DESC);
CREATE INDEX idx_router_log_user ON public.olive_router_log USING btree (user_id, created_at DESC);
CREATE INDEX idx_soul_evolution_log_drift ON public.olive_soul_evolution_log USING btree (user_id, drift_score DESC) WHERE (drift_score > (0.3)::double precision);
CREATE INDEX idx_soul_evolution_log_user ON public.olive_soul_evolution_log USING btree (user_id, created_at DESC);
CREATE INDEX idx_soul_layers_space ON public.olive_soul_layers USING btree (owner_id) WHERE (owner_type = 'space'::text);
CREATE INDEX idx_soul_layers_user ON public.olive_soul_layers USING btree (owner_id) WHERE (owner_type = 'user'::text);
CREATE INDEX idx_soul_rollbacks_user ON public.olive_soul_rollbacks USING btree (user_id, created_at DESC);
CREATE INDEX idx_soul_versions_layer ON public.olive_soul_versions USING btree (layer_id, version DESC);
CREATE INDEX idx_space_activity_actor ON public.space_activity USING btree (actor_id, created_at DESC);
CREATE INDEX idx_space_activity_entity ON public.space_activity USING btree (entity_type, entity_id);
CREATE INDEX idx_space_activity_feed ON public.space_activity USING btree (space_id, created_at DESC);
CREATE INDEX idx_space_invites_space ON public.olive_space_invites USING btree (space_id);
CREATE INDEX idx_space_invites_token ON public.olive_space_invites USING btree (token);
CREATE INDEX idx_space_members_active ON public.olive_space_members USING btree (space_id, user_id, role);
CREATE INDEX idx_space_members_space ON public.olive_space_members USING btree (space_id);
CREATE INDEX idx_space_members_user ON public.olive_space_members USING btree (user_id);
CREATE INDEX idx_space_templates_space ON public.olive_space_templates USING btree (space_id);
CREATE INDEX idx_spaces_couple_id ON public.olive_spaces USING btree (couple_id) WHERE (couple_id IS NOT NULL);
CREATE INDEX idx_spaces_created_by ON public.olive_spaces USING btree (created_by);
CREATE INDEX idx_spaces_type ON public.olive_spaces USING btree (type);
CREATE INDEX idx_split_shares_split ON public.olive_expense_split_shares USING btree (split_id);
CREATE INDEX idx_split_shares_user ON public.olive_expense_split_shares USING btree (user_id) WHERE (NOT is_paid);
CREATE INDEX idx_subscriptions_stripe ON public.olive_subscriptions USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);
CREATE INDEX idx_trust_actions_space ON public.olive_trust_actions USING btree (space_id, status) WHERE (space_id IS NOT NULL);
CREATE INDEX idx_trust_actions_user_pending ON public.olive_trust_actions USING btree (user_id, status, created_at DESC) WHERE (status = 'pending'::text);
CREATE INDEX idx_trust_actions_user_recent ON public.olive_trust_actions USING btree (user_id, created_at DESC);
CREATE INDEX idx_trust_notifications_user_unread ON public.olive_trust_notifications USING btree (user_id, created_at DESC) WHERE (read_at IS NULL);
CREATE INDEX idx_usage_meters_user_date ON public.olive_usage_meters USING btree (user_id, meter_date DESC);
CREATE INDEX idx_user_memories_active ON public.user_memories USING btree (user_id, is_active);
CREATE INDEX idx_user_memories_category ON public.user_memories USING btree (user_id, category);
CREATE INDEX idx_user_memories_couple_id ON public.user_memories USING btree (couple_id) WHERE (couple_id IS NOT NULL);
CREATE INDEX idx_user_memories_user ON public.user_memories USING btree (user_id);
CREATE INDEX idx_user_sessions_user_id ON public.user_sessions USING btree (user_id);
CREATE INDEX idx_workflow_instances_schedule ON public.olive_workflow_instances USING btree (is_enabled, last_run_at);
CREATE INDEX idx_workflow_instances_space ON public.olive_workflow_instances USING btree (space_id) WHERE (is_enabled = true);
CREATE INDEX idx_workflow_runs_instance ON public.olive_workflow_runs USING btree (instance_id, started_at DESC);

-- ===== 07 TRIGGERS =====
CREATE TRIGGER add_clerk_creator_as_member_trigger AFTER INSERT ON public.clerk_couples FOR EACH ROW EXECUTE FUNCTION add_clerk_creator_as_member();
CREATE TRIGGER add_creator_as_member AFTER INSERT ON public.couples FOR EACH ROW EXECUTE FUNCTION add_creator_as_member();
CREATE TRIGGER clerk_notes_category_edit_reflection AFTER UPDATE OF category ON public.clerk_notes FOR EACH ROW WHEN ((old.category IS DISTINCT FROM new.category)) EXECUTE FUNCTION capture_category_edit_reflection();
CREATE TRIGGER normalize_note_category BEFORE INSERT OR UPDATE OF category ON public.clerk_notes FOR EACH ROW EXECUTE FUNCTION trigger_normalize_category();
CREATE TRIGGER send_invite_email_trigger AFTER INSERT OR UPDATE ON public.invites FOR EACH ROW EXECUTE FUNCTION send_invite_email();
CREATE TRIGGER set_couples_updated_at BEFORE UPDATE ON public.couples FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_expenses_updated_at BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_notes_updated_at BEFORE UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_oura_connections_updated_at BEFORE UPDATE ON public.oura_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at_olive_chat_sessions BEFORE UPDATE ON public.olive_chat_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at_olive_entities BEFORE UPDATE ON public.olive_entities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at_olive_entity_communities BEFORE UPDATE ON public.olive_entity_communities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at_olive_relationships BEFORE UPDATE ON public.olive_relationships FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_clerk_couples_updated_at BEFORE UPDATE ON public.clerk_couples FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_client_stage_change BEFORE UPDATE ON public.olive_clients FOR EACH ROW EXECUTE FUNCTION log_client_stage_change();
CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON public.olive_clients FOR EACH ROW EXECUTE FUNCTION update_b2b_updated_at();
CREATE TRIGGER trg_decisions_updated_at BEFORE UPDATE ON public.olive_decisions FOR EACH ROW EXECUTE FUNCTION update_b2b_updated_at();
CREATE TRIGGER trg_delegation_activity AFTER INSERT OR UPDATE ON public.olive_delegations FOR EACH ROW EXECUTE FUNCTION trg_log_delegation_activity();
CREATE TRIGGER trg_delegation_set_updated_at BEFORE UPDATE ON public.olive_delegations FOR EACH ROW EXECUTE FUNCTION trg_delegation_updated_at();
CREATE TRIGGER trg_expense_splits_updated_at BEFORE UPDATE ON public.olive_expense_splits FOR EACH ROW EXECUTE FUNCTION update_b2b_updated_at();
CREATE TRIGGER trg_industry_templates_updated_at BEFORE UPDATE ON public.olive_industry_templates FOR EACH ROW EXECUTE FUNCTION update_b2b_updated_at();
CREATE TRIGGER trg_log_member_activity AFTER INSERT OR DELETE ON public.olive_space_members FOR EACH ROW EXECUTE FUNCTION log_member_activity();
CREATE TRIGGER trg_log_note_activity AFTER INSERT OR UPDATE ON public.clerk_notes FOR EACH ROW EXECUTE FUNCTION log_note_activity();
CREATE TRIGGER trg_log_reaction_activity AFTER INSERT ON public.note_reactions FOR EACH ROW EXECUTE FUNCTION log_reaction_activity();
CREATE TRIGGER trg_log_thread_activity AFTER INSERT ON public.note_threads FOR EACH ROW EXECUTE FUNCTION log_thread_activity();
CREATE TRIGGER trg_set_created_by BEFORE INSERT ON public.clerk_couples FOR EACH ROW EXECUTE FUNCTION set_created_by_from_jwt();
CREATE TRIGGER trg_sync_couple_member_to_space AFTER INSERT OR DELETE ON public.clerk_couple_members FOR EACH ROW EXECUTE FUNCTION sync_couple_member_to_space();
CREATE TRIGGER trg_sync_couple_to_space AFTER INSERT OR DELETE OR UPDATE ON public.clerk_couples FOR EACH ROW EXECUTE FUNCTION sync_couple_to_space();
CREATE TRIGGER trg_sync_expense_couple_space BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION sync_expense_couple_to_space();
CREATE TRIGGER trg_sync_expense_couple_space_insert BEFORE INSERT ON public.expenses FOR EACH ROW EXECUTE FUNCTION sync_expense_couple_to_space_insert();
CREATE TRIGGER trg_sync_list_couple_space BEFORE UPDATE ON public.clerk_lists FOR EACH ROW EXECUTE FUNCTION sync_list_couple_to_space();
CREATE TRIGGER trg_sync_list_couple_space_insert BEFORE INSERT ON public.clerk_lists FOR EACH ROW EXECUTE FUNCTION sync_list_couple_to_space_insert();
CREATE TRIGGER trg_sync_note_couple_space BEFORE UPDATE ON public.clerk_notes FOR EACH ROW EXECUTE FUNCTION sync_note_couple_to_space();
CREATE TRIGGER trg_sync_note_couple_space_insert BEFORE INSERT ON public.clerk_notes FOR EACH ROW EXECUTE FUNCTION sync_note_couple_to_space_insert();
CREATE TRIGGER trg_sync_settlement_couple_space_insert BEFORE INSERT ON public.expense_settlements FOR EACH ROW EXECUTE FUNCTION sync_settlement_couple_to_space_insert();
CREATE TRIGGER trg_workflow_instances_updated_at BEFORE UPDATE ON public.olive_workflow_instances FOR EACH ROW EXECUTE FUNCTION update_b2b_updated_at();
CREATE TRIGGER trg_workflow_templates_updated_at BEFORE UPDATE ON public.olive_workflow_templates FOR EACH ROW EXECUTE FUNCTION update_b2b_updated_at();
CREATE TRIGGER update_calendar_connections_updated_at BEFORE UPDATE ON public.calendar_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER update_calendar_events_updated_at BEFORE UPDATE ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER update_calendar_sync_state_updated_at BEFORE UPDATE ON public.calendar_sync_state FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER update_clerk_couples_updated_at BEFORE UPDATE ON public.clerk_couples FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER update_clerk_lists_updated_at BEFORE UPDATE ON public.clerk_lists FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER update_clerk_notes_updated_at BEFORE UPDATE ON public.clerk_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER update_clerk_profiles_updated_at BEFORE UPDATE ON public.clerk_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER update_olive_conversations_updated_at BEFORE UPDATE ON public.olive_conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER update_oura_connections_updated_at BEFORE UPDATE ON public.oura_connections FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER update_user_memories_updated_at BEFORE UPDATE ON public.user_memories FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER validate_invite_expiry BEFORE INSERT OR UPDATE ON public.invites FOR EACH ROW EXECUTE FUNCTION validate_invite_expiry();

-- ===== 08 ENABLE ROW LEVEL SECURITY =====
ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clerk_couple_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clerk_couples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clerk_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clerk_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clerk_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clerk_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decryption_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_budget_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.linking_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_agent_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_client_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_consolidation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_cross_space_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_email_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_engagement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_engagement_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_entity_communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_expense_split_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_gateway_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_heartbeat_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_heartbeat_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_industry_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_llm_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_memory_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_memory_contradictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_memory_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_memory_maintenance_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_memory_relevance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_outbound_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_pricing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_router_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_soul_evolution_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_soul_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_soul_rollbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_soul_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_space_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_space_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_space_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_trust_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_trust_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_usage_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_user_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_workflow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oura_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oura_daily_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- ===== 09 RLS POLICIES =====
CREATE POLICY "Anyone can insert feedback" ON public.beta_feedback AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Service role can read feedback" ON public.beta_feedback AS PERMISSIVE FOR SELECT TO public USING (false);
CREATE POLICY calendar_connections_delete ON public.calendar_connections AS PERMISSIVE FOR DELETE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY calendar_connections_insert ON public.calendar_connections AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY calendar_connections_select_own ON public.calendar_connections AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY calendar_connections_update ON public.calendar_connections AS PERMISSIVE FOR UPDATE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY calendar_events_delete ON public.calendar_events AS PERMISSIVE FOR DELETE TO public USING ((connection_id IN ( SELECT calendar_connections.id
   FROM calendar_connections
  WHERE (calendar_connections.user_id = (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY calendar_events_insert ON public.calendar_events AS PERMISSIVE FOR INSERT TO public WITH CHECK ((connection_id IN ( SELECT calendar_connections.id
   FROM calendar_connections
  WHERE (calendar_connections.user_id = (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY calendar_events_select ON public.calendar_events AS PERMISSIVE FOR SELECT TO public USING ((connection_id IN ( SELECT calendar_connections.id
   FROM calendar_connections
  WHERE ((calendar_connections.user_id = (auth.jwt() ->> 'sub'::text)) OR ((calendar_connections.couple_id IS NOT NULL) AND is_couple_member_safe(calendar_connections.couple_id, (auth.jwt() ->> 'sub'::text)))))));
CREATE POLICY calendar_events_update ON public.calendar_events AS PERMISSIVE FOR UPDATE TO public USING ((connection_id IN ( SELECT calendar_connections.id
   FROM calendar_connections
  WHERE (calendar_connections.user_id = (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY calendar_sync_state_all ON public.calendar_sync_state AS PERMISSIVE FOR ALL TO public USING ((connection_id IN ( SELECT calendar_connections.id
   FROM calendar_connections
  WHERE (calendar_connections.user_id = (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY clerk_couple_members_delete ON public.clerk_couple_members AS PERMISSIVE FOR DELETE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY clerk_couple_members_insert ON public.clerk_couple_members AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = (auth.jwt() ->> 'sub'::text)) AND ((EXISTS ( SELECT 1
   FROM clerk_invites i
  WHERE ((i.couple_id = clerk_couple_members.couple_id) AND (i.accepted_by = (auth.jwt() ->> 'sub'::text)) AND (i.accepted_at IS NOT NULL)))) OR (EXISTS ( SELECT 1
   FROM clerk_couples c
  WHERE ((c.id = clerk_couple_members.couple_id) AND (c.created_by = (auth.jwt() ->> 'sub'::text))))))));
CREATE POLICY clerk_couple_members_select ON public.clerk_couple_members AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY clerk_couple_members_update_own ON public.clerk_couple_members AS PERMISSIVE FOR UPDATE TO public USING (((user_id = (auth.jwt() ->> 'sub'::text)) OR is_couple_owner_safe(couple_id, (auth.jwt() ->> 'sub'::text)))) WITH CHECK (((role <> 'owner'::member_role) OR is_couple_owner_safe(couple_id, (auth.jwt() ->> 'sub'::text))));
CREATE POLICY members_see_space_members ON public.clerk_couple_members AS PERMISSIVE FOR SELECT TO public USING (is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)));
CREATE POLICY owners_can_delete_members ON public.clerk_couple_members AS PERMISSIVE FOR DELETE TO public USING (is_couple_owner_safe(couple_id, (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "couples.delete" ON public.clerk_couples AS PERMISSIVE FOR DELETE TO authenticated USING (is_couple_owner(id, (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "couples.insert" ON public.clerk_couples AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((created_by = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "couples.select" ON public.clerk_couples AS PERMISSIVE FOR SELECT TO public USING (is_couple_member(id, (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "couples.update" ON public.clerk_couples AS PERMISSIVE FOR UPDATE TO public USING (is_couple_member(id, (auth.jwt() ->> 'sub'::text))) WITH CHECK (is_couple_member(id, (auth.jwt() ->> 'sub'::text)));
CREATE POLICY couples_insert ON public.clerk_couples AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((created_by = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY couples_select ON public.clerk_couples AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM clerk_couple_members m
  WHERE ((m.couple_id = clerk_couples.id) AND (m.user_id = (auth.jwt() ->> 'sub'::text))))));
CREATE POLICY couples_update ON public.clerk_couples AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM clerk_couple_members m
  WHERE ((m.couple_id = clerk_couples.id) AND (m.user_id = (auth.jwt() ->> 'sub'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM clerk_couple_members m
  WHERE ((m.couple_id = clerk_couples.id) AND (m.user_id = (auth.jwt() ->> 'sub'::text))))));
CREATE POLICY clerk_invites_delete_own ON public.clerk_invites AS PERMISSIVE FOR DELETE TO authenticated USING ((created_by = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY clerk_invites_insert_own ON public.clerk_invites AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((created_by = (auth.jwt() ->> 'sub'::text)) AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))));
CREATE POLICY clerk_invites_select_own ON public.clerk_invites AS PERMISSIVE FOR SELECT TO authenticated USING (((created_by = (auth.jwt() ->> 'sub'::text)) OR (EXISTS ( SELECT 1
   FROM clerk_couple_members m
  WHERE ((m.couple_id = clerk_invites.couple_id) AND (m.user_id = (auth.jwt() ->> 'sub'::text)))))));
CREATE POLICY clerk_invites_update_own ON public.clerk_invites AS PERMISSIVE FOR UPDATE TO authenticated USING ((created_by = (auth.jwt() ->> 'sub'::text))) WITH CHECK ((created_by = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "lists.delete" ON public.clerk_lists AS PERMISSIVE FOR DELETE TO authenticated USING (((author_id = (auth.jwt() ->> 'sub'::text)) OR ((couple_id IS NOT NULL) AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY "lists.insert" ON public.clerk_lists AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((author_id = (auth.jwt() ->> 'sub'::text)) AND (((couple_id IS NULL) AND (space_id IS NULL)) OR ((couple_id IS NOT NULL) AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text))))));
CREATE POLICY "lists.select" ON public.clerk_lists AS PERMISSIVE FOR SELECT TO authenticated USING (((author_id = (auth.jwt() ->> 'sub'::text)) OR ((couple_id IS NOT NULL) AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY "lists.update" ON public.clerk_lists AS PERMISSIVE FOR UPDATE TO authenticated USING (((author_id = (auth.jwt() ->> 'sub'::text)) OR ((couple_id IS NOT NULL) AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text))))) WITH CHECK (((author_id = (auth.jwt() ->> 'sub'::text)) OR ((couple_id IS NOT NULL) AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY clerk_notes_delete ON public.clerk_notes AS PERMISSIVE FOR DELETE TO public USING ((((author_id = (auth.jwt() ->> 'sub'::text)) AND (couple_id IS NULL) AND (space_id IS NULL)) OR ((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY clerk_notes_insert ON public.clerk_notes AS PERMISSIVE FOR INSERT TO public WITH CHECK (((author_id = (auth.jwt() ->> 'sub'::text)) AND (((couple_id IS NULL) AND (space_id IS NULL)) OR ((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text))))));
CREATE POLICY clerk_notes_select ON public.clerk_notes AS PERMISSIVE FOR SELECT TO public USING ((((author_id = (auth.jwt() ->> 'sub'::text)) AND (couple_id IS NULL) AND (space_id IS NULL)) OR ((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY clerk_notes_update ON public.clerk_notes AS PERMISSIVE FOR UPDATE TO public USING ((((author_id = (auth.jwt() ->> 'sub'::text)) AND (couple_id IS NULL) AND (space_id IS NULL)) OR ((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY "Users can insert their own profile via Clerk" ON public.clerk_profiles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((((auth.jwt() ->> 'sub'::text) IS NOT NULL) AND (id = (auth.jwt() ->> 'sub'::text))));
CREATE POLICY "Users can update their own profile via Clerk" ON public.clerk_profiles AS PERMISSIVE FOR UPDATE TO authenticated USING ((id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Users can view their own profile via Clerk" ON public.clerk_profiles AS PERMISSIVE FOR SELECT TO authenticated USING ((id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Owners can add members" ON public.couple_members AS PERMISSIVE FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1
   FROM couple_members m
  WHERE ((m.couple_id = couple_members.couple_id) AND (m.user_id = auth.uid()) AND (m.role = 'owner'::member_role)))));
CREATE POLICY "Owners can remove members" ON public.couple_members AS PERMISSIVE FOR DELETE TO public USING ((EXISTS ( SELECT 1
   FROM couple_members m
  WHERE ((m.couple_id = couple_members.couple_id) AND (m.user_id = auth.uid()) AND (m.role = 'owner'::member_role)))));
CREATE POLICY "Owners can update members" ON public.couple_members AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM couple_members m
  WHERE ((m.couple_id = couple_members.couple_id) AND (m.user_id = auth.uid()) AND (m.role = 'owner'::member_role)))));
CREATE POLICY "Users can view their memberships" ON public.couple_members AS PERMISSIVE FOR SELECT TO public USING ((user_id = auth.uid()));
CREATE POLICY "Members can update their couples" ON public.couples AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM couple_members m
  WHERE ((m.couple_id = couples.id) AND (m.user_id = auth.uid())))));
CREATE POLICY "Members can view their couples" ON public.couples AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM couple_members m
  WHERE ((m.couple_id = couples.id) AND (m.user_id = auth.uid())))));
CREATE POLICY "Owners can delete their couples" ON public.couples AS PERMISSIVE FOR DELETE TO public USING ((EXISTS ( SELECT 1
   FROM couple_members m
  WHERE ((m.couple_id = couples.id) AND (m.user_id = auth.uid()) AND (m.role = 'owner'::member_role)))));
CREATE POLICY "Users can create couples" ON public.couples AS PERMISSIVE FOR INSERT TO public WITH CHECK ((created_by = auth.uid()));
CREATE POLICY "Service role inserts audit logs" ON public.decryption_audit_log AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Users can view own audit logs" ON public.decryption_audit_log AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY budget_limits_delete ON public.expense_budget_limits AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY budget_limits_insert ON public.expense_budget_limits AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY budget_limits_select ON public.expense_budget_limits AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = (auth.jwt() ->> 'sub'::text)) OR ((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY budget_limits_update ON public.expense_budget_limits AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY settlements_insert ON public.expense_settlements AS PERMISSIVE FOR INSERT TO public WITH CHECK (((settled_by = (auth.jwt() ->> 'sub'::text)) AND (((couple_id IS NULL) AND (space_id IS NULL)) OR ((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text))))));
CREATE POLICY settlements_select ON public.expense_settlements AS PERMISSIVE FOR SELECT TO public USING (((user_id = (auth.jwt() ->> 'sub'::text)) OR ((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY expenses_delete ON public.expenses AS PERMISSIVE FOR DELETE TO public USING ((((user_id = (auth.jwt() ->> 'sub'::text)) AND (couple_id IS NULL) AND (space_id IS NULL)) OR ((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY expenses_insert ON public.expenses AS PERMISSIVE FOR INSERT TO public WITH CHECK (((user_id = (auth.jwt() ->> 'sub'::text)) AND (((couple_id IS NULL) AND (space_id IS NULL)) OR ((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text))))));
CREATE POLICY expenses_select ON public.expenses AS PERMISSIVE FOR SELECT TO public USING ((((user_id = (auth.jwt() ->> 'sub'::text)) AND (couple_id IS NULL) AND (space_id IS NULL)) OR ((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY expenses_update ON public.expenses AS PERMISSIVE FOR UPDATE TO public USING ((((user_id = (auth.jwt() ->> 'sub'::text)) AND (couple_id IS NULL) AND (space_id IS NULL)) OR ((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text))) OR ((space_id IS NOT NULL) AND is_space_member(space_id, (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY "invites.delete" ON public.invites AS PERMISSIVE FOR DELETE TO authenticated USING (is_couple_owner(couple_id, (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "invites.insert" ON public.invites AS PERMISSIVE FOR INSERT TO public WITH CHECK (((invited_by = (auth.jwt() ->> 'sub'::text)) AND is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))));
CREATE POLICY "invites.select.mine" ON public.invites AS PERMISSIVE FOR SELECT TO public USING (((invited_by = (auth.jwt() ->> 'sub'::text)) OR is_couple_member(couple_id, (auth.jwt() ->> 'sub'::text))));
CREATE POLICY "invites.update" ON public.invites AS PERMISSIVE FOR UPDATE TO authenticated USING (is_couple_owner(couple_id, (auth.jwt() ->> 'sub'::text))) WITH CHECK (is_couple_owner(couple_id, (auth.jwt() ->> 'sub'::text)));
CREATE POLICY invites_insert ON public.invites AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((invited_by = jwt_sub()));
CREATE POLICY invites_select ON public.invites AS PERMISSIVE FOR SELECT TO authenticated USING (((invited_by = jwt_sub()) OR (EXISTS ( SELECT 1
   FROM clerk_couple_members m
  WHERE ((m.couple_id = invites.couple_id) AND (m.user_id = jwt_sub()))))));
CREATE POLICY "Users can insert their own linking tokens" ON public.linking_tokens AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Users can view their own linking tokens" ON public.linking_tokens AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY memory_insights_delete ON public.memory_insights AS PERMISSIVE FOR DELETE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY memory_insights_insert ON public.memory_insights AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY memory_insights_select ON public.memory_insights AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY memory_insights_update ON public.memory_insights AS PERMISSIVE FOR UPDATE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages mentions" ON public.note_mentions AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users can create mentions" ON public.note_mentions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((mentioned_by = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Users can mark their mentions as read" ON public.note_mentions AS PERMISSIVE FOR UPDATE TO public USING ((mentioned_user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Users see mentions directed at them" ON public.note_mentions AS PERMISSIVE FOR SELECT TO public USING (((mentioned_user_id = (auth.jwt() ->> 'sub'::text)) OR (mentioned_by = (auth.jwt() ->> 'sub'::text))));
CREATE POLICY "Service role manages reactions" ON public.note_reactions AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Space members and note authors can view reactions" ON public.note_reactions AS PERMISSIVE FOR SELECT TO public USING (((user_id = (auth.jwt() ->> 'sub'::text)) OR (EXISTS ( SELECT 1
   FROM (clerk_notes n
     LEFT JOIN olive_space_members sm ON ((sm.space_id = n.space_id)))
  WHERE ((n.id = note_reactions.note_id) AND ((n.author_id = (auth.jwt() ->> 'sub'::text)) OR (sm.user_id = (auth.jwt() ->> 'sub'::text))))))));
CREATE POLICY "Users can add reactions" ON public.note_reactions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Users can remove own reactions" ON public.note_reactions AS PERMISSIVE FOR DELETE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Authenticated users can create threads on accessible notes" ON public.note_threads AS PERMISSIVE FOR INSERT TO public WITH CHECK ((author_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages threads" ON public.note_threads AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Thread authors and space members can view threads" ON public.note_threads AS PERMISSIVE FOR SELECT TO public USING (((author_id = (auth.jwt() ->> 'sub'::text)) OR (EXISTS ( SELECT 1
   FROM olive_space_members sm
  WHERE ((sm.space_id = note_threads.space_id) AND (sm.user_id = (auth.jwt() ->> 'sub'::text))))) OR (EXISTS ( SELECT 1
   FROM clerk_notes n
  WHERE ((n.id = note_threads.note_id) AND (n.author_id = (auth.jwt() ->> 'sub'::text)))))));
CREATE POLICY "Thread authors can delete their threads" ON public.note_threads AS PERMISSIVE FOR DELETE TO public USING ((author_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Thread authors can update their threads" ON public.note_threads AS PERMISSIVE FOR UPDATE TO public USING ((author_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Members can delete notes in their couples" ON public.notes AS PERMISSIVE FOR DELETE TO public USING ((EXISTS ( SELECT 1
   FROM couple_members m
  WHERE ((m.couple_id = notes.couple_id) AND (m.user_id = auth.uid())))));
CREATE POLICY "Members can insert notes in their couples" ON public.notes AS PERMISSIVE FOR INSERT TO public WITH CHECK (((EXISTS ( SELECT 1
   FROM couple_members m
  WHERE ((m.couple_id = notes.couple_id) AND (m.user_id = auth.uid())))) AND (author_id = auth.uid())));
CREATE POLICY "Members can update notes in their couples" ON public.notes AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM couple_members m
  WHERE ((m.couple_id = notes.couple_id) AND (m.user_id = auth.uid())))));
CREATE POLICY "Members can view notes in their couples" ON public.notes AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM couple_members m
  WHERE ((m.couple_id = notes.couple_id) AND (m.user_id = auth.uid())))));
CREATE POLICY notifications_delete_own ON public.notifications AS PERMISSIVE FOR DELETE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY notifications_insert ON public.notifications AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY notifications_select_own ON public.notifications AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY notifications_update_own ON public.notifications AS PERMISSIVE FOR UPDATE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages agent executions" ON public.olive_agent_executions AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see own agent executions" ON public.olive_agent_executions AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_agent_runs_delete_own ON public.olive_agent_runs AS PERMISSIVE FOR DELETE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_agent_runs_insert_own ON public.olive_agent_runs AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_agent_runs_select_own ON public.olive_agent_runs AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_agent_runs_update_own ON public.olive_agent_runs AS PERMISSIVE FOR UPDATE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages briefings" ON public.olive_briefings AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see own briefings" ON public.olive_briefings AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_chat_sessions_user ON public.olive_chat_sessions AS PERMISSIVE FOR ALL TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages client activity" ON public.olive_client_activity AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Space members see client activity" ON public.olive_client_activity AS PERMISSIVE FOR SELECT TO public USING ((client_id IN ( SELECT olive_clients.id
   FROM olive_clients
  WHERE (olive_clients.space_id IN ( SELECT olive_space_members.space_id
           FROM olive_space_members
          WHERE (olive_space_members.user_id = (auth.jwt() ->> 'sub'::text)))))));
CREATE POLICY "Service role manages clients" ON public.olive_clients AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Space members see clients" ON public.olive_clients AS PERMISSIVE FOR SELECT TO public USING ((space_id IN ( SELECT olive_space_members.space_id
   FROM olive_space_members
  WHERE (olive_space_members.user_id = (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY "Service role manages conflicts" ON public.olive_conflicts AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Space members see conflicts" ON public.olive_conflicts AS PERMISSIVE FOR SELECT TO public USING ((space_id IN ( SELECT olive_space_members.space_id
   FROM olive_space_members
  WHERE (olive_space_members.user_id = (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY "Service role manages consolidation runs" ON public.olive_consolidation_runs AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see own consolidation runs" ON public.olive_consolidation_runs AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Users can delete their own conversations" ON public.olive_conversations AS PERMISSIVE FOR DELETE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Users can insert their own conversations" ON public.olive_conversations AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Users can update their own conversations" ON public.olive_conversations AS PERMISSIVE FOR UPDATE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Users can view their own conversations" ON public.olive_conversations AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages insights" ON public.olive_cross_space_insights AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see own insights" ON public.olive_cross_space_insights AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages decisions" ON public.olive_decisions AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Space members see decisions" ON public.olive_decisions AS PERMISSIVE FOR SELECT TO public USING ((space_id IN ( SELECT olive_space_members.space_id
   FROM olive_space_members
  WHERE (olive_space_members.user_id = (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY "Service role manages delegations" ON public.olive_delegations AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users can create delegations in their spaces" ON public.olive_delegations AS PERMISSIVE FOR INSERT TO public WITH CHECK ((delegated_by = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Users can update delegations assigned to them" ON public.olive_delegations AS PERMISSIVE FOR UPDATE TO public USING (((delegated_to = (auth.jwt() ->> 'sub'::text)) OR (reassigned_to = (auth.jwt() ->> 'sub'::text))));
CREATE POLICY "Users see delegations they're involved in" ON public.olive_delegations AS PERMISSIVE FOR SELECT TO public USING (((delegated_by = (auth.jwt() ->> 'sub'::text)) OR (delegated_to = (auth.jwt() ->> 'sub'::text)) OR (reassigned_to = (auth.jwt() ->> 'sub'::text))));
CREATE POLICY olive_email_connections_delete_own ON public.olive_email_connections AS PERMISSIVE FOR DELETE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_email_connections_insert_own ON public.olive_email_connections AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_email_connections_select_own ON public.olive_email_connections AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_email_connections_update_own ON public.olive_email_connections AS PERMISSIVE FOR UPDATE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages engagement events" ON public.olive_engagement_events AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see own engagement events" ON public.olive_engagement_events AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages engagement" ON public.olive_engagement_metrics AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see own engagement" ON public.olive_engagement_metrics AS PERMISSIVE FOR SELECT TO public USING ((user_id = ( SELECT (auth.uid())::text AS uid)));
CREATE POLICY olive_entities_user_policy ON public.olive_entities AS PERMISSIVE FOR ALL TO public USING (((user_id = (auth.jwt() ->> 'sub'::text)) OR (couple_id IN ( SELECT clerk_couple_members.couple_id
   FROM clerk_couple_members
  WHERE (clerk_couple_members.user_id = (auth.jwt() ->> 'sub'::text))))));
CREATE POLICY olive_entity_communities_user_policy ON public.olive_entity_communities AS PERMISSIVE FOR ALL TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages split shares" ON public.olive_expense_split_shares AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see own split shares" ON public.olive_expense_split_shares AS PERMISSIVE FOR SELECT TO public USING (((user_id = (auth.jwt() ->> 'sub'::text)) OR (split_id IN ( SELECT olive_expense_splits.id
   FROM olive_expense_splits
  WHERE (olive_expense_splits.space_id IN ( SELECT olive_space_members.space_id
           FROM olive_space_members
          WHERE (olive_space_members.user_id = (auth.jwt() ->> 'sub'::text))))))));
CREATE POLICY "Service role manages expense splits" ON public.olive_expense_splits AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Space members see expense splits" ON public.olive_expense_splits AS PERMISSIVE FOR SELECT TO public USING ((space_id IN ( SELECT olive_space_members.space_id
   FROM olive_space_members
  WHERE (olive_space_members.user_id = (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY olive_gateway_sessions_user ON public.olive_gateway_sessions AS PERMISSIVE FOR ALL TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_heartbeat_jobs_user ON public.olive_heartbeat_jobs AS PERMISSIVE FOR ALL TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_heartbeat_log_user ON public.olive_heartbeat_log AS PERMISSIVE FOR ALL TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Anyone can read industry templates" ON public.olive_industry_templates AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Service role manages industry templates" ON public.olive_industry_templates AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY olive_memory_chunks_user ON public.olive_memory_chunks AS PERMISSIVE FOR ALL TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_memory_contradictions_delete ON public.olive_memory_contradictions AS PERMISSIVE FOR DELETE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_memory_contradictions_insert ON public.olive_memory_contradictions AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_memory_contradictions_select ON public.olive_memory_contradictions AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_memory_contradictions_update ON public.olive_memory_contradictions AS PERMISSIVE FOR UPDATE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_memory_files_user ON public.olive_memory_files AS PERMISSIVE FOR ALL TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_memory_maintenance_log_delete ON public.olive_memory_maintenance_log AS PERMISSIVE FOR DELETE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_memory_maintenance_log_insert ON public.olive_memory_maintenance_log AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_memory_maintenance_log_select ON public.olive_memory_maintenance_log AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_memory_maintenance_log_update ON public.olive_memory_maintenance_log AS PERMISSIVE FOR UPDATE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages memory relevance" ON public.olive_memory_relevance AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see own memory relevance" ON public.olive_memory_relevance AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_outbound_queue_user ON public.olive_outbound_queue AS PERMISSIVE FOR ALL TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_patterns_user ON public.olive_patterns AS PERMISSIVE FOR ALL TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages poll votes" ON public.olive_poll_votes AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Space members see poll votes" ON public.olive_poll_votes AS PERMISSIVE FOR SELECT TO public USING ((poll_id IN ( SELECT olive_polls.id
   FROM olive_polls
  WHERE (olive_polls.space_id IN ( SELECT olive_space_members.space_id
           FROM olive_space_members
          WHERE (olive_space_members.user_id = (auth.jwt() ->> 'sub'::text)))))));
CREATE POLICY "Service role manages polls" ON public.olive_polls AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Space members see polls" ON public.olive_polls AS PERMISSIVE FOR SELECT TO public USING ((space_id IN ( SELECT olive_space_members.space_id
   FROM olive_space_members
  WHERE (olive_space_members.user_id = (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY "Anyone can read pricing plans" ON public.olive_pricing_plans AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Service role manages pricing plans" ON public.olive_pricing_plans AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Service role manages reflections" ON public.olive_reflections AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see own reflections" ON public.olive_reflections AS PERMISSIVE FOR SELECT TO public USING ((user_id = ( SELECT (auth.uid())::text AS uid)));
CREATE POLICY olive_relationships_user_policy ON public.olive_relationships AS PERMISSIVE FOR ALL TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_router_log_insert ON public.olive_router_log AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_router_log_select ON public.olive_router_log AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_skills_read ON public.olive_skills AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Service role manages soul evolution log" ON public.olive_soul_evolution_log AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see own soul evolution log" ON public.olive_soul_evolution_log AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages soul layers" ON public.olive_soul_layers AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see base and own soul layers" ON public.olive_soul_layers AS PERMISSIVE FOR SELECT TO public USING (((owner_type = 'system'::text) OR (owner_id = ( SELECT (auth.uid())::text AS uid))));
CREATE POLICY "Service role manages soul rollbacks" ON public.olive_soul_rollbacks AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users can create own soul rollbacks" ON public.olive_soul_rollbacks AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Users see own soul rollbacks" ON public.olive_soul_rollbacks AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages soul versions" ON public.olive_soul_versions AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see own soul versions" ON public.olive_soul_versions AS PERMISSIVE FOR SELECT TO public USING ((layer_id IN ( SELECT olive_soul_layers.id
   FROM olive_soul_layers
  WHERE ((olive_soul_layers.owner_type = 'system'::text) OR (olive_soul_layers.owner_id = ( SELECT (auth.uid())::text AS uid))))));
CREATE POLICY "Admins can create space invites" ON public.olive_space_invites AS PERMISSIVE FOR INSERT TO public WITH CHECK (is_space_member(space_id, (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Members can see space invites" ON public.olive_space_invites AS PERMISSIVE FOR SELECT TO public USING (((invited_by = (auth.jwt() ->> 'sub'::text)) OR is_space_member(space_id, (auth.jwt() ->> 'sub'::text))));
CREATE POLICY "Service role manages space invites" ON public.olive_space_invites AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Admins can add space members" ON public.olive_space_members AS PERMISSIVE FOR INSERT TO public WITH CHECK (((EXISTS ( SELECT 1
   FROM olive_space_members sm
  WHERE ((sm.space_id = olive_space_members.space_id) AND (sm.user_id = (auth.jwt() ->> 'sub'::text)) AND (sm.role = ANY (ARRAY['owner'::space_role, 'admin'::space_role]))))) OR (user_id = (auth.jwt() ->> 'sub'::text))));
CREATE POLICY "Owners can remove space members" ON public.olive_space_members AS PERMISSIVE FOR DELETE TO public USING (((EXISTS ( SELECT 1
   FROM olive_space_members sm
  WHERE ((sm.space_id = olive_space_members.space_id) AND (sm.user_id = (auth.jwt() ->> 'sub'::text)) AND (sm.role = 'owner'::space_role)))) OR (user_id = (auth.jwt() ->> 'sub'::text))));
CREATE POLICY "Service role manages space members" ON public.olive_space_members AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see own space memberships" ON public.olive_space_members AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages space templates" ON public.olive_space_templates AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Space members see applied templates" ON public.olive_space_templates AS PERMISSIVE FOR SELECT TO public USING ((space_id IN ( SELECT olive_space_members.space_id
   FROM olive_space_members
  WHERE (olive_space_members.user_id = (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY "Members can view their spaces" ON public.olive_spaces AS PERMISSIVE FOR SELECT TO public USING (((EXISTS ( SELECT 1
   FROM olive_space_members sm
  WHERE ((sm.space_id = olive_spaces.id) AND (sm.user_id = (auth.jwt() ->> 'sub'::text))))) OR (created_by = (auth.jwt() ->> 'sub'::text))));
CREATE POLICY "Owners can delete their spaces" ON public.olive_spaces AS PERMISSIVE FOR DELETE TO public USING ((EXISTS ( SELECT 1
   FROM olive_space_members sm
  WHERE ((sm.space_id = olive_spaces.id) AND (sm.user_id = (auth.jwt() ->> 'sub'::text)) AND (sm.role = 'owner'::space_role)))));
CREATE POLICY "Owners can update their spaces" ON public.olive_spaces AS PERMISSIVE FOR UPDATE TO public USING ((EXISTS ( SELECT 1
   FROM olive_space_members sm
  WHERE ((sm.space_id = olive_spaces.id) AND (sm.user_id = (auth.jwt() ->> 'sub'::text)) AND (sm.role = 'owner'::space_role)))));
CREATE POLICY "Service role manages spaces" ON public.olive_spaces AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users can create spaces" ON public.olive_spaces AS PERMISSIVE FOR INSERT TO public WITH CHECK ((created_by = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages subscriptions" ON public.olive_subscriptions AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see own subscriptions" ON public.olive_subscriptions AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages trust actions" ON public.olive_trust_actions AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users can update own trust actions" ON public.olive_trust_actions AS PERMISSIVE FOR UPDATE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Users see own trust actions" ON public.olive_trust_actions AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages trust notifications" ON public.olive_trust_notifications AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users can update own trust notifications" ON public.olive_trust_notifications AS PERMISSIVE FOR UPDATE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Users see own trust notifications" ON public.olive_trust_notifications AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages usage meters" ON public.olive_usage_meters AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Users see own usage" ON public.olive_usage_meters AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_user_preferences_user ON public.olive_user_preferences AS PERMISSIVE FOR ALL TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY olive_user_skills_user ON public.olive_user_skills AS PERMISSIVE FOR ALL TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Service role manages workflow instances" ON public.olive_workflow_instances AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Space members see workflow instances" ON public.olive_workflow_instances AS PERMISSIVE FOR SELECT TO public USING ((space_id IN ( SELECT olive_space_members.space_id
   FROM olive_space_members
  WHERE (olive_space_members.user_id = (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY "Service role manages workflow runs" ON public.olive_workflow_runs AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Space members see workflow runs" ON public.olive_workflow_runs AS PERMISSIVE FOR SELECT TO public USING ((space_id IN ( SELECT olive_space_members.space_id
   FROM olive_space_members
  WHERE (olive_space_members.user_id = (auth.jwt() ->> 'sub'::text)))));
CREATE POLICY "Anyone can read workflow templates" ON public.olive_workflow_templates AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "Service role manages workflow templates" ON public.olive_workflow_templates AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY oura_connections_delete_own ON public.oura_connections AS PERMISSIVE FOR DELETE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY oura_connections_insert_own ON public.oura_connections AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY oura_connections_select_own ON public.oura_connections AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY oura_connections_update_own ON public.oura_connections AS PERMISSIVE FOR UPDATE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY oura_daily_data_delete ON public.oura_daily_data AS PERMISSIVE FOR DELETE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY oura_daily_data_insert ON public.oura_daily_data AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY oura_daily_data_select ON public.oura_daily_data AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY oura_daily_data_update ON public.oura_daily_data AS PERMISSIVE FOR UPDATE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Profiles are viewable by owner" ON public.profiles AS PERMISSIVE FOR SELECT TO public USING ((id = auth.uid()));
CREATE POLICY "Users can insert own profile" ON public.profiles AS PERMISSIVE FOR INSERT TO public WITH CHECK ((id = auth.uid()));
CREATE POLICY "Users can update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING ((id = auth.uid()));
CREATE POLICY "Service role manages activity" ON public.space_activity AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Space members can view activity" ON public.space_activity AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM olive_space_members sm
  WHERE ((sm.space_id = space_activity.space_id) AND (sm.user_id = (auth.jwt() ->> 'sub'::text))))));
CREATE POLICY user_memories_delete ON public.user_memories AS PERMISSIVE FOR DELETE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY user_memories_insert ON public.user_memories AS PERMISSIVE FOR INSERT TO public WITH CHECK ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY user_memories_insert_couple ON public.user_memories AS PERMISSIVE FOR INSERT TO public WITH CHECK (((couple_id IS NOT NULL) AND (user_id = (auth.jwt() ->> 'sub'::text)) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text))));
CREATE POLICY user_memories_select ON public.user_memories AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY user_memories_select_couple ON public.user_memories AS PERMISSIVE FOR SELECT TO public USING (((couple_id IS NOT NULL) AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text))));
CREATE POLICY user_memories_update ON public.user_memories AS PERMISSIVE FOR UPDATE TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY users_read_own_roles ON public.user_roles AS PERMISSIVE FOR SELECT TO public USING ((user_id = (auth.jwt() ->> 'sub'::text)));
CREATE POLICY "Users can insert their own sessions" ON public.user_sessions AS PERMISSIVE FOR INSERT TO public WITH CHECK (((auth.uid())::text = user_id));
CREATE POLICY "Users can update their own sessions" ON public.user_sessions AS PERMISSIVE FOR UPDATE TO public USING (((auth.uid())::text = user_id));
CREATE POLICY "Users can view their own sessions" ON public.user_sessions AS PERMISSIVE FOR SELECT TO public USING (((auth.uid())::text = user_id));
