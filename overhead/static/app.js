/* Overhead — Phase 1 frontend logic.
 *
 * Evolved from flight-tracker-v4.html: same projection constant (28.6 px/km,
 * house at 400,230), the same SVG plane sprites and side-profile livery art,
 * the same panel + day/night system — but driven by the live /stream SSE feed
 * instead of the prototype's random spawner, with the §4 simplifications.
 */

const NS = "http://www.w3.org/2000/svg";
const W = 800, H = 480;
const HOME_PX = { x: 400, y: 230 };   // matches prototype
const KM_PER_DEG_LAT = 111.32;

// prototype sprite geometry (nose points up at rotation 0)
const BODY = "M0,-14 C2,-9 3,-5 3,-2 L14,6 L14,9 L3,4 L3,9 L6,12 L6,14 L0,12 L-6,14 L-6,12 L-3,9 L-3,4 L-14,9 L-14,6 L-3,-2 C-3,-5 -2,-9 0,-14 Z";
const FIN = "M0,8.5 L4.6,13.6 L-4.6,13.6 Z";
const SPRITE_BOOST = 1.2;   // §4.2: ~20% larger sprites than the prototype

const stage = document.getElementById("stage");
const device = document.getElementById("device");
const planesLayer = document.getElementById("planes");

let CFG = null, kmPerDegLon = 80, pxPerKm = 28.6;

const LANDMARKS = {
  pearson: { lat: 43.6777, lon: -79.6248 },
  cntower: { lat: 43.6426, lon: -79.3871 },
};

/* ---------- fit the fixed stage to the viewport ---------- */
function fitStage() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.transform = `scale(${s})`;
  stage.style.left = `${Math.max(0, (window.innerWidth - W * s) / 2)}px`;
  stage.style.top = `${Math.max(0, (window.innerHeight - H * s) / 2)}px`;
}
window.addEventListener("resize", fitStage);

/* ---------- projection: lat/lon -> screen px ---------- */
function project(lat, lon) {
  const eastKm = (lon - CFG.home.lon) * kmPerDegLon;
  const northKm = (lat - CFG.home.lat) * KM_PER_DEG_LAT;
  return { x: HOME_PX.x + eastKm * pxPerKm, y: HOME_PX.y - northKm * pxPerKm };
}

/* place the ring, house-relative sizes, and geo landmarks once config loads */
function layoutMap() {
  // overhead zone from config
  const zoneR = (CFG.overhead_radius_km || 2.5) * pxPerKm;
  const zone = document.getElementById("zone");
  zone.style.width = zone.style.height = `${zoneR * 2}px`;
  zone.style.margin = `${-zoneR}px 0 0 ${-zoneR}px`;

  // single outer range ring
  const rr = (CFG.range_ring_km || 6) * pxPerKm;
  const ring = document.getElementById("rangeRing");
  ring.style.left = `${HOME_PX.x - rr}px`;
  ring.style.top = `${HOME_PX.y - rr}px`;
  ring.style.width = ring.style.height = `${rr * 2}px`;
  const rlbl = document.getElementById("rangeLbl");
  rlbl.style.left = `${HOME_PX.x - 12}px`;
  rlbl.style.top = `${HOME_PX.y - rr + 13}px`;
  rlbl.textContent = `${CFG.range_ring_km || 6} km`;

  // Pearson (crossed runways) + label, at true bearing
  const yyz = project(LANDMARKS.pearson.lat, LANDMARKS.pearson.lon);
  placeRwy("yyz1", yyz.x - 21, yyz.y - 2, 42, 6, -14);
  placeRwy("yyz2", yyz.x - 18, yyz.y - 6, 36, 6, 48);
  place("yyzlbl", yyz.x - 14, yyz.y + 22);

  // CN Tower + label
  const cn = project(LANDMARKS.cntower.lat, LANDMARKS.cntower.lon);
  place("cntower", cn.x - 6, cn.y - 22);
  place("cnlbl", cn.x + 10, cn.y);

  device.dataset.detail = CFG.map_detail || "minimal";
}
function place(id, x, y) { const e = document.getElementById(id); e.style.left = `${x}px`; e.style.top = `${y}px`; }
function placeRwy(id, x, y, w, h, rot) {
  const e = document.getElementById(id);
  e.style.left = `${x}px`; e.style.top = `${y}px`;
  e.style.width = `${w}px`; e.style.height = `${h}px`;
  e.style.transform = `rotate(${rot}deg)`;
}

