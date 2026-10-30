-- Limit profile visibility to the signed-in user and active administrators.
-- Gate private signal events on active membership and remove anonymous reads.
BEGIN;
DROP POLICY IF EXISTS users_read_authenticated ON public.app_users;
CREATE POLICY users_read_self_or_admin
  ON public.app_users
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT public.is_current_user_admin()));

ALTER TABLE public.signal_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon read signals" ON public.signal_events;
DROP POLICY IF EXISTS lfc_approved_members_only ON public.signal_events;
CREATE POLICY lfc_approved_members_only
  ON public.signal_events
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (public.lfc_has_approved_access())
  WITH CHECK (public.lfc_has_approved_access());

NOTIFY pgrst, 'reload schema';
COMMIT;
