"""
============================================================================
  INSTITUTIONAL HEDGING & TRADE RESCUE TERMINAL v3.2 (MOBILE + PORTAL READY)
  Manual Trade Book | Live NSE 500+ | MCX | Delta Exchange | All Segments
  Powered by: streamlit, yfinance, scipy, plotly, delta-exchange v2 API
============================================================================
"""

import inspect
import math
from datetime import datetime
import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import requests
import streamlit as st
import yfinance as yf
from scipy.stats import norm

# ============================================================================
# 1. COMPLETE NSE 500+ SYMBOL MAP — ORGANIZED BY SECTOR
# ============================================================================
NSE_SECTORS = {
    "🏦 Banks & Financial Services": {
        "HDFCBANK": "HDFCBANK.NS", "ICICIBANK": "ICICIBANK.NS", "SBIN": "SBIN.NS",
        "KOTAKBANK": "KOTAKBANK.NS", "AXISBANK": "AXISBANK.NS", "BAJFINANCE": "BAJFINANCE.NS",
        "BAJAJFINSV": "BAJAJFINSV.NS", "HDFCLIFE": "HDFCLIFE.NS", "SBILIFE": "SBILIFE.NS",
        "ICICIGI": "ICICIGI.NS", "ICICIPRULI": "ICICIPRULI.NS", "HDFCAMC": "HDFCAMC.NS",
        "M&MFIN": "M&MFIN.NS", "BAJAJHLDNG": "BAJAJHLDNG.NS", "CHOLAFIN": "CHOLAFIN.NS",
        "SHRIRAMFIN": "SHRIRAMFIN.NS", "MUTHOOTFIN": "MUTHOOTFIN.NS", "MANAPPURAM": "MANAPPURAM.NS",
        "LICHSGFIN": "LICHSGFIN.NS", "PFC": "PFC.NS", "RECLTD": "RECLTD.NS", "IRFC": "IRFC.NS",
        "IDFCFIRSTB": "IDFCFIRSTB.NS", "FEDERALBNK": "FEDERALBNK.NS", "BANDHANBNK": "BANDHANBNK.NS",
        "AUBANK": "AUBANK.NS", "INDUSINDBK": "INDUSINDBK.NS", "PNB": "PNB.NS",
        "BANKBARODA": "BANKBARODA.NS", "CANBK": "CANBK.NS", "UNIONBANK": "UNIONBANK.NS",
        "IOB": "IOB.NS", "INDIANB": "INDIANB.NS", "UCOBANK": "UCOBANK.NS",
        "CENTRALBK": "CENTRALBK.NS", "BANKINDIA": "BANKINDIA.NS", "PSB": "PSB.NS",
        "MAHABANK": "MAHABANK.NS", "JAMMUKASHMIR": "JAMMUKASHMIR.NS",
        "KARURVYSYA": "KARURVYSYA.NS", "RBLBANK": "RBLBANK.NS", "CITYUNION": "CITYUNION.NS",
        "SOUTHBANK": "SOUTHBANK.NS", "EQUITASBNK": "EQUITASBNK.NS", "UJJIVANSFB": "UJJIVANSFB.NS",
        "CREDITACC": "CREDITACC.NS", "CAPITALSFB": "CAPITALSFB.NS", "SBICARD": "SBICARD.NS",
        "PAYTM": "PAYTM.NS", "POLICYBZR": "POLICYBZR.NS", "STARHEALTH": "STARHEALTH.NS",
        "NIACL": "NIACL.NS", "GICRE": "GICRE.NS", "ICICILOMBARD": "ICICILOMBARD.NS",
        "GENERALINS": "GENERALINS.NS", "NEWINDIA": "NEWINDIA.NS",
        "ANGELONE": "ANGELONE.NS", "MOTILALOFS": "MOTILALOFS.NS",
        "IIFL": "IIFL.NS", "5PAISA": "5PAISA.NS", "ANANDRATHI": "ANANDRATHI.NS",
    },
    "💻 IT & Technology": {
        "TCS": "TCS.NS", "INFY": "INFY.NS", "HCLTECH": "HCLTECH.NS", "WIPRO": "WIPRO.NS",
        "TECHM": "TECHM.NS", "LTIM": "LTIM.NS", "MPHASIS": "MPHASIS.NS",
        "COFORGE": "COFORGE.NS", "PERSISTENT": "PERSISTENT.NS", "KPITTECH": "KPITTECH.NS",
        "TATAELXSI": "TATAELXSI.NS", "CYIENT": "CYIENT.NS",
        "SONATSOFTW": "SONATSOFTW.NS", "OFSS": "OFSS.NS", "MASTEK": "MASTEK.NS",
        "INTELLECT": "INTELLECT.NS", "HAPPSTMNDS": "HAPPSTMNDS.NS", "ZENSARTECH": "ZENSARTECH.NS",
        "BIRLASOFT": "BIRLASOFT.NS", "TANLA": "TANLA.NS", "AFFLE": "AFFLE.NS",
        "NAUKRI": "NAUKRI.NS", "JUSTDIAL": "JUSTDIAL.NS", "MATRIMONY": "MATRIMONY.NS",
        "ROUTE": "ROUTE.NS", "MAPMYINDIA": "MAPMYINDIA.NS",
        "RATEGAIN": "RATEGAIN.NS", "NEWGEN": "NEWGEN.NS", "LTTS": "LTTS.NS",
    },
    "⛽ Oil, Gas & Energy": {
        "RELIANCE": "RELIANCE.NS", "ONGC": "ONGC.NS", "IOC": "IOC.NS",
        "BPCL": "BPCL.NS", "HPCL": "HPCL.NS", "GAIL": "GAIL.NS",
        "OIL": "OIL.NS", "PETRONET": "PETRONET.NS", "IGL": "IGL.NS",
        "MGL": "MGL.NS", "GUJGASLTD": "GUJGASLTD.NS", "ATGL": "ATGL.NS",
        "ADANIGREEN": "ADANIGREEN.NS", "ADANIENSOL": "ADANIENSOL.NS", "TATAPOWER": "TATAPOWER.NS",
        "NTPC": "NTPC.NS", "POWERGRID": "POWERGRID.NS", "NHPC": "NHPC.NS",
        "SJVN": "SJVN.NS", "JSWENERGY": "JSWENERGY.NS", "TORNTPOWER": "TORNTPOWER.NS",
        "CESC": "CESC.NS", "ADANIPOWER": "ADANIPOWER.NS", "COALINDIA": "COALINDIA.NS",
    },
    "🔩 Metals & Mining": {
        "TATASTEEL": "TATASTEEL.NS", "JSWSTEEL": "JSWSTEEL.NS", "HINDALCO": "HINDALCO.NS",
        "VEDL": "VEDL.NS", "JINDALSTEL": "JINDALSTEL.NS", "SAIL": "SAIL.NS",
        "NMDC": "NMDC.NS", "HINDZINC": "HINDZINC.NS", "NATIONALUM": "NATIONALUM.NS",
        "MOIL": "MOIL.NS", "HINDCOPPER": "HINDCOPPER.NS", "APLAPOLLO": "APLAPOLLO.NS",
        "RATNAMANI": "RATNAMANI.NS", "WELCORP": "WELCORP.NS", "KALYANISTL": "KALYANISTL.NS",
        "GODAWARI": "GODAWARI.NS", "SANDUMA": "SANDUMA.NS",
    },
    "🚗 Automobile & Auto Ancillary": {
        "MARUTI": "MARUTI.NS", "TATAMOTORS": "TATAMOTORS.NS", "M&M": "M&M.NS",
        "BAJAJ-AUTO": "BAJAJ-AUTO.NS", "EICHERMOT": "EICHERMOT.NS", "HEROMOTOCO": "HEROMOTOCO.NS",
        "TVSMOTOR": "TVSMOTOR.NS", "ASHOKLEY": "ASHOKLEY.NS", "BHARATFORG": "BHARATFORG.NS",
        "MOTHERSON": "MOTHERSON.NS", "BOSCHLTD": "BOSCHLTD.NS", "MRF": "MRF.NS",
        "APOLLOTYRE": "APOLLOTYRE.NS", "CEATLTD": "CEATLTD.NS", "BALKRISIND": "BALKRISIND.NS",
        "EXIDEIND": "EXIDEIND.NS", "ENDURANCE": "ENDURANCE.NS",
        "SCHAEFFLER": "SCHAEFFLER.NS", "SKFINDIA": "SKFINDIA.NS", "TIMKEN": "TIMKEN.NS",
        "SUNDRMFAST": "SUNDRMFAST.NS", "UNOMINDA": "UNOMINDA.NS",
        "ZFCVINDIA": "ZFCVINDIA.NS", "LUMAXTECH": "LUMAXTECH.NS",
        "SONACOMS": "SONACOMS.NS", "FORCEMOT": "FORCEMOT.NS", "OLECTRA": "OLECTRA.NS",
    },
    "💊 Pharma & Healthcare": {
        "SUNPHARMA": "SUNPHARMA.NS", "DRREDDY": "DRREDDY.NS", "CIPLA": "CIPLA.NS",
        "DIVISLAB": "DIVISLAB.NS", "BIOCON": "BIOCON.NS", "LUPIN": "LUPIN.NS",
        "AUROPHARMA": "AUROPHARMA.NS", "TORNTPHARM": "TORNTPHARM.NS", "ALKEM": "ALKEM.NS",
        "IPCALAB": "IPCALAB.NS", "GLENMARK": "GLENMARK.NS", "APOLLOHOSP": "APOLLOHOSP.NS",
        "MAXHEALTH": "MAXHEALTH.NS", "FORTIS": "FORTIS.NS", "METROPOLIS": "METROPOLIS.NS",
        "LALPATHLAB": "LALPATHLAB.NS", "THYROCARE": "THYROCARE.NS", "MEDANTA": "MEDANTA.NS",
        "SYNGENE": "SYNGENE.NS", "LAURUSLABS": "LAURUSLABS.NS", "GRANULES": "GRANULES.NS",
        "NATCOPHARM": "NATCOPHARM.NS", "ZYDUSLIFE": "ZYDUSLIFE.NS", "MANKIND": "MANKIND.NS",
        "CONCORDBIO": "CONCORDBIO.NS", "STAR": "STAR.NS", "JBCHEPHARM": "JBCHEPHARM.NS",
    },
    "🛒 FMCG & Consumer": {
        "HINDUNILVR": "HINDUNILVR.NS", "ITC": "ITC.NS", "NESTLEIND": "NESTLEIND.NS",
        "BRITANNIA": "BRITANNIA.NS", "DABUR": "DABUR.NS", "GODREJCP": "GODREJCP.NS",
        "COLPAL": "COLPAL.NS", "MARICO": "MARICO.NS", "EMAMILTD": "EMAMILTD.NS",
        "UBL": "UBL.NS", "RADICO": "RADICO.NS", "TATACONSUM": "TATACONSUM.NS",
        "VBL": "VBL.NS", "JUBLFOOD": "JUBLFOOD.NS", "DEVYANI": "DEVYANI.NS",
        "SAPPHIRE": "SAPPHIRE.NS", "BIKAJI": "BIKAJI.NS", "MANYAVAR": "MANYAVAR.NS",
        "TRENT": "TRENT.NS", "DMART": "DMART.NS", "AVANTIFEED": "AVANTIFEED.NS",
        "ZOMATO": "ZOMATO.NS", "NYKAA": "NYKAA.NS", "FIVESTAR": "FIVESTAR.NS",
        "TITAN": "TITAN.NS", "KALYANKJIL": "KALYANKJIL.NS", "THANGAMAYL": "THANGAMAYL.NS",
        "RAJESHEXPO": "RAJESHEXPO.NS", "PCJEWELLER": "PCJEWELLER.NS", "SENCO": "SENCO.NS",
    },
    "🏗️ Infrastructure & Construction": {
        "LT": "LT.NS", "ADANIENT": "ADANIENT.NS", "ADANIPORTS": "ADANIPORTS.NS",
        "DLF": "DLF.NS", "GODREJPROP": "GODREJPROP.NS", "OBEROIRLTY": "OBEROIRLTY.NS",
        "PRESTIGE": "PRESTIGE.NS", "PHOENIXLTD": "PHOENIXLTD.NS", "BRIGADE": "BRIGADE.NS",
        "SOBHA": "SOBHA.NS", "LODHA": "LODHA.NS", "MAHLIFE": "MAHLIFE.NS",
        "NBCC": "NBCC.NS", "IRB": "IRB.NS", "IRCON": "IRCON.NS",
        "RITES": "RITES.NS", "RVNL": "RVNL.NS", "RAILTEL": "RAILTEL.NS",
        "CONCOR": "CONCOR.NS", "KEI": "KEI.NS",
        "POLYCAB": "POLYCAB.NS", "HAVELLS": "HAVELLS.NS", "CROMPTON": "CROMPTON.NS",
        "VOLTAS": "VOLTAS.NS", "BLUESTARCO": "BLUESTARCO.NS", "KAYNES": "KAYNES.NS",
        "DIXON": "DIXON.NS", "AMBER": "AMBER.NS", "WHIRLPOOL": "WHIRLPOOL.NS",
    },
    "🏭 Industrials, Capital Goods & Defence": {
        "SIEMENS": "SIEMENS.NS", "ABB": "ABB.NS", "HITACHI": "HITACHI.NS",
        "THERMAX": "THERMAX.NS", "CUMMINSIND": "CUMMINSIND.NS", "GRINDWELL": "GRINDWELL.NS",
        "CARBORUNIV": "CARBORUNIV.NS", "ELGIEQUIP": "ELGIEQUIP.NS", "TRITURBINE": "TRITURBINE.NS",
        "BHEL": "BHEL.NS", "HAL": "HAL.NS", "BEL": "BEL.NS",
        "BDL": "BDL.NS", "MAZDOCK": "MAZDOCK.NS", "COCHINSHIP": "COCHINSHIP.NS",
        "PARAS": "PARAS.NS", "MTARTECH": "MTARTECH.NS", "ASTRAMICRO": "ASTRAMICRO.NS",
        "SOLARINDS": "SOLARINDS.NS", "DATAPATTNS": "DATAPATTNS.NS",
        "CGPOWER": "CGPOWER.NS", "SUZLON": "SUZLON.NS", "INOXWIND": "INOXWIND.NS",
    },
    "🧪 Chemicals & Fertilizers": {
        "PIDILITIND": "PIDILITIND.NS", "SRF": "SRF.NS", "NAVINFLUOR": "NAVINFLUOR.NS",
        "ATUL": "ATUL.NS", "DEEPAKNTR": "DEEPAKNTR.NS", "AARTIIND": "AARTIIND.NS",
        "TATACHEM": "TATACHEM.NS", "GNFC": "GNFC.NS", "GSFC": "GSFC.NS",
        "CHAMBLFERT": "CHAMBLFERT.NS", "COROMANDEL": "COROMANDEL.NS", "FACT": "FACT.NS",
        "NFL": "NFL.NS", "RCF": "RCF.NS", "PARADEEP": "PARADEEP.NS",
        "CLEAN": "CLEAN.NS", "FINEORG": "FINEORG.NS", "FLUOROCHEM": "FLUOROCHEM.NS",
        "LXCHEM": "LXCHEM.NS", "NEOGEN": "NEOGEN.NS", "VINATIORGA": "VINATIORGA.NS",
        "ALKYLAMINE": "ALKYLAMINE.NS", "BALAMINES": "BALAMINES.NS",
    },
    "🏢 Cement & Building Materials": {
        "ULTRACEMCO": "ULTRACEMCO.NS", "AMBUJACEM": "AMBUJACEM.NS", "ACC": "ACC.NS",
        "SHREECEM": "SHREECEM.NS", "DALBHARAT": "DALBHARAT.NS", "RAMCOCEM": "RAMCOCEM.NS",
        "JKCEMENT": "JKCEMENT.NS", "NUVOCO": "NUVOCO.NS", "STARCEMENT": "STARCEMENT.NS",
        "PRSMJOHNSN": "PRSMJOHNSN.NS", "HEIDELBERG": "HEIDELBERG.NS", "ORIENTCEM": "ORIENTCEM.NS",
        "ASIANPAINT": "ASIANPAINT.NS", "BERGEPAINT": "BERGEPAINT.NS", "KANSAINER": "KANSAINER.NS",
        "INDIGO": "INDIGO.NS", "ASTRAL": "ASTRAL.NS", "SUPREMEIND": "SUPREMEIND.NS",
        "PRINCEPIPE": "PRINCEPIPE.NS", "CERA": "CERA.NS",
        "KAJARIACER": "KAJARIACER.NS", "GREENPLY": "GREENPLY.NS", "CENTURYPLY": "CENTURYPLY.NS",
    },
    "📡 Telecom, Media & Others": {
        "BHARTIARTL": "BHARTIARTL.NS", "IDEA": "IDEA.NS", "TATACOMM": "TATACOMM.NS",
        "HFCL": "HFCL.NS", "TEJASNET": "TEJASNET.NS", "SUNTV": "SUNTV.NS",
        "ZEEL": "ZEEL.NS", "PVRINOX": "PVRINOX.NS", "TIPSINDLTD": "TIPSINDLTD.NS",
        "SAREGAMA": "SAREGAMA.NS", "NETWORK18": "NETWORK18.NS", "TVTODAY": "TVTODAY.NS",
        "DELHIVERY": "DELHIVERY.NS", "BLUEDART": "BLUEDART.NS", "TCIEXP": "TCIEXP.NS",
        "MAHLOG": "MAHLOG.NS", "GMRINFRA": "GMRINFRA.NS",
    },
    "🏛️ PSU & Government": {
        "NTPC": "NTPC.NS", "POWERGRID": "POWERGRID.NS", "ONGC": "ONGC.NS",
        "COALINDIA": "COALINDIA.NS", "IOC": "IOC.NS", "BPCL": "BPCL.NS",
        "HPCL": "HPCL.NS", "GAIL": "GAIL.NS", "SAIL": "SAIL.NS",
        "BEL": "BEL.NS", "HAL": "HAL.NS", "BHEL": "BHEL.NS",
        "PFC": "PFC.NS", "RECLTD": "RECLTD.NS", "IRFC": "IRFC.NS",
        "RVNL": "RVNL.NS", "IRCON": "IRCON.NS", "RITES": "RITES.NS",
        "SJVN": "SJVN.NS", "NHPC": "NHPC.NS", "NMDC": "NMDC.NS",
        "NBCC": "NBCC.NS", "CONCOR": "CONCOR.NS", "RAILTEL": "RAILTEL.NS",
        "SBIN": "SBIN.NS", "PNB": "PNB.NS", "BANKBARODA": "BANKBARODA.NS",
        "CANBK": "CANBK.NS", "IOB": "IOB.NS", "INDIANB": "INDIANB.NS",
    },
    "🔥 High-Growth / New-Age / Others": {
        "ZOMATO": "ZOMATO.NS", "PAYTM": "PAYTM.NS", "NYKAA": "NYKAA.NS",
        "POLICYBZR": "POLICYBZR.NS", "DELHIVERY": "DELHIVERY.NS", "MAPMYINDIA": "MAPMYINDIA.NS",
        "DEVYANI": "DEVYANI.NS", "CARTRADE": "CARTRADE.NS", "EASEMYTRIP": "EASEMYTRIP.NS",
        "IRCTC": "IRCTC.NS", "INDHOTEL": "INDHOTEL.NS", "LEMONTREE": "LEMONTREE.NS",
        "CHALET": "CHALET.NS", "MHRIL": "MHRIL.NS", "JUBLINGREA": "JUBLINGREA.NS",
        "WESTLIFE": "WESTLIFE.NS", "SULA": "SULA.NS", "MEDPLUS": "MEDPLUS.NS",
        "APARINDS": "APARINDS.NS", "TRIDENT": "TRIDENT.NS", "WELSPUNLIV": "WELSPUNLIV.NS",
        "ARVIND": "ARVIND.NS", "RAYMOND": "RAYMOND.NS", "PAGEIND": "PAGEIND.NS",
        "VTL": "VTL.NS", "KPRMILL": "KPRMILL.NS", "GOKEX": "GOKEX.NS",
    },
}

