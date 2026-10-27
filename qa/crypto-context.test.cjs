const {test}=require('node:test'),a=require('node:assert/strict');
require('../assets/js/crypto-context.js');const C=globalThis.LfcCryptoContext,now=1800000000000;
const tick=(symbol='BTCUSD')=>({symbol,contract_type:'perpetual_futures',product_trading_status:'operational',timestamp:now*1000,quotes:{best_bid:99,best_ask:101},oi_value_usd:0,turnover_usd:100});
test('funding uses percent, accepts zero, rejects absent/stale/future data',()=>{
 const q={type:'funding_rate',sy:'BTCUSD',ts:now*1000,nfr:(now+3600000)*1000,fi:28800,fr:.01};
 a.equal(C.funding(q,now).rate,.01);a.equal(C.funding({...q,fr:0},now).rate,0);
 for(const patch of [{fr:null},{ts:null},{ts:(now-121000)*1000},{ts:(now+6000)*1000},{nfr:now*1000}])a.equal(C.funding({...q,...patch},now),null);
});
test('universe filters and deduplicates; preserves gold beyond top20',()=>{
 const xs=Array.from({length:25},(_,i)=>({...tick('C'+i+'USD'),turnover_usd:1000-i}));
 xs.push({...tick('XAUTUSD'),turnover_usd:1},tick('XAUTUSD'),{...tick('BADUSD'),product_trading_status:'halted'});
 const x=C.universe(xs,now);a.equal(x.total,26);a.equal(x.rows.length,21);a.equal(x.rows.at(-1).symbol,'XAUTUSD');
 a.equal(C.ticker({...tick(),timestamp:null},now).stale,true);a.equal(C.ticker(tick(),now).oi,0);
});
const last=Math.floor(now/3600000)*3600-3600;
const bars=Array.from({length:25},(_,i)=>({time:last-(24-i)*3600,close:100+i}));
test('OI needs a complete 24h comparison',()=>{
 a.equal(Math.round(C.history(bars,'OI',now).change),24);
 for(const xs of [bars.slice(1),[...bars,bars[0]],bars.map((b,i)=>i?b:{...b,close:0})])a.throws(()=>C.history(xs,'OI',now));
});
test('funding history discloses empty and counts completed observations',()=>{
 a.throws(()=>C.history([],'funding',now),/no funding/);
 const x=C.history([{time:last,close:-.1},{time:last-3600,close:0},{time:last+3600,close:1}],'funding',now);
 a.equal(x.negative,1);a.equal(x.zero,1);a.equal(x.positive,0);
});
test('order book validates sides, symbol, sizes, timestamps and expiry',()=>{
 const b={symbol:'BTCUSD',buy:[{price:99,size:2}],sell:[{price:101,size:3}]};
 a.equal(C.book(b,'BTCUSD',now,now).at,null);
 a.equal(C.book(b,'BTCUSD',now,now).spread,2);
 for(const v of [{...b,symbol:'ETHUSD'},{...b,buy:[]},{...b,buy:[{price:102,size:1}]},{...b,buy:[{price:99,size:null}]},{...b,timestamp:(now-31000)*1000}])a.throws(()=>C.book(v,'BTCUSD',now,now));
 a.throws(()=>C.book(b,'BTCUSD',now-31000,now));
});
