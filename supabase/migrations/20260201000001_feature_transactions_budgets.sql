-- ============================================================================
-- FEATURE 1: Context-Aware Receipt Hunter - Database Schema
-- ============================================================================
-- Tables for tracking transactions from receipts and managing budgets
-- ============================================================================

-- Enable required extensions (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- TRANSACTIONS TABLE
-- Stores parsed receipt data with budget status tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id UUID REFERENCES public.clerk_couples(id) ON DELETE SET NULL,

  -- Core transaction data
  amount NUMERIC(12, 2) NOT NULL,
  merchant TEXT NOT NULL,
  category TEXT NOT NULL,
  transaction_date TIMESTAMPTZ NOT NULL,

  -- Source tracking
  image_url TEXT,
  source_note_id UUID REFERENCES public.clerk_notes(id) ON DELETE SET NULL,

  -- Budget tracking
  budget_status TEXT DEFAULT 'ok' CHECK (budget_status IN ('ok', 'warning', 'over_limit')),

  -- Extended data
  line_items JSONB DEFAULT '[]',  -- [{name, quantity, price}]
  payment_method TEXT,
  confidence NUMERIC(3, 2),  -- 0.00 to 1.00

  -- Metadata for AI extraction details
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_couple_id ON public.transactions(couple_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON public.transactions(category);
CREATE INDEX IF NOT EXISTS idx_transactions_user_category ON public.transactions(user_id, category);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON public.transactions(user_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_budget_status ON public.transactions(budget_status) WHERE budget_status != 'ok';

-- ============================================================================
-- BUDGETS TABLE
-- User-defined spending limits by category
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id UUID REFERENCES public.clerk_couples(id) ON DELETE SET NULL,

  -- Budget definition
  category TEXT NOT NULL,
  limit_amount NUMERIC(12, 2) NOT NULL,
  period TEXT DEFAULT 'monthly' CHECK (period IN ('weekly', 'monthly', 'yearly')),

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure unique budget per user/category/period combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_user_category_period
  ON public.budgets(user_id, category, period)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_budgets_user_active ON public.budgets(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_budgets_couple ON public.budgets(couple_id) WHERE couple_id IS NOT NULL;

-- ============================================================================
-- ROW LEVEL SECURITY - TRANSACTIONS
-- ============================================================================
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Users can view their own transactions or couple transactions
CREATE POLICY "transactions.select" ON public.transactions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  );

-- Users can insert their own transactions
CREATE POLICY "transactions.insert" ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.jwt()->>'sub');

-- Users can update their own transactions or couple transactions
CREATE POLICY "transactions.update" ON public.transactions
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  )
  WITH CHECK (
    user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  );

-- Users can delete their own transactions
CREATE POLICY "transactions.delete" ON public.transactions
  FOR DELETE TO authenticated
  USING (user_id = auth.jwt()->>'sub');

-- ============================================================================
-- ROW LEVEL SECURITY - BUDGETS
-- ============================================================================
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

-- Users can view their own budgets or couple budgets
CREATE POLICY "budgets.select" ON public.budgets
  FOR SELECT TO authenticated
  USING (
    user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  );

-- Users can insert their own budgets
CREATE POLICY "budgets.insert" ON public.budgets
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.jwt()->>'sub');

-- Users can update their own budgets or couple budgets
CREATE POLICY "budgets.update" ON public.budgets
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  )
  WITH CHECK (
    user_id = auth.jwt()->>'sub'
    OR (couple_id IS NOT NULL AND public.is_couple_member(couple_id))
  );

-- Users can delete their own budgets
CREATE POLICY "budgets.delete" ON public.budgets
  FOR DELETE TO authenticated
  USING (user_id = auth.jwt()->>'sub');

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get current period spending for a user/category
CREATE OR REPLACE FUNCTION public.get_period_spending(
  p_user_id TEXT,
  p_category TEXT,
  p_period TEXT DEFAULT 'monthly'
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_start_date TIMESTAMPTZ;
  v_total NUMERIC;
BEGIN
  -- Calculate period start date
  CASE p_period
    WHEN 'weekly' THEN
      v_start_date := date_trunc('week', NOW());
    WHEN 'monthly' THEN
      v_start_date := date_trunc('month', NOW());
    WHEN 'yearly' THEN
      v_start_date := date_trunc('year', NOW());
    ELSE
      v_start_date := date_trunc('month', NOW());
  END CASE;

  -- Sum transactions for the period
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total
  FROM public.transactions
  WHERE user_id = p_user_id
    AND category = p_category
    AND transaction_date >= v_start_date;

  RETURN v_total;
END;
$$;

-- Function to check budget status
CREATE OR REPLACE FUNCTION public.check_budget_status(
  p_user_id TEXT,
  p_category TEXT,
  p_new_amount NUMERIC DEFAULT 0
)
RETURNS TABLE (
  status TEXT,
  limit_amount NUMERIC,
  current_spending NUMERIC,
  new_total NUMERIC,
  percentage NUMERIC,
  remaining NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_budget RECORD;
  v_current NUMERIC;
  v_new_total NUMERIC;
  v_percentage NUMERIC;
BEGIN
  -- Get active budget for category
  SELECT * INTO v_budget
  FROM public.budgets b
  WHERE b.user_id = p_user_id
    AND b.category = p_category
    AND b.is_active = true
  LIMIT 1;

  -- If no budget exists, return 'ok' status
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      'ok'::TEXT,
      NULL::NUMERIC,
      NULL::NUMERIC,
      NULL::NUMERIC,
      NULL::NUMERIC,
      NULL::NUMERIC;
    RETURN;
  END IF;

  -- Calculate current spending
  v_current := public.get_period_spending(p_user_id, p_category, v_budget.period);
  v_new_total := v_current + p_new_amount;
  v_percentage := (v_new_total / v_budget.limit_amount) * 100;

  -- Determine status
  IF v_new_total > v_budget.limit_amount THEN
    RETURN QUERY SELECT
      'over_limit'::TEXT,
      v_budget.limit_amount,
      v_current,
      v_new_total,
      v_percentage,
      v_budget.limit_amount - v_new_total;
  ELSIF v_percentage >= 80 THEN
    RETURN QUERY SELECT
      'warning'::TEXT,
      v_budget.limit_amount,
      v_current,
      v_new_total,
      v_percentage,
      v_budget.limit_amount - v_new_total;
  ELSE
    RETURN QUERY SELECT
      'ok'::TEXT,
      v_budget.limit_amount,
      v_current,
      v_new_total,
      v_percentage,
      v_budget.limit_amount - v_new_total;
  END IF;
END;
$$;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to transactions table
DROP TRIGGER IF EXISTS trigger_transactions_updated_at ON public.transactions;
CREATE TRIGGER trigger_transactions_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Apply trigger to budgets table
DROP TRIGGER IF EXISTS trigger_budgets_updated_at ON public.budgets;
CREATE TRIGGER trigger_budgets_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE public.transactions IS 'Stores parsed receipt/transaction data with budget tracking';
COMMENT ON TABLE public.budgets IS 'User-defined spending limits by category and period';
COMMENT ON FUNCTION public.get_period_spending IS 'Calculate total spending for a user/category in current period';
COMMENT ON FUNCTION public.check_budget_status IS 'Check if a new transaction would exceed budget limits';
