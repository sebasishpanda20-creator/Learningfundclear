import {serveAlerts,runAlerts} from './email-alerts.mjs';
import {serveNifty} from './nifty-api.mjs';
import config from './config.mjs';
import {serveDeltaAccount} from './delta-account.mjs';
import {proxyToDaemon} from './quant-proxy.mjs';
import {issueTicket,guardTerminal,portalRole,terminalGateOpen} from './terminal-gate.mjs';
import {serveMarketYahoo,serveMarketMfapi} from './market-proxy.mjs';
import {runDaemonWatch} from './daemon-watch.mjs';
import {handleFyers} from './fyers-routes.mjs';
import {serveHedgePlan} from './hedging-engine.mjs';
export {FyersVault} from './fyers-vault.mjs';

const json=(body,status=200)=>Response.json(body,{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

// The terminal cookie is a browser credential for this worker only: never let
// it reach the daemon behind the tunnel.
function withoutCookies(request){
  const headers=new Headers(request.headers);
  headers.delete('cookie');
  return new Request(request,{headers});
}

// Tells the daemon which role the verified portal session holds. The cookie is
// always dropped here: the Supabase token is a credential for this Worker only.
// A human navigating (or a framed page), as opposed to a fetch for a script,
// stylesheet or image. Only these get the HTML 404 page.
function wantsHtml(request){
  const dest=(request.headers.get('sec-fetch-dest')||'').toLowerCase();
  if(dest==='document'||dest==='iframe'||dest==='frame')return true;
  return (request.headers.get('accept')||'').includes('text/html');
}

function withPortalRole(request,role){
  const headers=new Headers(request.headers);
  headers.delete('cookie');
  headers.set('x-portal-admin',role==='admin'?'1':'0');
  return new Request(request,{headers});
}

export default {async fetch(request,env){
 const url=new URL(request.url);
 // FYERS v3 auth/quote: portal session + owner allowlist, state and tokens in a
 // strongly consistent Durable Object (Workers KV is eventually consistent).
 if(url.pathname==='/api/fyers'||url.pathname.startsWith('/api/fyers/'))return handleFyers(request,env,config);
 if(url.pathname==='/api/email-alerts')return serveAlerts(request,env,config);
 if(url.pathname==='/api/nifty500')return serveNifty(request,env,config);
 if(url.pathname==='/api/market/yahoo')return serveMarketYahoo(request,env,config);
 if(url.pathname==='/api/market/mfapi')return serveMarketMfapi(request,env,config);
 if(url.pathname==='/api/delta/account')return serveDeltaAccount(request,env,config);
 // Terminal access ticket: the signed-in shell exchanges its Supabase session
 // for a short-lived HttpOnly cookie scoped to /quant-terminal.
 if(url.pathname==='/api/terminal-ticket')return issueTicket(request,env,config);
 // Quant daemon reverse proxy: JSON API (same-origin for the dashboard's
 // fetches) and the framed execution terminal.
 // The daemon's JSON API lives under /api/v1 on its own origin, so the full
 // pathname is forwarded (not the stripped suffix): dropping the prefix sent
 // /api/v1/health to the daemon's /health and answered 404.
 if(url.pathname==='/api/v1'||url.pathname.startsWith('/api/v1/')){
   // The daemon authenticates its own API calls with X-Admin-Token and
   // X-Portal-Proxy. This route deliberately does NOT add the terminal-ticket
   // gate: the framed terminal's reads and order actions carry that token, and
   // requiring the 10-minute ticket as well made every action a silent 401 once
   // the cookie aged out (only the embed re-mints it). Hardening belongs in the
   // daemon's own admin/keyless mode, not in a second expiring gate here.
   // When a portal session rides along, assert its role so the daemon can open
   // admin controls without a second sign-in; otherwise forward without the
   // browser credential and let the daemon apply its own auth.
   const role=await portalRole(request,config);
   return proxyToDaemon(role?withPortalRole(request,role):withoutCookies(request),env,url.pathname,url.search);
 }
 // Plan-only hedging: validated research templates for the existing portal
 // segments. The handler never reads env/config, never calls a broker and never
 // places an order, so it is deliberately not behind the terminal gate.
 if(url.pathname==='/api/hedge-plan')return serveHedgePlan(request);
 // Unknown /api/* routes must return JSON error, not HTML fallback.
 if(url.pathname.startsWith('/api/')){
   return json({ error: 'Not found' }, 404);
 }
 // The terminal is normally served only to a signed-in dashboard session;
 // OPEN_TERMINAL=1 opens the route to anonymous visitors (see terminal-gate.mjs).
 if(url.pathname==='/quant-terminal'||url.pathname==='/quant-terminal/'||url.pathname.startsWith('/quant-terminal/')){
   const open=terminalGateOpen(env);
   if(!open){
     const denied=await guardTerminal(request,env,config);
     if(denied)return denied;
   }
   const role=await portalRole(request,config);
   // An open route with no session forwards no role at all: the daemon then
   // applies its own auth instead of being told this visitor is a mere viewer.
   const forwarded=open&&!role?withoutCookies(request):withPortalRole(request,role||'viewer');
   return proxyToDaemon(forwarded,env,url.pathname.slice('/quant-terminal'.length),url.search);
 }
 // The Sites asset handler answers a miss with an empty 404 instead of serving
 // not_found_handling's page, so a human navigating to an unknown path would get
 // a blank screen. Serve the same 404.html the static host would have, keeping
 // the 404 status; document/HTML requests only, so a missing .js or image stays
 // an empty 404 rather than returning markup.
 const assets=await env.ASSETS.fetch(request);
 if(assets.status===404&&request.method!=='POST'&&wantsHtml(request)){
   const page=await env.ASSETS.fetch(new URL('/404.html',url));
   if(page.ok){
     const headers=new Headers(page.headers);
     headers.set('cache-control','no-store');
     return new Response(page.body,{status:404,headers});
   }
 }
 return assets;},async scheduled(event,env,ctx){ctx.waitUntil(runAlerts(env));ctx.waitUntil(runDaemonWatch(env));}};
