/* Overhead — vintage aeronautical chart, driven by /stream.
 *
 * The canvas draws only ink (compass rose, coastline, aerodrome, house, and
 * aircraft as small plotted silhouettes with dotted courses); the paper, grain
 * and frame come from CSS. An overhead event reveals a boarding-pass ticket.
 * Calm by design: no bright colour, no pulsing, gentle fades only.
 */

const W = 800, H = 480;
const HOME_PX = { x: 400, y: 214 };
const KM_PER_DEG_LAT = 111.32;

const stage = document.getElementById("stage");
const canvas = document.getElementById("chart");
const ctx = canvas.getContext("2d");

let CFG = null, kmPerDegLon = 80, pxPerKm = 28.6;

const PAL = {
  day:   { ink:"#33291B", soft:"#6A5B44", navy:"#2C4152", rust:"#9E4526", brass:"#A98545" },
  night: { ink:"#C9B58C", soft:"#8C795A", navy:"#8AA0B0", rust:"#C06A43", brass:"#8A6E42" },
};

const LANDMARKS = { pearson: { lat: 43.6777, lon: -79.6248, label: "YYZ" } };

/* ---------- fit ---------- */
function fitStage() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.transform = `scale(${s})`;
  stage.style.left = `${Math.max(0, (window.innerWidth - W * s) / 2)}px`;
  stage.style.top = `${Math.max(0, (window.innerHeight - H * s) / 2)}px`;
}
window.addEventListener("resize", fitStage);

/* ---------- projection ---------- */
function project(lat, lon) {
  const eastKm = (lon - CFG.home.lon) * kmPerDegLon;
  const northKm = (lat - CFG.home.lat) * KM_PER_DEG_LAT;
  return { x: HOME_PX.x + eastKm * pxPerKm, y: HOME_PX.y - northKm * pxPerKm };
}

/* ---------- day / night ---------- */
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
    const Hh = (isSunrise ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad) / 15;
    const T = Hh + RA - 0.06571 * t - 6.622;
    const UT = ((T - lngHour) % 24 + 24) % 24;
    const d = new Date(date); d.setUTCHours(0, 0, 0, 0);
    return new Date(d.getTime() + UT * 3600000);
  }
  return { sunrise: calc(true), sunset: calc(false) };
}
function isNightNow() {
  const u = new URLSearchParams(location.search);
  if (u.has("night")) return u.get("night") !== "0";
  const now = new Date();
  const { sunrise, sunset } = sunTimes(now, CFG.home.lat, CFG.home.lon);
  if (!sunrise || !sunset) return false;
  return now < sunrise || now > sunset;
}
function inQuietHours() {
  const u = new URLSearchParams(location.search);
  if (u.has("quiet")) return u.get("quiet") !== "0";
  const q = CFG.quiet_hours || {};
  if (!q.start || !q.end) return false;
  const now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = q.start.split(":").map(Number), [eh, em] = q.end.split(":").map(Number);
  const s = sh * 60 + sm, e = eh * 60 + em;
  return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e);
}

/* ---------- chart ink ---------- */
function drawCompass(pal) {
  const R = (CFG.range_ring_km || 6) * pxPerKm;
  const cx = HOME_PX.x, cy = HOME_PX.y;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineWidth = 1;

  // outer + inner rings
  ctx.globalAlpha = 0.55; ctx.strokeStyle = pal.brass;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.28; ctx.strokeStyle = pal.ink;
  ctx.beginPath(); ctx.arc(0, 0, R * 0.66, 0, Math.PI * 2); ctx.stroke();

  // degree ticks every 15°
  ctx.globalAlpha = 0.4; ctx.strokeStyle = pal.ink;
  for (let a = 0; a < 360; a += 15) {
    const r = a % 90 === 0 ? R - 12 : R - 6;
    const rad = a * Math.PI / 180;
    ctx.beginPath();
    ctx.moveTo(Math.sin(rad) * R, -Math.cos(rad) * R);
    ctx.lineTo(Math.sin(rad) * r, -Math.cos(rad) * r);
    ctx.stroke();
  }

  // 8-point star: long cardinals, shorter intercardinals
  const star = (len, half, col, alpha) => {
    for (let k = 0; k < 4; k++) {
      const rad = k * Math.PI / 2;
      const dx = Math.sin(rad), dy = -Math.cos(rad);      // point dir
      const px = Math.sin(rad + Math.PI / 2), py = -Math.cos(rad + Math.PI / 2);
      ctx.globalAlpha = alpha; ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(dx * len, dy * len);
      ctx.lineTo(px * half, py * half);
      ctx.lineTo(-dx * half * 0.5, -dy * half * 0.5);
      ctx.lineTo(-px * half, -py * half);
      ctx.closePath(); ctx.fill();
    }
  };
  star(R * 0.66, 12, pal.navy, 0.5);                       // cardinal star
  ctx.save(); ctx.rotate(Math.PI / 4);
  star(R * 0.45, 8, pal.ink, 0.28);                        // intercardinal
  ctx.restore();

  // north spike accent
  ctx.globalAlpha = 0.9; ctx.fillStyle = pal.rust;
  ctx.beginPath(); ctx.moveTo(0, -R * 0.66); ctx.lineTo(6, -R * 0.5); ctx.lineTo(-6, -R * 0.5); ctx.closePath(); ctx.fill();

  // cardinal letters
  ctx.globalAlpha = 0.75; ctx.fillStyle = pal.ink;
  ctx.font = "600 15px Oswald"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const lab = [["N", 0, -R + 2], ["E", R - 2, 0], ["S", 0, R - 2], ["W", -R + 2, 0]];
  for (const [t, x, y] of lab) ctx.fillText(t, x, y);
  ctx.restore();
}

