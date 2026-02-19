-- Add stress and resilience data columns to oura_daily_data
-- These come from Oura API v2 /daily_stress and /daily_resilience endpoints

-- Stress columns (from /v2/usercollection/daily_stress)
ALTER TABLE oura_daily_data ADD COLUMN IF NOT EXISTS stress_high_minutes INTEGER;
ALTER TABLE oura_daily_data ADD COLUMN IF NOT EXISTS recovery_high_minutes INTEGER;
ALTER TABLE oura_daily_data ADD COLUMN IF NOT EXISTS stress_day_summary TEXT;  -- 'stressed' | 'restored' | 'normal'

-- Resilience columns (from /v2/usercollection/daily_resilience)
ALTER TABLE oura_daily_data ADD COLUMN IF NOT EXISTS resilience_level TEXT;  -- 'limited' | 'adequate' | 'solid' | 'strong' | 'exceptional'
ALTER TABLE oura_daily_data ADD COLUMN IF NOT EXISTS resilience_sleep_recovery NUMERIC;
ALTER TABLE oura_daily_data ADD COLUMN IF NOT EXISTS resilience_daytime_recovery NUMERIC;

-- Partner wellness sharing opt-in (privacy-first: default OFF)
ALTER TABLE oura_connections ADD COLUMN IF NOT EXISTS share_wellness_with_partner BOOLEAN DEFAULT false;
