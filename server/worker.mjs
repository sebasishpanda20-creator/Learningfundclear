import {serveAlerts,runAlerts} from './email-alerts.mjs';
import {serveNifty} from './nifty-api.mjs';
import config from './config.mjs';
import {serveDeltaAccount} from './delta-account.mjs';
import {proxyToDaemon} from './quant-proxy.mjs';
import {issueTicket,guardTerminal,portalRole} from './terminal-gate.mjs';
import {serveMarketYahoo,serveMarketMfapi} from './market-proxy.mjs';

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

// Keeps the Render-hosted daemon awake. Render's free plan suspends an idle
// service after ~15 minutes, and the next request then waits ~50s for a cold
// start, which the desk shows as "Terminal unreachable". This Worker already
// runs a cron every minute for alerts, so the same tick polls the daemon's
// health endpoint and never leaves it idle — no third-party monitor needed.
// No-op until QUANT_API_ORIGIN points at the daemon's real HTTPS origin.
export async function keepDaemonWarm(env,fetcher=fetch){
 const origin=String((env&&env.QUANT_API_ORIGIN)||'').trim().replace(/\/+$/,'');
 if(!/^https?:\/\//i.test(origin))return false;
 const headers={};
 // A free ngrok origin answers its splash page without this header.
 if(/\.ngrok-free\.(dev|app)$/i.test(origin))headers['ngrok-skip-browser-warning']='learningfundclear-portal';
 try{await fetcher(origin+'/api/v1/health',{method:'GET',headers,cache:'no-store',signal:AbortSignal.timeout(10000)});return true;}
 catch{/* The desk's own probe stays the source of truth for outages; a failed warm-up must not fail the cron. */return false;}
}

export default {async fetch(request,env){
 const url=new URL(request.url);
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
 // The terminal is only served to a signed-in dashboard session.
 if(url.pathname==='/quant-terminal'||url.pathname==='/quant-terminal/'||url.pathname.startsWith('/quant-terminal/')){
   const denied=await guardTerminal(request,env,config);
   if(denied)return denied;
   const role=await portalRole(request,config);
   return proxyToDaemon(withPortalRole(request,role||'viewer'),env,url.pathname.slice('/quant-terminal'.length),url.search);
 } return env.ASSETS.fetch(request);},async scheduled(event,env,ctx){ctx.waitUntil(runAlerts(env));ctx.waitUntil(keepDaemonWarm(env));}};
