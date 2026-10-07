-- Apply once through an authorized Supabase SQL connection.
-- Does not delete existing ideas or audit history. Deletion remains an explicit admin action.
BEGIN;
ALTER TABLE public.audit_log ALTER COLUMN idea_id DROP NOT NULL;
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_idea_id_fkey;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_idea_id_fkey
 FOREIGN KEY (idea_id) REFERENCES public.ideas(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.delete_idea_with_audit(p_idea_id public.ideas.id%TYPE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_idea public.ideas%ROWTYPE; v_user uuid := auth.uid();
BEGIN
 IF v_user IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.app_users WHERE id=v_user AND is_admin IS TRUE AND is_active IS TRUE
 ) THEN RAISE EXCEPTION 'Active administrator access is required' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_idea FROM public.ideas WHERE id=p_idea_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Idea no longer exists' USING ERRCODE='P0002'; END IF;
 -- Preserve identification after the FK is detached. Never erase prior events.
 UPDATE public.audit_log
 SET details = COALESCE(details::jsonb, '{}'::jsonb) ||
  jsonb_build_object('deleted_idea_id',p_idea_id::text,'ticker',v_idea.ticker)
 WHERE idea_id=p_idea_id;
 DELETE FROM public.user_watchlist WHERE idea_id=p_idea_id;
 DELETE FROM public.ideas WHERE id=p_idea_id;
 INSERT INTO public.audit_log(user_id,action,idea_id,details)
 VALUES(v_user,'IDEA_DELETE',NULL,jsonb_build_object('deleted_idea_id',p_idea_id::text,'ticker',v_idea.ticker));
 RETURN jsonb_build_object('deleted',true,'id',p_idea_id);
END;
$$;
-- Resolve the table's actual key type rather than assuming UUID for permissions.
DO $$ DECLARE sig text; BEGIN
 SELECT p.oid::regprocedure::text INTO sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='delete_idea_with_audit' AND p.pronargs=1;
 EXECUTE 'REVOKE ALL ON FUNCTION '||sig||' FROM PUBLIC, anon';
 EXECUTE 'GRANT EXECUTE ON FUNCTION '||sig||' TO authenticated';
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
