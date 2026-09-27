# Security runbook — LearningFundClear

Every credential this project uses, what it can actually do, where it lives, and the
exact steps to rotate it. If you suspect a leak, find the credential in the table,
follow its rotation section, done. No step here requires reading code.

**The one rule this runbook enforces:** every credential in this project is
single-purpose. Nothing shares a secret across two trust boundaries, so one leak never
forces a second rotation and can never widen its own blast radius.

Last reviewed: 27 Sep 2026. Verify against reality after any change — this file rots
silently if nobody checks it.

---

## Inventory

| # | Credential | What it authenticates | Blast radius if leaked | Rotation difficulty |
|---|---|---|---|---|
| 1 | **Supabase anon key** | Browser → Supabase, as the anonymous role | Almost none — designed to be public | Never needs rotation |
| 2 | **`TV_WEBHOOK_SECRET`** | GitHub Actions nightly scan → `tv-webhook` | Fake signals at scale (scan-tagged) | Medium — two stores, no user action |
| 3 | **`TV_CHART_SECRET`** | TradingView Pine indicator → `tv-webhook` | Fake signals (chart-tagged) only; scan untouched | Easy — one paste in TradingView |
| 4 | **Supabase access token (PAT)** | You → the whole Supabase project (Management API, CLI) | **Everything**: database, auth, functions, secrets | Easy — revoke in dashboard |
| 5 | **GitHub credential (git push / API)** | This machine → the repo | Publish anything, edit workflows, read Actions logs | Medium — where it lives depends on your setup |
| 6 | **Portal admin account** | Sign-in to the journal/Setups as admin | Full data access via RLS policies; user management | Manual — Supabase dashboard |

Nothing else exists. If you find a credential name in the code that isn't in this
table, that's a bug in the runbook — fix the table, not just the code.

---

## 1. Supabase anon key

**What it is:** a JWT identifying the project's *anonymous* role. Shipped in every
public HTML page by design — `index.html`, `signin.html`, `setups.html`, and
`tools/signal-scan.js` (the Actions runner uses it to read the scan list without a
session).

**What it can do:** only what RLS allows the `anon` role. Verified empirically
(27 Sep 2026): reads of `signal_events` return `[]`, writes are rejected with a
row-level-security error, `is_current_user_admin()` returns `false`. Two tables are
deliberately readable by `anon`: `scan_symbols` (the nightly watchlist — not secret,
and the Actions runner has no session) and nothing else.

**Where it lives:** hardcoded in the files above. Treat the *files* as the source of
truth, not any single copy.

**Rotation: never, unless the project is being decommissioned.** If you believe the
anon key itself is somehow compromised (it isn't, and can't practically be — it's
public by design), the fix is tightening RLS policies, not rotating the key. Rotation
means updating every embedded copy:

1. Supabase Dashboard → Project Settings → API keys → publishable/anon key → rotate.
2. `grep -rl "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" --include="*.html" --include="*.js" .`
   and replace the old JWT with the new value in each file (expect 4: `index.html`,
   `signin.html`, `setups.html`, `tools/signal-scan.js`).
