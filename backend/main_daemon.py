from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import time

app = FastAPI(title="Quant Terminal Daemon", version="1.0-prod")

# 1. Production CORS Middleware Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://learningfundclear.sebasish-panda20.workers.dev",
        "http://localhost:8787",
        "http://127.0.0.1:8000",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Keep-Alive Health Probe Endpoint (Required for UptimeRobot)
@app.get("/api/v1/health")
def health_check():
    return {
        "status": "online",
        "mode": "24/7 Cloud Daemon",
        "timestamp": time.time(),
    }