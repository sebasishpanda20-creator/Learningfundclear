import {readFileSync,writeFileSync,cpSync,mkdirSync,readdirSync,copyFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
rmSync('dist',{recursive:true,force:true});
mkdirSync('dist/client',{recursive:true});
for(const file of readdirSync('.')) if(file.endsWith('.html')) copyFileSync(file,join('dist/client',file));
for(const dir of ['assets','funds'])cpSync(dir,join('dist/client',dir),{recursive:true,filter:p=>!p.includes('/tools')&&!p.endsWith('netlify.toml')&&!p.endsWith('_headers')});
for(const file of ['auth-guard.js','scanner-logic.js','india_symbols.json'])copyFileSync(file,join('dist/client',file));
mkdirSync('dist/client/tools',{recursive:true});copyFileSync('tools/signal-watchlist.json','dist/client/tools/signal-watchlist.json');

mkdirSync('dist/server',{recursive:true});
cpSync('server','dist/server',{recursive:true});
copyFileSync('server/worker.mjs','dist/server/index.js');
const config=readFileSync('assets/js/config.js','utf8').replace('window.LFC_CONFIG =','export default');
writeFileSync('dist/server/config.mjs',config);
mkdirSync('dist/.openai',{recursive:true});
copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');
