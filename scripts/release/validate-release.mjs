#!/usr/bin/env node
// Release validation: one verdict. Delegates to scripts/deploy-gate.mjs, which
// runs node --check, import resolution, manifest parity, the full .ci/guard.sh
// and qa/terminal-open.test.mjs. Exit code is the answer; nothing is uploaded.
import { execFileSync } from 'node:child_process';

try {
  execFileSync(process.execPath, ['scripts/deploy-gate.mjs'], { stdio: 'inherit', cwd: process.cwd() });
} catch {
  process.exit(1);
}
