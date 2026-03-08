
-- Add recurring expense fields to the expenses table
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_frequency text CHECK (recurrence_frequency IN ('weekly', 'monthly', 'yearly')) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS recurrence_interval integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS next_recurrence_date timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS parent_recurring_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL DEFAULT NULL;
