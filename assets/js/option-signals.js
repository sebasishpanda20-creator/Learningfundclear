/* Long-option research rules. Selling always closes a tracked long position. */
(function(root){
 'use strict';
 const finite=x=>typeof x==='number'&&Number.isFinite(x);
 const wait=reason=>({action:'Wait',reason});
 function evaluate(input){
  const {chain,bars,symbol,expiry,position,now=Date.now()}=input;
  const ist=new Date(now+19800000),minute=ist.getUTCHours()*60+ist.getUTCMinutes();
  if(ist.getUTCDay()===0||ist.getUTCDay()===6||minute<555||minute>=930)return wait('Outside the normal NSE session. Wait for fresh in-session data.');
  if(!chain||chain.symbol!==symbol||chain.expiry!==expiry)return wait('No verified chain for the selected symbol and expiry.');
  if(!finite(chain.sourceAt)||now-chain.sourceAt>90000||chain.sourceAt>now+10000)return wait('Fresh option-chain timestamp required (maximum 90 seconds).');
  if(!finite(chain.expiryAt)||chain.expiryAt<=now)return wait('Expiry is missing or has passed.');
  if(!finite(chain.underlying)||chain.underlying<=0)return wait('Underlying price is missing.');
  const rows=chain.strikes;if(!Array.isArray(rows))return wait('Contract data unavailable.');
  function quote(row,type){const q=row?.[type];return q&&[q.bid,q.ask,q.oi,q.vol,q.quoteAt].every(finite)&&q.bid>0&&q.ask>=q.bid&&q.oi>=1000&&q.vol>=1000&&(q.ask-q.bid)/((q.ask+q.bid)/2)<=0.02&&now-q.quoteAt<=90000&&q.quoteAt<=now+10000?q:null;}
  if(position){
   if(position.symbol!==symbol||position.expiry!==expiry)return wait('Tracked position belongs to another contract; select its symbol and expiry.');
   if(!['ce','pe'].includes(position.type)||![position.strike,position.entry,position.stop,position.target].every(finite)||position.stop<=0||position.stop>=position.entry||position.target<=position.entry)return wait('Tracked position levels are invalid.');
   const q=quote(rows.find(r=>r.strike===position.strike),position.type);if(!q)return wait('Fresh bid/ask and sufficient contract liquidity required to evaluate this exit.');
   const action=q.bid<=position.stop||q.bid>=position.target?'Exit '+(position.type==='ce'?'Call':'Put'):'Hold';
   return {...position,action,mark:q.bid,reason:action==='Hold'?'Neither your stop-loss nor target has been reached.':q.bid<=position.stop?'Bid reached or crossed your stop-loss.':'Bid reached or crossed your target.'};
  }
  if(!Array.isArray(bars)||bars.length<60)return wait('At least 60 verified completed 15-minute underlying candles are required.');
  for(let i=0;i<bars.length;i++){const b=bars[i];if(![b.timestamp,b.open,b.high,b.low,b.close].every(finite)||b.low<=0||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close)||b.timestamp*1000+900000>now||i&&b.timestamp<=bars[i-1].timestamp)return wait('Invalid, duplicate or unfinished underlying candles.');}
  const last=bars.at(-1);if(now-last.timestamp*1000>1800000)return wait('Underlying candles are stale.');
  const ema=n=>{let v=bars[0].close;for(const b of bars.slice(1))v=b.close*2/(n+1)+v*(1-2/(n+1));return v;};const fast=ema(20),slow=ema(50),prior=bars.slice(-6,-1);
  const type=last.close>fast&&fast>slow&&last.close>Math.max(...prior.map(b=>b.high))?'ce':last.close<fast&&fast<slow&&last.close<Math.min(...prior.map(b=>b.low))?'pe':null;
  if(!type)return wait('No confirmed 15-minute trend and five-candle breakout match.');
  const candidates=rows.filter(r=>finite(r.strike)&&r.strike>0&&Math.abs(r.strike-chain.underlying)/chain.underlying<=0.02&&quote(r,type)).sort((a,b)=>Math.abs(a.strike-chain.underlying)-Math.abs(b.strike-chain.underlying));
  if(!candidates.length)return wait('No near-ATM contract passes the fresh bid/ask, spread, OI and volume checks.');
  const row=candidates[0],q=quote(row,type),entry=q.ask;
  return {action:'Buy '+(type==='ce'?'Call':'Put'),symbol,expiry,type,strike:row.strike,entry,stop:entry*0.75,target:entry*1.5,reason:'Experimental rule matched: EMA20/50 trend and completed five-candle breakout; contract passes liquidity gates. Premium stop 25%, target 50%.',createdAt:now};
 }
 root.LfcOptionSignals={evaluate};
})(typeof window!=='undefined'?window:globalThis);