3. Deploy: `git add -A && git commit && git push` — GitHub Pages redeploys on push.
4. Sync `C:\Users\tinch\OneDrive\Desktop\` copies of any HTML files you keep there.

---

## 2. `TV_WEBHOOK_SECRET` — nightly scan → webhook

**What it is:** a random 32-byte URL-safe string, generated with Python's
`secrets.token_urlsafe(30)`. Sent by `tools/signal-scan.js` (GitHub Actions) on every
signal insert.

**What it can do:** POST fake signals to `tv-webhook` tagged `source: scan`. That's
all — the function has no other powers. But at scale that's data poisoning of the
Setups page, so treat a leak as urgent.

**Where it lives — two stores, kept in sync:**

| Store | Path | Set by |
|---|---|---|
| Supabase | Project → Edge Functions → `tv-webhook` → Secrets (or `supabase secrets set`) | CLI / dashboard |
| GitHub | Repo → Settings → Secrets and variables → Actions → `TV_WEBHOOK_SECRET` | Dashboard, or API (libsodium sealed box — see tools note below) |

Never displayed anywhere in the portal, never printed in any log, never in a
screenshot. The only copies that exist outside those two stores are in this machine's
environment during rotation, and in chat transcripts *if* you paste a value into a
conversation — which is exactly why its rotation history is: `my8sl…` → `aO50…`
(screenshot leak) → `nLEs…` (rotated 27 Sep 2026 as part of the two-secret split;
`aO50…` retired the same day — it had appeared in a chart screenshot, and was the last
single secret shared by scan and chart paths).

**Rotation steps (both stores in one sitting — partial rotation breaks the scan):**

1. Generate: `python -c "import secrets; print(secrets.token_urlsafe(30))"`
2. Supabase: `supabase secrets set TV_WEBHOOK_SECRET=<new> --project-ref chbtjicvbezbiosuouwm`
   (needs a Supabase access token — see #4)
3. Redeploy so the function picks it up:
   `supabase functions deploy tv-webhook --project-ref chbtjicvbezbiosuouwm --use-api --no-verify-jwt`
   (`--use-api` because Docker isn't installed here; `--no-verify-jwt` because
   TradingView/Actions send no Supabase JWT — the function does its own secret check)
4. GitHub: repo → Settings → Secrets and variables → Actions → `TV_WEBHOOK_SECRET` →
   Update. (API alternative, if you have a GitHub token with `repo` scope:
   `tools/` note below.)
5. Verify within 24h (before the next scheduled 12:30 UTC run):
   `Actions → Nightly zone signal scan → Run workflow` (dry run unticked). The run log
   must show `saved` or `skip (already recorded)` lines, never `FAIL … HTTP 401`.
6. Direct probe (optional but conclusive):
   `curl -X POST https://chbtjicvbezbiosuouwm.supabase.co/functions/v1/tv-webhook -H "Content-Type: application/json" -d '{"secret":"<new>","symbol":"SBIN.NS","action":"LONG","price":1,"details":"rotation check"}'`
   → expect `{"ok":true,…}`. Old value must return `401`.

**If leaked:** do all six steps now. A leaked scan secret lets an attacker write
convincing fake signals silently — dedup won't hide them and RLS won't block them
(the function's service-role key bypasses RLS by design). Check
`signal_events` for rows you don't recognise (`source: scan` filtering by eye).

---

## 3. `TV_CHART_SECRET` — TradingView → webhook

**What it is:** a random 32-byte URL-safe string, separate from #2 on purpose (see the
two-secret split, commit `4ed8056`).

**What it can do:** POST fake signals to `tv-webhook` tagged `source: chart`. The
`source` column makes chart-origin rows distinguishable from scan-origin rows, so a
compromised chart path is visible in the data.

**Assume it is already leaked.** It lives in the Pine indicator's *Inputs*, which
TradingView prints in the chart status line and every settings dialog — the user's own
screenshots have exposed two earlier values. This is accepted, not a vulnerability:
its blast radius stops at chart-tagged fakes.

**Where it lives:** Supabase secrets + whatever the user pasted into the indicator on
each TradingView chart layout. Nothing else.

