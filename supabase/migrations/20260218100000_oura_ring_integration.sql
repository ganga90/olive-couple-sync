-- Oura Ring Integration: OAuth connections and daily health data
-- Pattern: Cloned from calendar_connections / calendar_events schema

-- ============================================================================
-- oura_connections: Stores OAuth tokens and connection state
-- ============================================================================
CREATE TABLE IF NOT EXISTS oura_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id UUID REFERENCES clerk_couples(id) ON DELETE SET NULL,

  -- OAuth Tokens
  oura_user_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMP WITH TIME ZONE,

  -- Sync Configuration
  sync_enabled BOOLEAN DEFAULT true,
  last_sync_time TIMESTAMP WITH TIME ZONE,

  -- Status
  is_active BOOLEAN DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- One connection per user
  UNIQUE(user_id)
);

-- Indexes
CREATE INDEX idx_oura_connections_user ON oura_connections(user_id);
CREATE INDEX idx_oura_connections_active ON oura_connections(user_id, is_active);

-- Enable RLS
ALTER TABLE oura_connections ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Only the token owner can access their connection
-- (Same pattern as calendar_connections after the security fix)
CREATE POLICY "oura_connections_select_own"
  ON oura_connections FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "oura_connections_insert"
  ON oura_connections FOR INSERT
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "oura_connections_update"
  ON oura_connections FOR UPDATE
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "oura_connections_delete"
  ON oura_connections FOR DELETE
  USING (user_id = (auth.jwt() ->> 'sub'));

-- ============================================================================
-- oura_daily_data: Synced daily sleep, readiness, and activity scores
-- ============================================================================
CREATE TABLE IF NOT EXISTS oura_daily_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES oura_connections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  day DATE NOT NULL,

  -- Sleep Data
  sleep_score INTEGER,
  sleep_duration_seconds INTEGER,
  sleep_efficiency INTEGER,
  deep_sleep_seconds INTEGER,
  rem_sleep_seconds INTEGER,
  light_sleep_seconds INTEGER,
  awake_seconds INTEGER,
  sleep_latency_seconds INTEGER,
  bedtime_start TIMESTAMP WITH TIME ZONE,
  bedtime_end TIMESTAMP WITH TIME ZONE,

  -- Readiness Data
  readiness_score INTEGER,
  readiness_temperature_deviation REAL,
  readiness_hrv_balance INTEGER,
  readiness_resting_heart_rate INTEGER,

  -- Activity Data
  activity_score INTEGER,
  steps INTEGER,
  active_calories INTEGER,
  total_calories INTEGER,
  active_minutes INTEGER,
  sedentary_minutes INTEGER,

  -- Raw API response for future use
  raw_data JSONB,
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

  -- One entry per user per day
  UNIQUE(user_id, day)
);

-- Indexes
CREATE INDEX idx_oura_daily_data_connection ON oura_daily_data(connection_id);
CREATE INDEX idx_oura_daily_data_user_day ON oura_daily_data(user_id, day);
CREATE INDEX idx_oura_daily_data_day ON oura_daily_data(day);

-- Enable RLS
ALTER TABLE oura_daily_data ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "oura_daily_data_select"
  ON oura_daily_data FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "oura_daily_data_insert"
  ON oura_daily_data FOR INSERT
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "oura_daily_data_update"
  ON oura_daily_data FOR UPDATE
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "oura_daily_data_delete"
  ON oura_daily_data FOR DELETE
  USING (user_id = (auth.jwt() ->> 'sub'));

-- Updated_at trigger for oura_connections
CREATE TRIGGER update_oura_connections_updated_at
  BEFORE UPDATE ON oura_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