NSE_INDICES = {
    "NIFTY": "^NSEI", "BANKNIFTY": "^NSEBANK", "SENSEX": "^BSESN",
    "FINNIFTY": "NIFTY_FIN_SERVICE.NS", "NIFTY IT": "^CNXIT",
    "NIFTY AUTO": "^CNXAUTO", "NIFTY PHARMA": "^CNXPHARMA",
    "NIFTY METAL": "^CNXMETAL", "NIFTY REALTY": "^CNXREALTY",
    "NIFTY ENERGY": "^CNXENERGY", "NIFTY FMCG": "^CNXFMCG",
    "NIFTY MEDIA": "^CNXMEDIA", "NIFTY INFRA": "^CNXINFRA",
    "NIFTY PSU BANK": "^CNXPSUBANK", "INDIA VIX": "^INDIAVIX",
}

NSE_SYMBOL_MAP = {}
for sector_stocks in NSE_SECTORS.values():
    NSE_SYMBOL_MAP.update(sector_stocks)
NSE_SYMBOL_MAP.update(NSE_INDICES)

MCX_SYMBOLS = {
    "CRUDEOIL": "CL=F", "NATURALGAS": "NG=F", "GOLD": "GC=F",
    "SILVER": "SI=F", "COPPER": "HG=F", "ALUMINIUM": "ALI=F",
    "ZINC": "ZINC=F", "LEAD": "LEAD=F", "NICKEL": "NICKEL=F",
}

