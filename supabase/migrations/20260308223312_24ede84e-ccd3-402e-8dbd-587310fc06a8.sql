
-- ============================================================================
-- EXPENSES FEATURE: Core Tables
-- ============================================================================

-- Expense split types
CREATE TYPE public.expense_split_type AS ENUM (
  'you_paid_split',      -- You paid, split equally (partner owes half)
  'you_owed_full',       -- You paid, partner owes full amount
  'partner_paid_split',  -- Partner paid, split equally (you owe half)
  'partner_owed_full',   -- Partner paid, you owe full amount
  'individual'           -- No splitting, individual expense
);

-- Main expenses table
CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  couple_id uuid REFERENCES public.clerk_couples(id) ON DELETE SET NULL,
  note_id uuid REFERENCES public.clerk_notes(id) ON DELETE SET NULL,
  
  -- Expense data
  name text NOT NULL,
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  category text NOT NULL DEFAULT 'Other',
  category_icon text DEFAULT '📄',
  
  -- Split logic
  split_type public.expense_split_type NOT NULL DEFAULT 'individual',
  paid_by text NOT NULL, -- user_id of who paid
  
  -- Privacy
  is_shared boolean NOT NULL DEFAULT false,
  
  -- Settlement
  is_settled boolean NOT NULL DEFAULT false,
  settled_at timestamptz,
  settlement_id uuid,
  
  -- Media
  receipt_url text,
  
  -- Metadata
  expense_date timestamptz NOT NULL DEFAULT now(),
  original_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Settlements table (for batch settlement)
CREATE TABLE public.expense_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid REFERENCES public.clerk_couples(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  settled_by text NOT NULL,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  expense_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add foreign key from expenses to settlements
ALTER TABLE public.expenses 
  ADD CONSTRAINT expenses_settlement_id_fkey 
  FOREIGN KEY (settlement_id) REFERENCES public.expense_settlements(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX idx_expenses_user_id ON public.expenses(user_id);
CREATE INDEX idx_expenses_couple_id ON public.expenses(couple_id);
CREATE INDEX idx_expenses_note_id ON public.expenses(note_id);
CREATE INDEX idx_expenses_is_settled ON public.expenses(is_settled);
CREATE INDEX idx_expenses_expense_date ON public.expenses(expense_date);
CREATE INDEX idx_expenses_category ON public.expenses(category);

-- Enable RLS
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_settlements ENABLE ROW LEVEL SECURITY;

-- RLS policies for expenses
CREATE POLICY "expenses_select" ON public.expenses FOR SELECT
  USING (
    (user_id = (auth.jwt() ->> 'sub'::text) AND couple_id IS NULL)
    OR (couple_id IS NOT NULL AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)))
  );

CREATE POLICY "expenses_insert" ON public.expenses FOR INSERT
  WITH CHECK (
    user_id = (auth.jwt() ->> 'sub'::text)
    AND (couple_id IS NULL OR is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)))
  );

CREATE POLICY "expenses_update" ON public.expenses FOR UPDATE
  USING (
    (user_id = (auth.jwt() ->> 'sub'::text) AND couple_id IS NULL)
    OR (couple_id IS NOT NULL AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)))
  );

CREATE POLICY "expenses_delete" ON public.expenses FOR DELETE
  USING (
    (user_id = (auth.jwt() ->> 'sub'::text) AND couple_id IS NULL)
    OR (couple_id IS NOT NULL AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)))
  );

-- RLS policies for settlements
CREATE POLICY "settlements_select" ON public.expense_settlements FOR SELECT
  USING (
    user_id = (auth.jwt() ->> 'sub'::text)
    OR (couple_id IS NOT NULL AND is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)))
  );

CREATE POLICY "settlements_insert" ON public.expense_settlements FOR INSERT
  WITH CHECK (
    settled_by = (auth.jwt() ->> 'sub'::text)
    AND (couple_id IS NULL OR is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub'::text)))
  );

-- Updated_at trigger for expenses
CREATE TRIGGER set_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Add expense tracking preference to clerk_profiles (individual vs shared default)
ALTER TABLE public.clerk_profiles 
  ADD COLUMN IF NOT EXISTS expense_tracking_mode text DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS expense_default_split text DEFAULT 'you_paid_split',
  ADD COLUMN IF NOT EXISTS expense_default_currency text DEFAULT 'USD';
