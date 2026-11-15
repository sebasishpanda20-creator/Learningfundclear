import {serveAlerts,runAlerts} from './email-alerts.mjs';
import {serveNifty} from './nifty-api.mjs';
import config from './config.mjs';
import {serveDeltaAccount} from './delta-account.mjs';
import {proxyToDaemon} from './quant-proxy.mjs';
import {issueTicket,guardTerminal,portalRole,terminalGateOpen} from './terminal-gate.mjs';
import {serveMarketYahoo,serveMarketMfapi} from './market-proxy.mjs';
import {runDaemonWatch} from './daemon-watch.mjs';
import {handleFyers} from './fyers-routes.mjs';
export {FyersVault} from './fyers-vault.mjs';

// The terminal cookie is a browser credential for this worker only: never let
// it reach the daemon behind the tunnel.
function withoutCookies(request){
  const headers=new Headers(request.headers);
  headers.delete('cookie');
  return new Request(request,{headers});
}

// Tells the daemon which role the verified portal session holds. The cookie is
// always dropped here: the Supabase token is a credential for this Worker only.
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
   // The framed terminal calls the daemon API on this path. When the portal
   // session cookie rides along, assert its role so admin controls open without
   // a second sign-in; requests without the cookie are proxied unchanged.
   const role=await portalRole(request,config);
   return proxyToDaemon(role?withPortalRole(request,role):withoutCookies(request),env,url.pathname,url.search);
 }
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
 } return env.ASSETS.fetch(request);},async scheduled(event,env,ctx){ctx.waitUntil(runAlerts(env));ctx.waitUntil(runDaemonWatch(env));}};
