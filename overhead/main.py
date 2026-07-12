"""Overhead backend — Phase 1 (simulation).

One FastAPI process that:
  * serves the single-page frontend from ./static
  * streams live state over SSE at /stream (aircraft positions + panel events)
  * exposes /config so the frontend inherits home coords, ring sizes, palettes.

Phase 2 swaps the Simulator for a real adsb.lol poller behind the same /stream
contract, so nothing here or in the frontend needs to change shape.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import yaml
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .simulator import Simulator

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
STATIC = ROOT / "static"


def load_config() -> dict:
    with open(REPO / "config.yaml") as f:
        return yaml.safe_load(f)


CONFIG = load_config()
app = FastAPI(title="Overhead")


@app.get("/config")
def get_config():
    """Frontend-relevant slice of the config."""
    return JSONResponse({
        "home": CONFIG["home"],
        "overhead_radius_km": CONFIG.get("overhead_radius_km", 2.5),
        "range_ring_km": CONFIG.get("sim", {}).get("range_ring_km", 6.0),
        "px_per_km": CONFIG.get("sim", {}).get("px_per_km", 28.6),
        "map_detail": CONFIG.get("map_detail", "minimal"),
        "panel_dwell_s": CONFIG.get("panel_dwell_s", 12),
        "quiet_hours": CONFIG.get("quiet_hours", {"start": "21:30", "end": "07:00"}),
    })


@app.get("/stream")
async def stream(request: Request):
    """Server-Sent Events: one JSON state frame per poll_interval_s."""
    sim = Simulator(CONFIG)
    interval = float(CONFIG.get("poll_interval_s", 5))
    # In simulation we tick faster than the real poll cadence so motion is smooth.
    tick = interval / max(1.0, CONFIG.get("sim", {}).get("time_scale", 1.0))
    tick = min(tick, 1.0)

    async def gen():
        while True:
            if await request.is_disconnected():
                break
            frame = sim.step()
            yield f"data: {json.dumps(frame)}\n\n"
            await asyncio.sleep(tick)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@app.get("/favicon.ico")
def favicon():
    # kiosk has no favicon; answer cleanly so the console stays quiet
    return Response(status_code=204)


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


app.mount("/", StaticFiles(directory=STATIC), name="static")
