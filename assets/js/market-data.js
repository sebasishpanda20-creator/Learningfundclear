/* Normalized, completed historical candles. This is not an exchange live feed. */
(function (root) {
  'use strict';
  const seconds = {'15m':900,'1h':3600,'1d':86400,'1wk':604800,'1mo':2678400};
  function ttl(interval) { return interval === '15m' ? 60000 : interval === '1h' ? 120000 : 300000; }
  function endTime(ts, interval, symbol, meta) {
    const offset = Number(meta.gmtoffset) || 0;
    const d = new Date((ts + offset) * 1000);
    if (interval === '1mo') return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000-offset;
    if (interval === '1wk') {
      const days = 7 - ((d.getUTCDay()+6)%7);
      return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+days)/1000-offset;
    }
    if (interval === '1d') {
      if (/\.(NS|BO)$/.test(symbol) || /^(\^NSE|\^BSESN)/.test(symbol)) {
        const india = new Date((ts+19800)*1000);
        return Date.UTC(india.getUTCFullYear(),india.getUTCMonth(),india.getUTCDate(),10)/1000;
      }
      const session = meta.currentTradingPeriod && meta.currentTradingPeriod.regular;
      if (session && ts >= session.start && ts < session.end) return session.end;
    }
    return ts + seconds[interval];
  }
  function stale(bars, interval, symbol, now) {
    if (!bars.length) return true;
    let tolerance = interval === '1wk' ? 14*86400 : interval === '1mo' ? 62*86400 : 4*86400;
    if (interval === '15m' || interval === '1h') {
      // Tight intraday checks only during the known Indian equity session.
      // Holidays are not inferred from weekdays; an idle feed is reported conservatively.
      const india = new Date(now+19800000), minute=india.getUTCHours()*60+india.getUTCMinutes();
      if ((/\.(NS|BO)$/.test(symbol) || symbol.startsWith('^NSE')) && india.getUTCDay()>0 && india.getUTCDay()<6 && minute>=615 && minute<=930) {
        tolerance=seconds[interval]*2+900;
      }
    }
    return now/1000 - bars[bars.length-1].timestamp > tolerance;
  }
  function parseYahoo(json, symbol, interval, now=Date.now()) {
    if (!seconds[interval]) throw new Error('Unsupported candle interval');
    const chart=json && json.chart, r=chart && chart.result && chart.result[0];
    if (chart && chart.error) throw new Error(chart.error.description || 'Market source error');
    const q=r && r.indicators && r.indicators.quote && r.indicators.quote[0];
    if (!q || !Array.isArray(r.timestamp)) throw new Error('Source returned no candle data');
    const meta=r.meta || {}, byTime=new Map();
    let discarded=0, incomplete=0;
    r.timestamp.forEach((timestamp,i)=>{
      const open=q.open?.[i], high=q.high?.[i], low=q.low?.[i], close=q.close?.[i];
      if (![timestamp,open,high,low,close].every(Number.isFinite) || timestamp<=0 || low<=0 || high<Math.max(open,close,low) || low>Math.min(open,close)) {discarded++;return;}
      if (endTime(timestamp,interval,symbol,meta)*1000+60000>now) {incomplete++;return;}
      const date = new Date((timestamp+(Number(meta.gmtoffset)||0))*1000).toISOString().slice(0,interval==='15m'||interval==='1h'?16:10).replace('T',' ');
      const volume=Number.isFinite(q.volume?.[i]) && q.volume[i]>=0 ? q.volume[i] : null;
      byTime.set(timestamp,{timestamp,date,open,high,low,close,volume});
    });
    const bars=[...byTime.values()].sort((a,b)=>a.timestamp-b.timestamp);
    if (!bars.length) throw new Error('No valid completed candles available');
    let gaps=0;
    if ((interval==='15m' || interval==='1h') && /\.(NS|BO)$/.test(symbol)) {
      for (let i=1;i<bars.length;i++) {
        if (bars[i].date.slice(0,10)===bars[i-1].date.slice(0,10) && bars[i].timestamp-bars[i-1].timestamp>seconds[interval]*1.5) gaps++;
      }
    }
    return {symbol,bars,source:'Yahoo historical · may be delayed',fetchedAt:now,candleAt:bars[bars.length-1].timestamp*1000,gaps,timezone:meta.exchangeTimezoneName || 'Exchange time',discarded,incomplete,stale:stale(bars,interval,symbol,now)};
  }
  function cacheValid(entry, interval, now=Date.now()) {
    return !!(entry && entry.version===2 && entry.data && entry.data.bars?.length && now>=entry.saved && now-entry.saved<ttl(interval) && !stale(entry.data.bars,interval,entry.data.symbol,now));
  }
  root.LfcMarketData={parseYahoo,ttl,cacheValid,stale,endTime};
})(typeof window!=='undefined'?window:globalThis);
