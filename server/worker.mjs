import {serveAlerts,runAlerts} from './email-alerts.mjs';
import {serveNifty} from './nifty-api.mjs';
import config from './config.mjs';
import {serveDeltaAccount} from './delta-account.mjs';
import {proxyToDaemon} from './quant-proxy.mjs';
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/api/email-alerts')return serveAlerts(request,env,config);
 if(url.pathname==='/api/nifty500')return serveNifty(request,env,config);
 if(url.pathname==='/api/delta/account')return serveDeltaAccount(request,env,config);
 // Quant daemon reverse proxy: JSON API (same-origin for the dashboard's
 // fetches) and the framed execution terminal.
 // The daemon's JSON API lives under /api/v1 on its own origin, so the full
 // pathname is forwarded (not the stripped suffix): dropping the prefix sent
 // /api/v1/health to the daemon's /health and answered 404.
 if(url.pathname==='/api/v1'||url.pathname.startsWith('/api/v1/'))
   return proxyToDaemon(request,env,url.pathname,url.search);
 if(url.pathname==='/quant-terminal'||url.pathname==='/quant-terminal/'||url.pathname.startsWith('/quant-terminal/'))
   return proxyToDaemon(request,env,url.pathname.slice('/quant-terminal'.length),url.search);
 return env.ASSETS.fetch(request);
},async scheduled(event,env,ctx){ctx.waitUntil(runAlerts(env));}};
