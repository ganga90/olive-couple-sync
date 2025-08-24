-- Re-enable RLS on all tables now that we've identified the issue
ALTER TABLE clerk_couples ENABLE ROW LEVEL SECURITY;
ALTER TABLE clerk_couple_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE clerk_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE clerk_lists ENABLE ROW LEVEL SECURITY;

-- Remove the temporary debugging comments
COMMENT ON TABLE clerk_couples IS NULL;
COMMENT ON TABLE clerk_couple_members IS NULL;
COMMENT ON TABLE invites IS NULL;
COMMENT ON TABLE clerk_notes IS NULL;
COMMENT ON TABLE clerk_lists IS NULL;