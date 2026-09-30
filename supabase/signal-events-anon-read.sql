-- signal_events: allow the anon role to READ signals
-- ===================================================
-- Why: the nightly digest's live hit-rate tracker (tools/signal-scan.js ->
-- fetchRecentCounts) reads signal_events with the anon key. The original
-- migration (signal-events-migration.sql) enabled RLS with a SELECT policy
-- for `authenticated` only, so the tracker saw 0 rows even though the
-- tv-webhook function was storing hundreds - and the digest kept printing
-- "no live signals yet". Signal rows are not secret (the Setups page shows
-- them to any signed-in user; there is no personal data in them), so a
-- blanket anon read is the simplest correct fix.
--
-- Inserts stay service-role only: there is deliberately NO insert policy,
-- so anon/authenticated clients still cannot write - only the tv-webhook
-- edge function (service role) can.
--
-- Run once in Supabase Studio -> SQL Editor:
--   https://supabase.com/dashboard/project/chbtjicvbezbiosuouwm/sql/new
-- Safe to re-run: the DO block below skips creation when the policy already
-- exists instead of erroring out.

-- 1) make sure the table is row-security enabled at all
alter table public.signal_events enable row level security;

-- 2) create the anon SELECT policy only if it is missing (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'signal_events'
      and policyname = 'anon read signals'
  ) then
    create policy "anon read signals"
      on public.signal_events
      for select
      to anon
      using (true);
    raise notice 'created policy "anon read signals"';
  else
    raise notice 'policy "anon read signals" already exists - nothing to do';
  end if;
end $$;

-- 3) self-diagnostics: read the three result panels after running
--    (a) is RLS actually enabled on the table? (expected: t)
select c.relrowsecurity as rls_enabled
  from pg_class c
 join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'signal_events';

-- (b) which policies exist right now? (expected: one row, cmd SELECT, roles {anon})
select policyname, cmd, roles, qual
  from pg_policies
 where schemaname = 'public' and tablename = 'signal_events';

-- (c) how many rows exist in total? (runs as YOU, the signed-in editor user)
select count(*) as total_rows from public.signal_events;

-- Afterwards, verify from OUTSIDE (anon key, in a terminal):
--   curl -sI "https://chbtjicvbezbiosuouwm.supabase.co/rest/v1/signal_events?select=id&limit=1" \
--     -H "apikey: <ANON_KEY>" -H "Prefer: count=exact" | grep -i content-range
-- Expected:  Content-Range: 0-0/<N>   with N > 0
-- If it still prints  */0  the policy did not land in THIS project
-- (chbtjicvbezbiosuouwm) - check the project selector in the dashboard.