DELTA_COINS = [
    "BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "AVAX", "LINK", "DOT",
    "MATIC", "ARB", "OP", "SUI", "APT", "NEAR", "FIL", "ATOM", "LTC", "BCH"
]

POSITION_TYPES = [
    "Long Equity / Spot",
    "Long Future / Perp",
    "Short Future / Perp",
    "Long Call (CE)",
    "Long Put (PE)",
    "Short Call (CE)",
    "Short Put (PE)",
]


# ============================================================================
# 2. PROFESSIONAL DARK UI + MOBILE RESPONSIVE & PORTAL EMBED THEME
# ============================================================================
CUSTOM_CSS = """
<style>
    /* ---- GLOBAL DARK THEME ---- */
    .stApp { background-color: #0a0e17; }
    .main .block-container { padding-top: 0.9rem; max-width: 1600px; }
    h1, h2, h3, h4, h5 { color: #e2e8f0 !important; font-family: 'JetBrains Mono', monospace; }
    p, span, label, .stMarkdown { color: #94a3b8 !important; }

    /* ---- CLEAN EMBED CHROME ---- */
    #MainMenu { visibility: hidden; }
    footer { visibility: hidden; }
    header[data-testid="stHeader"] { background: transparent; height: 2.2rem; }

    /* ---- METRIC CARDS ---- */
    [data-testid="stMetric"] {
        background: linear-gradient(135deg, #111827 0%, #1e293b 100%);
        border: 1px solid #1e3a5f;
        border-radius: 12px;
        padding: 12px 16px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    [data-testid="stMetric"] label { color: #64748b !important; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.8px; }
    [data-testid="stMetric"] [data-testid="stMetricValue"] { color: #38bdf8 !important; font-size: 1.4rem; font-weight: 700; }
    [data-testid="stMetric"] [data-testid="stMetricDelta"] { font-size: 0.82rem; }

    /* ---- SIDEBAR ---- */
    [data-testid="stSidebar"] {
        background: linear-gradient(180deg, #0f172a 0%, #1e1b4b 100%);
        border-right: 1px solid #1e3a5f;
    }
    [data-testid="stSidebar"] h1, [data-testid="stSidebar"] h2, [data-testid="stSidebar"] h3 { color: #38bdf8 !important; }

    /* ---- TABS ---- */
    .stTabs [data-baseweb="tab-list"] { gap: 4px; background: #111827; border-radius: 10px; padding: 4px; }
    .stTabs [data-baseweb="tab"] {
        color: #64748b !important; background: transparent; border-radius: 8px;
        padding: 10px 16px; font-weight: 600; font-size: 0.84rem;
    }
    .stTabs [aria-selected="true"] { color: #38bdf8 !important; background: #1e3a5f !important; }

    /* ---- BUTTONS ---- */
    .stButton > button {
        background: linear-gradient(135deg, #1e40af, #3b82f6);
        color: white !important; border: none; border-radius: 8px;
        font-weight: 600; padding: 8px 16px; transition: all 0.2s;
    }
    .stButton > button:hover { transform: translateY(-1px); box-shadow: 0 4px 15px rgba(59,130,246,0.4); }

    /* ---- CUSTOM CARDS & LEG BADGES ---- */
    .rescue-box {
        background: linear-gradient(135deg, #064e3b 0%, #0f172a 100%);
        border-left: 4px solid #10b981; border-radius: 8px;
        padding: 14px 18px; margin: 10px 0;
    }
    .warn-box {
        background: linear-gradient(135deg, #78350f 0%, #0f172a 100%);
        border-left: 4px solid #f59e0b; border-radius: 8px;
        padding: 14px 18px; margin: 10px 0;
    }
    .danger-box {
        background: linear-gradient(135deg, #7f1d1d 0%, #0f172a 100%);
        border-left: 4px solid #ef4444; border-radius: 8px;
        padding: 14px 18px; margin: 10px 0;
    }
    .info-box {
        background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%);
        border-left: 4px solid #38bdf8; border-radius: 8px;
        padding: 14px 18px; margin: 10px 0;
    }
    .trade-row-card {
        background: #111827; border: 1px solid #1e3a5f; border-radius: 10px;
        padding: 12px 16px; margin-bottom: 8px;
    }
    .leg-sell {
        background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.45);
        border-radius: 8px; padding: 10px 14px; color: #fca5a5 !important;
    }
    .leg-buy {
        background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.45);
        border-radius: 8px; padding: 10px 14px; color: #6ee7b7 !important;
    }
    .leg-hold {
        background: rgba(56, 189, 248, 0.10); border: 1px solid rgba(56, 189, 248, 0.35);
        border-radius: 8px; padding: 10px 14px; color: #7dd3fc !important;
    }

    .stSelectbox > div > div { background: #1e293b !important; border: 1px solid #334155 !important; border-radius: 8px !important; }
    .stNumberInput > div > div > input { background: #1e293b !important; border: 1px solid #334155 !important; border-radius: 8px !important; color: #e2e8f0 !important; }
    .stTextInput > div > div > input { background: #1e293b !important; border: 1px solid #334155 !important; border-radius: 8px !important; color: #e2e8f0 !important; }
    hr { border-color: #1e3a5f !important; }

    /* ---- MOBILE RESPONSIVE VIEWPORT (< 768px) ---- */
    @media (max-width: 768px) {
        .main .block-container {
            padding-left: 0.65rem !important;
            padding-right: 0.65rem !important;
            padding-top: 0.45rem !important;
        }
        h2 { font-size: 1.15rem !important; }
        h3 { font-size: 1.0rem !important; }
        /* Wrap 6-column metric strips into a clean 2x3 touch grid */
        [data-testid="stHorizontalBlock"] {
            flex-wrap: wrap !important;
            gap: 0.45rem !important;
        }
        [data-testid="stHorizontalBlock"] > [data-testid="stColumn"] {
            min-width: 47% !important;
            flex: 1 1 47% !important;
        }
        [data-testid="stMetric"] { padding: 10px 12px !important; }
        [data-testid="stMetric"] [data-testid="stMetricValue"] { font-size: 1.12rem !important; }
        [data-testid="stMetric"] label { font-size: 0.66rem !important; }

        /* Horizontally scrollable touch tab bar */
        .stTabs [data-baseweb="tab-list"] {
            overflow-x: auto !important;
            flex-wrap: nowrap !important;
            -webkit-overflow-scrolling: touch;
        }
        .stTabs [data-baseweb="tab"] {
            white-space: nowrap !important;
            padding: 8px 12px !important;
            font-size: 0.78rem !important;
        }
        /* 44px minimum touch targets */
        .stButton > button {
            min-height: 44px !important;
            width: 100% !important;
        }
    }
</style>
"""
st.set_page_config(
    page_title="🛡️ Institutional Hedging Terminal v3.2",
    page_icon="🛡️",
    layout="wide",
    initial_sidebar_state="auto",
)
st.markdown(CUSTOM_CSS, unsafe_allow_html=True)


def full_width(fn):
    """Width kwarg for one Streamlit element, across Streamlit versions.

    `width="stretch"` is the 2026 API (use_container_width was removed); older
    builds only understand use_container_width, so ask the callable itself
    instead of hard-coding one and crashing on the other.
    """
    try:
        if "width" in inspect.signature(fn).parameters:
            return {"width": "stretch"}
    except (TypeError, ValueError):
        pass
    if "use_container_width" in inspect.signature(fn).parameters:
        return {"use_container_width": True}
    return {}