function drawCoastline(pal) {
  const y0 = project(43.632, CFG.home.lon).y;   // lake edge to the south
  ctx.save();
  ctx.globalAlpha = 0.55; ctx.strokeStyle = pal.navy; ctx.lineWidth = 1.2;
  ctx.beginPath();
  const pts = [];
  for (let x = -10; x <= W + 10; x += 20) {
    const y = y0 + 10 * Math.sin(x / 90) + (x / W) * 14;
    pts.push([x, y]);
  }
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  ctx.stroke();
  // hatch ticks on the lakeward (south) side
  ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
  for (let i = 0; i < pts.length; i += 2) {
    const [x, y] = pts[i];
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 7); ctx.stroke();
  }
  ctx.restore();
}

function drawAerodrome(pal) {
  const p = project(LANDMARKS.pearson.lat, LANDMARKS.pearson.lon);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalAlpha = 0.6; ctx.strokeStyle = pal.ink; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(6, 2); ctx.moveTo(-4, 5); ctx.lineTo(4, -5); ctx.stroke();
  ctx.globalAlpha = 0.7; ctx.fillStyle = pal.ink; ctx.font = "500 12px Oswald";
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillText(LANDMARKS.pearson.label, 0, 12);
  ctx.restore();
}

function drawHome(pal) {
  const { x, y } = HOME_PX;
  ctx.save();
  ctx.globalAlpha = 1; ctx.fillStyle = pal.rust;
  ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.85; ctx.strokeStyle = pal.rust; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, 6.5, 0, Math.PI * 2); ctx.stroke();
  // overhead zone, faint
  ctx.globalAlpha = 0.4; ctx.setLineDash([2, 5]);
  ctx.beginPath(); ctx.arc(x, y, (CFG.overhead_radius_km || 2.5) * pxPerKm, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.8; ctx.fillStyle = pal.ink; ctx.font = "500 11px Oswald";
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.save(); ctx.translate(x, y - 12);
  ctx.fillText("O U R   H O U S E", 0, 0);
  ctx.restore();
  ctx.restore();
}