/* ---------- day / night (computed, no API) ---------- */
function sunTimes(date, lat, lon) {
  const rad = Math.PI / 180, dayMs = 86400000;
  const doy = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / dayMs);
  const lngHour = lon / 15;
  function calc(isSunrise) {
    const t = doy + ((isSunrise ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634;
    L = ((L % 360) + 360) % 360;
    let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
    RA = ((RA % 360) + 360) % 360;
    RA += (Math.floor(L / 90) - Math.floor(RA / 90)) * 90; RA /= 15;
    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(90.833 * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null;
    let Hh = (isSunrise ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad) / 15;
    const T = Hh + RA - 0.06571 * t - 6.622;
    const UT = ((T - lngHour) % 24 + 24) % 24;
    const d = new Date(date); d.setUTCHours(0, 0, 0, 0);
    return new Date(d.getTime() + UT * 3600000);
  }
  return { sunrise: calc(true), sunset: calc(false) };
}
function isNightNow() {
  const url = new URLSearchParams(location.search);
  if (url.has("night")) return url.get("night") !== "0";
  const now = new Date();
  const { sunrise, sunset } = sunTimes(now, CFG.home.lat, CFG.home.lon);
  if (!sunrise || !sunset) return false;
  return now < sunrise || now > sunset;
}
function inQuietHours() {
  const url = new URLSearchParams(location.search);
  if (url.has("quiet")) return url.get("quiet") !== "0";
  const q = CFG.quiet_hours || {};
  if (!q.start || !q.end) return false;
  const now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = q.start.split(":").map(Number), [eh, em] = q.end.split(":").map(Number);
  const s = sh * 60 + sm, e = eh * 60 + em;
  return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e);
}
function applyDayNight() {
  device.classList.toggle("night", isNightNow());
  device.classList.toggle("quiet", inQuietHours());
}

/* ---------- planes ---------- */
const fleet = new Map();   // hex -> { g, spr, trail, render, target, track, size, tail, hot, pts, frame }

function makePlaneEl(a) {
  const g = document.createElementNS(NS, "g");
  const trail = document.createElementNS(NS, "polyline");
  trail.setAttribute("class", "trail");
  trail.setAttribute("stroke", a.tail);
  trail.setAttribute("stroke-width", (3 * a.size).toFixed(1));
  const spr = document.createElementNS(NS, "g");
  const body = document.createElementNS(NS, "path");
  body.setAttribute("d", BODY); body.setAttribute("fill", a.body);
  body.setAttribute("stroke", "#7E8B98"); body.setAttribute("stroke-width", "1.1");
  const fin = document.createElementNS(NS, "path");
  fin.setAttribute("d", FIN); fin.setAttribute("fill", a.tail);
  spr.appendChild(body); spr.appendChild(fin);
  g.appendChild(trail); g.appendChild(spr);
  planesLayer.appendChild(g);
  return { g, spr, trail };
}

function ingest(frame) {
  const seen = new Set();
  for (const a of frame.aircraft) {
    seen.add(a.hex);
    const p = project(a.lat, a.lon);
    let e = fleet.get(a.hex);
    if (!e) {
      const els = makePlaneEl(a);
      e = { ...els, render: { ...p }, pts: [], frame: 0 };
      fleet.set(a.hex, e);
    }
    e.target = p; e.track = a.track; e.size = a.size; e.tail = a.tail;
    const hot = a.score >= 80;
    if (hot !== e.hot) e.trail.classList.toggle("hot", hot);
    e.hot = hot;
  }
  for (const [hex, e] of [...fleet]) {
    if (!seen.has(hex)) { e.g.remove(); fleet.delete(hex); }
  }
  document.getElementById("idle").classList.toggle("gone", frame.aircraft.length > 0);
  if (frame.panel) enqueuePanel(frame.panel);
}

let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  for (const e of fleet.values()) {
    if (e.target) {
      e.render.x += (e.target.x - e.render.x) * Math.min(1, dt * 4);
      e.render.y += (e.target.y - e.render.y) * Math.min(1, dt * 4);
    }
    const scale = e.size * SPRITE_BOOST * (e.hot ? 1.12 : 1);
    e.spr.setAttribute("transform", `translate(${e.render.x},${e.render.y}) rotate(${e.track || 0}) scale(${scale})`);
    if ((e.frame++ % 5) === 0) {
      e.pts.push(`${e.render.x.toFixed(1)},${e.render.y.toFixed(1)}`);
      if (e.pts.length > 26) e.pts.shift();
      e.trail.setAttribute("points", e.pts.join(" "));
    }
  }
  requestAnimationFrame(loop);
}

