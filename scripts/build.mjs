import {cpSync,mkdirSync,readdirSync,copyFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
rmSync('dist',{recursive:true,force:true});
mkdirSync('dist/client',{recursive:true});
for(const file of readdirSync('.')) if(file.endsWith('.html')) copyFileSync(file,join('dist/client',file));
for(const dir of ['assets','funds'])cpSync(dir,join('dist/client',dir),{recursive:true,filter:p=>!p.includes('/tools')&&!p.endsWith('netlify.toml')&&!p.endsWith('_headers')});
for(const file of ['auth-guard.js','scanner-logic.js','india_symbols.json'])copyFileSync(file,join('dist/client',file));
mkdirSync('dist/client/tools',{recursive:true});copyFileSync('tools/signal-watchlist.json','dist/client/tools/signal-watchlist.json');

mkdirSync('dist/server',{recursive:true});
// server/worker.mjs is the source entrypoint; it is emitted as index.js only,
// so the upload tree never carries a duplicate worker file.
cpSync('server','dist/server',{recursive:true,filter:p=>!p.endsWith('worker.mjs')});
copyFileSync('server/worker.mjs','dist/server/index.js');
if(!process.argv.includes('--cloudflare') && existsSync('.openai/hosting.json')) {
  mkdirSync('dist/.openai',{recursive:true});
  copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
}