# ============================================================================
# 3. QUANTITATIVE ENGINE — BSM, GREEKS, REGIME & LIVE FEEDS
# ============================================================================
class BSMEngine:
    @staticmethod
    def price(S, K, T, r, sigma, opt_type="CE"):
        T = max(T, 1 / 8760)
        sigma = max(sigma, 0.05)
        S, K = max(S, 1e-6), max(K, 1e-6)
        d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)
        if opt_type in ("CE", "C", "CALL"):
            return max(S * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2), 0.01)
        return max(K * math.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1), 0.01)

    @staticmethod
    def greeks(S, K, T, r, sigma, opt_type="CE"):
        T = max(T, 1 / 8760)
        sigma = max(sigma, 0.05)
        S, K = max(S, 1e-6), max(K, 1e-6)
        d1 = (math.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)
        is_call = opt_type in ("CE", "C", "CALL")
        delta = norm.cdf(d1) if is_call else norm.cdf(d1) - 1
        gamma = norm.pdf(d1) / (S * sigma * math.sqrt(T))
        theta = (
            -(S * norm.pdf(d1) * sigma) / (2 * math.sqrt(T))
            - r * K * math.exp(-r * T) * (norm.cdf(d2) if is_call else norm.cdf(-d2))
        ) / 365
        vega = S * norm.pdf(d1) * math.sqrt(T) / 100
        pop = norm.cdf(-d2) * 100 if is_call else norm.cdf(d2) * 100
        return {"delta": delta, "gamma": gamma, "theta": theta, "vega": vega, "pop": pop}

    @staticmethod
    def payoff_grid(legs, S_arr, eval_days, r, sigma):
        pnl = np.zeros_like(S_arr, dtype=float)
        for leg in legs:
            if leg["type"] in ("SPOT", "FUT"):
                pnl += leg["side"] * leg["qty"] * (S_arr - leg["entry"])
            else:
                T_rem = max(leg["dte"] - eval_days, 0) / 365
                theo = np.where(
                    T_rem < 1e-5,
                    np.maximum(S_arr - leg["strike"], 0)
                    if leg["type"] == "CE"
                    else np.maximum(leg["strike"] - S_arr, 0),
                    BSMEngine._vec_price(S_arr, leg["strike"], T_rem, r, sigma, leg["type"]),
                )
                pnl += leg["side"] * leg["qty"] * (theo - leg["entry"])
        return pnl

    @staticmethod
    def _vec_price(S, K, T, r, sigma, opt_type):
        sigma = max(sigma, 0.05)
        d1 = (np.log(np.maximum(S, 1e-6) / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
        d2 = d1 - sigma * np.sqrt(T)
        if opt_type in ("CE", "C"):
            return S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
        return K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)

    @staticmethod
    def solve_zero_cost(S, K_long, target, T, r, sigma, opt_type, step):
        best_k, best_p = (K_long + step * 3 if opt_type == "CE" else max(K_long - step * 3, step)), 0
        for i in range(1, 40):
            k = K_long + i * step if opt_type == "CE" else K_long - i * step
            if k <= 0:
                continue
            p = BSMEngine.price(S, k, T, r, sigma, opt_type)
            if abs(p - target) < abs(best_p - target):
                best_k, best_p = k, p
        return best_k, best_p


def compute_regime(df):
    if df is None or len(df) < 20:
        return {"rsi": 50.0, "adx": 20.0, "atr": 0.0, "vwap": 0.0, "hv": 0.20, "ema20": 0.0, "bbw": 0.05}
    c = df["Close"].astype(float)
    h = df["High"].astype(float)
    l = df["Low"].astype(float)
    v = df["Volume"].astype(float) if "Volume" in df.columns else pd.Series(1, index=df.index)

    d = c.diff()
    g = d.clip(lower=0).rolling(14).mean()
    lo = (-d.clip(upper=0)).rolling(14).mean()
    rs = g / lo.replace(0, np.nan)
    rsi = float((100 - 100 / (1 + rs)).iloc[-1]) if not np.isnan(rs.iloc[-1]) else 50.0

    tr = pd.concat([h - l, (h - c.shift(1)).abs(), (l - c.shift(1)).abs()], axis=1).max(axis=1)
    atr = float(tr.rolling(14).mean().iloc[-1])
    up, dn = h.diff(), -l.diff()
    pdi = 100 * pd.Series(np.where((up > dn) & (up > 0), up, 0), index=df.index).rolling(14).mean() / tr.rolling(14).mean().replace(0, np.nan)
    mdi = 100 * pd.Series(np.where((dn > up) & (dn > 0), dn, 0), index=df.index).rolling(14).mean() / tr.rolling(14).mean().replace(0, np.nan)
    adx_series = (100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)).rolling(14).mean()
    adx = float(adx_series.iloc[-1]) if not np.isnan(adx_series.iloc[-1]) else 20.0

    hv = float(np.log(c / c.shift(1)).dropna().tail(20).std() * np.sqrt(252))
    ema20 = float(c.ewm(span=20).mean().iloc[-1])
    tp = (h + l + c) / 3
    vwap = float((tp * v).tail(20).sum() / v.tail(20).sum()) if v.tail(20).sum() > 0 else float(c.iloc[-1])
    bb_mid = c.rolling(20).mean()
    bb_std = c.rolling(20).std()
    bbw = float((((bb_mid + 2 * bb_std) - (bb_mid - 2 * bb_std)) / bb_mid).iloc[-1]) if len(bb_mid.dropna()) > 0 else 0.05

    return {
        "rsi": round(rsi, 1),
        "adx": round(adx, 1),
        "atr": round(atr, 2),
        "vwap": round(vwap, 2),
        "hv": max(round(hv, 4), 0.08),
        "ema20": round(ema20, 2),
        "bbw": round(bbw, 4),
    }


@st.cache_data(ttl=45)
def fetch_live(symbol, interval="1d"):
    sym = symbol.strip().upper()
    if sym in MCX_SYMBOLS:
        usdinr_df = yf.Ticker("USDINR=X").history(period="5d")
        usdinr = float(usdinr_df["Close"].iloc[-1]) if not usdinr_df.empty else 86.50
        df = yf.Ticker(MCX_SYMBOLS[sym]).history(period="90d")
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        if df.empty:
            raise ValueError(f"No MCX proxy feed for {sym}.")
        unit_mult = (10 / 31.1035) if sym == "GOLD" else ((1000 / 31.1035) if sym == "SILVER" else 1.0)
        conv = usdinr * unit_mult * 1.06
        for col in ["Open", "High", "Low", "Close"]:
            df[col] *= conv
        spot = float(df["Close"].iloc[-1])
        reg = compute_regime(df)
        return {
            "symbol": sym, "segment": "MCX", "spot": round(spot, 2),
            "iv": round(max(reg["hv"] * 1.1, 0.22), 4), "cur": "₹",
            "r": 0.068, "funding": 0.0, "df": df, **reg
        }

    yf_sym = NSE_SYMBOL_MAP.get(sym, f"{sym}.NS")
    df = yf.Ticker(yf_sym).history(period="5d" if interval in ("5m", "15m") else "90d", interval=interval)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    if df.empty:
        raise ValueError(f"No data for '{sym}'. Try NIFTY, RELIANCE, TCS, etc.")
    spot = float(df["Close"].iloc[-1])
    reg = compute_regime(df)
    vix = 0.145
    try:
        vix_df = yf.Ticker("^INDIAVIX").history(period="5d")
        if not vix_df.empty:
            vix = float(vix_df["Close"].iloc[-1]) / 100
    except Exception:
        pass
    is_idx = sym in ("NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY") or yf_sym.startswith("^")
    iv = vix if is_idx else max(reg["hv"] * 1.12, vix * 1.35)
    return {
        "symbol": sym, "segment": "NSE", "spot": round(spot, 2),
        "iv": round(iv, 4), "cur": "₹", "r": 0.068, "funding": 0.0, "df": df, **reg
    }


@st.cache_data(ttl=25)
def fetch_delta(coin):
    c = coin.strip().upper().replace("USDT", "").replace("USD", "")
    spot, fr, miv = 0.0, 0.0, 0.55
    for url in ["https://api.india.delta.exchange/v2/tickers", "https://api.delta.exchange/v2/tickers"]:
        try:
            data = requests.get(url, timeout=5).json()
            if data.get("success"):
                ivs = []
                for t in data["result"]:
                    if t.get("symbol") in (f"{c}USD", f"{c}USDT") and "perpetual" in t.get("contract_type", ""):
                        spot = float(t.get("spot_price") or t.get("mark_price") or 0)
                        fr = float(t.get("funding_rate") or 0)
                    elif "options" in t.get("contract_type", "") and f"-{c}-" in t.get("symbol", ""):
                        miv_val = float((t.get("quotes") or {}).get("mark_iv") or 0)
                        if 0.1 < miv_val < 3:
                            ivs.append(miv_val)
                if ivs:
                    miv = float(np.median(ivs))
                break
        except Exception:
            continue
    df = yf.Ticker(f"{c}-USD").history(period="90d")
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    reg = compute_regime(df)
    if spot <= 0 and not df.empty:
        spot = float(df["Close"].iloc[-1])
    if spot <= 0:
        raise ValueError(f"No live feed for {c}. Try BTC, ETH, SOL.")
    return {
        "symbol": c, "segment": "DELTA", "spot": round(spot, 4 if spot < 10 else 2),
        "iv": round(miv if miv > 0.1 else max(reg["hv"], 0.5), 4),
        "cur": "$", "r": 0.045, "funding": round(fr, 4), "df": df, **reg
    }


def get_strike_step(spot, sym=""):
    s = sym.upper()
    if "NIFTY" in s and "BANK" not in s and "FIN" not in s:
        return 50
    if "BANKNIFTY" in s or "SENSEX" in s:
        return 100
    if spot >= 50000:
        return 500
    if spot >= 10000:
        return 100
    if spot >= 2000:
        return 50
    if spot >= 500:
        return 10
    if spot >= 100:
        return 2.5
    if spot >= 10:
        return 0.5
    return max(round(spot * 0.02, 4), 0.001)


def rnd(price, step):
    if step <= 0:
        return round(price, 2)
    v = round(price / step) * step
    return round(v, 4) if step < 1 else round(v, 2)


