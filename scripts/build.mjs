import {cpSync,mkdirSync,readdirSync,copyFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
rmSync('dist',{recursive:true,force:true});
mkdirSync('dist',{recursive:true});
for(const file of readdirSync('.')) if(file.endsWith('.html')) copyFileSync(file,join('dist',file));
for(const dir of ['assets','funds'])cpSync(dir,join('dist',dir),{recursive:true,filter:p=>!p.includes('/tools')&&!p.endsWith('netlify.toml')&&!p.endsWith('_headers')});
for(const file of ['auth-guard.js','scanner-logic.js','india_symbols.json'])copyFileSync(file,join('dist',file));
mkdirSync('dist/tools',{recursive:true});copyFileSync('tools/signal-watchlist.json','dist/tools/signal-watchlist.json');
