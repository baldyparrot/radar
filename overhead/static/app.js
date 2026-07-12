/* Overhead — Phase 1 frontend.
 *
 * Consumes the /stream SSE endpoint, projects aircraft lat/lon onto the 800x480
 * map, draws the idle map (rings, landmarks, day/night), animates plane sprites
 * with tail-coloured trails, and runs the overhead panel queue with a dwell
 * drain bar. All §4 simplifications applied.
 */

const W = 800, H = 480;
const HOME_PX = { x: W / 2, y: H / 2 };
const KM_PER_DEG_LAT = 111.32;

const stage = document.getElementById("stage");
const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

let CFG = null;
let kmPerDegLon = 80;      // set once config loads
let pxPerKm = 28.6;

// --- landmarks, at their true bearings from home (§4.1) ---
const LANDMARKS = {
  pearson:  { lat: 43.6777, lon: -79.6248, label: "YYZ" },
  cntower:  { lat: 43.6426, lon: -79.3871, label: "CN" },
};

/* ---------- scale the fixed stage to fill the viewport ---------- */
function fitStage() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.transform = `scale(${s})`;
  // centre any letterbox
  const ox = (window.innerWidth - W * s) / 2;
  const oy = (window.innerHeight - H * s) / 2;
  stage.style.left = `${Math.max(0, ox)}px`;
  stage.style.top = `${Math.max(0, oy)}px`;
}
window.addEventListener("resize", fitStage);

/* ---------- projection: lat/lon -> screen px ---------- */
function project(lat, lon) {
  const eastKm = (lon - CFG.home.lon) * kmPerDegLon;
  const northKm = (lat - CFG.home.lat) * KM_PER_DEG_LAT;
  return { x: HOME_PX.x + eastKm * pxPerKm, y: HOME_PX.y - northKm * pxPerKm };
}

