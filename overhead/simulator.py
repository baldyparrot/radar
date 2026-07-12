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
        Plane(
            hex="896180", callsign="UAE241", registration="A6-EEQ",
            typ="A388", type_name="Airbus A380", airline="Emirates",
            airline_code="EK", tail="#d71920",
            origin={"code": "DXB", "city": "Dubai", "flag": "🇦🇪"},
            dest={"code": "YYZ", "city": "Toronto", "flag": "🇨🇦"},
            seats="up to 500 people", age=6, score=95,
            wonder="This is the biggest passenger plane in the world — it has TWO floors of seats!",
            took_off="took off 13 h ago", lands="lands ~in 25 min",
            cruise_alt_m=3200, photo_caption="A6-EEQ · 6 years old",
            bearing_deg=70, miss_km=0.8, gs_kt=290),
        Plane(
            hex="3c6dd2", callsign="DLH470", registration="D-ABYK",
            typ="B748", type_name="Boeing 747-8", airline="Lufthansa",
            airline_code="LH", tail="#0b2d6b",
            origin={"code": "FRA", "city": "Frankfurt", "flag": "🇩🇪"},
            dest={"code": "YYZ", "city": "Toronto", "flag": "🇨🇦"},
            seats="up to 364 people", age=9, score=88,
            wonder="They call this one the Queen of the Skies — look at the hump on top!",
            took_off="took off 8 h ago", lands="lands ~in 18 min",
            cruise_alt_m=2600, photo_caption="D-ABYK · 9 years old",
            bearing_deg=110, miss_km=-1.6, gs_kt=300),
        Plane(
            hex="c052fa", callsign="ACA456", registration="C-FGDT",
            typ="A320", type_name="Airbus A320", airline="Air Canada",
            airline_code="AC", tail="#d0021b",
            origin={"code": "YYZ", "city": "Toronto", "flag": "🇨🇦"},
            dest={"code": "YUL", "city": "Montréal", "flag": "🇨🇦"},
            seats="up to 146 people", age=12, score=35,
            wonder="Just took off from Toronto — off to Montréal for a quick hop!",
            took_off="took off 6 min ago", lands="lands ~in 55 min",
            cruise_alt_m=2900, photo_caption="C-FGDT · 12 years old",
            bearing_deg=55, miss_km=2.0, gs_kt=340),
        Plane(
            hex="a1b2c3", callsign="POE324", registration="C-GLQD",
            typ="DH8D", type_name="Dash 8-400", airline="Porter",
            airline_code="PD", tail="#0e2340",
            origin={"code": "YTZ", "city": "Toronto Island", "flag": "🇨🇦"},
            dest={"code": "YOW", "city": "Ottawa", "flag": "🇨🇦"},
            seats="up to 78 people", age=15, score=58,
            wonder="This little plane took off from the island airport downtown minutes ago!",
            took_off="took off 4 min ago", lands="lands ~in 45 min",
            cruise_alt_m=2100, photo_caption="C-GLQD · 15 years old",
            bearing_deg=35, miss_km=-1.0, gs_kt=250),
        Plane(
            hex="4ca7b1", callsign="CJT701", registration="C-FCAE",
            typ="B763", type_name="Boeing 767 freighter", airline="Cargojet",
            airline_code="W8", tail="#8a1a1a",
            origin={"code": "YYZ", "city": "Toronto", "flag": "🇨🇦"},
            dest={"code": "YVR", "city": "Vancouver", "flag": "🇨🇦"},
            seats="0 people · 2 pilots", age=22, score=52,
            wonder="No passengers on this one — it's packed with boxes and parcels flying across Canada!",
            took_off="took off 15 min ago", lands="lands ~in 4 h 20 min",
            cruise_alt_m=3000, photo_caption="C-FCAE · 22 years old",
            bearing_deg=290, miss_km=1.4, gs_kt=360),
        Plane(
            hex="400af2", callsign="BAW99", registration="G-STBF",
            typ="B77W", type_name="Boeing 777", airline="British Airways",
            airline_code="BA", tail="#1d2b5c",
            origin={"code": "LHR", "city": "London", "flag": "🇬🇧"},
            dest={"code": "YYZ", "city": "Toronto", "flag": "🇨🇦"},
            seats="up to 297 people", age=11, score=70,
            wonder="This plane flew all the way across the ocean from London — over the whole Atlantic!",
            took_off="took off 7 h ago", lands="lands ~in 20 min",
            cruise_alt_m=2800, photo_caption="G-STBF · 11 years old",
            bearing_deg=95, miss_km=-0.5, gs_kt=300),
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
                "airline": p.airline, "tail": p.tail, "type": p.typ,
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
            "airline": p.airline, "airline_code": p.airline_code, "tail": p.tail,
            "flight": p.callsign, "type_name": p.type_name,
            "registration": p.registration, "age": p.age,
            "photo_caption": p.photo_caption,
            "origin": p.origin, "dest": p.dest,
            "took_off": p.took_off, "lands": p.lands,
            "seats": p.seats, "wonder": p.wonder, "score": p.score,
        }
