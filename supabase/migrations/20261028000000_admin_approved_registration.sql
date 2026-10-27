-- First-time registration approval: hard database gate for NEW authenticated accounts.
-- Apply with Supabase SQL editor / authorized migrations before opening signup.
-- Existing app_users records, admin roles, passwords and data are NOT altered.
BEGIN;
CREATE OR REPLACE FUNCTION public.lfc_has_approved_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.app_users
   WHERE id = auth.uid() AND is_active IS TRUE
 )
$$;
REVOKE ALL ON FUNCTION public.lfc_has_approved_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lfc_has_approved_access() TO authenticated, service_role;
-- Extra restrictive policies are ANDed with each table's existing RLS policies,
-- so a newly authenticated, unapproved registration cannot bypass the UI guard.
DO $$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['app_users','ideas','user_watchlist','audit_log'] LOOP
  IF to_regclass('public.'||name) IS NOT NULL THEN
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
   EXECUTE format('DROP POLICY IF EXISTS lfc_approved_members_only ON public.%I',name);
   EXECUTE format(
    'CREATE POLICY lfc_approved_members_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.lfc_has_approved_access()) WITH CHECK (public.lfc_has_approved_access())',name);
  END IF;
 END LOOP;
END $$;
-- Only exists after the above security policies are installed successfully.
-- Edge Function's public availability check requires this positive database signal.
CREATE OR REPLACE FUNCTION public.lfc_registration_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$ SELECT TRUE $$;
REVOKE ALL ON FUNCTION public.lfc_registration_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lfc_registration_ready() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
