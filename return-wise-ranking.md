# Return-wise ranking — page design notes

**Version 1.0**
**Updated:** 2026-10-02

This document describes a new page for the **LearningFundClear** portal. The page ranks mutual funds
by **return-wise** behaviour — i.e., by how consistently a scheme has delivered its stated return goal over
a rolling look-back — and is intended to sit alongside the existing journal, scanner, setups, funds and
performance sections.

The design is deliberately flat and dark (matching the rest of the portal):

- Text: `#e8efe9` on `#0b0f0e`, muted secondary `#93a39a`.
- Brand block: `LearningFundClear` in white bold with `data, not advice` subtitle.
- Navigation: pill tabs (`Journal`, `Scanner`, `Setups`, `Home`, `Schemes`, `Comp`) with a distinct fill for the
  active `Home` tab; a subtle scrollbar tracks the tab strip.
- Cards: `#111714` with `#24312b` borders, 12 px radius, 18 px padding.
- Headings: 24 px (page title), 15 px (card headings).
- Stats: large white numbers with muted gray `<span>` labels, grouped in a 3-column grid; a single
  `latest NAV date` stat sits below.
- Accent: mint green `#4ade80` for the primary `Browse schemes` button; the nav active tab uses an olive/green
  fill.
- Typography: `Segoe UI`, system-ui, sans-serif; `11 px` uppercase letter-spaced sub-labels; `13 px` body.
- Transparency: the whole layout uses `color-scheme: dark` and respects the OS-reduced-motion and
  prefers-contrast settings when available.

## 1. What the page shows

A ranked table of mutual fund schemes by **return-wise consistency**, not by headline return. For every
scheme the user can see:

- Scheme name and AMFI code.
- Return over the selected horizon (1 yr, 3 yr, 5 yr and since inception), i.e. the point the scheme
  itself claims to beat.
- A rolling, time-weighted look-back that measures how often the scheme actually achieved that goal —
  e.g. `Has beaten benchmark in ≥ 80% of trailing 12 months`.
- A rank and a consistency band (A / B / C), derived from the rolling look-back rather than from the
  headline return alone.
- A "return-wise edge" column showing the difference between the scheme's reported return and the
  appropriate benchmark over the same period — this is where the ranking buys you something the raw
  return column hides.
- Sort controls: by rank, by return-wise edge, by consistency band, and by scheme name.

Each row links to the scheme's page in the funds portal (same data, deeper detail), so the ranking is a
portal-level entry point rather than a walled garden.

## 2. Scope of data

The ranking is built from the **NSE / BSE / AMFI** public datasets the portal already carries:

- `data/NIFTY500-EV-Ranking.html` — the fund universe (500 NSE/BSE securities, including the delisted
  `HDFC.NS` case that was removed from the Supabase watchlist).
- `data/NSE-SECTOR-RELATIVE-STRENGTH.html` — relative strength values used to sanity-check the
  consistency ranking.
- The already-migrated `signal_events` RLS policy (anon-read, verified 100% open via the anon key) is
  reused as the model for how the ranking page reads and serves results from Supabase.
- AMFI NAV numbers land via the existing `NAV snapshot` housekeeping script; the ranking reads those
  NAVs plus the scheme master, so no new data source is introduced.

The ranking is **read-only** from the portal's point of view: it does not create rows, write alerts or
open trade orders. It is analysis over data the portal already holds.

## 3. Page structure (section by section)

1. **Hero** — heading, subtitle, three stat blocks (`schemes listed`, `fund houses`, `funds with both plans`)
   and a `latest NAV date` footer line. The three numbers are refreshed by the NAV snapshot job so they
   always read from the same `NAVAll.txt` the rest of the portal uses.
2. **Ranked list** — the main table, sticky header, per-row `<a>` into the funds page.
3. **Sorts & filters** — rank / return-wise edge / consistency band / scheme name; optional horizon picker
   (1Y / 3Y / 5Y / inception).
4. **Consistency legend** — what A / B / C mean in terms of rolling look-back coverage, so the ranking is
   interpretable at a glance.
5. **How the ranking is computed** (small print) — rolling window, benchmark choice, and why return-wise
   consistency is preferred over headline return for long-term capital deployment.
6. **Related sections** — links back to the scanner, setups, funds portal, NAV snapshot job.

## 4. Voluntary state & forecast

Deliberately present-tense, not a "what will happen tomorrow" gimmick:

- The page never claims certainty: every row carries a consistency band and a relative-12-month edge,
  not a price target.
- A fund can be rank 1 on return over three years and still sit at B on consistency; the user is told
  which one they are looking at.
- Nothing the page renders pushes the user into a trade — it is a fact display, not a signal.

## 5. Rollout notes

- The page is a **read-only new view**; it does not need a new authentication flow or a new Supabase
  table. It can consume data that already exists in the project (scan `signal_events`, the scheme master
  and the NAV snapshot) through the same anon-key + RLS approach that already works.
- The pager needs a test run against the real data before it is pointed at the live `signal_events`
  rows; if the pagination math is wrong the risk is a 404 or an empty table, not a data loss.
- Version pin: this is `v1.0` of the page design. Nothing in the ranking logic changes until a
  maintainer explicitly bumps the version.

---
*Freebuff · private research journal · data, not advice*