function drawPlane(e, pal) {
  const { x, y } = e.render;
  // plotted course (dotted)
  if (e.pts.length > 1) {
    ctx.save();
    ctx.globalAlpha = 0.5; ctx.strokeStyle = pal.rust; ctx.lineWidth = 1;
    ctx.setLineDash([1.5, 6]);
    ctx.beginPath(); ctx.moveTo(e.pts[0].x, e.pts[0].y);
    for (const p of e.pts) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(x, y);
  // overhead marker (static, no pulse)
  if (e.overhead) {
    ctx.globalAlpha = 0.8; ctx.strokeStyle = pal.rust; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.rotate((e.track || 0) * Math.PI / 180);
  ctx.globalAlpha = 0.92; ctx.fillStyle = pal.navy;
  // fuselage
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.bezierCurveTo(2.4, -9, 2.8, -2, 2.3, 6);
  ctx.lineTo(1.5, 12); ctx.lineTo(-1.5, 12); ctx.lineTo(-2.3, 6);
  ctx.bezierCurveTo(-2.8, -2, -2.4, -9, 0, -13);
  ctx.closePath(); ctx.fill();
  // straight wings (vintage)
  ctx.beginPath();
  ctx.moveTo(-17, 0); ctx.lineTo(17, 0); ctx.lineTo(15, 4); ctx.lineTo(-15, 4);
  ctx.closePath(); ctx.fill();
  // tailplane
  ctx.beginPath();
  ctx.moveTo(-7, 9); ctx.lineTo(7, 9); ctx.lineTo(6, 11.5); ctx.lineTo(-6, 11.5);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* ---------- fleet ---------- */
const fleet = new Map();
let lastT = performance.now();

function ingest(frame) {
  const seen = new Set();
  for (const a of frame.aircraft) {
    seen.add(a.hex);
    const p = project(a.lat, a.lon);
    let e = fleet.get(a.hex);
    if (!e) { e = { render: { ...p }, pts: [], frame: 0 }; fleet.set(a.hex, e); }
    e.target = p; e.track = a.track; e.overhead = a.dist_km <= (CFG.overhead_radius_km || 2.5);
  }
  for (const [hex, e] of [...fleet]) if (!seen.has(hex)) fleet.delete(hex);
  document.getElementById("idle").classList.toggle("gone", frame.aircraft.length > 0);
  if (frame.panel) enqueueTicket(frame.panel);
}

function loop(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  const night = isNightNow();
  stage.classList.toggle("night", night);
  stage.classList.toggle("quiet", inQuietHours());
  const pal = night ? PAL.night : PAL.day;

  ctx.clearRect(0, 0, W, H);
  drawCoastline(pal);
  drawCompass(pal);
  drawAerodrome(pal);
  drawHome(pal);

  for (const e of fleet.values()) {
    if (e.target) {
      e.render.x += (e.target.x - e.render.x) * Math.min(1, dt * 3);
      e.render.y += (e.target.y - e.render.y) * Math.min(1, dt * 3);
    }
    const last = e.pts[e.pts.length - 1];
    if (!last || Math.hypot(last.x - e.render.x, last.y - e.render.y) > 4) {
      e.pts.push({ x: e.render.x, y: e.render.y });
      if (e.pts.length > 18) e.pts.shift();
    }
    if (e.render.x > -40 && e.render.x < W + 40 && e.render.y > -40 && e.render.y < H + 40)
      drawPlane(e, pal);
  }
  requestAnimationFrame(loop);
}

/* ---------- chronometer ---------- */
function tickClock() {
  const d = new Date();
  let h = d.getHours() % 12; if (h === 0) h = 12;
  document.getElementById("clock").textContent = `${h}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ---------- ticket ---------- */
const ticketEl = document.getElementById("ticket");
let queue = [], showing = false;
function enqueueTicket(p) { queue.push(p); if (!showing) nextTicket(); }
function nextTicket() {
  if (!queue.length) { showing = false; return; }
  showing = true;
  fillTicket(queue.shift());
  ticketEl.classList.add("show");
  const dwell = (CFG.panel_dwell_s || 12) * 1000;
  setTimeout(() => {
    ticketEl.classList.remove("show");
    setTimeout(nextTicket, 1000);
  }, dwell);
}
function fillTicket(p) {
  const $ = (id) => document.getElementById(id);
  $("tReg").textContent = p.registration || p.hex || "";
  $("tAirline").textContent = p.airline || "Unidentified aircraft";
  const bits = [p.flight, p.type_name].filter(Boolean).join(" · ");
  $("tFlight").textContent = bits;

  const hasRoute = p.origin && p.dest && p.origin.code && p.dest.code;
  $("tRoute").style.display = hasRoute ? "" : "none";
  if (hasRoute) {
    $("oCode").textContent = p.origin.code; $("oCity").textContent = p.origin.city || "";
    $("dCode").textContent = p.dest.code;   $("dCity").textContent = p.dest.city || "";
  }
  const fact = p.wonder || (p.type_name ? `A ${p.type_name}, passing quietly overhead.` : "");
  $("tFact").textContent = fact;
  $("tFact").classList.toggle("center", !hasRoute);
}

/* ---------- coords ---------- */
function dms(v, pos, neg) {
  const h = v >= 0 ? pos : neg, a = Math.abs(v);
  const d = Math.floor(a), m = Math.round((a - d) * 60);
  return `${d}°${String(m).padStart(2, "0")}′${h}`;
}

/* ---------- boot ---------- */
async function boot() {
  CFG = await (await fetch("/config")).json();
  pxPerKm = CFG.px_per_km || 28.6;
  kmPerDegLon = KM_PER_DEG_LAT * Math.cos(CFG.home.lat * Math.PI / 180);
  document.getElementById("coords").textContent =
    `${dms(CFG.home.lat, "N", "S")} · ${dms(CFG.home.lon, "E", "W")}`;

  try {
    await Promise.all([
      document.fonts.load("600 30px Oswald"),
      document.fonts.load("500 12px Oswald"),
      document.fonts.load("italic 18px Spectral"),
    ]);
  } catch (_) {}

  fitStage();
  tickClock();
  setInterval(tickClock, 15000);
  requestAnimationFrame(loop);

  const es = new EventSource("/stream");
  es.onmessage = (ev) => { try { ingest(JSON.parse(ev.data)); } catch (_) {} };
}
boot();
