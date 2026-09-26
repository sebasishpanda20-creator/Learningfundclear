-- scan_symbols: the nightly zone scan's watchlist, editable from the Setups page.
-- Run once in Supabase -> SQL Editor. Safe to re-run (idempotent).
--
-- The table is intentionally readable WITHOUT sign-in: the scan runs on GitHub
-- Actions, which has no Supabase session, and the symbol list is not secret
-- (it was already public in tools/signal-watchlist.json). Writes need an
-- authenticated session, so the public cannot change what gets scanned.

create table if not exists public.scan_symbols (
  symbol text primary key,
  enabled boolean not null default true,
  position int not null default 1000,
  updated_at timestamptz not null default now()
);

alter table public.scan_symbols enable row level security;

-- Anyone (including the Actions runner, unauthenticated) can read the list.
drop policy if exists "public read scan symbols" on public.scan_symbols;
create policy "public read scan symbols"
  on public.scan_symbols for select
  using (true);

-- Only a signed-in portal admin can change it. The journal's own admin check,
-- reused verbatim: a row with the same username must exist in app_users.
drop policy if exists "authenticated write scan symbols" on public.scan_symbols;
create policy "authenticated write scan symbols"
  on public.scan_symbols for insert
  to authenticated
  with check (public.is_current_user_admin());

drop policy if exists "authenticated update scan symbols" on public.scan_symbols;
create policy "authenticated update scan symbols"
  on public.scan_symbols for update
  to authenticated
  using (public.is_current_user_admin());

drop policy if exists "authenticated delete scan symbols" on public.scan_symbols;
create policy "authenticated delete scan symbols"
  on public.scan_symbols for delete
  to authenticated
  using (public.is_current_user_admin());

-- Seed from the current watchlist. ON CONFLICT keeps any edits already made.
insert into public.scan_symbols (symbol, enabled, position)
select s.symbol, true, s.rn
from (
  select value as symbol, row_number() over (order by ord) as rn
  from jsonb_array_elements_text('[
    "HDFCBANK.NS","ICICIBANK.NS","SBIN.NS","KOTAKBANK.NS","AXISBANK.NS",
    "BAJFINANCE.NS","BAJAJFINSV.NS","INDUSINDBK.NS","BANKBARODA.NS","PNB.NS",
    "TCS.NS","INFY.NS","WIPRO.NS","HCLTECH.NS","TECHM.NS","PERSISTENT.NS",
    "RELIANCE.NS","ONGC.NS","NTPC.NS","POWERGRID.NS","TATAPOWER.NS","ADANIGREEN.NS",
    "HINDUNILVR.NS","ITC.NS","NESTLEIND.NS","BRITANNIA.NS","DABUR.NS","TATACONSUM.NS",
    "MARUTI.NS","TMCV.NS","TMPV.NS","M&M.NS","BAJAJ-AUTO.NS","EICHERMOT.NS","ASHOKLEY.NS",
    "TATASTEEL.NS","JSWSTEEL.NS","HINDALCO.NS","COALINDIA.NS","VEDL.NS","JINDALSTEL.NS",
    "SUNPHARMA.NS","DRREDDY.NS","CIPLA.NS","DIVISLAB.NS","LUPIN.NS","AUROPHARMA.NS",
    "LT.NS","ULTRACEMCO.NS","GRASIM.NS","ADANIPORTS.NS","DMART.NS","TITAN.NS",
    "GC=F","SI=F","CL=F","BZ=F","NG=F","HG=F","ALI=F","ZNC=F","PL=F"
  ]'::jsonb) with ordinality as t(value, ord)
) s
on conflict (symbol) do nothing;

create index if not exists scan_symbols_enabled_idx
  on public.scan_symbols (position) where enabled;
