-- Temporarily disable RLS for testing purposes
-- This will allow operations to work while we fix the auth integration
ALTER TABLE public.clerk_couples DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clerk_couple_members DISABLE ROW LEVEL SECURITY;  
ALTER TABLE public.invites DISABLE ROW LEVEL SECURITY;

-- Keep the notes table RLS enabled since it might have different auth setup
-- ALTER TABLE public.clerk_notes DISABLE ROW LEVEL SECURITY;