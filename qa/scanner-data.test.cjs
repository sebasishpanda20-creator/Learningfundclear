const assert=require('node:assert/strict'),test=require('node:test');
global.window=global;require('../scanner-logic.js');require('../assets/js/market-data.js');
const S=LfcScanner,M=LfcMarketData;
const now=Date.parse('2026-10-05T07:00:00Z');
function bars(n=100){return Array.from({length:n},(_,i)=>({date:String(i),open:100,high:104,low:96,close:101,volume:100}));}
function chart(rows){return {chart:{result:[{meta:{gmtoffset:19800},timestamp:rows.map(r=>r[0]),indicators:{quote:[{open:rows.map(r=>r[1]),high:rows.map(r=>r[2]),low:rows.map(r=>r[3]),close:rows.map(r=>r[4]),volume:rows.map(r=>r[5])}]}}]}};}
const ts=now/1000;
test('50 completed bars supported; insufficient history rejected',()=>{assert(S.computeZones(bars(50)));assert.equal(S.computeZones(bars(49)),null)});
test('invalid prices and pivot parameters fail closed',()=>{let b=bars();b[90].close=NaN;assert.equal(S.computeZones(b),null);assert.equal(S.computeZones(bars(),{pivotRight:0}),null)});
test('a plateau is not counted as repeated confirmed pivots',()=>{assert.equal(S.computeZones(bars()).demandZones.length,0)});
test('zone creation includes confirmation and retests count visits after departure',()=>{let b=bars();b[85]={...b[85],low:90};b[93]={...b[93],high:110,low:106,open:108,close:108};let r=S.computeZones(b);assert.equal(r.demandZones[0].confirmedIndex,88);assert.equal(r.demandZones[0].touches,1);assert.equal(r.demandTop,r.nearestDemand.top)});
test('displayed demand zone is the matching older zone, not latest zone',()=>{let b=bars();b[60]={...b[60],low:80};b[80]={...b[80],open:92,close:92,high:94,low:90};b[99]={...b[99],open:98,close:99,low:97};let r=S.computeZones(b);assert.equal(r.demandZones[0].bottom,90);assert.equal(r.demandBottom,80);assert.equal(r.demandTop,101)});
test('opening above swing with close below it is not a breakout',()=>{let b=bars();b[90].high=110;b[99]={...b[99],open:112,high:113,close:108};assert.equal(S.computeZones(b).structureEvent,'NONE')});
test('repeated closes above a broken swing do not retrigger breakout',()=>{let b=bars();b[90].high=110;b[98]={...b[98],open:112,high:114,close:112};b[99]={...b[99],open:113,high:115,close:113};assert.equal(S.computeZones(b).structureEvent,'NONE')});
test('first closing-price crossing emits a structure event',()=>{let b=bars();b[90].high=110;b[99]={...b[99],open:108,high:115,close:113};assert.notEqual(S.computeZones(b).structureEvent,'NONE')});
test('body gaps with overlapping wicks are not fair value gaps',()=>{let b=bars();b[99]={...b[99],open:103,close:103};assert.equal(S.computeZones(b).fvg,null)});
test('an earlier filled wick gap cannot reappear',()=>{let b=bars();b[95]={...b[95],open:110,high:114,low:108,close:110};b[98].high=109;assert.equal(S.computeZones(b).fvg,null)});
test('volume ratio respects specified threshold and equality',()=>{let r={insideDemand:true,avgVol20:100,lastVol:150};assert(!S.includeRow(r,{minVolRatio:2}));assert(S.includeRow(r,{minVolRatio:1.5}))});
test('missing volume is unknown, not zero; missing SMA cannot earn short score',()=>{let b=bars();b[90].volume=null;let r=S.computeZones(b);assert.equal(r.avgVol20,null);assert.equal(S.confluenceScore(r,'SHORT'),0)});
test('normalizer sorts, deduplicates, rejects invalid OHLC and drops forming bars',()=>{let data=M.parseYahoo(chart([[ts-3600,100,110,90,105,20],[ts-7200,100,110,90,104,20],[ts-3600,100,110,90,106,20],[ts-300,100,110,90,105,20],[ts-1800,100,99,90,105,20]]),'TEST.NS','15m',now);assert.equal(data.bars.length,2);assert.equal(data.bars[1].close,106);assert.equal(data.discarded,1);assert.equal(data.incomplete,1)});
test('daily India session candle excluded before close and included after close',()=>{let raw=chart([[Date.parse('2026-10-05T03:45:00Z')/1000,100,110,90,105,20]]);assert.throws(()=>M.parseYahoo(raw,'TEST.NS','1d',now));assert.equal(M.parseYahoo(raw,'TEST.NS','1d',Date.parse('2026-10-05T10:02:00Z')).bars.length,1)});
test('weekly and monthly unfinished periods excluded',()=>{for(const interval of ['1wk','1mo'])assert.throws(()=>M.parseYahoo(chart([[ts-3600,100,110,90,105,20]]),'TEST.NS',interval,now))});
test('stale source cannot masquerade as fresh just because downloaded now',()=>{let data=M.parseYahoo(chart([[ts-7200,100,110,90,105,20]]),'TEST.NS','15m',now);assert(data.stale);assert(!M.cacheValid({version:2,data,saved:now},'15m',now))});
test('old cache rejected; new cache expires at interval TTL',()=>{let data=M.parseYahoo(chart([[ts-1800,100,110,90,105,20]]),'TEST.NS','15m',now);assert(!M.cacheValid({saved:now,bars:data.bars},'15m',now));assert(M.cacheValid({version:2,data,saved:now},'15m',now));assert(!M.cacheValid({version:2,data,saved:now-61000},'15m',now))});
test('weekend close remains usable without implying live data',()=>{const sat=Date.parse('2026-10-10T09:00:00Z');assert.equal(M.stale([{timestamp:Date.parse('2026-10-09T09:00:00Z')/1000}],'15m','TEST.NS',sat),false)});

test('missing India intraday intervals are identified',()=>{const data=M.parseYahoo(chart([[ts-7200,100,110,90,105,20],[ts-1800,100,110,90,105,20]]),'TEST.NS','15m',now);assert.equal(data.gaps,1)});
