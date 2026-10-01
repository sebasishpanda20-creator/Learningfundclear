# freebuff — User Manual

Version 1.0 · July 2026
Portal: https://sebasishpanda20-creator.github.io/Learningfundclear/
Owner / maintainer: ninchan (GitHub: sebasishpanda20)

What this manual covers
- The private research journal (sign-in, admin, tools).
- The Demand Zone Scanner (scan settings, run a scan, read results, chart, CSV export).
- Setups & paper trading (TradingView alerts → risk sizing → manual execution → paper-trade ledger).
- The nightly scan list (Supabase scan_symbols, GitHub Actions 18:00 IST run).
- How the signals pipeline works: TradingView alerts → Supabase → scanner logic → results → saved to Supabase signal_events.
- Local scanning for power users (tools/signal-scan.js, the scan-rules config, CLI).
- Troubleshooting and FAQ.

============================================================
1. What this portal is
============================================================
freebuff is a private investment research journal built around an **end-of-day demand-zone scanner**
for Indian equities (NSE/BSE) and global commodity futures. It does not give signals or recommendations —
it shows where price has historically made its last significant reaction (demand/supply zones), whether
the trend is up/down/sideways, and whether any current candle touches a zone. The user decides whether
to act on that information.

Public areas (no sign-in): funds portal (funds/index.html), the scanner (scanner.html needs sign-in),
the journal index (index.html).

The scanner itself is pure client-side logic (scanner-logic.js) plus Yahoo Finance EOD data. Everything
else that "acts" — saving scan lists, logins, signal events, paper trades — lives in Supabase.

============================================================
2. Getting started
============================================================
1. Go to https://sebasishpanda20-creator.github.io/Learningfundclear/ and open **Sign in**.
2. The admin issues you a username and password (see the Admin panel in the journal).
3. Enter your username + password and Sign in. You are then taken to the journal dashboard.
   - If you land on the scanner (scanner.html) the link carries ?next=scanner.html.
   - Sign out by adding ?signout=1 to any URL (this clears the local session too).

Credentials
- Account rows live in Supabase (auth.users + app_users). The admin creates users through the
  journal Admin panel; passwords are ended with @portal.local. There is no password reset flow here —
  ask the admin to create a new user if you lose access.
- "Admin" means your app_users row has is_admin = true. Only admins can mint new users.

============================================================
2b. Sign in (signin.html)
============================================================
The sign-in page is the single entry point. Two modes:

1. Normal sign-in: enter username + password. On success the page stamps your identity (username,
   display name, is_admin flag) into the session and redirects you to the journal.
2. Admin create-user card (shown only to a signed-in administrator): the creator enters a username,
   display name and password; the portal creates a Supabase auth user (<username>@portal.local) plus an
   app_users row with is_admin=false. The new user then logs in on this same page.

If sign-in behaves oddly after a browser update or tab restore: open the sign-in page and add
?signout=1 to the URL to clear the local session, then sign in again.

============================================================
3. The Demand Zone Scanner (scanner.html)
============================================================
What it does
A daily (EOD) scan. For every symbol × timeframe it:
 1. pulls the last N days of bars from Yahoo Finance (with jina.ai text-proxy fallback);
 2. applies an independent pivot-based approximation of demand/supply zones:
    - a confirmed pivot low = the lowest low across (pivotLeft + pivotRight + 1) bars → a demand
      zone from [candle body top] to [candle low];
    - a confirmed pivot high = the highest high → a supply zone from [candle body bottom] to
      [candle high];
    - a zone dies the next day's close trades through it (price must close above a demand zone
      or below a supply zone to invalidate it);
 3. annotates each bar with trend (EMA 10/20/50 stack: UPTREND / DOWNTREND / SIDEWAYS),
    volume vs the 20-day average, and how far the current candle sits from the zone (in % of the
    zone range or exactly inside).

Tools sidebar (scanner.html, top card)
- Pivot left / Pivot right → how many bars each side of the pivot to look at (1–10, default 3).
- Timeframes (checkboxes): Daily, Weekly, Monthly, Hourly, 15m (MIS). Each has its own minimum bar
  count for a valid computeZones() result; daily is driven by "Daily history" (1/2/3 years).
