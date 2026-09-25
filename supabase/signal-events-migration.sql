-- signal_events: TradingView alert webhooks land here (via the tv-webhook edge function).
-- Run once in Supabase -> SQL Editor, BEFORE deploying the tv-webhook function.

create table if not exists public.signal_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  symbol text not null,
  action text not null check (action in ('LONG', 'SHORT')),
  price numeric,
  details text
);

-- The portal reads signals with the anon key, but only for signed-in users.
alter table public.signal_events enable row level security;

drop policy if exists "authenticated read signals" on public.signal_events;
create policy "authenticated read signals"
  on public.signal_events for select
  to authenticated
  using (true);

-- Inserts happen only through the tv-webhook function using the service role key,
-- which bypasses RLS. There is intentionally NO insert policy for anon/authenticated:
-- the public cannot fabricate signals.

create index if not exists signal_events_created_idx
  on public.signal_events (created_at desc);
