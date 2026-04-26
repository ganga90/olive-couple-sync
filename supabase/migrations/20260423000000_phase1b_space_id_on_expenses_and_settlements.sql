-- Phase 1B-3 — space_id data plane for expenses + expense_settlements
-- =====================================================================
-- Mirror of the Phase 1A pattern (notes / lists). Adds space_id columns,
-- backfills, dual-write triggers (FK-safe for non-couple spaces), and
-- extends RLS to accept is_space_member.
--
-- Calendar tables intentionally NOT in scope: calendar_connections is
-- per-user (each user connects their own Google account) and querying
-- across members requires server-side aggregation + opt-in. That's
-- Phase 4 territory.
--
-- Verified live (rolled-back transaction, authenticated role):
--   * non-couple family-space expense inserts with couple_id NULL (FK-safe)
--   * space members can read it; outsiders blocked
--   * existing couple-type spaces unchanged (RLS is a superset)

-- ─── (A) expenses: space_id column + index + backfill ────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS space_id UUID
    REFERENCES public.olive_spaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_space_id
  ON public.expenses (space_id)
  WHERE space_id IS NOT NULL;

UPDATE public.expenses
SET space_id = couple_id
WHERE couple_id IS NOT NULL
  AND space_id IS NULL;

-- ─── (B) expenses: dual-write triggers (FK-safe) ─────────────────────
CREATE OR REPLACE FUNCTION public.sync_expense_couple_to_space_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.couple_id IS NOT NULL AND NEW.space_id IS NULL THEN
    NEW.space_id := NEW.couple_id;
  ELSIF NEW.space_id IS NOT NULL AND NEW.couple_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_expense_couple_to_space()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.space_id IS DISTINCT FROM OLD.space_id THEN
    IF NEW.space_id IS NULL THEN
      NEW.couple_id := NULL;
    ELSIF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    ELSE
      NEW.couple_id := NULL;
    END IF;
  ELSIF NEW.couple_id IS DISTINCT FROM OLD.couple_id THEN
    NEW.space_id := NEW.couple_id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_expense_couple_space_insert ON public.expenses;
CREATE TRIGGER trg_sync_expense_couple_space_insert
  BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.sync_expense_couple_to_space_insert();

DROP TRIGGER IF EXISTS trg_sync_expense_couple_space ON public.expenses;
CREATE TRIGGER trg_sync_expense_couple_space
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.sync_expense_couple_to_space();

-- ─── (C) expense_settlements: same treatment ─────────────────────────
ALTER TABLE public.expense_settlements
  ADD COLUMN IF NOT EXISTS space_id UUID
    REFERENCES public.olive_spaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expense_settlements_space_id
  ON public.expense_settlements (space_id)
  WHERE space_id IS NOT NULL;

UPDATE public.expense_settlements
SET space_id = couple_id
WHERE couple_id IS NOT NULL
  AND space_id IS NULL;

CREATE OR REPLACE FUNCTION public.sync_settlement_couple_to_space_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.couple_id IS NOT NULL AND NEW.space_id IS NULL THEN
    NEW.space_id := NEW.couple_id;
  ELSIF NEW.space_id IS NOT NULL AND NEW.couple_id IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.olive_spaces s
      WHERE s.id = NEW.space_id AND s.couple_id = s.id
    ) THEN
      NEW.couple_id := NEW.space_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_settlement_couple_space_insert ON public.expense_settlements;
CREATE TRIGGER trg_sync_settlement_couple_space_insert
  BEFORE INSERT ON public.expense_settlements
  FOR EACH ROW EXECUTE FUNCTION public.sync_settlement_couple_to_space_insert();

-- expense_settlements has no UPDATE/DELETE policies (settlements are
-- immutable), so no UPDATE trigger needed.

-- ─── (D) RLS: accept space members ───────────────────────────────────
DROP POLICY IF EXISTS expenses_select ON public.expenses;
CREATE POLICY expenses_select ON public.expenses
  FOR SELECT
  USING (
    ((user_id = (auth.jwt() ->> 'sub')) AND couple_id IS NULL AND space_id IS NULL)
    OR (couple_id IS NOT NULL AND public.is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub')))
    OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
  );

DROP POLICY IF EXISTS expenses_insert ON public.expenses;
CREATE POLICY expenses_insert ON public.expenses
  FOR INSERT
  WITH CHECK (
    (user_id = (auth.jwt() ->> 'sub'))
    AND (
      (couple_id IS NULL AND space_id IS NULL)
      OR (couple_id IS NOT NULL AND public.is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub')))
      OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
    )
  );

DROP POLICY IF EXISTS expenses_update ON public.expenses;
CREATE POLICY expenses_update ON public.expenses
  FOR UPDATE
  USING (
    ((user_id = (auth.jwt() ->> 'sub')) AND couple_id IS NULL AND space_id IS NULL)
    OR (couple_id IS NOT NULL AND public.is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub')))
    OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
  );

DROP POLICY IF EXISTS expenses_delete ON public.expenses;
CREATE POLICY expenses_delete ON public.expenses
  FOR DELETE
  USING (
    ((user_id = (auth.jwt() ->> 'sub')) AND couple_id IS NULL AND space_id IS NULL)
    OR (couple_id IS NOT NULL AND public.is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub')))
    OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
  );

DROP POLICY IF EXISTS settlements_select ON public.expense_settlements;
CREATE POLICY settlements_select ON public.expense_settlements
  FOR SELECT
  USING (
    (user_id = (auth.jwt() ->> 'sub'))
    OR (couple_id IS NOT NULL AND public.is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub')))
    OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
  );

DROP POLICY IF EXISTS settlements_insert ON public.expense_settlements;
CREATE POLICY settlements_insert ON public.expense_settlements
  FOR INSERT
  WITH CHECK (
    (settled_by = (auth.jwt() ->> 'sub'))
    AND (
      (couple_id IS NULL AND space_id IS NULL)
      OR (couple_id IS NOT NULL AND public.is_couple_member_safe(couple_id, (auth.jwt() ->> 'sub')))
      OR (space_id  IS NOT NULL AND public.is_space_member(space_id,  (auth.jwt() ->> 'sub')))
    )
  );
