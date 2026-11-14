# AGENTS.md — LearningFundClear

Notes for humans and AI agents working in this repository.

## Rebase before push — scheduled data commits own `main` too

Two workflows commit directly to `main` on a schedule:

- `.github/workflows/nifty500-data.yml` — `Update encrypted Nifty 500 snapshot`,
  every 15 minutes on weekday market sessions.
- `.github/workflows/deploy-pages.yml` — `data: refresh NAV snapshot`,
  daily at 06:15 IST (after AMFI publishes the previous day's NAV file)
  and on its `workflow_dispatch` runs.

Rule for every manual push (and every local branch you are about to publish):

1. `git fetch origin && git rebase origin/main` immediately before
   `git push`. A branch that was current an hour ago almost certainly is not
   now — expect to pick up scheduled data commits.
2. If the push is rejected as non-fast-forward, that is the normal outcome of
   racing a scheduled refresh: fetch, rebase, push again. Never use
   `git push --force` / `--force-with-lease` to "resolve" it — that destroys
   scheduled snapshot commits and forces every other checkout to re-sync.
   Force-pushes require explicit, separate user authorization.
3. Keep feature/engine/UI commits free of data files. If a rebase drags a
   scheduled snapshot into your commit (or yours into a data file), resolve
   the conflict by keeping the upstream version on the data file and your
   version on the code file.
4. Don't build a fix or PR branch from a stale local `main` without rebasing
   onto `origin/main` first — branching days behind `origin/main` is how
   unrelated conflicts get invented.

Long-lived local checkouts (worktrees, VMs) are the most likely to generate
these races, so they are the ones that must follow rule 1 every single time.
