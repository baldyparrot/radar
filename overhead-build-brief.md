# Overhead — Build Brief for Claude Code

A wall/counter flight tracker showing live aircraft over our house at Caledonia & Norman (Toronto), designed for kids aged 4–8. Playful, glanceable, fact-driven. No gamification.

**Companion file:** `flight-tracker-v4.html` — the approved visual prototype. Treat it as the style and layout reference, NOT the density reference. The final display must be SIMPLER than the prototype (see §4). Reuse its palette, fonts, plane sprites, panel structure, and day/night system.

---

## 1. Hardware target

- Raspberry Pi Zero 2 W (or Pi 4 if available), Raspberry Pi OS Lite
- 7" HDMI display, 1024×600 or 800×480. **Design at 800×480 logical resolution** and scale to fit.
- Runs Chromium in kiosk mode, fullscreen, no cursor, auto-start on boot
- No touchscreen. No keyboard after setup. The device is display-only.

## 2. Architecture

```
[adsb.lol API] ──┐
[adsbdb API] ────┤
[planespotters]──┼──> Python backend (FastAPI) ──> SQLite ──> WebSocket/SSE ──> Frontend (single HTML/JS page, kiosk)
[hexdb.io] ──────┘
```

- **Backend:** Python 3.11+, FastAPI, `httpx`, `sqlite3`. One process. Serves the frontend statically and pushes state over SSE or WebSocket.
- **Frontend:** single-page vanilla HTML/CSS/JS (no framework, no build step) — evolve directly from the prototype file.
- **Everything runs locally on the Pi.** No cloud services, no accounts, no API keys required in v1.

## 3. Data pipeline

### 3.1 Position polling
- Poll `https://api.adsb.lol/v2/point/{lat}/{lon}/{radius_nm}` every 5 s (config: `poll_interval`).
- Home point: `HOME_LAT`, `HOME_LON` in config — **placeholder `43.686, -79.460` (Caledonia & Norman area); Brady sets exact values.** Radius: 15 nm (covers the ~28 km frame).
- Track aircraft by ICAO hex. Fields used: lat, lon, alt_baro, gs (ground speed), track, flight (callsign), registration (`r`), type (`t`).
- Map lat/lon → screen px with a simple equirectangular projection centered on home (px-per-km constant; prototype uses 28.6 px/km).

### 3.2 Enrichment (on first sight of each callsign, cached in SQLite)
1. **Route:** `https://api.adsbdb.com/v0/callsign/{callsign}` → origin/destination airports, airline name + ICAO/IATA codes. Handle nulls gracefully (military, private, unmatched callsigns → show what we have).
2. **Aircraft:** adsbdb `/v0/aircraft/{hex}` and/or `https://hexdb.io/api/v1/aircraft/{hex}` → type, registration, manufacture year where available.
3. **Photo:** `https://api.planespotters.net/pub/photos/hex/{hex}` → thumbnail URL of the exact airframe. Cache image to disk. Include attribution string (photographer credit) small in the panel — required by their terms.
4. Respect rate limits: enrich sequentially, cache aggressively (SQLite `aircraft` and `routes` tables), never re-fetch what we have. Add User-Agent identifying the hobby project.

### 3.3 Derived values (computed, no schedule API in v1)
- **"Took off X ago":** timestamp of first ADS-B sighting if we saw the climb-out; otherwise estimate from route distance already flown ÷ ground speed; otherwise omit the line.
- **"Lands in ~Y":** great-circle distance remaining to destination airport ÷ current ground speed. Round to friendly units ("~6 h 20 min", "~25 min"). Add destination local time ("· 6:05 AM there") via a static airport→IANA timezone table.
- **Seats:** static YAML lookup `seats.yaml` keyed by aircraft type (ICAO type code), with airline-specific overrides where known. Phrase as "up to N people". Cargo carriers (FedEx, UPS, Cargojet…) → "0 people · 2 pilots" + cargo framing.
- **Aircraft age:** current year − manufacture year.

### 3.4 History (self-built)
- SQLite `sightings` table: hex, registration, callsign, route, timestamp, closest distance to home.
- An "overhead event" = aircraft within `overhead_radius_km` (default 2.5 km) of home.
- On each overhead event, check for prior sightings of the same registration → powers the "this exact plane last flew over our house on {date}" fact.

## 4. Display spec — SIMPLER than the prototype

The v4 prototype is too dense for a 7" screen viewed across a room. Apply these reductions:

### 4.1 Map (idle state)
- Soft radial-gradient ground, day and night palettes exactly as prototype (night switches automatically at local sunset/sunrise — compute from lat/lon, no API).
- **Keep:** overhead zone ring (coral dashed, pulsing), ONE outer range ring (6 km, unlabelled or one small label), the house illustration with "OUR HOUSE", lake band at bottom, Pearson runways icon + "YYZ" at the west edge, CN Tower icon southeast. All at the prototype's true bearings.
- **Cut (move behind config flag `map_detail: full`, default off):** St Clair / Caledonia road lines and labels, Earlscourt Park, YTZ, cardinal letters, extra rings and ring labels.
- Plane sprites: prototype livery system (white body, airline tail fin colour, tail-colour trail). Increase sprite scale ~20% over prototype for legibility.
- Clock chip top-left. Nothing else persistent on screen.