- Require bullish EMA trend → only rows where EMA10 > EMA20 > EMA50 pass.
- Include candles touching a zone → also shows candles that merely touch a zone edge (checkbox off
  keeps only fully INSIDE results).
- Max distance above zone % → null disables it; a positive number (e.g. 1.0) additionally keeps
  rows where the last close is no more than that many percent above the zone top. Useful as a
  "don't chase the breakout yet" filter.
- Volume above 20-day average → keeps rows where lastVolume >= 20dAverageVolume.
- Watchlist (one symbol per line) with Save / Import / Replace / Default list / Add commodities.
  - Add commodities appends the global futures that track MCX: GC=F (gold), SI=F (silver),
    CL=F (crude), BZ=F (Brent), NG=F (natural gas), HG=F (copper), ALI=F (aluminium),
    ZNC=F (zinc), PL=F (platinum). MCX contract codes do not exist on Yahoo, so these are the
    proxies — for example put COALINDIA.NS in the list to scan just the stocks you hold.
  - Import accepts CSV, one per line, or comma/semicolon separated, bare symbol (NSE), bare 5–6
    digit code (BSE), "Coal India"-style names (looked up in india_symbols.json), or "SYMBOL,NAME"
    header rows.

Run a scan
1. Type or paste your symbols into the watchlist box (defaults are a full banking/IT/energy/FMCG/auto/
   metals/pharma/infra list).
2. Set pivot left/right to taste (3/3 is the reference default), pick timeframes and history depth,
   tick the extra filters you want.
3. Click **Scan watchlist**. Results appear progressively as they resolve: each row is one symbol × TF,
   showing Trend tag (UPTREND/DOWNTREND/SIDEWAYS), Demand zone, Position (IN/IN + TOUCHING/—), Distance
   to zone (%), Zone created (date), and volume vs 20-day average.
4. Tags:
   - INSIDE — the current candle's low/high sits inside a live demand or supply zone.
   - TOUCHING — the candle only touches a zone edge (only when the "Include touching" box is ticked).
   - A zone disappears the day price closes through it, so "inside" means "currently inside the
     last live zone".

The scan card has a tiny chart viewer: click any row to open a chart card showing candlesticks
(green up / red down), EMA20 (blue), EMA50 (gold), zone bands, and last price. Hovering/zooming
is not available — this is an EOD summary, not a real-time chart.

Download Results (CSV)
Exports the last scan as UTF-8 CSV (BOM so Excel opens it correctly): Symbol, TF, Price, Trend,
Demand Zone, Position, Dist to zone, Zone Date, Vol vs 20d.

Settings saved locally
The scan tool saves your last-used pivot/history/filters to localStorage (key lfc.scanSettings), so a
return visit restores them exactly. Changing the watchlist also saves it.

Important: the scanner uses your browser's localStorage for the watchlist AND the scan settings.
Setting this computer's browser does not affect the scanner on another machine or the GitHub Pages
site — those are separate products (the journal's own 62-symbol localStorage list and the Supabase
scan_symbols table).

============================================================
4. Setups & paper trading (setups.html)
============================================================
What it is: a local event-to-trade log with a risk-size calculator and a paper-trade ledger. Three jobs:

1. Pull signals from a TradingView alert webhook (Supabase signal_events table).
   - Label the checkbox "Pull TradingView alerts from Supabase" — the webhook below is guarded by a
     service-role key, and alerts landing on signal_events appear here (TV / Manual source tags).
2. Add or remove symbols from the nightly scan list (supabase.scan_symbols):
   - type a symbol + Add; the list is saved to Supabase and the 18:00 IST nightly run picks it up.
3. Risk size a signal (choose Long/Short), then Open a paper trade. The risk card computes
   position size from account (₹), risk %, and leverage, and works off the details string
   (e.g. "stop 212.5 · target 230").
4. Manage the paper-trade ledger: close trades at the exit price, see win rate and net P&L, delete a row.
   Paper trades are stored in browser localStorage (lfc.papertrades).