/* ---------- day / night (computed from lat/lon, no API) ---------- */
function sunTimes(date, lat, lon) {
  // NOAA-simplified sunrise/sunset. Returns {sunrise, sunset} as Date (local).
  const rad = Math.PI / 180;
  const dayMs = 86400000;
  const start = new Date(date.getFullYear(), 0, 0);
  const doy = Math.floor((date - start) / dayMs);
  const lngHour = lon / 15;

  function calc(isSunrise) {
    const t = doy + ((isSunrise ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634;
    L = ((L % 360) + 360) % 360;
    let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
    RA = ((RA % 360) + 360) % 360;
    RA += (Math.floor(L / 90) - Math.floor(RA / 90)) * 90;
    RA /= 15;
    const sinDec = 0.39782 * Math.sin(L * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const zenith = 90.833;
    const cosH = (Math.cos(zenith * rad) - sinDec * Math.sin(lat * rad)) /
                 (cosDec * Math.cos(lat * rad));
    if (cosH > 1 || cosH < -1) return null; // sun never rises/sets
    let Hh = isSunrise ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad;
    Hh /= 15;
    const T = Hh + RA - 0.06571 * t - 6.622;
    let UT = ((T - lngHour) % 24 + 24) % 24;
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
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
  const q = CFG.quiet_hours || {};
  if (!q.start || !q.end) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = q.start.split(":").map(Number);
  const [eh, em] = q.end.split(":").map(Number);
  const s = sh * 60 + sm, e = eh * 60 + em;
  return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e);
}

/* palettes */
const PAL = {
  day: {
    gCenter: "#eef5ea", gEdge: "#cfe0cf", lake: "#bfe0ef",
    ring: "rgba(60,90,70,.28)", house: "#5b4636", roof: "#c0563e",
    label: "rgba(40,60,50,.65)", landmark: "rgba(50,70,60,.55)",
  },
  night: {
    gCenter: "#1b2740", gEdge: "#0c1220", lake: "#0f2233",
    ring: "rgba(150,180,210,.22)", house: "#c9b79c", roof: "#e0795e",
    label: "rgba(190,205,225,.6)", landmark: "rgba(170,190,215,.5)",
  },
};

/* ---------- aircraft state + trails ---------- */
const fleet = new Map();   // hex -> { target, render, track, tail, score, trail:[] }
let lastFrameTime = performance.now();

function ingest(frame) {
  const seen = new Set();
  for (const a of frame.aircraft) {
    seen.add(a.hex);
    const p = project(a.lat, a.lon);
    let e = fleet.get(a.hex);
    if (!e) {
      e = { render: { ...p }, trail: [] };
      fleet.set(a.hex, e);
    }
    e.target = p;
    e.track = a.track;
    e.tail = a.tail;
    e.score = a.score;
    e.dist = a.dist_km;
  }
  for (const hex of [...fleet.keys()]) if (!seen.has(hex)) fleet.delete(hex);
  document.getElementById("idle").classList.toggle("hidden", frame.aircraft.length > 0);
  if (frame.panel) enqueuePanel(frame.panel);
}

/* ---------- drawing ---------- */
function drawMap(pal) {
  // radial-gradient ground
  const g = ctx.createRadialGradient(HOME_PX.x, HOME_PX.y, 30, HOME_PX.x, HOME_PX.y, 520);
  g.addColorStop(0, pal.gCenter);
  g.addColorStop(1, pal.gEdge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // lake band along the south (bottom), wavy top edge
  const lakeLat = 43.632;
  const lakeY = project(lakeLat, CFG.home.lon).y;
  ctx.fillStyle = pal.lake;
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(0, lakeY);
  for (let x = 0; x <= W; x += 40) {
    ctx.quadraticCurveTo(x + 20, lakeY - 8, x + 40, lakeY);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // single outer range ring (§4.1)
  const ringR = (CFG.range_ring_km || 6) * pxPerKm;
  ctx.strokeStyle = pal.ring;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(HOME_PX.x, HOME_PX.y, ringR, 0, Math.PI * 2);
  ctx.stroke();

  drawLandmark(LANDMARKS.pearson, pal, "runway");
  drawLandmark(LANDMARKS.cntower, pal, "tower");
  drawOverheadRing(pal);
  drawHouse(pal);
}

function drawOverheadRing(pal) {
  const r = (CFG.overhead_radius_km || 2.5) * pxPerKm;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 600);
  ctx.save();
  ctx.strokeStyle = `rgba(255,122,107,${0.45 + 0.35 * pulse})`;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([7, 7]);
  ctx.beginPath();
  ctx.arc(HOME_PX.x, HOME_PX.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawHouse(pal) {
  const { x, y } = HOME_PX;
  ctx.save();
  ctx.translate(x, y);
  // body
  ctx.fillStyle = pal.house;
  ctx.fillRect(-11, -4, 22, 15);
  // roof
  ctx.fillStyle = pal.roof;
  ctx.beginPath();
  ctx.moveTo(-14, -4); ctx.lineTo(0, -16); ctx.lineTo(14, -4);
  ctx.closePath();
  ctx.fill();
  // label
  ctx.fillStyle = pal.label;
  ctx.font = "700 12px 'Baloo 2', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("OUR HOUSE", 0, 28);
  ctx.restore();
}

function drawLandmark(lm, pal, kind) {
  const { x, y } = project(lm.lat, lm.lon);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = pal.landmark;
  if (kind === "tower") {
    ctx.fillRect(-2, -14, 4, 22);
    ctx.beginPath(); ctx.arc(0, -6, 5, 0, Math.PI * 2); ctx.fill();
  } else {
    // crossed runways
    ctx.save();
    ctx.rotate(0.5);
    ctx.fillRect(-13, -2, 26, 4);
    ctx.rotate(-1.1);
    ctx.fillRect(-13, -2, 26, 4);
    ctx.restore();
  }
  ctx.fillStyle = pal.label;
  ctx.font = "700 11px 'Baloo 2', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(lm.label, 0, 24);
  ctx.restore();
}

function drawPlane(e) {
  const { x, y } = e.render;
  // trail (tail colour, fading)
  if (e.trail.length > 1) {
    for (let i = 1; i < e.trail.length; i++) {
      const a = e.trail[i - 1], b = e.trail[i];
      ctx.strokeStyle = e.tail;
      ctx.globalAlpha = (i / e.trail.length) * 0.5;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  const big = e.score >= 80;            // score drives emphasis (§5)
  const s = big ? 1.25 : 1.0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((e.track || 0) * Math.PI / 180);   // 0deg = nose up = north
  ctx.scale(s, s);

  // wings
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0,0,0,.18)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, -3); ctx.lineTo(15, 7); ctx.lineTo(15, 10);
  ctx.lineTo(0, 6); ctx.lineTo(-15, 10); ctx.lineTo(-15, 7);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // fuselage
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.quadraticCurveTo(4, -6, 3.4, 10);
  ctx.lineTo(-3.4, 10);
  ctx.quadraticCurveTo(-4, -6, 0, -14);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // tail fin (airline colour)
  ctx.fillStyle = e.tail;
  ctx.beginPath();
  ctx.moveTo(0, 6); ctx.lineTo(5, 12); ctx.lineTo(-5, 12);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* ---------- render loop ---------- */
function tick() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  const night = isNightNow();
  stage.dataset.daynight = night ? "night" : "day";
  stage.classList.toggle("quiet", inQuietHours());
  const pal = night ? PAL.night : PAL.day;

  ctx.clearRect(0, 0, W, H);
  drawMap(pal);

  for (const e of fleet.values()) {
    if (e.target) {
      // ease render position toward the latest reported position
      e.render.x += (e.target.x - e.render.x) * Math.min(1, dt * 4);
      e.render.y += (e.target.y - e.render.y) * Math.min(1, dt * 4);
    }
    // record trail
    const last = e.trail[e.trail.length - 1];
    if (!last || Math.hypot(last.x - e.render.x, last.y - e.render.y) > 3) {
      e.trail.push({ x: e.render.x, y: e.render.y });
      if (e.trail.length > 22) e.trail.shift();
    }
    if (e.render.x > -30 && e.render.x < W + 30 && e.render.y > -30 && e.render.y < H + 30) {
      drawPlane(e);
    }
  }
  requestAnimationFrame(tick);
}

/* ---------- clock ---------- */
function updateClock() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  document.getElementById("clock").textContent = `${hh}:${mm}`;
}

/* ---------- overhead panel queue ---------- */
const panelEl = document.getElementById("panel");
const drainBar = document.getElementById("drainBar");
let queue = [];
let showing = false;

function enqueuePanel(p) {
  queue.push(p);
  if (!showing) nextPanel();
}

function nextPanel() {
  if (queue.length === 0) { showing = false; return; }
  showing = true;
  const p = queue.shift();
  fillPanel(p);
  panelEl.classList.add("show");

  const dwellMs = (CFG.panel_dwell_s || 12) * 1000;
  // reset + run drain
  drainBar.style.transition = "none";
  drainBar.style.transform = "scaleX(1)";
  requestAnimationFrame(() => {
    drainBar.style.transition = `transform ${dwellMs}ms linear`;
    drainBar.style.transform = "scaleX(0)";
  });

  setTimeout(() => {
    panelEl.classList.remove("show");
    setTimeout(nextPanel, 600);   // let it slide out before the next
  }, dwellMs);
}

function fillPanel(p) {
  const $ = (id) => document.getElementById(id);
  $("logoInitials").textContent = p.airline_code || "??";
  document.querySelector(".logo-circle").style.background = p.tail || "#666";
  $("airlineName").textContent = p.airline;
  $("flightLine").textContent = `${p.flight} · ${p.type_name}`;

  $("planeArt").innerHTML = sideProfileSVG(p.tail);
  $("photoCaption").textContent = p.photo_caption ||
    `${p.registration}${p.age != null ? " · " + p.age + " years old" : ""}`;
  // Phase 1 uses the SVG livery fallback, so no photographer attribution yet.
  $("photoAttrib").textContent = "";

  $("origFlag").textContent = p.origin.flag || "🏳️";
  $("origCity").textContent = p.origin.city;
  $("origTime").textContent = p.took_off || "";
  $("destFlag").textContent = p.dest.flag || "🏳️";
  $("destCity").textContent = p.dest.city;
  $("destTime").textContent = p.lands || "";

  $("wonder").textContent = p.wonder;
}

/* side-profile livery illustration — Phase 1 photo fallback (§4.2) */
function sideProfileSVG(tail) {
  const t = tail || "#8899aa";
  return `<svg viewBox="0 0 322 128" preserveAspectRatio="xMidYMid slice">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#bcd7ec"/><stop offset="1" stop-color="#dfeef7"/>
    </linearGradient></defs>
    <rect width="322" height="128" fill="url(#sky)"/>
    <g transform="translate(36,44)">
      <path d="M0,20 C10,8 60,4 150,8 C210,10 232,14 246,18
               C238,26 214,30 150,32 C70,34 20,32 0,20 Z" fill="#ffffff" stroke="#c9d3dc"/>
      <path d="M246,18 l24,-14 l8,2 l-16,18 Z" fill="${t}"/>
      <path d="M92,20 l-30,26 l14,0 l40,-22 Z" fill="#e7edf2" stroke="#c9d3dc"/>
      <g fill="#9fb0bf"><circle cx="40" cy="16" r="2"/><circle cx="58" cy="15" r="2"/>
      <circle cx="76" cy="15" r="2"/><circle cx="94" cy="15" r="2"/>
      <circle cx="112" cy="15" r="2"/><circle cx="130" cy="15" r="2"/></g>
      <path d="M20,22 q-14,-2 -20,4 q8,4 22,2 Z" fill="${t}" opacity=".85"/>
    </g>
  </svg>`;
}

/* ---------- boot ---------- */
async function boot() {
  CFG = await (await fetch("/config")).json();
  pxPerKm = CFG.px_per_km || 28.6;
  kmPerDegLon = KM_PER_DEG_LAT * Math.cos(CFG.home.lat * Math.PI / 180);

  fitStage();
  updateClock();
  setInterval(updateClock, 1000 * 15);
  requestAnimationFrame(tick);

  const es = new EventSource("/stream");
  es.onmessage = (ev) => {
    try { ingest(JSON.parse(ev.data)); } catch (e) { /* ignore malformed frame */ }
  };
  es.onerror = () => { /* browser auto-reconnects SSE */ };
}

boot();
