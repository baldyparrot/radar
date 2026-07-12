"""Phase 1 simulated traffic.

Produces a small, lively fleet of aircraft flying straight-line ground tracks
past our house. Works entirely in a local kilometre grid centred on home
(east_km, north_km) and converts to lat/lon on the way out, so Phase 2 can drop
in real adsb.lol positions without the frontend changing.

The simulator also owns the event policy (§4.3): one panel per aircraft pass,
cooldown between panels, and a wonder-score gate for queued events. It emits a
``panel`` payload when a new overhead event should be shown.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

KM_PER_DEG_LAT = 111.32


@dataclass
class Plane:
    hex: str
    callsign: str
    registration: str
    typ: str            # ICAO type code, e.g. "A388"
    type_name: str      # kid-friendly, e.g. "Airbus A380"
    airline: str
    airline_code: str   # for the logo circle initials
    tail: str           # tail-fin / trail colour
    origin: dict        # {code, city, flag}
    dest: dict          # {code, city, flag}
    seats: str          # "up to 500 people"
    age: int | None     # years, or None
    score: int          # wonder score 0-100
    wonder: str         # the single fact line
    took_off: str       # short time line under origin
    lands: str          # short time line under dest
    cruise_alt_m: int   # altitude in metres
    photo_caption: str  # reg + age overlay caption

    # kinematics, in the home-centred km grid
    bearing_deg: float          # direction of travel (0 = north, 90 = east)
    miss_km: float              # perpendicular offset of the track from home

    # livery, reused from the prototype's sprite/side-profile model
    body: str = "#FBFBFB"   # fuselage fill
    eng: str = "#333333"    # engine fill
    stripe: str = "#333333" # window-line accent
    logoc: str = "#333333"  # brand colour for the logo circle
    size: float = 1.0       # sprite scale (prototype scale; frontend adds ~20%)

    start_back_km: float = 24.0 # how far back along the track it spawns
    path_len_km: float = 48.0   # total distance before respawn
    gs_kt: float = 430.0        # ground speed, knots
    phase_km: float = 0.0       # distance travelled along the track so far

    # runtime bookkeeping (not serialised directly)
    _inside: bool = field(default=False, repr=False)
    _shown: bool = field(default=False, repr=False)

    def unit_vec(self) -> tuple[float, float]:
        """East/north components of the travel direction."""
        rad = math.radians(self.bearing_deg)
        return math.sin(rad), math.cos(rad)

    def position_km(self) -> tuple[float, float]:
        """Current (east_km, north_km) in the home grid."""
        ex, ny = self.unit_vec()
        # perpendicular (to the right of travel): rotate travel dir by +90°
        px, py = ny, -ex
        along = self.phase_km - self.start_back_km
        east = ex * along + px * self.miss_km
        north = ny * along + py * self.miss_km
        return east, north

    def advance(self, dt_s: float) -> None:
        km_per_h = self.gs_kt * 1.852
        self.phase_km += km_per_h * dt_s / 3600.0
        if self.phase_km >= self.path_len_km:
            self.phase_km = 0.0
            self._inside = False
            self._shown = False


def _fleet() -> list[Plane]:
    """A curated demo fleet matching the brief's prototype dataset flavour."""
    return [
        # Liveries and wonder copy carried over from the v4 prototype dataset.
        Plane(
            hex="896180", callsign="EK242", registration="A6-EVN",
            typ="A388", type_name="Airbus A380-800", airline="Emirates",
            airline_code="EK", tail="#C8A55B",
            body="#FDFDFD", eng="#D71920", stripe="#D71920", logoc="#D71920", size=1.4,
            origin={"code": "DXB", "city": "Dubai", "flag": "🇦🇪"},
            dest={"code": "YYZ", "city": "Toronto", "flag": "🇨🇦"},
            seats="up to 519 people", age=7, score=95,
            wonder="The largest passenger plane in the world — it has two whole floors!",
            took_off="took off 13 h ago", lands="lands in ~25 min",
            cruise_alt_m=3200, photo_caption="A6-EVN · 7 years old",
            bearing_deg=70, miss_km=0.8, gs_kt=290),
        Plane(
            hex="3c6dd2", callsign="LH471", registration="D-ABYT",
            typ="B748", type_name="Boeing 747-8 Jumbo", airline="Lufthansa",
            airline_code="LH", tail="#0A1D3F",
            body="#F4F7FA", eng="#0A1D3F", stripe="#F9BA00", logoc="#0A1D3F", size=1.3,
            origin={"code": "FRA", "city": "Frankfurt", "flag": "🇩🇪"},
            dest={"code": "YYZ", "city": "Toronto", "flag": "🇨🇦"},
            seats="up to 364 people", age=12, score=88,
            wonder="The famous Jumbo Jet — pilots call it the Queen of the Skies 👑",
            took_off="took off 8 h ago", lands="lands in ~18 min",
            cruise_alt_m=2600, photo_caption="D-ABYT · 12 years old",
            bearing_deg=110, miss_km=-1.6, gs_kt=300),
        Plane(
            hex="c052fa", callsign="AC124", registration="C-GFAF",
            typ="A333", type_name="Airbus A330-300", airline="Air Canada",
            airline_code="AC", tail="#141414",
            body="#FBFBFB", eng="#141414", stripe="#D22630", logoc="#D22630", size=1.05,
            origin={"code": "YYZ", "city": "Toronto", "flag": "🇨🇦"},
            dest={"code": "YVR", "city": "Vancouver", "flag": "🇨🇦"},
            seats="up to 297 people", age=26, score=72,
            wonder="This exact plane last flew over our house on June 28 — welcome back! 👋",
            took_off="took off 9 min ago", lands="lands in ~4 h 40 min",
            cruise_alt_m=2900, photo_caption="C-GFAF · 26 years old",
            bearing_deg=290, miss_km=2.0, gs_kt=340),
        Plane(
            hex="a1b2c3", callsign="PD365", registration="C-GKQL",
            typ="E290", type_name="Embraer E195-E2", airline="Porter",
            airline_code="PD", tail="#12355B",
            body="#FBFBFB", eng="#12355B", stripe="#12355B", logoc="#12355B", size=0.85,
            origin={"code": "YTZ", "city": "Toronto Island", "flag": "🇨🇦"},
            dest={"code": "YOW", "city": "Ottawa", "flag": "🇨🇦"},
            seats="up to 132 people", age=2, score=58,
            wonder="One of the newest, quietest planes in the sky — almost brand new!",
            took_off="took off 9 min ago from the island airport",
            lands="lands in ~40 min",
            cruise_alt_m=2100, photo_caption="C-GKQL · 2 years old",
            bearing_deg=35, miss_km=-1.0, gs_kt=250),
        Plane(
            hex="4ca7b1", callsign="FX9042", registration="N132FE",
            typ="B763", type_name="Boeing 767 Cargo", airline="FedEx",
            airline_code="FX", tail="#4D148C",
            body="#F6F6F8", eng="#FF6600", stripe="#4D148C", logoc="#4D148C", size=1.05,
            origin={"code": "YYZ", "city": "Toronto", "flag": "🇨🇦"},
            dest={"code": "MEM", "city": "Memphis", "flag": "🇺🇸"},
            seats="0 people · 2 pilots", age=9, score=52,
            wonder="No passengers at all — just 52,000 kg of packages! 📦",
            took_off="took off 31 min ago", lands="lands in ~1 h 20 min",
            cruise_alt_m=3000, photo_caption="N132FE · 9 years old",
            bearing_deg=250, miss_km=1.4, gs_kt=360),
        Plane(
            hex="400af2", callsign="NH9", registration="JA789A",
            typ="B77W", type_name="Boeing 777-300ER", airline="ANA",
            airline_code="NH", tail="#10387D",
            body="#F7FAFC", eng="#10387D", stripe="#10387D", logoc="#10387D", size=1.15,
            origin={"code": "JFK", "city": "New York", "flag": "🇺🇸"},
            dest={"code": "HND", "city": "Tokyo", "flag": "🇯🇵"},
            seats="up to 264 people", age=14, score=80,
            wonder="Not stopping here — it's flying right over us on its way across the world! 🌏",
            took_off="took off 1 h 05 min ago", lands="lands in ~12 h · tomorrow there",
            cruise_alt_m=2800, photo_caption="JA789A · 14 years old",
            bearing_deg=330, miss_km=-0.5, gs_kt=300),
    ]


