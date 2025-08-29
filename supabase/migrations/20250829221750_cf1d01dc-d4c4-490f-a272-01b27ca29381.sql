-- 1) Find any leftover references to member_role
-- Functions containing 'member_role'
SELECT n.nspname, p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND pg_get_functiondef(p.oid) ILIKE '%member_role%';

-- Policies containing 'member_role'
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public' AND (qual ILIKE '%member_role%' OR with_check ILIKE '%member_role%');

-- Column defaults using 'member_role'
SELECT c.relname AS table_name, a.attname AS column_name,
       pg_get_expr(d.adbin, d.adrelid) AS default_expr
FROM pg_attrdef d
JOIN pg_class c ON c.oid = d.adrelid
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.adnum
WHERE pg_get_expr(d.adbin, d.adrelid) ILIKE '%member_role%';