The scan list note: symbol shapes are NSE equity RELIANCE.NS, BSE 500325.BO, commodity futures GC=F /
CL=F (MCX tracks these global contracts). The scan page prints "429 too many requests" when Yahoo
rate-limits a wave — the scanner has a retry/backoff pool that recovers gently.

============================================================
5. The journal (index.html) — what you do there
============================================================
The dashboard is a mix of public fund pages (visible to anyone) and private tools for signed-in users:

- Performance: handful of stats computed from a local research script and the Supabase signal_events
  table (see the maintainer notes).
- FUNDS: AMFI fund pages — significant, but the relevant ones are in funds/index.html, and the
  screen's scan list is managed there.
- Admin: mint new sign-ins (admin card), manage app_users.

Sign-in requirement
- Read-only pages (funds portal) work for anyone.
- scanner.html, setups.html, and the journal tools need a signed-in session; the scanner redirects
  to signin.html?next=scanner.html if you are not signed in.

============================================================
6. Subscription & access (what the admin manages)
============================================================
The portal is private by design:
- Everyone can view the public fund pages (funds/index.html).
- The scanner, setups, and journal tools need a signed-in session.
- The admin (an app_users row with is_admin = true) can create sign-ins via the Admin card on
  signin.html. Those create a Supabase auth user and an app_users row with is_admin=false.
- The journal's admin panel (in index.html) is the point of truth for roles; the correct one is the
  "create-user" Edge Function, not the dashboard, and production users should be created through that.

============================================================
7. How the signals pipeline works (maintainer / power-user view)
============================================================
This is how a TradingView alert turns into a scan result that the setups page and the nightly scan
share:

1. TradingView POSTs an alert to the Supabase create-user edge function? — no: to the webhook at
   https://chbtjicvbezbiosuouwm.supabase.co/functions/tv-webhook, with the raw alert JSON in the body.
2. Inside the webhook, if the zoneKey matches the last zoneKey used within 7 days → the webhook skips
   the duplicate and logs a warning. Otherwise it is upserted into the signal_events table with
   created_at = now.
3. The scanner (scanner.html or the workflow) reads signal_events with the anonymous key. Row-level
   security (RLS) on that table permits the anonymous key to read (the "anonymised-read" RLS fix).
4. The scanner computes zones on top of EOD/Intraday/OHLC bars (per timeframe), applies the pivot
   logic, and writes the results back to the page.

=============================
10. Working locally / testing
=============================
The scanner logic is pure client-side (scanner-logic.js) — you can copy it into any HTML page and
browse it. The scanner page's only network calls are Yahoo EOD bars.

If you want a local-looking environment (GitHub Pages + Supabase), follow these steps:
1. Clone the repo and deploy Pages as usual.
2. Create a Supabase project and populate app_users with your own credentials.
3. Run the scanner locally: open scanner.html over a local server, sign in, and it just works.
4. For the nightly scan, the GitHub Actions workflow (signal-scan.yml, 18:00 IST) does 499-symbol
   lookups with a built-in retry/backoff pool (4 attempts, 1500ms × attempt), and writes signal_events.

FAQ
- "Why does the scanner show no zones?" — This is an EOD scan, and a zone must be confirmed by a
  pivot, so a zone in the last 1–2 days is normal. Lower the pivot bars, and if needed turn off
  "Include candles touching a zone".
- "Why did the scan fail on X symbols?" — Data source hiccups (Yahoo 429 etc.). The scanner has a
  recovery pass that uses up to 2 workers with 4-second spacing.
- My watchlist disappeared after a browser update.
  This is because the scan tool saved it locally. Re-save the watchlist via the scan page, or the
  import list.

This is also the end of the user manual. Please let me know if you'd like a quick reference card
(printable one-pager) or a template that the admin can copy into the journal for contributors.

BUG FIX VERIFIED IN THIS REPOSITORY
- date/time: use the scanner,
- paging: page shows the scanner →
- status: fixed and verified →
- changes rolled out: yes
