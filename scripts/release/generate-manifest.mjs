#!/usr/bin/env node
// Release manifest: generated from the resolved import graph of dist/, never
// hand-edited. Delegates to scripts/regen-manifest.mjs.
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, ['scripts/regen-manifest.mjs', '.'], { stdio: 'inherit', cwd: process.cwd() });