class Simulator:
    def __init__(self, config: dict):
        self.cfg = config
        self.home = config["home"]
        self.overhead_km = float(config.get("overhead_radius_km", 2.5))
        self.cooldown_s = float(config.get("cooldown_s", 45))
        self.queue_threshold = float(config.get("queue_threshold", 60))
        self.time_scale = float(config.get("sim", {}).get("time_scale", 1.0))
        self.km_per_deg_lon = KM_PER_DEG_LAT * math.cos(math.radians(self.home["lat"]))
        self.planes = _fleet()
        # stagger starting phases so passes don't all bunch up
        for i, p in enumerate(self.planes):
            p.phase_km = (i * 7.5) % p.path_len_km
        self._last = time.monotonic()
        self._last_panel_at = -1e9

    def _to_latlon(self, east_km: float, north_km: float) -> tuple[float, float]:
        lat = self.home["lat"] + north_km / KM_PER_DEG_LAT
        lon = self.home["lon"] + east_km / self.km_per_deg_lon
        return lat, lon

    def step(self) -> dict:
        now = time.monotonic()
        dt = (now - self._last) * self.time_scale
        self._last = now

        aircraft = []
        panel = None
        best_pending = None

        for p in self.planes:
            p.advance(dt)
            east, north = p.position_km()
            dist = math.hypot(east, north)
            lat, lon = self._to_latlon(east, north)

            aircraft.append({
                "hex": p.hex, "callsign": p.callsign, "registration": p.registration,
                "lat": lat, "lon": lon, "track": p.bearing_deg,
                "alt_m": p.cruise_alt_m, "gs_kt": p.gs_kt,
                "airline": p.airline, "type": p.typ,
                "tail": p.tail, "body": p.body, "size": p.size,
                "score": p.score, "dist_km": round(dist, 2),
            })

            inside = dist <= self.overhead_km
            if inside and not p._inside and not p._shown:
                # new overhead event for this pass
                if (best_pending is None) or (p.score > best_pending.score):
                    best_pending = p
            p._inside = inside

        if best_pending is not None:
            cooled = (time.monotonic() - self._last_panel_at) >= self.cooldown_s
            if cooled or best_pending.score >= self.queue_threshold:
                panel = self._panel_payload(best_pending)
                best_pending._shown = True
                self._last_panel_at = time.monotonic()

        return {"time": time.time(), "aircraft": aircraft, "panel": panel}

    def _panel_payload(self, p: Plane) -> dict:
        return {
            "hex": p.hex,
            "airline": p.airline, "airline_code": p.airline_code,
            "flight": p.callsign, "type_name": p.type_name,
            "registration": p.registration, "age": p.age,
            "photo_caption": p.photo_caption,
            "origin": p.origin, "dest": p.dest,
            "took_off": p.took_off, "lands": p.lands,
            "seats": p.seats, "wonder": p.wonder, "score": p.score,
            # livery for the side-profile illustration (§4.2 photo fallback)
            "tail": p.tail, "body": p.body, "eng": p.eng,
            "stripe": p.stripe, "logoc": p.logoc, "size": p.size,
        }
