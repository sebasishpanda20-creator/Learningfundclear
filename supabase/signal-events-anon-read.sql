-- signal_events: allow the anon role to READ signals
-- ===================================================
-- Why: the nightly digest's live hit-rate tracker (tools/signal-scan.js →
-- fetchRecentCounts) reads signal_events with the anon key. The original
-- migration (signal-events-migration.sql) enabled RLS with a SELECT policy
-- for `authenticated` only, so the tracker saw 0 rows even though the
-- tv-webhook function was storing hundreds — and the digest kept printing
-- "no live signals yet". Signal rows are not secret (the Setups page shows
-- them to any signed-in user; there is no personal data in them), so a
-- blanket anon read is the simplest correct fix.
--
-- Inserts stay service-role only: there is deliberately NO insert policy,
-- so anon/authenticated clients still cannot write — only the tv-webhook
-- edge function (service role) can.
--
-- Run once in Supabase Studio → SQL Editor:
--   https://supabase.com/dashboard/project/chbtjicvbezbiosuouwm/sql/new

create policy "anon read signals"
  on public.signal_events
  for select
  to anon
  using (true);

-- verify afterwards (should return a row count > 0 from an anon client):
--   select count(*) from signal_events;
