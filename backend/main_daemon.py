import os
import time

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Quant Terminal Daemon", version="1.0-prod")


def _allowed_origins() -> list[str]:
    """Browser origins allowed to call this daemon directly."""
    raw = os.environ.get("QUANT_ALLOWED_ORIGINS", "")
    extra = [o.strip() for o in raw.split(",") if o.strip()]
    return [
        "https://learningfundclear.sebasish-panda20.workers.dev",
        "http://localhost:8787",
        "http://127.0.0.1:8000",
        *extra,
    ]


# Production CORS. A wildcard is intentionally NOT used: wildcard combined with
# allow_credentials is rejected by browsers, and the desk talks to the daemon
# through the same-origin /quant-terminal proxy anyway. Add custom origins with
# the QUANT_ALLOWED_ORIGINS env var (comma separated).
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/v1/health")
def health_check():
    """Keep-alive endpoint polled by UptimeRobot every 5 minutes."""
    return {
        "status": "online",
        "mode": "24/7 Cloud Daemon",
        "timestamp": time.time(),
    }


@app.get("/")
def root():
    return {
        "service": "quant-terminal-daemon",
        "health": "/api/v1/health",
        "status": "online",
    }
