-- Fix token column type in clerk_invites (should be text, not uuid for the functions)
ALTER TABLE public.clerk_invites ALTER COLUMN token TYPE text;

-- Ensure role column exists with proper name (not member_role)
DO $$
BEGIN
  -- Check if role column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema='public' AND table_name='clerk_invites' AND column_name='role'
  ) THEN
    -- Add role column
    ALTER TABLE public.clerk_invites ADD COLUMN role public.member_role NOT NULL DEFAULT 'partner';
    
    -- If member_role column exists, copy data and drop it
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema='public' AND table_name='clerk_invites' AND column_name='member_role'
    ) THEN
      UPDATE public.clerk_invites SET role = member_role::public.member_role;
      ALTER TABLE public.clerk_invites DROP COLUMN member_role;
    END IF;
  END IF;
END $$;