### 4.2 Overhead panel (event state)
Right-side slide-in panel as prototyped, but trimmed:
- **Row 1:** airline logo-circle + airline name; flight number · aircraft type on the second line. Registration + age moves INTO the photo band as a small overlay caption, not a separate header element.
- **Photo band:** the real planespotters photo of this airframe (object-fit: cover), with tiny attribution. Fallback: the SVG side-profile livery illustration from the prototype.
- **Route block:** origin ➜ destination, city names + flag emoji, LARGER than prototype (min 22 px at 800×480). One short time line under each ("took off 22 min ago" / "lands ~6:05 AM there").
- **Wonder banner:** yellow banner, one fact, min 17 px. This is the star — give it room.
- **Cut:** the three-item sub-stat row. Altitude/speed/seats only appear when they ARE the wonder fact or its natural second clause.
- Dwell 12 s with drain bar, then slide out.

### 4.3 Event policy (important — our sky is busy)
- Max one panel per aircraft. While a panel is showing, new overhead events queue only if their wonder score (§5) is ≥ `queue_threshold`; routine flights are silently logged, not shown.
- Cooldown: after a panel closes, suppress the next panel for `cooldown_s` (default 45 s) unless score is high.
- Quiet hours (config, default 21:30–07:00): log everything, show nothing new, dim the display (CSS brightness), night palette.

## 5. Wonder engine

Every overhead aircraft gets scored; the panel leads with the single highest-scoring true fact.

Priority order (first match wins, roughly):
1. **Superlatives** from `facts.yaml` — curated, editable file keyed by aircraft type, airline, or route. Seed entries: A380 = largest passenger plane (two floors); 747 = Queen of the Skies; A225-style rarities; longest routes into YYZ (verify current: HKG, TPE, DEL, DXB class); notably old airframes (age ≥ 30 → "one of the oldest still flying passengers").
2. **Our own history:** registration seen before → "this exact plane last flew over our house on {date}"; first-ever sighting of an airline → "first time we've ever seen {airline}!"
3. **Route character:** overflight (neither end is Toronto) → "not stopping here — flying right over us from {origin} to {destination}"; ultra-long-haul ≥ 12 h; cargo → packages framing; YTZ departures → "took off from the island airport minutes ago".
4. **Computed hooks:** altitude in CN Towers (÷ 553 m), destination local-time contrast ("kids there are asleep"), destination weather contrast for sun routes (optional, needs a weather call — v2).
5. **Fallback:** clean route + type presentation, no banner.

Score also drives sprite emphasis: score ≥ high threshold → slightly larger sprite + brighter trail on the map.

## 6. Config (`config.yaml`)

```yaml
home: {lat: 43.686, lon: -79.460}   # SET EXACT VALUES
overhead_radius_km: 2.5
poll_interval_s: 5
map_detail: minimal        # minimal | full | lofi (rings only)
panel_dwell_s: 12
cooldown_s: 45
queue_threshold: 60
quiet_hours: {start: "21:30", end: "07:00"}
units: metric              # always metric, Celsius
chime: off                 # v2: soft whoosh scaled to aircraft size, respects quiet hours
```

## 7. Build phases

**Phase 1 — Simulation mode.** Port the prototype into the app structure (backend serves frontend; frontend consumes a `/stream` SSE endpoint). Backend emits simulated traffic matching the prototype dataset. Apply all §4 simplifications. Deliverable: runs on a laptop, visually final.

**Phase 2 — Live data.** Replace simulator with adsb.lol polling + projection. Real planes on the map with livery sprites (airline → tail colour table, ~30 airlines common at YYZ, sensible grey default). Overhead detection fires the panel with whatever data is available.

**Phase 3 — Enrichment + wonder engine.** adsbdb routes, planespotters photos with caching + attribution, hexdb age, seats.yaml, facts.yaml, sightings history, scoring, event policy, quiet hours, sunset-driven night mode.

**Phase 4 — Pi deployment.** Systemd service for the backend, Chromium kiosk autostart, unclutter cursor hiding, read-only-friendly logging (cap SQLite size, rotate), graceful behaviour when offline (map stays up, "waiting for planes" state).

Each phase ends with a working, demoable state. Commit per phase.

## 8. Constraints & non-goals

- Free/hobby-tier data only in v1. No FlightAware/paid APIs (AeroAPI is a documented v2 option for true scheduled times).
- **No gamification:** no badges, points, streaks, stickers, tallies, or collection UI. Wonder facts only.
- No user accounts, no cloud, no analytics. All data local to the Pi.
- Metric units and Celsius everywhere.
- Kid-readable copy: short sentences, concrete comparisons, no jargon. Tone reference: the wonder lines in the prototype dataset.
- Handle the unglamorous cases: callsigns with no route match, blocked/private aircraft, missing photos, API downtime. The display should never show an error to the kids — degrade to whatever is known.
