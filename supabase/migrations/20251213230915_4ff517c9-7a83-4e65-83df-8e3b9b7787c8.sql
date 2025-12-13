-- Calendar Connections table for storing Google Calendar OAuth tokens
CREATE TABLE calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id UUID REFERENCES clerk_couples(id) ON DELETE SET NULL,
  
  -- OAuth Tokens (stored securely)
  google_user_id TEXT NOT NULL,
  google_email TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMP WITH TIME ZONE,
  
  -- Calendar Info
  primary_calendar_id TEXT NOT NULL,
  calendar_name TEXT,
  calendar_type TEXT CHECK (calendar_type IN ('individual', 'couple')) DEFAULT 'individual',
  
  -- Sync Configuration
  sync_enabled BOOLEAN DEFAULT true,
  sync_direction TEXT CHECK (sync_direction IN ('read', 'write', 'both')) DEFAULT 'both',
  auto_create_events BOOLEAN DEFAULT true,
  last_sync_time TIMESTAMP WITH TIME ZONE,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint per user
  UNIQUE(user_id)
);

-- Indexes
CREATE INDEX idx_calendar_connections_user ON calendar_connections(user_id);
CREATE INDEX idx_calendar_connections_couple ON calendar_connections(couple_id);
CREATE INDEX idx_calendar_connections_active ON calendar_connections(user_id, is_active);

-- Enable RLS
ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;

-- RLS Policies using Clerk JWT
CREATE POLICY "calendar_connections_select" ON calendar_connections
  FOR SELECT USING (
    user_id = (auth.jwt() ->> 'sub') OR 
    (couple_id IS NOT NULL AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub')))
  );

CREATE POLICY "calendar_connections_insert" ON calendar_connections
  FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "calendar_connections_update" ON calendar_connections
  FOR UPDATE USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "calendar_connections_delete" ON calendar_connections
  FOR DELETE USING (user_id = (auth.jwt() ->> 'sub'));

-- Calendar Events table (synced from Google Calendar)
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  google_event_id TEXT NOT NULL,
  
  -- Event Details
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  all_day BOOLEAN DEFAULT false,
  timezone TEXT DEFAULT 'UTC',
  
  -- Event Origin
  event_type TEXT CHECK (event_type IN ('from_note', 'from_calendar', 'manual')) DEFAULT 'from_calendar',
  note_id UUID REFERENCES clerk_notes(id) ON DELETE SET NULL,
  
  -- Sync Metadata
  etag TEXT,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_synced BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(google_event_id)
);

-- Indexes
CREATE INDEX idx_calendar_events_connection ON calendar_events(connection_id);
CREATE INDEX idx_calendar_events_google_id ON calendar_events(google_event_id);
CREATE INDEX idx_calendar_events_start_time ON calendar_events(start_time);
CREATE INDEX idx_calendar_events_note ON calendar_events(note_id);

-- Enable RLS
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "calendar_events_select" ON calendar_events
  FOR SELECT USING (
    connection_id IN (
      SELECT id FROM calendar_connections 
      WHERE user_id = (auth.jwt() ->> 'sub') 
      OR (couple_id IS NOT NULL AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub')))
    )
  );

CREATE POLICY "calendar_events_insert" ON calendar_events
  FOR INSERT WITH CHECK (
    connection_id IN (SELECT id FROM calendar_connections WHERE user_id = (auth.jwt() ->> 'sub'))
  );

CREATE POLICY "calendar_events_update" ON calendar_events
  FOR UPDATE USING (
    connection_id IN (SELECT id FROM calendar_connections WHERE user_id = (auth.jwt() ->> 'sub'))
  );

CREATE POLICY "calendar_events_delete" ON calendar_events
  FOR DELETE USING (
    connection_id IN (SELECT id FROM calendar_connections WHERE user_id = (auth.jwt() ->> 'sub'))
  );

-- Sync State Tracking
CREATE TABLE calendar_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL UNIQUE REFERENCES calendar_connections(id) ON DELETE CASCADE,
  
  sync_token TEXT,
  last_sync_time TIMESTAMP WITH TIME ZONE,
  sync_status TEXT CHECK (sync_status IN ('idle', 'syncing', 'error')) DEFAULT 'idle',
  error_message TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE calendar_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calendar_sync_state_all" ON calendar_sync_state
  FOR ALL USING (
    connection_id IN (SELECT id FROM calendar_connections WHERE user_id = (auth.jwt() ->> 'sub'))
  );

-- Trigger for updated_at
CREATE TRIGGER update_calendar_connections_updated_at
  BEFORE UPDATE ON calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER update_calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER update_calendar_sync_state_updated_at
  BEFORE UPDATE ON calendar_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();