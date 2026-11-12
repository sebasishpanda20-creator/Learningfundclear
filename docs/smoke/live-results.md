# LearningFundClear — live smoke run

- **Published portal:** https://site-443e334f4a224d008788726d8cf4b9ed.freebuff.page
- **Local proxy:** http://127.0.0.1:8000
- **Run at:** 2026-11-12T18:56:57.394405+00:00
- **Result:** FAIL (15/16 checks, 12033 ms)

## Checks

| Check | Result | Detail |
| --- | --- | --- |
| published index.html served | pass | HTTP 200, 79,122 bytes |
| published index.html matches committed build | pass | sha256 ad96f6d9a87e vs build ad96f6d9a87e |
| published robots.txt served | pass | HTTP 200, 104 bytes |
| published robots.txt matches committed build | pass | sha256 c2aadd5546da vs build c2aadd5546da |
| proxy health ONLINE | pass | HTTP 200, version 5.3, nsemine=False |
| NSE RELIANCE priced | pass | ltp 1,339.7 |
| NSE RELIANCE is real-time | pass | state=REAL-TIME NSE DIRECT |
| MCX GOLD priced | pass | ltp 136,279, expiry 04DEC2026 |
| MCX GOLD is real-time | pass | state=REAL-TIME MCX DIRECT |
| MCX GOLD inside circuit band | pass | 130,827.84 < 136,279 < 141,730.16 |
| XAUTUSD priced | pass | ltp 3,882.57, mark 3,882.5499 |
| XAUTUSD badged LIVE | pass | state=LIVE DELTA API |
| XAUTUSD inside circuit band | pass | 3,494.2861 < 3,882.57 < 4,270.7941 |
| categorized products not empty while claiming LIVE | **fail** | state=LIVE DELTA API, counts={'Futures': 0, 'Options': 0, 'RWA Tokens': 0} |
| unknown Delta symbol not tradeable | pass | ltp 0, state=UNAVAILABLE |
| unknown NSE symbol not tradeable | pass | ltp 0, state=UNAVAILABLE |

## Live snapshot

### MCX GOLD (NSE/MCX proxy)
- LTP 136,279 · open 139,282 · high 139,315 · low 135,530
- Circuit band 130,827.84 – 141,730.16 · expiry 04DEC2026
- State REAL-TIME MCX DIRECT

### NSE RELIANCE
- LTP 1,339.7 · change 0.32%
- State REAL-TIME NSE DIRECT · feed nsepython (NSE official API)

### Delta XAUTUSD (crypto VDA desk)
- LTP 3,882.57 · mark 3,882.5499
- 24h change -2.604% · funding 0.005
- 24h turnover USD 1,080,901,761.0476
- Circuit band 3,494.2861 – 4,270.7941
- State LIVE DELTA API

### Deployed build
- deployed index.html sha256 `ad96f6d9a87eee36…`
- committed build sha256 `ad96f6d9a87eee36…`
