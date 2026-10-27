"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const file=p=>fs.readFileSync(p,"utf8");
test("Cloudflare production Worker preserves stock and index relays and private market feed",()=>{
 const worker=file("server/worker.mjs"),cfg=JSON.parse(file("wrangler.jsonc"));
 for(const endpoint of ["/api/stock-history","/api/index-history","/api/nifty500"])assert(worker.includes(endpoint),endpoint);
 assert.equal(cfg.name,"learningfundclear");
 assert(cfg.secrets?.required?.includes("NIFTY_FEED_PRIVATE_KEY"));
 assert.equal(cfg.assets?.binding,"ASSETS");
 assert(!worker.includes("create-order")&&!worker.includes("POST /api/trade"));
});
test("Cloudflare portal preserves original sections and adds the two crypto desks",()=>{
 const shell=file("assets/js/shell.js");
 for(const name of ["Stock & crypto scanner","Index scanner","Trading plan","My account","Crypto options desk","Crypto funding desk"])
  assert(shell.includes(name),name);
 for(const page of ["crypto-options.html","crypto-funding.html"]){
  const html=file(page);
  assert(html.includes('assets/js/shell.js')&&html.includes('auth-guard.js'));
  assert(html.includes('assets/js/crypto-desk-ui.js'));
 }
 assert(file("crypto.html").includes("assets/js/crypto-signals.js"),"Preserve spot-market signals");
 assert(file("crypto.html").includes("crypto-options.html"),"Link new options desk");
 assert(file("crypto.html").includes("crypto-funding.html"),"Link new funding desk");
});
test("Research-only validation and visible capital diagnostics are shipped",()=>{
 const ui=file("assets/js/crypto-desk-ui.js"),opts=file("crypto-options.html");
 assert(opts.includes('id="runValidation"')&&opts.includes('id="capitalDiagnostics"'));
 assert(ui.includes("capitalDiagnostics()"));
 assert(ui.includes("sizedCapitalINR"));
 assert(file("assets/js/crypto-validation-engine.js").includes("PRELIMINARY HISTORICAL RESEARCH"));
});
