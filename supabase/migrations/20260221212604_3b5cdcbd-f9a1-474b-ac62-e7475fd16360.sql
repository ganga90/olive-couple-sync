
-- Table to store beta feedback and access requests
CREATE TABLE public.beta_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL DEFAULT 'general',
  message text NOT NULL,
  contact_email text,
  user_name text,
  user_id text,
  page text,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- RLS: service role only (edge function writes, no direct user access needed)
ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert (for logged-in feedback)
CREATE POLICY "Anyone can insert feedback"
ON public.beta_feedback
FOR INSERT
WITH CHECK (true);

-- Only service role can read (admin dashboard later)
CREATE POLICY "Service role can read feedback"
ON public.beta_feedback
FOR SELECT
USING (false);
