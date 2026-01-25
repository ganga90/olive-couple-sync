-- Create memory_insights table for holding proposed memories
CREATE TABLE public.memory_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  suggested_content text NOT NULL,
  source text DEFAULT 'analysis_agent',
  confidence_score float,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.memory_insights ENABLE ROW LEVEL SECURITY;

-- RLS policies for memory_insights
CREATE POLICY "memory_insights_select" ON public.memory_insights
  FOR SELECT USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "memory_insights_insert" ON public.memory_insights
  FOR INSERT WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "memory_insights_update" ON public.memory_insights
  FOR UPDATE USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "memory_insights_delete" ON public.memory_insights
  FOR DELETE USING (user_id = (auth.jwt() ->> 'sub'));

-- Add index for faster queries
CREATE INDEX idx_memory_insights_user_status ON public.memory_insights(user_id, status);