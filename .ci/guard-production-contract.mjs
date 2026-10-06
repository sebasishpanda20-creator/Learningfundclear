// Contracts for the unified authenticated portal. Dynamic shell is tested in browser QA.
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const read=p=>readFileSync(p,'utf8');
const pages={'index.html':'dashboard','performance.html':'performance','admin.html':'admin','scanner.html':'scanner','setups.html':'setups','gex.html':'gex','crypto.html':'crypto','funds/index.html':'funds','funds/funds.html':'funds','funds/scheme.html':'funds','funds/compare.html':'funds','funds/calculators.html':'funds','funds/methodology.html':'funds','funds/legal.html':'funds'};
for(const [page,key] of Object.entries(pages)){
 const h=read(page),prefix=page.startsWith('funds/')?'../':'';
 assert(h.includes('name="viewport"'),page+' viewport');assert(h.includes(`data-page="${key}"`),page+' active navigation key');
 for(const src of ['assets/js/theme.js','assets/js/shell.js','auth-guard.js','assets/js/config.js'])assert.equal([...h.matchAll(/<script[^>]*src="([^"]+)"/g)].filter(m=>m[1]===prefix+src).length,1,page+' '+src);
 for(const src of ['assets/css/app.css','assets/css/tokens.css'])assert.equal([...h.matchAll(/<link[^>]*href="([^"]+)"/g)].filter(m=>m[1]===prefix+src).length,1,page+' '+src);
 for(const [,ref] of h.matchAll(/(?:src|href)="([^"]+)"/g)){
  if(/^(?:https?:|#|mailto:|data:)/.test(ref))continue;const clean=ref.split(/[?#]/)[0];if(/\.(html|js|css|json|svg)$/.test(clean))assert(existsSync(path.join(path.dirname(page),clean)),page+' unresolved '+ref);
 }
}
const shell=read('assets/js/shell.js'),auth=read('auth-guard.js');
for(const page of Object.values(pages))assert(shell.includes('"'+page+'"'),'shell route '+page);
for(const required of ['LfcAuth.logout()','aria-current','aria-expanded','Escape','is_admin'])assert(shell.includes(required),'shell '+required);
for(const required of ['signOut','onAuthStateChange','pageshow','safeTarget'])assert(auth.includes(required),'auth '+required);
const hooks={
 'index.html':['search','rating','status','timeFrame','watchFilter','toggleWatch','ideasBody','ideasEmpty','retryIdeas'],
 'admin.html':['ticker','saveIdea','closeIdea','exitPrice','closeIdeaBtn','adminIdeasBody','newUsername','createUser','usersBody','auditBody'],
 'performance.html':['perfYear','closedCount','positiveCount','negativeCount','averageReturn','performanceBody'],
 'scanner.html':['pLeft','pRight','tfDaily','tfWeekly','tfMonthly','tfHourly','tf15','trendFilter','scanBtn','watchInput','saveWatch','importFile','resultsBody','downloadBtn','chart','historySource','historyFile','forceRefresh','feedIssues'],
 'setups.html':['sigBody','refreshSigs','scanList','scanAdd','scanAddBtn','addManual','riskCard','paperOpen','ledgerBody'],
 'gex.html':['sym','exp','load','auto','mkt','stamp','stats','bars','flip','chainMeta','chain'],
 'crypto.html':['venue','asset','interval','lastPrice','spotStatus','cryptoChart','deltaRows']};
for(const [page,ids] of Object.entries(hooks))for(const id of ids)assert(read(page).includes(`id="${id}"`),page+' missing #'+id);
const tokens=new Set([...read('assets/css/tokens.css').matchAll(/--(lfc-[\w-]+)\s*:/g)].map(m=>m[1]));for(const [,ref] of read('funds/assets/css/style.css').matchAll(/var\(--(lfc-[\w-]+)/g))assert(tokens.has(ref),'undefined fund token '+ref);
for(const file of ['tools/signal-scan.js','tools/test-signal-guards.js','tools/test-weekly-line.js','tools/engine/candle.js','tools/engine/zone.js','tools/engine/pipeline.js','.github/workflows/deploy-pages.yml','.github/workflows/signal-scan.yml','.github/workflows/scan-watchdog.yml','.github/workflows/pre-push-html-guard.yml'])assert(existsSync(file),'required '+file);
const scan=read('tools/signal-scan.js');for(const text of ['type: "legacy-pivot"','scannerType: "gtf-pro"','enabled: process.env.GTF_PRO === "true" || false','const GTF_PRO_ENABLED = GTF_PRO.enabled','function parseYahoo','function loadRules','async function post','s.type,      // scannerType'])assert(scan.includes(text),'backend contract '+text);
assert(read('scanner-logic.js').includes('function computeZones'));
console.log('Production contract OK: shared shell, authentication, functional hooks, assets, tokens and backend signal gates.');
