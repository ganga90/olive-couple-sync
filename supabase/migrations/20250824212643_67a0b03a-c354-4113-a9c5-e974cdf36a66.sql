-- Re-enable Row Level Security on all tables

-- Enable RLS on clerk_couples
ALTER TABLE clerk_couples ENABLE ROW LEVEL SECURITY;

-- Enable RLS on clerk_couple_members  
ALTER TABLE clerk_couple_members ENABLE ROW LEVEL SECURITY;

-- Enable RLS on clerk_notes
ALTER TABLE clerk_notes ENABLE ROW LEVEL SECURITY;

-- Enable RLS on clerk_lists
ALTER TABLE clerk_lists ENABLE ROW LEVEL SECURITY;

-- Enable RLS on invites
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;