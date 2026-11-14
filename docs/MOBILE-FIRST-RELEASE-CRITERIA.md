# Mobile-first release criteria (mandatory)

Status: **MANDATORY**. A release is not shippable while any `MF-*` criterion fails,
for the portal or for any new workspace page added under this repository.

Scope: every page in `PAGES` (`.ci/guard.sh`), `funds/*.html`, and any new
workspace or desk page. Styling that "looks fine" at 390 px is not evidence; the
checks below run in a real Chromium engine at real CSS-pixel widths.

Automated gate: `node qa/mobile-first.cjs` (wired into `.ci/guard.sh`).
Manual gate: `bash .ci/visual-qa.sh` keeps the screenshot artifacts.

---

## MF-1 — No unintended page-level horizontal overflow

`document.documentElement.scrollWidth <= window.innerWidth + 1` at every tested
width, with the page scrolled to the bottom as well as the top.

- Wide content (tables, code, charts, long identifiers) scrolls inside its own
  `overflow-x: auto` region, never by stretching the document.
- A deliberate, bounded inner scroller is allowed; `body { overflow-x: hidden }`
  alone is **not** a fix, because it hides content instead of containing it.
- Verified at 360, 375, 390, 414, 768, both sides of every breakpoint
  (639/640, 759/760, 767/768, 1023/1024), landscape and desktop.

## MF-2 — Readable text without disabling browser zoom

- No `user-scalable=no`, `maximum-scale<2` or `minimum-scale` in the viewport meta.
- Viewport meta includes `width=device-width, initial-scale=1`.
- Body text ≥ 12 CSS px at 320 px width; form controls ≥ 16 CSS px font on touch
  widths so iOS does not force-zoom on focus.
- Any element that truncates text keeps the full value reachable (title, expanded
  detail sheet, or `aria-label`).

## MF-3 — Touch targets: 44×44 CSS px minimum

Every control a touch user can hit measures at least 44×44 CSS px, including its
hit area (padding counts; `::before`/`::after` expansion counts).

- Applies to buttons, links that act as controls, inputs, selects, checkboxes,
  radios, tabs, icon buttons, table row actions, sheet close buttons.
- Inline links inside prose are exempt.
- When a visual control must stay small, expand its hit area to 44 px:
  `.mf-hit-44 { position: relative } .mf-hit-44::after { content:""; position:absolute; inset:calc((44px - 100%) / -2) }`.

## MF-4 — No hover-only information or actions

- Any `:hover`-revealed affordance must also be revealed by focus and by tap:
  gate cosmetic hover styles behind `@media (hover: hover) and (pointer: fine)`.
- Information carried only by `title=` on touch is mirrored into visible text, an
  expandable detail sheet, or `aria-label`.
- A tap target is never `opacity: 0` / `display: none` until hovered.

## MF-5 — Tap, keyboard and screen-reader accessible controls

- Every interactive element is reachable with Tab in DOM order and has a
  non-empty accessible name.
- Visible focus indicator on every focusable element (`:focus-visible`, ≥ 2 px,
  contrast ≥ 3:1 against its background).
- State is exposed: `aria-expanded`, `aria-pressed`, `aria-current`,
  `aria-selected`, `role="dialog"` + `aria-modal="true"` where applicable.
- A skip link is the first focusable element; live regions announce async results.

## MF-6 — Mobile Market Map drill-down, not a scaled network

Any map/network/graph view must be **navigable at mobile widths**, not shrunk.

- At `< 900px` the map renders a drill-down list/tiles: sector → constituents,
  with breadcrumb back-navigation; the network/graph canvas is not rendered
  scaled-down and unreadable.
- Drill-down level is preserved on back navigation and exposed in the URL.
- Hit areas inside tiles obey MF-3; labels are never smaller than 11 px.
- No market-map / network surface exists in this portal today (verified across
  all 23 pages). The criterion is **N/A for this release** and binding on the
  first such surface added: it must ship with the mobile drill-down, not a
  scaled network.

## MF-7 — Single-column Chart Board and usable chart expansion

- At mobile widths charts render in one column, at container width, with a
  minimum plot height of 220 px and legible axis/price labels (≥ 10 px).
- A canvas is sized from its container and redrawn on resize/rotation; it never
  keeps a stale bitmap from the previous width.
- Expansion is a real control: opens full-screen (or near-full-screen) with focus
  moved inside, Escape/second tap closes it, and focus returns to the trigger.
- Expanded charts keep the same data and do not refetch it.

## MF-8 — Scanner selection opens complete, scrollable setup details

- Tapping any scanner row opens the complete setup: symbol, segment, direction,
  entry, stop, TP1/TP2, risk multiples, zone bounds, volume context, gate/status
  reasons, and data freshness.
- The detail surface is scrollable independently, capped by the visible viewport
  (`max-height: 100dvh` minus insets), and never truncates a value.