/* ---------- clock ---------- */
function tick() {
  document.getElementById("time").textContent =
    new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/* ---------- side-profile livery art (ported from prototype drawProfile) ---------- */
function drawProfile(p) {
  const s = document.getElementById("psvg"); s.innerHTML = "";
  const g = document.createElementNS(NS, "g");
  const big = (p.size || 1) >= 1.2;
  const scale = big ? 1 : 0.86, ox = 230 - 190 * scale, oy = 60;
  g.setAttribute("transform", `translate(${ox},${oy}) scale(${scale})`);
  s.appendChild(g);
  const add = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); g.appendChild(e); return e; };
  add("path", { d: "M262,2 L296,-38 L318,-38 L286,2 Z", fill: p.tail });
  add("path", { d: "M8,0 Q8,-16 44,-18 L268,-20 Q322,-19 344,-2 Q330,16 268,18 L44,18 Q8,16 8,0 Z", fill: p.body, stroke: "#C6CFD8", "stroke-width": 2 });
  add("path", { d: "M320,-14 Q338,-10 344,-2 Q338,4 324,6 Z", fill: "#9FB6C8" });
  add("rect", { x: 40, y: -9, width: 216, height: 5, rx: 2.5, fill: "#B9C6D2" });
  add("rect", { x: 8, y: -2, width: 336, height: 6, fill: p.stripe, opacity: .92, rx: 3 });
  add("path", { d: "M150,10 L210,10 L166,52 L128,40 Z", fill: "#D5DDE4", stroke: "#B4C0CB", "stroke-width": 1.5 });
  add("ellipse", { cx: 176, cy: 30, rx: 24, ry: 12, fill: p.eng });
  add("ellipse", { cx: 158, cy: 30, rx: 5, ry: 9, fill: "#38424C" });
  if (big) add("ellipse", { cx: 236, cy: 24, rx: 20, ry: 10, fill: p.eng });
}

/* ---------- overhead panel queue ---------- */
const panelEl = document.getElementById("panel");
const barEl = document.getElementById("bar");
let queue = [], showing = false;

function enqueuePanel(p) { queue.push(p); if (!showing) nextPanel(); }

function nextPanel() {
  if (!queue.length) { showing = false; return; }
  showing = true;
  fillPanel(queue.shift());
  const dwellMs = (CFG.panel_dwell_s || 12) * 1000;
  barEl.style.animation = "none"; void barEl.offsetWidth;
  barEl.style.animation = `drain ${dwellMs}ms linear forwards`;
  panelEl.classList.add("show");
  setTimeout(() => {
    panelEl.classList.remove("show");
    setTimeout(nextPanel, 650);
  }, dwellMs);
}

function fillPanel(p) {
  const $ = (id) => document.getElementById(id);
  $("tlogo").textContent = p.airline_code || "??";
  $("tlogo").style.background = p.logoc || p.tail || "#666";
  $("tal").textContent = p.airline;
  $("tfl").textContent = `${p.flight} · ${p.type_name}`;
  drawProfile(p);
  $("tcap").textContent = p.photo_caption ||
    `${p.registration}${p.age != null ? " · " + p.age + " years old" : ""}`;
  // Phase 1 uses the SVG livery fallback → no photographer credit yet.
  $("tattrib").textContent = "";
  $("fcity").textContent = `${p.origin.flag || "🏳️"} ${p.origin.city}`;
  $("ftime").textContent = p.took_off || "";
  $("tcity").textContent = `${p.dest.flag || "🏳️"} ${p.dest.city}`;
  $("ttime").textContent = p.lands || "";
  $("wtxt").textContent = p.wonder;
}

/* ---------- boot ---------- */
async function boot() {
  CFG = await (await fetch("/config")).json();
  pxPerKm = CFG.px_per_km || 28.6;
  kmPerDegLon = KM_PER_DEG_LAT * Math.cos(CFG.home.lat * Math.PI / 180);

  layoutMap();
  fitStage();
  applyDayNight();
  tick();
  setInterval(tick, 10000);
  setInterval(applyDayNight, 60000);
  requestAnimationFrame(loop);

  const es = new EventSource("/stream");
  es.onmessage = (ev) => { try { ingest(JSON.parse(ev.data)); } catch (_) {} };
}
boot();
