import {serveStockHistory} from './stock-history.mjs';
import {serveAlerts,runAlerts} from './email-alerts.mjs';
import {serveNifty} from './nifty-api.mjs';
import {serveIndexHistory} from './index-history.mjs';
import config from './config.mjs';
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/api/stock-history')return serveStockHistory(request,config);
 if(url.pathname==='/api/index-history')return serveIndexHistory(request,config);
 if(url.pathname==='/api/email-alerts')return serveAlerts(request,env,config);
 if(url.pathname==='/api/nifty500')return serveNifty(request,env,config);
 return env.ASSETS.fetch(request);
},async scheduled(event,env,ctx){ctx.waitUntil(runAlerts(env));}};
