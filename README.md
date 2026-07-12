# Overhead

A wall/counter **live flight tracker** for kids (ages 4–8), showing planes flying
over our house in Toronto. Playful, glanceable, fact-driven — no gamification.

See [`overhead-build-brief.md`](overhead-build-brief.md) for the full spec.

---

## Status

- **Phase 1 — Simulation mode ✅ (this build)**
  Backend serves the frontend and streams simulated traffic over SSE. The
  frontend is evolved directly from `flight-tracker-v4.html` — same palette,
  fonts (Fredoka/Nunito, self-hosted for offline use), plane sprites,
  side-profile liveries, panel and day/night system — with all §4
  simplifications applied. Visually final; runs on a laptop.
- Phase 2 — Live adsb.lol data (next)
- Phase 3 — Enrichment + wonder engine
- Phase 4 — Raspberry Pi kiosk deployment

## Run it

```bash
pip install -r requirements.txt
uvicorn overhead.main:app --host 0.0.0.0 --port 8000
```

Open <http://localhost:8000>. The page is designed at **800×480** and scales to
fill the window (or the Pi's 7" display in kiosk mode).

Useful URL flags for previewing:

- `?night=1` / `?night=0` — force the night / day palette
- `?quiet=1` / `?quiet=0` — force quiet-hours dimming on / off

Map density follows `map_detail` in `config.yaml`: `minimal` (default — one range
ring, house, Pearson, CN Tower, lake), `full` (adds roads, park, extra rings,
cardinals, YTZ), or `lofi` (rings only).

Planes fly straight tracks past the house; when one enters the 2.5 km overhead
zone the panel slides in for `panel_dwell_s` seconds with a drain bar, then out.
Event policy (one panel per pass, cooldown, wonder-score gate) is applied in the
simulator so a busy sky doesn't flood the screen.

## Layout

```
config.yaml                 # home coords, radii, timers, quiet hours, sim knobs
overhead/
  main.py                   # FastAPI app: /  /config  /stream (SSE)
  simulator.py              # Phase 1 simulated fleet + event policy
  static/
    index.html              # the single-page display (DOM map + SVG planes)
    styles.css              # prototype palette, panel, wonder banner
    app.js                  # projection, SSE, SVG sprites, panel queue, day/night
    fonts/                  # Fredoka + Nunito woff2, self-hosted (offline Pi)
```

## Contract (stable across phases)

`GET /stream` emits one JSON frame per tick:

```json
{
  "time": 1699999999.0,
  "aircraft": [
    {"hex":"...","callsign":"...","lat":43.7,"lon":-79.4,"track":70,
     "alt_m":3200,"gs_kt":290,"airline":"...","tail":"#d71920","score":95,"dist_km":1.2}
  ],
  "panel": { "airline":"...", "flight":"...", "origin":{...}, "dest":{...},
             "wonder":"...", "seats":"...", "took_off":"...", "lands":"..." }
}
```

`panel` is `null` except on the frame a new overhead event should be shown.
Phase 2 replaces `simulator.py` with a real adsb.lol poller behind this same
contract, so the frontend does not change.
