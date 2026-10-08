"""Personal research snapshots. No orders. Stop on throttling; never use a bypass proxy."""
import argparse, csv, datetime as dt, io, json, math, pathlib, time, urllib.request, urllib.error, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
IST=dt.timezone(dt.timedelta(hours=5,minutes=30))
UA='LearningFundClear/1.0 personal-research contact sebasishpanda20-creator'
def download(url):
    import subprocess
    result=subprocess.run(['curl','--silent','--show-error','--location','--max-time','20','--max-filesize','5000000','--user-agent',UA,'--write-out','\n%{http_code}',url],capture_output=True,check=True)
    body,status=result.stdout.rsplit(b'\n',1)
    if int(status)!=200:raise urllib.error.HTTPError(url,int(status),'source unavailable',None,None)
    return body

def refresh_universe():
    url='https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv'
    data=list(csv.DictReader(io.StringIO(download(url).decode('utf-8-sig'))))
    members=[dict(symbol=r['Symbol'],name=r['Company Name'],industry=r['Industry'],isin=r['ISIN Code']) for r in data]
    if not 450<=len(members)<=600 or len({r['symbol'] for r in members})!=len(members):raise ValueError('Unexpected constituent count')
    import re
    if not all(re.fullmatch(r'[A-Z0-9&.\-]+',r['symbol']) and re.fullmatch(r'[A-Z0-9]{12}',r['isin']) for r in members):raise ValueError('Invalid constituents')
    (ROOT/'market-data/nifty500-universe.json').write_text(json.dumps(dict(source=url,fetchedAt=dt.datetime.now(IST).isoformat(),members=members),indent=2)+'\n')

def valid(values):
    o,h,l,c,v=values
    return all(isinstance(n,(float,int)) and math.isfinite(n) for n in values) and min(o,h,l,c)>0 and v>=0 and h>=max(o,l,c) and l<=min(o,h,c)
def parse_eod(raw,members,date):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        files=[n for n in z.namelist() if n.endswith('.csv')]
        if len(files)!=1 or z.getinfo(files[0]).file_size>20000000: raise ValueError('Unexpected report archive')
        report=list(csv.DictReader(io.TextIOWrapper(z.open(files[0]),encoding='utf-8-sig')))
    index={(r['TckrSymb'],r['ISIN']):r for r in report if r['TradDt']==date and r['SctySrs'] in ('EQ','BE','RR')}
    out=[]
    for m in members:
        item=dict(m,status='unavailable',reason='No matching equity row for this session')
        r=index.get((m['symbol'],m['isin']))
        if r:
            try:
                values=[float(r[k]) for k in ['OpnPric','HghPric','LwPric','ClsPric','TtlTradgVol']]
                if not valid(values):raise ValueError('Invalid OHLCV')
                item.update(dict(zip(['open','high','low','price','volume'],values)),status='available',reason='',asOf=date+'T15:30:00+05:30')
            except (ValueError,TypeError):item['reason']='Invalid OHLCV in report'
        out.append(item)
    if not any(r['status']=='available' for r in out):raise ValueError('Report has no matching valid constituent rows')
    return out

def parse_delayed(payload,m,now):
    r=payload['chart']['result'][0]
    if r['meta']['symbol'].upper()!=m['symbol']+'.NS':raise ValueError('Provider symbol mismatch')
    q=r['indicators']['quote'][0];candidates=[]
    for i,t in enumerate(r.get('timestamp',[])):
        # Completed 15-minute bars, with one minute settlement allowance.
        if t+960>now.timestamp():continue
        values=[q.get(k,[])[i] for k in ['open','high','low','close','volume']]
        if valid(values):candidates.append((t,values))
    if not candidates:raise ValueError('No completed valid candle')
    t,values=max(candidates)
    age=now.timestamp()-(t+900)
    status='available' if age<=3600 and dt.datetime.fromtimestamp(t,IST).date()==now.date() else 'stale'
    return dict(m,**dict(zip(['open','high','low','price','volume'],values)),asOf=dt.datetime.fromtimestamp(t+900,IST).isoformat(),status=status,reason='' if status=='available' else 'Latest completed candle is old')

def collect(mode,now,report=None):
    universe=json.loads((ROOT/'market-data/nifty500-universe.json').read_text())
    members=universe['members'];error=None;source='NSE daily bhavcopy' if mode=='eod' else 'Yahoo completed 15-minute candles (best effort)'
    if mode=='eod':
        date=now.date().isoformat()
        url=f'https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{now:%Y%m%d}_F_0000.csv.zip'
        try:rows=parse_eod(pathlib.Path(report).read_bytes() if report else download(url),members,date)
        except Exception as e:
            error='Session report unavailable: '+str(e);rows=[dict(m,status='unavailable',reason=error) for m in members]
    else:
        import concurrent.futures, threading
        blocked=threading.Event();deadline=time.monotonic()+600
        def fetch_member(m):
            nonlocal error
            if time.monotonic()>deadline:
                blocked.set();error='Collection time budget reached; remaining constituents unavailable'
            if blocked.is_set():return dict(m,status='unavailable',reason='Collection paused after provider rate limit')
            try:
                url='https://query1.finance.yahoo.com/v8/finance/chart/'+urllib.parse.quote(m['symbol']+'.NS',safe='')+'?range=1d&interval=15m'
                return parse_delayed(json.loads(download(url)),m,now)
            except urllib.error.HTTPError as e:
                if e.code in (401,403,429):blocked.set();error=f'Provider unavailable (HTTP {e.code}); no bypass attempted'
                return dict(m,status='unavailable',reason=f'Provider HTTP {e.code}')
            except Exception as e:return dict(m,status='unavailable',reason=str(e)[:180])
            finally:time.sleep(0.5)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(fetch_member,members))
    available=sum(r['status']=='available' for r in rows)
    return dict(version=1,mode=mode,source=source,generatedAt=now.isoformat(),sessionDate=now.date().isoformat(),universeAsOf=universe['fetchedAt'],total=len(members),available=available,stale=sum(r['status']=='stale' for r in rows),error=error,rows=rows)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--mode',choices=['delayed','eod'],required=True);p.add_argument('--refresh-universe',action='store_true');p.add_argument('--report');p.add_argument('--date');p.add_argument('--output',required=True);a=p.parse_args()
    now=dt.datetime.now(IST) if not a.date else dt.datetime.fromisoformat(a.date+'T18:00:00+05:30')
    if a.refresh_universe:
        try:refresh_universe()
        except Exception as e:print('Keeping previous universe: '+str(e))
    data=collect(a.mode,now,a.report);path=pathlib.Path(a.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(data,allow_nan=False))
    print(f"{a.mode}: {data['available']}/{data['total']} available; {data['stale']} stale. {data['error'] or ''}")
