import {serveNifty} from './nifty-api.mjs';
import config from './config.mjs';
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/api/nifty500')return serveNifty(request,env,config);
 return env.ASSETS.fetch(request);
}};