# ============================================================================
# 4. ADVANCED STRATEGY ENGINE — 8 INSTITUTIONAL BLUEPRINTS
# ============================================================================
def generate_strategies(mkt, pos_type, entry, qty, strike, dte, style):
    S, iv, r, cur = mkt["spot"], mkt["iv"], mkt["r"], mkt["cur"]
    step = get_strike_step(S, mkt["symbol"])
    hedge_dte = {"Intraday": 2, "F&O": max(dte, 5), "Swing": 14, "Investing": 30}.get(style, 7)
    T = hedge_dte / 365
    strategies = []

    if pos_type in ("Long Equity / Spot", "Long Future / Perp"):
        # STRATEGY 1: Zero-Cost 1x2 Recovery Spread
        K1 = rnd(S, step)
        c1 = BSMEngine.price(S, K1, T, r, iv, "CE")
        K2, c2 = BSMEngine.solve_zero_cost(S, K1, c1 / 2, T, r, iv, "CE", step)
        new_be = (entry + K1 + (c1 - 2 * c2)) / 2
        strategies.append({
            "name": "1x2 Covered Recovery Spread",
            "icon": "🔄", "risk": "LOW", "fit": "Oversold RSI / Sideways — expect 40-50% bounce",
            "legs": [
                {"label": f"Hold {qty:g}x {mkt['symbol']}", "type": "SPOT", "side": 1, "qty": qty, "entry": entry, "strike": 0, "dte": hedge_dte},
                {"label": f"Buy {qty:g}x {K1} CE", "type": "CE", "side": 1, "qty": qty, "entry": c1, "strike": K1, "dte": hedge_dte},
                {"label": f"Sell {2*qty:g}x {K2} CE", "type": "CE", "side": -1, "qty": 2 * qty, "entry": c2, "strike": K2, "dte": hedge_dte},
            ],
            "steps": [
                f"HOLD {qty:g}x {mkt['symbol']} @ {cur}{entry:,.2f}. Do NOT average down.",
                f"BUY {qty:g}x **{K1} CE** @ ~{cur}{c1:,.2f} ({hedge_dte} DTE).",
                f"SELL {2*qty:g}x **{K2} CE** @ ~{cur}{c2:,.2f} (100% covered by Long + K1 CE).",
                f"✅ Breakeven drops from **{cur}{entry:,.2f}** → **~{cur}{new_be:,.2f}** (2x Delta acceleration between {K1}–{K2}).",
            ],
            "eval_days": hedge_dte,
        })

        # STRATEGY 2: Delta-Flip Seagull (Crash -> Profit)
        Kp = rnd(S, step)
        Kw = rnd(S * 0.92, step)
        Kf = rnd(max(entry, S * 1.04), step)
        pa = BSMEngine.price(S, Kp, T, r, iv, "PE")
        pw = BSMEngine.price(S, Kw, T, r, iv, "PE")
        cf = BSMEngine.price(S, Kf, T, r, iv, "CE")
        strategies.append({
            "name": "Delta-Flip Seagull (Crash → Profit)",
            "icon": "🦅", "risk": "MEDIUM", "fit": "ADX > 25, Spot below VWAP — Bearish Breakdown",
            "legs": [
                {"label": f"Hold {qty:g}x Long", "type": "SPOT", "side": 1, "qty": qty, "entry": entry, "strike": 0, "dte": hedge_dte},
                {"label": f"Buy {2*qty:g}x {Kp} PE", "type": "PE", "side": 1, "qty": 2 * qty, "entry": pa, "strike": Kp, "dte": hedge_dte},
                {"label": f"Sell {qty:g}x {Kw} PE", "type": "PE", "side": -1, "qty": qty, "entry": pw, "strike": Kw, "dte": hedge_dte},
                {"label": f"Sell {qty:g}x {Kf} CE", "type": "CE", "side": -1, "qty": qty, "entry": cf, "strike": Kf, "dte": hedge_dte},
            ],
            "steps": [
                f"BUY {2*qty:g}x **{Kp} PE** @ {cur}{pa:,.2f} (2x downside Gamma).",
                f"SELL {qty:g}x **{Kw} PE** + {qty:g}x **{Kf} CE** to finance (net ~{cur}{(pw + cf - 2 * pa) * qty:,.0f}).",
                f"✅ Below {Kp}: Net Delta flips to **-1.0 Short** — crash becomes net profit!",
            ],
            "eval_days": hedge_dte,
        })

        # STRATEGY 3: Weekly Theta-Drip Collar
        Kc = rnd(S * 1.03, step)
        Kf2 = rnd(S * 0.96, step)
        ct = BSMEngine.price(S, Kc, 7 / 365, r, iv, "CE")
        pf = BSMEngine.price(S, Kf2, 7 / 365, r, iv, "PE")
        strategies.append({
            "name": "Weekly Theta-Drip Collar",
            "icon": "🛡️", "risk": "LOW", "fit": "Positional / Investing — Zero crash stress",
            "legs": [
                {"label": f"Hold {qty:g}x Long", "type": "SPOT", "side": 1, "qty": qty, "entry": entry, "strike": 0, "dte": 7},
                {"label": f"Sell Weekly {Kc} CE", "type": "CE", "side": -1, "qty": qty, "entry": ct, "strike": Kc, "dte": 7},
                {"label": f"Buy Floor {Kf2} PE", "type": "PE", "side": 1, "qty": qty, "entry": pf, "strike": Kf2, "dte": 7},
            ],
            "steps": [
                f"Hard downside floor locked at **{cur}{Kf2:,.2f}** via Long {Kf2} PE.",
                f"Sell weekly **{Kc} CE** @ {cur}{ct:,.2f} to reduce cost basis each cycle.",
                f"✅ Net weekly carry: **{cur}{(ct - pf) * qty:,.0f}** while completely crash-proof.",
            ],
            "eval_days": 7,
        })

        # STRATEGY 4: Gamma-Matched Reverse Diagonal
        Kd = rnd(S, step)
        Ks_near = rnd(S * 1.025, step)
        long_dte = hedge_dte + 14
        cd = BSMEngine.price(S, Kd, long_dte / 365, r, iv, "CE")
        cs = BSMEngine.price(S, Ks_near, T, r, iv, "CE")
        strategies.append({
            "name": "Gamma-Matched Reverse Diagonal",
            "icon": "📐", "risk": "MEDIUM", "fit": "Fast intraday spikes — Instant 50-Delta shield",
            "legs": [
                {"label": f"Hold {qty:g}x Long", "type": "SPOT", "side": 1, "qty": qty, "entry": entry, "strike": 0, "dte": hedge_dte},
                {"label": f"Buy {qty:g}x {Kd} CE ({long_dte}D)", "type": "CE", "side": 1, "qty": qty, "entry": cd, "strike": Kd, "dte": long_dte},
                {"label": f"Sell {qty:g}x {Ks_near} CE ({hedge_dte}D)", "type": "CE", "side": -1, "qty": qty, "entry": cs, "strike": Ks_near, "dte": hedge_dte},
            ],
            "steps": [
                f"BUY {qty:g}x **{Kd} CE** ({long_dte} DTE) @ {cur}{cd:,.2f} for low Theta decay & +0.52 Delta boost.",
                f"SELL {qty:g}x **{Ks_near} CE** ({hedge_dte} DTE) @ {cur}{cs:,.2f} to harvest front-week IV crush.",
                f"✅ Net Debit: **{cur}{(cd - cs) * qty:,.0f}** — accelerates recovery on sharp rebounds.",
            ],
            "eval_days": hedge_dte,
        })

    elif pos_type == "Short Future / Perp":
        Kp1 = rnd(S, step)
        p1 = BSMEngine.price(S, Kp1, T, r, iv, "PE")
        Kp2, p2 = BSMEngine.solve_zero_cost(S, Kp1, p1 / 2, T, r, iv, "PE", step)
        new_be = (entry + Kp1 - (p1 - 2 * p2)) / 2
        strategies.append({
            "name": "1x2 Covered Put Ratio Rescue",
            "icon": "📉", "risk": "LOW", "fit": "Overbought RSI / Pullback expected on Short Perp/Fut",
            "legs": [
                {"label": f"Hold {qty:g}x Short {mkt['symbol']}", "type": "FUT", "side": -1, "qty": qty, "entry": entry, "strike": 0, "dte": hedge_dte},
                {"label": f"Buy {qty:g}x {Kp1} PE", "type": "PE", "side": 1, "qty": qty, "entry": p1, "strike": Kp1, "dte": hedge_dte},
                {"label": f"Sell {2*qty:g}x {Kp2} PE", "type": "PE", "side": -1, "qty": 2 * qty, "entry": p2, "strike": Kp2, "dte": hedge_dte},
            ],
            "steps": [
                f"HOLD {qty:g}x Short {mkt['symbol']} @ {cur}{entry:,.2f}.",
                f"BUY {qty:g}x **{Kp1} PE** @ {cur}{p1:,.2f} + SELL {2*qty:g}x **{Kp2} PE** @ {cur}{p2:,.2f}.",
                f"✅ Short breakeven rises from **{cur}{entry:,.2f}** → **~{cur}{new_be:,.2f}** with 2x downward speed.",
            ],
            "eval_days": hedge_dte,
        })

        Kc1 = rnd(S, step)
        Kc2 = rnd(S * 1.07, step)
        Kp_cap = rnd(min(entry, S * 0.96), step)
        ca = BSMEngine.price(S, Kc1, T, r, iv, "CE")
        cw = BSMEngine.price(S, Kc2, T, r, iv, "CE")
        pf = BSMEngine.price(S, Kp_cap, T, r, iv, "PE")
        strategies.append({
            "name": "Short-Squeeze Bull Flip Seagull",
            "icon": "🚀", "risk": "MEDIUM", "fit": "Strong Bullish Breakout against Short Future/Perp",
            "legs": [
                {"label": f"Hold {qty:g}x Short", "type": "FUT", "side": -1, "qty": qty, "entry": entry, "strike": 0, "dte": hedge_dte},
                {"label": f"Buy {2*qty:g}x {Kc1} CE", "type": "CE", "side": 1, "qty": 2 * qty, "entry": ca, "strike": Kc1, "dte": hedge_dte},
                {"label": f"Sell {qty:g}x {Kc2} CE", "type": "CE", "side": -1, "qty": qty, "entry": cw, "strike": Kc2, "dte": hedge_dte},
                {"label": f"Sell {qty:g}x {Kp_cap} PE", "type": "PE", "side": -1, "qty": qty, "entry": pf, "strike": Kp_cap, "dte": hedge_dte},
            ],
            "steps": [
                f"BUY {2*qty:g}x **{Kc1} CE** @ {cur}{ca:,.2f} to neutralize -1.0 Short Delta.",
                f"SELL {qty:g}x **{Kc2} CE** + {qty:g}x **{Kp_cap} PE** to finance upside protection.",
                f"✅ Above {Kc1}: Net Delta flips to **+1.0 Long** — short squeeze turns profitable.",
            ],
            "eval_days": hedge_dte,
        })

    elif pos_type in ("Long Call (CE)", "Long Put (PE)"):
        opt = "CE" if "Call" in pos_type else "PE"
        K_orig = strike if strike > 0 else rnd(S * (1.03 if opt == "CE" else 0.97), step)
        orig_dte = max(dte, 3)
        K_short = rnd(S * (1.02 if opt == "CE" else 0.98), step)
        short_dte = max(min(orig_dte - 2, 5), 1)
        p_short = BSMEngine.price(S, K_short, short_dte / 365, r, iv, opt)
        strategies.append({
            "name": f"Zero-Cost {opt} Calendar / Vertical Rescue",
            "icon": "⏳", "risk": "LOW", "fit": "Stop Theta bleed on underwater Long Option",
            "legs": [
                {"label": f"Hold {qty:g}x Long {K_orig} {opt}", "type": opt, "side": 1, "qty": qty, "entry": entry, "strike": K_orig, "dte": orig_dte},
                {"label": f"Sell {qty:g}x {K_short} {opt} ({short_dte}D)", "type": opt, "side": -1, "qty": qty, "entry": p_short, "strike": K_short, "dte": short_dte},
            ],
            "steps": [
                f"HOLD existing {qty:g}x **{K_orig} {opt}** ({orig_dte} DTE, entry {cur}{entry:,.2f}).",
                f"SELL {qty:g}x front-term **{K_short} {opt}** ({short_dte} DTE) @ {cur}{p_short:,.2f}.",
                f"✅ Cuts net option cost by **{cur}{p_short * qty:,.0f}** and offsets daily Theta decay.",
            ],
            "eval_days": short_dte,
        })

    else:
        opt = "CE" if "Call" in pos_type else "PE"
        opp = "PE" if opt == "CE" else "CE"
        K_orig = strike if strike > 0 else rnd(S, step)
        orig_dte = max(dte, 3)
        K_wing = rnd(K_orig + (2 * step if opt == "CE" else -2 * step), step)
        K_opp = rnd(S * (0.97 if opp == "PE" else 1.03), step)
        p_wing = BSMEngine.price(S, K_wing, orig_dte / 365, r, iv, opt)
        p_opp = BSMEngine.price(S, K_opp, orig_dte / 365, r, iv, opp)
        strategies.append({
            "name": f"Iron Wing & Opposite-Credit Defense ({opt})",
            "icon": "🧱", "risk": "LOW", "fit": "Cap tail risk & collect counter-side Theta on threatened Short Option",
            "legs": [
                {"label": f"Hold {qty:g}x Short {K_orig} {opt}", "type": opt, "side": -1, "qty": qty, "entry": entry, "strike": K_orig, "dte": orig_dte},
                {"label": f"Buy {qty:g}x {K_wing} {opt} Wing", "type": opt, "side": 1, "qty": qty, "entry": p_wing, "strike": K_wing, "dte": orig_dte},
                {"label": f"Sell {qty:g}x {K_opp} {opp}", "type": opp, "side": -1, "qty": qty, "entry": p_opp, "strike": K_opp, "dte": orig_dte},
            ],
            "steps": [
                f"BUY {qty:g}x **{K_wing} {opt}** @ {cur}{p_wing:,.2f} to convert naked tail risk into a capped spread.",
                f"SELL {qty:g}x **{K_opp} {opp}** @ {cur}{p_opp:,.2f} to collect offsetting credit (net {cur}{(p_opp - p_wing) * qty:,.0f}).",
                f"✅ Max loss strictly capped at **{K_wing}** while widening breakeven.",
            ],
            "eval_days": orig_dte,
        })

    return strategies