- Every field shown in the wider table is reachable from the detail view.
- Row identity is unambiguous: the selected row is visually marked and announced.

## MF-9 — Preserve instrument/timeframe/filter state on back navigation

- Filters, timeframe, symbol/instrument and selected chart survive
  back/forward and reload (`history.replaceState`/`pushState` + URL params, or
  `sessionStorage` keyed by page).
- Restoring state must not double-apply or double-fetch.
- Returning from a detail/chart view restores scroll position.

## MF-10 — Bottom sheets and modals manage focus and restore it

- Opening moves focus into the surface (first control or the surface itself).
- Tab/Shift+Tab are trapped inside while open.
- Close button is ≥ 44×44, labelled, and reachable; Escape closes.
- On close, focus returns to the element that opened it; background is not
  scrollable while open (`inert` or scroll lock).

## MF-11 — Respect device safe areas and the on-screen keyboard

- Fixed/sticky chrome uses `env(safe-area-inset-*)` and `viewport-fit=cover`.
- With the on-screen keyboard open (visual viewport height reduced ~40 %), the
  focused input stays visible and the submit action remains reachable.
- Layout uses `100dvh` (with `100vh` fallback) so browser chrome/keyboard do not
  create hidden content or a dead scroll region.

## MF-12 — Sticky headers and bottom bars must not cover content or actions

- Any sticky/fixed header or action bar declares its height as a CSS variable
  (`--mf-sticky-top`, `--mf-sticky-bottom`) and the scroll container reserves
  that space via padding/`scroll-margin`.
- No interactive element ends up underneath fixed chrome at the top or bottom of
  the scroll range (checked by hit-testing the element's centre point).
- Focused elements are scrolled into view clear of the chrome.

## MF-13 — Pause decorative animation; respect reduced motion

- `@media (prefers-reduced-motion: reduce)` removes or shortens transitions,
  keyframe animations, parallax and auto-advancing carousels.
- With reduced motion requested, no animation with `iterations: Infinity` is
  running, and no `requestAnimationFrame` loop redraws a static canvas.
- Animations pause when the tab is hidden.

## MF-14 — No duplicate requests or subscriptions after rotation or navigation

- A rotation/resize, an orientation change or a back/forward navigation must not
  add a second fetch of the same resource or a second live subscription.
- Listeners are registered once; `AbortController` aborts the previous request;
  resize handlers are debounced and only act on a width change.
- Measured by counting requests per URL before and after a resize sequence and a
  back/forward cycle.

---

## Enforcement in this repository

- `assets/css/mobile-first.css` and `assets/js/mobile-first.js` are the one
  shared mobile layer, linked into the `<head>` of all 23 pages (portal, funds
  workspace, terminal, sign-in, 404). `node tools/mf-include.py` keeps them
  wired and is safe to re-run.
- `node qa/mobile-first.cjs` is the executable gate and runs from
  `.ci/guard.sh`. It serves the real pages with the isolated QA fixture and
  fails on: page-level overflow, zoom-blocking viewport meta, sub-16 px form
  text on touch, controls under 44×44 at touch widths, controls without an
  accessible name or a visible focus ring, actions covered by fixed chrome,
  missing safe-area variables, and infinite animation under
  `prefers-reduced-motion: reduce`.
- The same script drives the normal data path end to end (fixture → scanner
  rows → row A details → row B details → chart → expansion → draft plan) and
  asserts that rotation adds no extra `/api/market/yahoo` request.
- A context with `(pointer: coarse)` receives the 44 px minimums, 16 px form
  text and label-sized checkbox targets; fine-pointer desktop keeps its denser
  components.

## Verification matrix (required before release)

| Axis | Values |
| --- | --- |
| Widths | 360, 375, 390, 414, 768 |
| Breakpoint boundaries | 639/640, 759/760, 767/768, 1023/1024 |
| Orientation | portrait + landscape (e.g. 844×390) |
| Keyboard | on-screen keyboard open (viewport height −40 %) |
| Desktop regression | 1280×900 and 1440×900 |
| Motion | default and `prefers-reduced-motion: reduce` |
| Input | touch (`hasTouch`) and mouse |

Recording the outcome:

- `qa/mobile-first.json` — per page/viewport results, failures with element
  selector + measured size, console errors, request counts.
- `qa/mobile-first-<viewport>.png` — screenshots for each tested page/viewport.
- The release note must state which viewports were **emulated** and which were
  checked on a **physical device**. Emulated viewports are not device tests.

## Honesty rules

- Missing broker credentials (FYERS) do not block mobile fixture testing; the
  fixture path must still be verified end to end.
- Demo/paper results stay non-actionable and are labelled as such.
- Never mark a criterion PASS from source inspection alone when a runtime check
  is defined for it.
