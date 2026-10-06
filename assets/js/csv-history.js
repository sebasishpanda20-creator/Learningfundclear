/* Local daily history only; files stay in this tab and are never uploaded. */
(function(root){
 'use strict';
 function split(text){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(!quoted&&cell!=='')throw new Error('Malformed CSV quote');else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n')){row.push(cell.trim());cell='';if(c==='\n'){if(row.some(Boolean))rows.push(row);row=[];}}else if(c!=='\r')cell+=c;}
  if(quoted)throw new Error('Unclosed CSV quote');row.push(cell.trim());if(row.some(Boolean))rows.push(row);return rows;
 }
 function parse(text,now=Date.now()){
  if(text.length>10*1024*1024)throw new Error('Use a CSV smaller than 10 MB');
  const rows=split(text.replace(/^\uFEFF/,''));if(rows.length<2)throw new Error('CSV needs a header and history rows');
  const headers=rows.shift().map(x=>x.toLowerCase().replace(/[ _-]/g,''));
  const fields=['symbol','date','open','high','low','close','volume'];const indexes=Object.fromEntries(fields.map(k=>[k,headers.indexOf(k)]));
  for(const f of fields)if(indexes[f]<0)throw new Error('Missing column: '+f+'. Required: symbol,date,open,high,low,close,volume');
  const result=new Map();
  rows.forEach((row,i)=>{
   const value=k=>row[indexes[k]];const symbol=(value('symbol')||'').toUpperCase();const date=value('date');
   if(!/^[A-Z0-9&._-]+\.(NS|BO)$/.test(symbol))throw new Error('Row '+(i+2)+': use an NSE .NS or BSE .BO symbol');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Row '+(i+2)+': date must be YYYY-MM-DD');
   const timestamp=Date.parse(date+'T00:00:00+05:30')/1000;
   if(!Number.isFinite(timestamp)||new Date((timestamp+19800)*1000).toISOString().slice(0,10)!==date||timestamp*1000>now)throw new Error('Row '+(i+2)+': invalid or future date');
   const nums=['open','high','low','close','volume'].map(k=>value(k)===''?NaN:Number(value(k)));
   const [open,high,low,close,volume]=nums;
   if(!nums.every(Number.isFinite)||low<=0||high<Math.max(open,close,low)||low>Math.min(open,close)||volume<0)throw new Error('Row '+(i+2)+': invalid OHLC or volume');
   if(!result.has(symbol))result.set(symbol,new Map());const bars=result.get(symbol);
   if(bars.has(timestamp))throw new Error('Duplicate date for '+symbol+': '+date);
   bars.set(timestamp,{timestamp,date,open,high,low,close,volume});
  });
  return new Map([...result].map(([symbol,bars])=>[symbol,[...bars.values()].sort((a,b)=>a.timestamp-b.timestamp)]));
 }
 function history(all,symbol,interval,now=Date.now()){
  if(interval!=='1d')throw new Error('Local CSV supports daily candles only');
  if(!all.has(symbol))throw new Error('No imported history for '+symbol);
  const original=all.get(symbol);const bars=original.filter(b=>LfcMarketData.endTime(b.timestamp,'1d',symbol,{})*1000+60000<=now);
  if(!bars.length)throw new Error('No completed daily candles in the file');
  return {symbol,bars,source:'Local CSV · unadjusted unless supplied adjusted',fetchedAt:now,candleAt:bars.at(-1).timestamp*1000,timezone:'Asia/Kolkata',gaps:0,discarded:0,incomplete:original.length-bars.length,stale:LfcMarketData.stale(bars,'1d',symbol,now)};
 }
 root.LfcCsvHistory={parse,history};
})(typeof window!=='undefined'?window:globalThis);