# ============================================================================
# 5. VISUALIZATION, OPTION CHAIN & STATUTORY AUDIT HELPERS
# ============================================================================
def render_payoff_chart(strat, mkt):
    S, iv, r, cur = mkt["spot"], mkt["iv"], mkt["r"], mkt["cur"]
    eval_days = strat["eval_days"]
    S_arr = np.linspace(S * 0.84, S * 1.16, 160)

    unhedged_leg = [strat["legs"][0]]
    pnl_unhedged = BSMEngine.payoff_grid(unhedged_leg, S_arr, eval_days, r, iv)
    pnl_rescued_exp = BSMEngine.payoff_grid(strat["legs"], S_arr, eval_days, r, iv)
    pnl_rescued_mid = BSMEngine.payoff_grid(strat["legs"], S_arr, max(eval_days / 2, 0.5), r, iv)

    fig = go.Figure()
    fig.add_hline(y=0, line_dash="dash", line_color="#475569", line_width=1)
    fig.add_vline(x=S, line_dash="dot", line_color="#38bdf8", annotation_text=f"Spot {cur}{S:,.2f}", annotation_font_color="#38bdf8")

    fig.add_trace(go.Scatter(
        x=S_arr, y=pnl_unhedged, name="Unhedged Position",
        line=dict(color="#ef4444", width=2, dash="dash")
    ))
    fig.add_trace(go.Scatter(
        x=S_arr, y=pnl_rescued_mid, name=f"Rescued (T+{eval_days/2:.1f}d MTM)",
        line=dict(color="#f59e0b", width=2)
    ))
    fig.add_trace(go.Scatter(
        x=S_arr, y=pnl_rescued_exp, name=f"Rescued at {eval_days}D Expiry",
        line=dict(color="#10b981", width=3),
        fill="tozeroy", fillcolor="rgba(16, 185, 129, 0.10)"
    ))

    fig.update_layout(
        title=f"{strat['icon']} {strat['name']} — Payoff Comparison ({cur})",
        xaxis_title=f"Underlying Price ({cur})",
        yaxis_title=f"Net P&L ({cur})",
        paper_bgcolor="#0a0e17",
        plot_bgcolor="#111827",
        font=dict(color="#e2e8f0", family="JetBrains Mono, monospace"),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        margin=dict(l=15, r=15, t=55, b=25),
        height=360,
    )
    fig.update_xaxes(gridcolor="#1e293b")
    fig.update_yaxes(gridcolor="#1e293b")
    return fig


def render_price_chart(mkt):
    df = mkt.get("df")
    if df is None or df.empty:
        return None
    df_plot = df.tail(60).copy()
    df_plot["EMA20"] = df_plot["Close"].ewm(span=20).mean()
    d = df_plot["Close"].diff()
    g = d.clip(lower=0).rolling(14).mean()
    lo = (-d.clip(upper=0)).rolling(14).mean()
    df_plot["RSI"] = 100 - 100 / (1 + g / lo.replace(0, np.nan))

    fig = make_subplots(
        rows=2, cols=1, shared_xaxes=True, vertical_spacing=0.06,
        row_heights=[0.72, 0.28], subplot_titles=(f"{mkt['symbol']} Price & EMA(20)", "RSI (14)")
    )
    fig.add_trace(go.Candlestick(
        x=df_plot.index, open=df_plot["Open"], high=df_plot["High"],
        low=df_plot["Low"], close=df_plot["Close"], name="OHLC",
        increasing_line_color="#10b981", decreasing_line_color="#ef4444"
    ), row=1, col=1)
    fig.add_trace(go.Scatter(
        x=df_plot.index, y=df_plot["EMA20"], name="EMA 20",
        line=dict(color="#38bdf8", width=1.8)
    ), row=1, col=1)
    fig.add_trace(go.Scatter(
        x=df_plot.index, y=df_plot["RSI"], name="RSI(14)",
        line=dict(color="#a78bfa", width=1.8)
    ), row=2, col=1)
    fig.add_hline(y=70, line_dash="dash", line_color="#ef4444", row=2, col=1)
    fig.add_hline(y=30, line_dash="dash", line_color="#10b981", row=2, col=1)

    fig.update_layout(
        paper_bgcolor="#0a0e17", plot_bgcolor="#111827",
        font=dict(color="#e2e8f0", family="JetBrains Mono, monospace"),
        xaxis_rangeslider_visible=False, height=460,
        margin=dict(l=15, r=15, t=45, b=20),
    )
    fig.update_xaxes(gridcolor="#1e293b")
    fig.update_yaxes(gridcolor="#1e293b")
    return fig


def build_option_chain_df(mkt, dte_chain):
    S, iv, r = mkt["spot"], mkt["iv"], mkt["r"]
    step = get_strike_step(S, mkt["symbol"])
    atm = rnd(S, step)
    T = max(dte_chain, 1) / 365
    rows = []
    for i in range(-7, 8):
        k = rnd(atm + i * step, step)
        if k <= 0:
            continue
        cp = BSMEngine.price(S, k, T, r, iv, "CE")
        cg = BSMEngine.greeks(S, k, T, r, iv, "CE")
        pp = BSMEngine.price(S, k, T, r, iv, "PE")
        pg = BSMEngine.greeks(S, k, T, r, iv, "PE")
        rows.append({
            "CE Price": round(cp, 2),
            "CE Δ": round(cg["delta"], 3),
            "CE Θ/d": round(cg["theta"], 2),
            "CE Short POP%": round(cg["pop"], 1),
            "STRIKE": k,
            "PE Short POP%": round(pg["pop"], 1),
            "PE Θ/d": round(pg["theta"], 2),
            "PE Δ": round(pg["delta"], 3),
            "PE Price": round(pp, 2),
        })
    return pd.DataFrame(rows)


def audit_statutory_costs(segment, notional, gross_target_pnl):
    if segment == "DELTA":
        exchange_fee = notional * 0.0005 * 2
        vda_tax_115bbh = max(gross_target_pnl - exchange_fee, 0.0) * 0.312
        total_friction = exchange_fee + vda_tax_115bbh
        net_expectancy = gross_target_pnl - total_friction
        rule_label = "Sec 115BBH (31.2% Flat VDA Tax, Zero Loss Set-Off) + Sec 194S (1% TDS)"
    elif segment == "MCX":
        brokerage = 40.0
        ctt_sebi_stamp = notional * 0.00015
        gst = (brokerage + ctt_sebi_stamp * 0.2) * 0.18
        total_friction = brokerage + ctt_sebi_stamp + gst
        net_expectancy = gross_target_pnl - total_friction
        rule_label = "MCX CTT (0.01%) + SEBI Turnover + Stamp Duty + 18% GST"
    else:
        brokerage = 40.0
        stt_sebi_stamp = notional * 0.00065
        gst = (brokerage + stt_sebi_stamp * 0.15) * 0.18
        total_friction = brokerage + stt_sebi_stamp + gst
        net_expectancy = gross_target_pnl - total_friction
        rule_label = "NSE STT + SEBI Fees + Stamp Duty + 18% GST"

    return {
        "rule": rule_label,
        "friction": round(total_friction, 2),
        "net_pnl": round(net_expectancy, 2),
        "passed": net_expectancy > 0,
    }


def evaluate_manual_trade(trade):
    seg = trade["segment"]
    sym = trade["symbol"]
    mkt = fetch_delta(sym) if seg == "DELTA" else fetch_live(sym)
    S, iv, r, cur = mkt["spot"], mkt["iv"], mkt["r"], mkt["cur"]
    ptype = trade["pos_type"]
    entry = float(trade["entry"])
    qty = float(trade["qty"])

    if ptype in ("Long Equity / Spot", "Long Future / Perp"):
        mark_price = S
        mtm_pnl = (mark_price - entry) * qty
        delta_exp = qty
    elif ptype == "Short Future / Perp":
        mark_price = S
        mtm_pnl = (entry - mark_price) * qty
        delta_exp = -qty
    else:
        opt = "CE" if "Call" in ptype else "PE"
        is_long = "Long" in ptype
        K = float(trade.get("strike") or S)
        T = max(int(trade.get("dte") or 7), 1) / 365
        mark_price = BSMEngine.price(S, K, T, r, iv, opt)
        g = BSMEngine.greeks(S, K, T, r, iv, opt)
        mtm_pnl = ((mark_price - entry) if is_long else (entry - mark_price)) * qty
        delta_exp = (g["delta"] if is_long else -g["delta"]) * qty

    notional = S * qty
    audit = audit_statutory_costs(seg, notional, mtm_pnl)
    return {
        "cur": cur,
        "spot": S,
        "mark": round(mark_price, 2),
        "mtm_pnl": round(mtm_pnl, 2),
        "delta": round(delta_exp, 2),
        "tax_friction": audit["friction"],
        "net_post_tax": audit["net_pnl"],
    }


