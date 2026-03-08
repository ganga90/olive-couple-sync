
-- Budget limits per category
CREATE TABLE public.expense_budget_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  couple_id uuid REFERENCES public.clerk_couples(id) ON DELETE CASCADE,
  category text NOT NULL,
  monthly_limit numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, category)
);

ALTER TABLE public.expense_budget_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "budget_limits_select" ON public.expense_budget_limits
  FOR SELECT TO authenticated
  USING (
    user_id = (auth.jwt() ->> 'sub'::text)
    OR (couple_id IS NOT NULL AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)))
  );

CREATE POLICY "budget_limits_insert" ON public.expense_budget_limits
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'::text));

CREATE POLICY "budget_limits_update" ON public.expense_budget_limits
  FOR UPDATE TO authenticated
  USING (user_id = (auth.jwt() ->> 'sub'::text));

CREATE POLICY "budget_limits_delete" ON public.expense_budget_limits
  FOR DELETE TO authenticated
  USING (user_id = (auth.jwt() ->> 'sub'::text));
