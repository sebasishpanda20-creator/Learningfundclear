from unittest.mock import patch
import urllib.error
import importlib.util, unittest, datetime as dt, io, zipfile, csv
spec=importlib.util.spec_from_file_location('collector','tools/nifty500-collect.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Collector(unittest.TestCase):
 def test_report_matches_symbol_isin_date_and_series(self):
  fields=['TckrSymb','ISIN','TradDt','SctySrs','OpnPric','HghPric','LwPric','ClsPric','TtlTradgVol']
  out=io.StringIO();w=csv.writer(out);w.writerow(fields);w.writerow(['TEST','ISIN','2026-10-08','BE',100,110,90,105,500]);buf=io.BytesIO()
  with zipfile.ZipFile(buf,'w') as z:z.writestr('report.csv',out.getvalue())
  rows=m.parse_eod(buf.getvalue(),[dict(symbol='TEST',isin='ISIN'),dict(symbol='DUMMY',isin='OTHER')],'2026-10-08')
  self.assertEqual(rows[0]['price'],105);self.assertEqual(rows[1]['status'],'unavailable')
  with self.assertRaises(ValueError):m.parse_eod(buf.getvalue(),[dict(symbol='TEST',isin='ISIN')],'2026-10-07')
 def test_completed_candles_only_and_stale_not_fresh(self):
  now=dt.datetime.fromisoformat('2026-10-08T12:00:00+05:30');t=int(now.timestamp());member=dict(symbol='TEST');payload={'chart':{'result':[{'meta':{'symbol':'TEST.NS'},'timestamp':[t-1800,t-300],'indicators':{'quote':[dict(open=[100,101],high=[110,111],low=[90,91],close=[105,106],volume=[1000,1001])]}}]}}
  row=m.parse_delayed(payload,member,now);self.assertEqual(row['price'],105);self.assertEqual(row['status'],'available')
  self.assertEqual(m.parse_delayed(payload,member,now+dt.timedelta(hours=2))['status'],'stale')
 def test_missing_weekend_and_holiday_reports_use_actual_session_date(self):
  now=dt.datetime.fromisoformat('2026-10-17T18:00:00+05:30')
  missing=urllib.error.HTTPError('test',404,'missing',None,None)
  with patch.object(m,'download',side_effect=[missing,missing,b'report']) as download, patch.object(m,'parse_eod',return_value=[{'status':'available'}]) as parse:
   rows,date=m.latest_eod([],now)
   self.assertEqual(date,'2026-10-15');self.assertEqual(download.call_count,3)
   parse.assert_called_once_with(b'report',[],'2026-10-15')
 def test_access_errors_stop_without_looking_back(self):
  for code in (401,403,429,500):
   with patch.object(m,'download',side_effect=urllib.error.HTTPError('test',code,'blocked',None,None)) as download:
    with self.assertRaises(urllib.error.HTTPError):m.latest_eod([],dt.datetime.fromisoformat('2026-10-17T18:00:00+05:30'))
    self.assertEqual(download.call_count,1)
 def test_report_search_is_bounded(self):
  with patch.object(m,'download',side_effect=urllib.error.HTTPError('test',404,'missing',None,None)) as download:
   with self.assertRaises(ValueError):m.latest_eod([],dt.datetime.fromisoformat('2026-10-17T18:00:00+05:30'))
   self.assertEqual(download.call_count,10)
 def test_before_close_starts_with_previous_day(self):
  with patch.object(m,'download',return_value=b'report') as download, patch.object(m,'parse_eod',return_value=[]):
   _,date=m.latest_eod([],dt.datetime.fromisoformat('2026-10-16T12:00:00+05:30'))
   self.assertEqual(date,'2026-10-15');self.assertIn('20261015',download.call_args.args[0])
if __name__=='__main__':unittest.main()