def load_trade_into_sidebar(trade):
    seg = trade["segment"]
    st.session_state["sb_custom_sym"] = ""
    st.session_state["sb_custom_coin"] = ""

    if seg == "NSE":
        st.session_state["sb_segment"] = "NSE Equities & Indices (500+)"
        st.session_state["sb_custom_sym"] = trade["symbol"]
    elif seg == "MCX":
        st.session_state["sb_segment"] = "MCX Commodities"
        if trade["symbol"] in MCX_SYMBOLS:
            st.session_state["sb_mcx_sym"] = trade["symbol"]
    else:
        st.session_state["sb_segment"] = "Delta Exchange (Crypto)"
        st.session_state["sb_custom_coin"] = trade["symbol"]

    st.session_state["sb_pos_type"] = trade["pos_type"]
    st.session_state["sb_entry"] = float(trade["entry"])
    st.session_state["sb_qty"] = float(trade["qty"])
    if float(trade.get("strike") or 0) > 0:
        st.session_state["sb_strike"] = float(trade["strike"])
    st.session_state["sb_dte"] = int(trade.get("dte") or 7)
    st.session_state["loaded_banner"] = (
        f"Loaded {trade['symbol']} ({trade['pos_type']} @ {trade['entry']}) — switch to '🛡️ Trade Rescue & Strike Legs' tab to view hedge strikes."
    )