**Rotation steps (any time it's convenient; the scan keeps working throughout):**

1. Generate: `python -c "import secrets; print(secrets.token_urlsafe(30))"`
2. Supabase: `supabase secrets set TV_CHART_SECRET=<new>` (see #4 for auth), then
   redeploy as in #2 step 3.
3. TradingView: open each chart layout that uses the indicator → LFC Zones ⚙ →
   Inputs → replace the value in **Webhook secret (must equal TV_CHART_SECRET)**.
   There is no API for this — it is a per-layout paste, by hand.
4. Mitigation against future leaks (optional, per layout): Chart Settings → Status
   Line → untick "Indicator arguments" and "Indicator values" so the legend stops
   printing inputs. TradingView has no per-input hide; this chart option is the only
   mechanism.

**If leaked:** rotate when convenient. Check `signal_events` for unexpected
`source: chart` rows. Never touch #2 — that's the entire point of the split.

---

## 4. Supabase access token (personal access token)

**What it is:** an `sbp_…` token from https://supabase.com/dashboard/account/tokens.
Authenticates *you* (not the project) to the Management API and CLI.

**What it can do:** everything — run SQL against the production database, deploy
functions, read and write secrets, manage auth. This is the most powerful credential
in the project.

**Where it lives:** only where you paste it. Never in the repo (verified by grep),
never in a file on disk (temp scripts containing it are deleted after use). It
necessarily appears in chat transcripts when pasted there — hence the standing rule:

> **Revoke every Supabase PAT the moment the work that needed it is done.** This
> project's pattern: mint → paste → deploy → revoke. Rotation is cheap because a new
> token is one click and nothing else needs updating.

**Rotation / revocation steps:**

1. https://supabase.com/dashboard/account/tokens → find the token → **Revoke**.
   Immediate, global, no side effects on anything already deployed.
2. Nothing else to update — future work mints a fresh one.

**If leaked:** revoke now (step 1), then audit: Supabase Dashboard → Database →
check for unexpected tables/policies; Logs → check for unexpected API traffic.
Because the token was in a chat transcript, the audit window is from when it was
pasted to when it was revoked.

---

## 5. GitHub credential (git push / Actions API)

**What it is:** whatever Git uses on this machine to push, and whatever scripts use to
call the GitHub API. Currently a GitHub OAuth token delivered via Git Credential
Manager (`git credential fill` returns it on demand).

**What it can do:** push to `main` (which redeploys the site via Actions), edit
workflows, read Actions logs, manage repo secrets and variables. Near-full control of
the repo.

**Where it lives:** Windows Credential Manager (store: `git:https://github.com`).
Scripts in this project read it at runtime via
`printf 'protocol=https\nhost=github.com\n\n' | git credential fill` — nothing stores
the value in a file, and it has never been committed (verified by grep of history
during the leak audit).

**Rotation steps:**

1. GitHub → Settings → Developer settings → Personal access tokens → find the token
   (or revoke *all* fine-grained/OAuth tokens if unsure — Git Credential Manager will
   re-authenticate on next push).
2. On this machine, clear the cached copy so the next push prompts fresh:
   `cmdkey /delete:git:https://github.com` (or Windows → Credential Manager →
   Windows Credentials → remove the `git:https://github.com` entry).
3. Next `git push` triggers a browser sign-in; the new credential is stored
   automatically.
4. Verify: `git push --dry-run` succeeds; `gh auth status` (if you use gh CLI) is
   clean.

**If leaked:** rotate (above), then audit the repo: Settings → Actions → check for
workflows you didn't add; commit history for commits you didn't make; Insights →
Dependency graph for surprises. Because pushes redeploy the site, also check
Deployments for runs you didn't trigger.

---

## 6. Portal admin account

**What it is:** the username/password that signs into the journal and unlocks admin
features (user management, audit log, and — via RLS — all data tables).

**What it can do:** everything a signed-in user can, plus write access gated by
`is_current_user_admin()`: edit `scan_symbols` from the Setups page, manage
`app_users`, read `audit_log`. It is the only credential whose compromise exposes
*content*, not just the ability to write fakes.

**Where it lives:** Supabase Auth (`auth.users`) + an `is_admin` flag in
`app_users`. The password exists only in the user's head/password manager — it has
never been stored in the repo or on disk.

**Rotation steps (manual, by the admin):**

1. Sign in → journal → user management → set a new password for the admin account
   (the portal's own UI handles this; the exact flow is the same one used to onboard
   any user).
2. If the old password may be in someone else's hands, also sign out all sessions:
   Supabase Dashboard → Authentication → Users → admin account → remove sessions.
3. Verify: old password fails, new password works, admin features still present.

**If leaked:** rotate (above) + audit `audit_log` for actions you didn't take, and
`signal_events`/`ideas` for rows you didn't create. RLS kept the write-gates intact —
the risk is content authenticity, not structure.

---

## Standing rules (what keeps this runbook short)

1. **One purpose per credential.** A new integration gets a new secret, never a
   recycled one. The moment two things share a secret, one leak doubles the work.
2. **A secret that appears on screen is a different tier of secret.** Anything visible
   in a chart legend, screenshot, or settings dialog must never be the same value as
   something server-side-only. (#2 vs #3 exists because of this rule.)
3. **PATs are single-session.** Mint, paste, deploy, revoke — in that order, same
   sitting. A long-lived Supabase PAT is a standing invitation.
4. **Grep before you commit.** `git diff --staged | grep -E "sbp_|secret.*=.*[A-Za-z0-9]{20}"` catches most accidents. The repo has never
   contained a secret value (verified 27 Sep 2026 across full history); keep it that
   way.
5. **Rotation is only real if it's verified.** Every rotation in this runbook ends
   with a live check — a 200 from the new value and a 401 from the old. Do not skip
   that step.

---

## Verification commands (copy-paste, 2 minutes, run after any change)

```bash
# 1. No secret values in the working tree or full git history.
#    (Dead values only — a value that is still live must NEVER appear here,
#    including in this file. After every rotation, add the newly-dead value to
#    the grep list below and drop nothing live.)
cd "C:\Users\tinch\OneDrive\Documents\www\.freebuff\Learningfundclear"
git grep -nE "my8sl-pSk" -- . || echo "clean: no known dead secret values"
git log --all -p | grep -cE "sbp_[A-Za-z0-9]{20,}" || echo "clean: no PAT in history"

# 2. Both edge-function secrets exist (names only, via CLI — needs a live PAT)
supabase secrets list --project-ref chbtjicvbezbiosuouwm 2>/dev/null | grep -E "TV_WEBHOOK_SECRET|TV_CHART_SECRET"

# 3. GitHub secret exists (name only — the API never returns values)
curl -s -H "Authorization: token $(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')" \
  "https://api.github.com/repos/sebasishpanda20-creator/Learningfundclear/actions/secrets" | python -c "import sys,json;print([s['name'] for s in json.load(sys.stdin).get('secrets',[])])"

# 4. RLS on every table (paste into the dashboard SQL editor if no PAT)
#    select tablename, policyname, cmd from pg_policies where schemaname='public';

# 5. Old webhook secrets are dead — expect HTTP 401 from each.
curl -s -o /dev/null -w "dead my8sl…: %{http_code} (expect 401)\n" -X POST \
  https://chbtjicvbezbiosuouwm.supabase.co/functions/v1/tv-webhook \
  -H "Content-Type: application/json" -d '{"secret":"my8sl-pSk-Ulf6LuDGwdalOm-HD-LIaX4wSmeeXNf7Q","symbol":"X","action":"LONG"}'
curl -s -o /dev/null -w "dead aO50…: %{http_code} (expect 401)\n" -X POST \
  https://chbtjicvbezbiosuouwm.supabase.co/functions/v1/tv-webhook \
  -H "Content-Type: application/json" -d '{"secret":"aO50-9airBjO6_HLlnIkzSOXJGKpWiRGjEERd91bsHc","symbol":"X","action":"LONG"}'
```

> Note: check #5 hardcodes historical **dead** values only (`my8sl…` dead since the
> first rotation; `aO50…` dead since the two-secret split on 27 Sep 2026). Never put
> a live value in this file — after each rotation, add the newly-dead value here.

---

## Incident quick reference

| Symptom | Check first | Runbook section |
|---|---|---|
| Fake signals on Setups, tag `scan` | Recent Actions runs you didn't trigger? | #2 — rotate now |
| Fake signals on Setups, tag `chart` | Unexpected chart layouts, shared indicator? | #3 — rotate when convenient |
| Unknown tables/policies in Supabase | PAT usage outside this workflow? | #4 — revoke now |
| Unknown commits or workflow runs | GitHub token shared with any app? | #5 — rotate now |
| Unknown content in journal/ideas | Admin password reused anywhere? | #6 — rotate + audit |
| Portal reads fail for signed-in users | RLS policies intact? Anon key current? | #1 — verify, rarely rotate |