# ============================================================================
# 6. MAIN STREAMLIT TERMINAL APPLICATION
# ============================================================================
def main():
    if "manual_trades" not in st.session_state:
        st.session_state["manual_trades"] = []

    st.markdown("## 🛡️ INSTITUTIONAL HEDGING & TRADE RESCUE TERMINAL `v3.2`")
    st.caption("Manual Trade Book • Live NSE 500+ • MCX Commodities • Delta Exchange Crypto • BSM Greeks • Statutory Cost Gate")

    if st.session_state.get("loaded_banner"):
        st.success(f"🎯 {st.session_state.pop('loaded_banner')}")

    # ---- SIDEBAR CONTROLS ----
    with st.sidebar:
        st.header("⚙️ Active Rescue Target")
        segment = st.selectbox(
            "1. Market Segment",
            ["NSE Equities & Indices (500+)", "MCX Commodities", "Delta Exchange (Crypto)"],
            key="sb_segment",
        )

        if segment == "NSE Equities & Indices (500+)":
            sector_choice = st.selectbox(
                "Sector / Index Universe",
                ["📊 Indices (NIFTY / BANKNIFTY / VIX)"] + list(NSE_SECTORS.keys()),
                key="sb_sector",
            )
            sym_list = list(NSE_INDICES.keys()) if sector_choice.startswith("📊") else list(NSE_SECTORS[sector_choice].keys())
            selected_sym = st.selectbox("Select Instrument", sym_list, key="sb_nse_sym")
            custom_sym = st.text_input("Or Type Any NSE Ticker", key="sb_custom_sym").strip().upper()
            active_sym = custom_sym if custom_sym else selected_sym
        elif segment == "MCX Commodities":
            active_sym = st.selectbox("MCX Commodity Contract", list(MCX_SYMBOLS.keys()), key="sb_mcx_sym")
        else:
            selected_coin = st.selectbox("Delta Exchange Asset", DELTA_COINS, key="sb_delta_coin")
            custom_coin = st.text_input("Or Type Any Crypto Ticker", key="sb_custom_coin").strip().upper()
            active_sym = custom_coin if custom_coin else selected_coin

        interval = st.selectbox("Chart Timeframe", ["1d", "15m", "5m"], index=0, key="sb_interval")

        try:
            if segment == "Delta Exchange (Crypto)":
                mkt = fetch_delta(active_sym)
            else:
                mkt = fetch_live(active_sym, interval=interval)
        except Exception as e:
            st.error(f"Feed Error: {e}")
            return

        st.markdown("---")
        st.subheader("📌 Position Parameters")
        pos_type = st.selectbox("Position Type", POSITION_TYPES, key="sb_pos_type")

        if st.session_state.get("_last_sym") != mkt["symbol"] and "sb_entry" not in st.session_state:
            st.session_state["sb_entry"] = float(round(mkt["spot"] * 1.03, 2))
        st.session_state["_last_sym"] = mkt["symbol"]

        entry_price = st.number_input(
            f"Entry Price ({mkt['cur']})",
            min_value=0.0001,
            value=float(st.session_state.get("sb_entry", round(mkt["spot"] * 1.03, 2))),
            format="%.2f",
            key="sb_entry",
        )
        qty = st.number_input(
            "Quantity / Units",
            min_value=0.01,
            value=float(st.session_state.get("sb_qty", 100.0 if mkt["segment"] != "DELTA" else 1.0)),
            step=1.0,
            key="sb_qty",
        )

        strike_input = 0.0
        dte_input = 7
        if any(x in pos_type for x in ("Call", "Put")):
            step = get_strike_step(mkt["spot"], mkt["symbol"])
            strike_input = st.number_input(
                f"Option Strike ({mkt['cur']})",
                min_value=0.0,
                value=float(st.session_state.get("sb_strike", rnd(mkt["spot"], step))),
                step=float(step),
                key="sb_strike",
            )
            dte_input = st.number_input(
                "Remaining DTE (Days)",
                min_value=1,
                max_value=365,
                value=int(st.session_state.get("sb_dte", 7)),
                key="sb_dte",
            )

        style = st.selectbox("Trading Horizon", ["F&O", "Intraday", "Swing", "Investing"], key="sb_style")
        capital = st.number_input(
            f"Desk Capital ({mkt['cur']})",
            min_value=1000.0,
            value=500000.0 if mkt["cur"] == "₹" else 10000.0,
            step=1000.0,
            key="sb_capital",
        )

    # ---- TOP TELEMETRY METRICS ----
    cur = mkt["cur"]
    unrealized_pnl = (
        (mkt["spot"] - entry_price) * qty
        if pos_type in ("Long Equity / Spot", "Long Future / Perp")
        else (entry_price - mkt["spot"]) * qty
    )
    regime_label = (
        "🔴 OVERSOLD BOUNCE" if mkt["rsi"] < 32
        else ("🟠 OVERBOUGHT / STRETCHED" if mkt["rsi"] > 68
              else ("⚡ STRONG TREND" if mkt["adx"] > 25 else "⚖️ RANGE / COMPRESSION"))
    )

    c1, c2, c3, c4, c5, c6 = st.columns(6)
    c1.metric(f"{mkt['symbol']} Live Spot", f"{cur}{mkt['spot']:,.2f}", f"EMA20: {cur}{mkt['ema20']:,.2f}")
    c2.metric("Implied Vol (IV)", f"{mkt['iv']*100:.1f}%", f"HV20: {mkt['hv']*100:.1f}%")
    c3.metric("RSI (14) / ADX", f"{mkt['rsi']} / {mkt['adx']}", regime_label)
    c4.metric("ATR (14) / VWAP", f"{cur}{mkt['atr']:,.2f}", f"VWAP: {cur}{mkt['vwap']:,.2f}")
    c5.metric("Open Position P&L", f"{cur}{unrealized_pnl:,.2f}", pos_type)
    c6.metric("Funding / Risk-Free", f"{mkt['funding']*100:.3f}%" if mkt["segment"] == "DELTA" else f"{mkt['r']*100:.1f}% RF", mkt["segment"])

    # ---- MAIN TERMINAL TABS ----
    tab_book, tab1, tab2, tab3, tab4, tab5 = st.tabs([
        f"📓 Manual Trade Book ({len(st.session_state['manual_trades'])})",
        "🛡️ Trade Rescue & Strike Legs",
        "📐 BSM Option Chain & Greeks",
        "📊 Multi-TF Chart & Regime",
        "⚖️ Quarter-Kelly & Statutory Tax Gate",
        "🔍 Cross-Asset Scanner",
    ])

    # ========================================================================
    # TAB 0: MANUAL TRADE BOOK (ZERO-CSV ENTRY + LIVE MTM + 1-CLICK RESCUE)
    # ========================================================================
    with tab_book:
        st.subheader("📓 Manual Trade Entry & Live Hedging Book")
        st.caption("Log any taken trade in seconds — no CSV required. Click **🛡️ Rescue** on any open trade to compute exact Buy/Sell hedge strikes.")

        with st.form("manual_trade_form", clear_on_submit=True):
            fc1, fc2, fc3, fc4 = st.columns([1.1, 1.3, 1.6, 1.2])
            f_seg = fc1.selectbox("Segment", ["NSE", "MCX", "DELTA"])
            f_sym = fc2.text_input("Ticker (e.g. RELIANCE, NIFTY, CRUDEOIL, BTC)", value=mkt["symbol"]).strip().upper()
            f_ptype = fc3.selectbox("Trade Direction / Type", POSITION_TYPES)
            f_entry = fc4.number_input("Entry Price", min_value=0.0001, value=float(mkt["spot"]), format="%.2f")

            fc5, fc6, fc7, fc8 = st.columns([1.1, 1.3, 1.6, 1.2])
            f_qty = fc5.number_input("Quantity / Units", min_value=0.01, value=100.0 if f_seg != "DELTA" else 1.0, step=1.0)
            f_strike = fc6.number_input("Option Strike (0 if Spot/Fut)", min_value=0.0, value=0.0, format="%.2f")
            f_dte = fc7.number_input("Option DTE (Days)", min_value=1, max_value=365, value=7)
            f_note = fc8.text_input("Tag / Setup Note (Optional)", placeholder="e.g. Breakout long")

            submitted = st.form_submit_button("➕ Log Trade into Live Book")
            if submitted and f_sym:
                st.session_state["manual_trades"].append({
                    "id": f"{f_sym}_{int(datetime.now().timestamp()*1000)}",
                    "time": datetime.now().strftime("%d-%b %H:%M"),
                    "segment": f_seg,
                    "symbol": f_sym,
                    "pos_type": f_ptype,
                    "entry": f_entry,
                    "qty": f_qty,
                    "strike": f_strike,
                    "dte": f_dte,
                    "note": f_note,
                })
                st.rerun()

        trades = st.session_state["manual_trades"]
        if not trades:
            st.markdown(
                """<div class="info-box">
                    <strong>No trades logged yet.</strong> Use the form above to enter any stock, index option, MCX commodity, or Delta crypto trade you have taken.
                </div>""",
                unsafe_allow_html=True,
            )
        else:
            inr_mtm_total = 0.0
            inr_tax_total = 0.0
            usd_mtm_total = 0.0
            usd_vda_tax_total = 0.0

            st.markdown("### 📊 Active Open Positions (Live MTM & Statutory Audit)")
            for idx, tr in enumerate(trades):
                try:
                    ev = evaluate_manual_trade(tr)
                    if tr["segment"] == "DELTA":
                        usd_mtm_total += ev["mtm_pnl"]
                        usd_vda_tax_total += ev["tax_friction"]
                    else:
                        inr_mtm_total += ev["mtm_pnl"]
                        inr_tax_total += ev["tax_friction"]

                    pnl_color = "#10b981" if ev["mtm_pnl"] >= 0 else "#ef4444"
                    strike_tag = f" | Strike: {tr['strike']:g} ({tr['dte']}D)" if tr["strike"] > 0 else ""
                    note_tag = f" • <em>{tr['note']}</em>" if tr.get("note") else ""

                    rc1, rc2, rc3, rc4 = st.columns([3.4, 1.5, 0.9, 0.7])
                    with rc1:
                        st.markdown(
                            f"""<div class="trade-row-card">
                                <strong>[{tr['segment']}] {tr['symbol']}</strong> — <span>{tr['pos_type']}{strike_tag}</span>{note_tag}<br/>
                                <span style="font-size:0.82rem;">Entry: <strong>{ev['cur']}{tr['entry']:,.2f}</strong> → Live Mark: <strong>{ev['cur']}{ev['mark']:,.2f}</strong> (Spot: {ev['cur']}{ev['spot']:,.2f}) | Qty: <strong>{tr['qty']:g}</strong> | Δ: <strong>{ev['delta']:+.2f}</strong></span>
                            </div>""",
                            unsafe_allow_html=True,
                        )
                    with rc2:
                        st.markdown(
                            f"""<div class="trade-row-card">
                                <span style="font-size:0.75rem;">UNREALIZED MTM</span><br/>
                                <strong style="color:{pnl_color};font-size:1.05rem;">{ev['cur']}{ev['mtm_pnl']:+,.2f}</strong><br/>
                                <span style="font-size:0.75rem;">Post-Tax Est: {ev['cur']}{ev['net_post_tax']:+,.2f}</span>
                            </div>""",
                            unsafe_allow_html=True,
                        )
                    with rc3:
                        st.button(
                            "🛡️ Rescue",
                            key=f"rescue_{tr['id']}",
                            on_click=load_trade_into_sidebar,
                            args=(tr,),
                            help="Load this trade into the Trade Rescue & Strike Legs engine",
                        )
                    with rc4:
                        if st.button("🗑️", key=f"del_{tr['id']}", help="Remove trade from book"):
                            st.session_state["manual_trades"].pop(idx)
                            st.rerun()
                except Exception as err:
                    st.warning(f"Could not price {tr['symbol']}: {err}")

            st.markdown("---")
            s1, s2, s3, s4 = st.columns(4)
            s1.metric("TradFi Open MTM (NSE/MCX)", f"₹{inr_mtm_total:+,.2f}", f"Est. Friction: ₹{inr_tax_total:,.2f}")
            s2.metric("Crypto VDA Open MTM (Delta)", f"${usd_mtm_total:+,.2f}", f"Sec 115BBH Tax (No Loss Offset): ${usd_vda_tax_total:,.2f}")
            s3.metric("Total Active Positions", f"{len(trades)} Trades")
            if s4.button("🧹 Clear Entire Trade Book"):
                st.session_state["manual_trades"] = []
                st.rerun()

    # ========================================================================
    # TAB 1: TRADE RESCUE & EXPLICIT BUY/SELL STRIKE LEGS
    # ========================================================================
    with tab1:
        strategies = generate_strategies(mkt, pos_type, entry_price, qty, strike_input, dte_input, style)
        strat_names = [f"{s['icon']} {s['name']} [{s['risk']} RISK]" for s in strategies]
        chosen_idx = st.selectbox("Select Institutional Rescue Blueprint", range(len(strategies)), format_func=lambda i: strat_names[i])
        active_strat = strategies[chosen_idx]

        st.markdown(
            f"""<div class="rescue-box">
                <strong>{active_strat['icon']} {active_strat['name']}</strong> &nbsp;|&nbsp;
                <span>Ideal Regime: <strong>{active_strat['fit']}</strong></span>
            </div>""",
            unsafe_allow_html=True,
        )

        st.subheader("🎯 Explicit Execution Legs (Buy / Sell Strikes)")
        leg_cols = st.columns(len(active_strat["legs"]))
        for idx, leg in enumerate(active_strat["legs"]):
            with leg_cols[idx]:
                if leg["side"] == -1 and leg["type"] in ("CE", "PE"):
                    css_cls, badge = "leg-sell", "🔴 SELL (SHORT LEG)"
                elif leg["side"] == 1 and leg["type"] in ("CE", "PE"):
                    css_cls, badge = "leg-buy", "🟢 BUY (PROTECTION / BOOSTER)"
                else:
                    css_cls, badge = "leg-hold", "🔵 CORE POSITION"
                st.markdown(
                    f"""<div class="{css_cls}">
                        <div style="font-size:0.72rem;font-weight:700;">{badge}</div>
                        <div style="font-size:1.05rem;font-weight:800;margin:4px 0;">{leg['label']}</div>
                        <div style="font-size:0.8rem;">Price: {cur}{leg['entry']:,.2f} | DTE: {leg['dte']}d</div>
                    </div>""",
                    unsafe_allow_html=True,
                )

        st.markdown("#### 📋 Step-by-Step Execution Checklist")
        for step_txt in active_strat["steps"]:
            st.markdown(f"- {step_txt}")

        st.plotly_chart(
            render_payoff_chart(active_strat, mkt),
            **full_width(st.plotly_chart),
            config={"displayModeBar": False, "responsive": True},
        )

    # ========================================================================
    # TAB 2: BSM OPTION CHAIN & GREEKS MATRIX
    # ========================================================================
    with tab2:
        st.subheader(f"📐 Live BSM Option Chain & Greeks — {mkt['symbol']} (IV: {mkt['iv']*100:.1f}%)")
        chain_dte = st.slider("Option Chain Expiry (DTE)", min_value=1, max_value=60, value=7)
        chain_df = build_option_chain_df(mkt, chain_dte)
        st.dataframe(chain_df, **full_width(st.dataframe), hide_index=True)

    # ========================================================================
    # TAB 3: CANDLESTICK, EMA20 & RSI CHART
    # ========================================================================
    with tab3:
        price_fig = render_price_chart(mkt)
        if price_fig is not None:
            st.plotly_chart(
                price_fig,
                **full_width(st.plotly_chart),
                config={"displayModeBar": False, "responsive": True},
            )
        else:
            st.warning("Historical OHLCV candles unavailable for this ticker.")

    # ========================================================================
    # TAB 4: QUARTER-KELLY & STATUTORY TAX GATE
    # ========================================================================
    with tab4:
        st.subheader("⚖️ Quarter-Kelly Position Sizing & Statutory Expectancy Gate")
        col_a, col_b = st.columns(2)
        with col_a:
            win_prob = st.slider("Estimated Strategy Win Rate (%)", 35, 85, 62) / 100.0
            rr_ratio = st.slider("Reward-to-Risk Ratio (Win / Loss)", 0.5, 4.0, 1.6, 0.1)
            full_kelly = max(win_prob - ((1 - win_prob) / rr_ratio), 0.0)
            quarter_kelly = full_kelly * 0.25
            rec_allocation = capital * quarter_kelly
            rec_units = (
                max(int(rec_allocation / max(mkt["spot"], 1)), 1)
                if mkt["segment"] != "DELTA"
                else round(rec_allocation / max(mkt["spot"], 1), 3)
            )

            st.metric("Quarter-Kelly Allocation %", f"{quarter_kelly*100:.2f}%", f"Full Kelly: {full_kelly*100:.1f}%")
            st.metric("Recommended Max Size", f"{rec_units} units", f"Capital At Risk: {cur}{rec_allocation:,.2f}")

        with col_b:
            notional_val = mkt["spot"] * qty
            est_gross_gain = max(mkt["atr"] * qty * 1.5, notional_val * 0.015)
            audit = audit_statutory_costs(mkt["segment"], notional_val, est_gross_gain)

            gate_class = "rescue-box" if audit["passed"] else "danger-box"
            gate_status = "PASSED (E_net > 0)" if audit["passed"] else "BLOCKED (E_net <= 0)"
            st.markdown(
                f"""<div class="{gate_class}">
                    <strong>Statutory Gate Status: {gate_status}</strong><br/>
                    <span>Regime: {audit['rule']}</span><br/>
                    <span>Est. Gross Edge: <strong>{cur}{est_gross_gain:,.2f}</strong> | Statutory Friction & Tax: <strong>{cur}{audit['friction']:,.2f}</strong></span><br/>
                    <span>Net Post-Tax Expectancy: <strong>{cur}{audit['net_pnl']:,.2f}</strong></span>
                </div>""",
                unsafe_allow_html=True,
            )

    # ========================================================================
    # TAB 5: CROSS-ASSET & SECTOR SCANNER
    # ========================================================================
    with tab5:
        st.subheader("🔍 Quick Cross-Asset Regime Scanner")
        scan_universe = st.radio(
            "Scan Basket",
            ["Benchmark Indices & MCX", "Top Delta Crypto Perps", "Nifty Heavyweights"],
            horizontal=True,
        )
        if st.button("Run Live Regime Scan"):
            if scan_universe == "Benchmark Indices & MCX":
                tickers = [("NIFTY", "NSE"), ("BANKNIFTY", "NSE"), ("CRUDEOIL", "MCX"), ("GOLD", "MCX"), ("SILVER", "MCX")]
            elif scan_universe == "Top Delta Crypto Perps":
                tickers = [(c, "DELTA") for c in ["BTC", "ETH", "SOL", "XRP", "AVAX"]]
            else:
                tickers = [(s, "NSE") for s in ["RELIANCE", "HDFCBANK", "ICICIBANK", "TCS", "INFY", "TATAMOTORS"]]

            scan_rows = []
            for sym_item, seg_item in tickers:
                try:
                    d_mkt = fetch_delta(sym_item) if seg_item == "DELTA" else fetch_live(sym_item)
                    bias = (
                        "Oversold Bounce" if d_mkt["rsi"] < 35
                        else ("Overbought Fade" if d_mkt["rsi"] > 65
                              else ("Trend Follow" if d_mkt["adx"] > 25 else "Range / Collar"))
                    )
                    scan_rows.append({
                        "Symbol": d_mkt["symbol"],
                        "Segment": seg_item,
                        "Spot": f"{d_mkt['cur']}{d_mkt['spot']:,.2f}",
                        "IV %": f"{d_mkt['iv']*100:.1f}%",
                        "RSI (14)": d_mkt["rsi"],
                        "ADX (14)": d_mkt["adx"],
                        "Suggested Rescue / Play": bias,
                    })
                except Exception:
                    continue
            if scan_rows:
                st.dataframe(pd.DataFrame(scan_rows), **full_width(st.dataframe), hide_index=True)


if __name__ == "__main__":
    main()
