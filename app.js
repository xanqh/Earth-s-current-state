const canvas = document.getElementById("pond");
const ctx = canvas ? canvas.getContext("2d") : null;
const statusEl = document.getElementById("status");
const titleEl = document.getElementById("title");
const subtitleEl = document.getElementById("subtitle");
const langBtn = document.getElementById("lang-toggle");
const debugBtn = document.getElementById("debug-toggle");
const debugPanel = document.getElementById("debug-panel");

const dbgTimeScale = document.getElementById("dbg-time-scale");
const dbgTimeScaleValue = document.getElementById("dbg-time-scale-value");
const dbgUtcOffset = document.getElementById("dbg-utc-offset");
const dbgUtcOffsetValue = document.getElementById("dbg-utc-offset-value");
const dbgShowMap = document.getElementById("dbg-show-map");
const dbgShowGrid = document.getElementById("dbg-show-grid");
const dbgShowNight = document.getElementById("dbg-show-night");
const dbgShowLabels = document.getElementById("dbg-show-labels");
const dbgWave = document.getElementById("dbg-wave");
const dbgResetTime = document.getElementById("dbg-reset-time");
const dbgComet = document.getElementById("dbg-comet");
const dbgParty = document.getElementById("dbg-party");
const dbgReadout = document.getElementById("dbg-readout");

const TEXT = {
  ja: {
    title: "地球のいま",
    subtitle: "世界を流れる昼と夜を、表情で見る。",
    status: (dayCount, nightCount, utc) => `昼 ${dayCount} / 夜 ${nightCount} | UTC ${utc}`,
    dragHint: "クリックで笑顔、ドラッグで移動。",
  },
  en: {
    title: "Earth’s current state",
    subtitle: "Watch day and night flowing across the world through expressions.",
    status: (dayCount, nightCount, utc) => `Day ${dayCount} / Night ${nightCount} | UTC ${utc}`,
    dragHint: "Click to smile, drag to move.",
  },
};

const cities = [
  { id: "tokyo", ja: "東京", en: "Tokyo", lat: 35.6764, lon: 139.65, color: "#ff7f7f" },
  { id: "seoul", ja: "ソウル", en: "Seoul", lat: 37.5665, lon: 126.978, color: "#ffac5d" },
  { id: "singapore", ja: "シンガポール", en: "Singapore", lat: 1.3521, lon: 103.8198, color: "#ffd166" },
  { id: "sydney", ja: "シドニー", en: "Sydney", lat: -33.8688, lon: 151.2093, color: "#67d6c4" },
  { id: "delhi", ja: "デリー", en: "Delhi", lat: 28.6139, lon: 77.209, color: "#55b7ff" },
  { id: "cairo", ja: "カイロ", en: "Cairo", lat: 30.0444, lon: 31.2357, color: "#7e9bff" },
  { id: "london", ja: "ロンドン", en: "London", lat: 51.5072, lon: -0.1276, color: "#a58bff" },
  { id: "rio", ja: "リオ", en: "Rio", lat: -22.9068, lon: -43.1729, color: "#ff8fb1" },
  { id: "newyork", ja: "ニューヨーク", en: "New York", lat: 40.7128, lon: -74.006, color: "#ff7f7f" },
  { id: "la", ja: "ロサンゼルス", en: "Los Angeles", lat: 34.0522, lon: -118.2437, color: "#67d6c4" },
];

let worldGeoData = window.WORLD_GEOJSON || null;

const creatures = cities.map((city) => ({
  ...city,
  x: 0,
  y: 0,
  homeX: 0,
  homeY: 0,
  size: 64,
  targetSize: 64,
  phase: Math.random() * Math.PI * 2,
  speed: 0.7 + Math.random() * 0.3,
  driftX: 0,
  driftY: 0,
  isDay: true,
  dayFactor: 1,
  smileUntil: 0,
  dragging: false,
  renderX: 0,
  renderY: 0,
}));

const state = {
  lang: "ja",
  sunLon: 0,
  sunLat: 0,
  dragTarget: null,
  dragOffsetX: 0,
  dragOffsetY: 0,
  particles: [],
  stars: [],
  clouds: [],
  comet: { x: -100, y: 120, vx: 0, vy: 0, active: false, cooldown: 0 },
  debugOpen: false,
  showMap: true,
  showGrid: true,
  showNightMask: true,
  showLabels: true,
  partyMode: false,
  timeScale: 12,
  manualUtcOffsetHours: 0,
  timeBasePerf: performance.now(),
  timeBaseEpochMs: Date.now(),
};

function t(key, ...args) {
  const v = TEXT[state.lang][key];
  return typeof v === "function" ? v(...args) : v;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function ease(cur, target, speed) {
  return cur + (target - cur) * speed;
}

function fitCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function normalizeLon(lon) {
  let v = lon;
  while (v > 180) v -= 360;
  while (v < -180) v += 360;
  return v;
}

function getSimDate() {
  const nowPerf = performance.now();
  const elapsed = (nowPerf - state.timeBasePerf) * state.timeScale;
  const offset = state.manualUtcOffsetHours * 3600000;
  return new Date(state.timeBaseEpochMs + elapsed + offset);
}

function setTimeScale(nextScale) {
  const simNow = getSimDate().getTime() - state.manualUtcOffsetHours * 3600000;
  state.timeBaseEpochMs = simNow;
  state.timeBasePerf = performance.now();
  state.timeScale = nextScale;
}

function dayOfYearUtc(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const now = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((now - start) / 86400000);
}

function getSubsolarPoint(date) {
  const doy = dayOfYearUtc(date);
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (doy - 81));
  const utcHour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const lon = normalizeLon((12 - utcHour) * 15);
  return { lat: decl, lon };
}

function solarCosZenith(lat, lon, sunLat, sunLon) {
  const toRad = (d) => (d * Math.PI) / 180;
  const latR = toRad(lat);
  const decR = toRad(sunLat);
  const hourAngle = toRad(normalizeLon(lon - sunLon));
  return Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(hourAngle);
}

function lonToX(lon, w) {
  const left = 34;
  const right = w - 34;
  return left + ((lon + 180) / 360) * (right - left);
}

function latToY(lat, h) {
  const top = 70;
  const bottom = h - 112;
  return top + ((90 - lat) / 180) * (bottom - top);
}

function getMapRect() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  return { left: 24, right: w - 24, top: 56, bottom: h - 98, width: w - 48, height: h - 154 };
}

async function loadWorldGeoData() {
  if (worldGeoData && Array.isArray(worldGeoData.features)) return;
  try {
    const res = await fetch("./world.geojson", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json || !Array.isArray(json.features)) throw new Error("Invalid GeoJSON");
    worldGeoData = json;
  } catch {
    worldGeoData = null;
  }
}

function seedAmbient() {
  state.stars = Array.from({ length: 150 }, () => ({
    lon: -180 + Math.random() * 360,
    lat: -70 + Math.random() * 140,
    twinkle: Math.random() * Math.PI * 2,
    size: 1.2 + Math.random() * 2.2,
  }));

  state.clouds = Array.from({ length: 6 }, (_, i) => ({
    x: 80 + i * 200,
    y: 110 + (i % 3) * 52,
    speed: 0.2 + Math.random() * 0.18,
    scale: 0.9 + Math.random() * 0.9,
  }));
}

function spawnBurst(x, y, color, ringRadius) {
  for (let i = 0; i < 8; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const startR = Math.max(0, ringRadius || 0) + 2 + Math.random() * 4;
    const v = 0.9 + Math.random() * 1.2;
    state.particles.push({
      x: x + Math.cos(a) * startR,
      y: y + Math.sin(a) * startR,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 0.08,
      life: 0.95,
      color,
    });
  }
  if (state.particles.length > 640) state.particles.splice(0, state.particles.length - 640);
}

function drawParticles() {
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const p = state.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.vy -= 0.002;
    p.life -= 0.03;
    if (p.life <= 0 || p.y < 36 || p.y > canvas.clientHeight + 24 || p.x < -24 || p.x > canvas.clientWidth + 24) {
      state.particles.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 4, 4);
    ctx.globalAlpha = 1;
  }
}

function updateComet() {
  if (state.comet.active) {
    state.comet.x += state.comet.vx;
    state.comet.y += state.comet.vy;
    if (state.comet.x > canvas.clientWidth + 120 || state.comet.y > canvas.clientHeight + 120) {
      state.comet.active = false;
      state.comet.cooldown = 220 + Math.random() * 320;
    }
    return;
  }

  state.comet.cooldown -= 1;
  if (state.comet.cooldown <= 0) {
    state.comet.active = true;
    state.comet.x = -80;
    state.comet.y = 90 + Math.random() * 130;
    state.comet.vx = 4.2 + Math.random() * 2.2;
    state.comet.vy = 1.2 + Math.random() * 1.4;
  }
}

function drawComet() {
  if (!state.comet.active) return;
  const c = state.comet;
  const trail = ctx.createLinearGradient(c.x - c.vx * 16, c.y - c.vy * 16, c.x, c.y);
  trail.addColorStop(0, "rgba(255,255,255,0)");
  trail.addColorStop(1, "rgba(255,255,255,0.95)");
  ctx.strokeStyle = trail;
  ctx.lineWidth = 3.8;
  ctx.beginPath();
  ctx.moveTo(c.x - c.vx * 16, c.y - c.vy * 16);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();

  const glow = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, 22);
  glow.addColorStop(0, "rgba(255, 248, 190, 0.95)");
  glow.addColorStop(1, "rgba(255, 248, 190, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(c.x, c.y, 22, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#fff9c8";
  ctx.beginPath();
  ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
  ctx.fill();
}

function triggerComet() {
  state.comet.active = true;
  state.comet.x = -140;
  state.comet.y = 80 + Math.random() * 150;
  state.comet.vx = 5.8 + Math.random() * 3.4;
  state.comet.vy = 1.1 + Math.random() * 2.1;
}

function smileWave() {
  const now = performance.now();
  creatures.forEach((c, i) => {
    c.smileUntil = now + 500 + i * 120;
    spawnBurst(c.renderX || c.x, c.renderY || c.y, c.color, c.size * 0.6);
  });
}

function updateSun() {
  const simDate = getSimDate();
  const sub = getSubsolarPoint(simDate);
  state.sunLat = sub.lat;
  state.sunLon = sub.lon;
  return simDate;
}

function updateCreatures(tick) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const marginX = 68;
  const marginYTop = 74;
  const marginYBottom = h - 120;

  for (const c of creatures) {
    c.homeX = lonToX(c.lon, w);
    c.homeY = latToY(c.lat, h);

    const cosZenith = solarCosZenith(c.lat, c.lon, state.sunLat, state.sunLon);
    const dayFactor = clamp((cosZenith + 0.2) / 1.2, 0, 1);
    const nextDay = cosZenith > 0;

    if (nextDay !== c.isDay) {
      c.smileUntil = performance.now() + 500;
      spawnBurst(c.x || c.homeX, c.y || c.homeY, c.color, c.size * 0.56);
    }

    c.isDay = nextDay;
    c.dayFactor = dayFactor;
    c.targetSize = 58 + dayFactor * 20;
    c.speed = 0.55 + dayFactor * 0.85;

    if (!c.dragging) {
      const dayLift = -12 * dayFactor;
      c.x = ease(c.x || c.homeX, c.homeX, 0.08);
      c.y = ease(c.y || c.homeY, c.homeY + dayLift, 0.08);
    } else {
      c.x = clamp(c.x, marginX, w - marginX);
      c.y = clamp(c.y, marginYTop, marginYBottom);
    }

    c.size = ease(c.size, c.targetSize, 0.14);
    const wobbleX = Math.sin(tick * c.speed + c.phase) * (4 + 5 * c.dayFactor);
    const wobbleY = Math.cos(tick * (c.speed + 0.2) + c.phase) * (2 + 3 * c.dayFactor);
    c.driftX = ease(c.driftX, c.dragging ? 0 : wobbleX, 0.12);
    c.driftY = ease(c.driftY, c.dragging ? 0 : wobbleY, 0.12);

    c.renderX = clamp(c.x + c.driftX, marginX, w - marginX);
    c.renderY = clamp(c.y + c.driftY, marginYTop, marginYBottom);
  }
}

function drawMapLayer() {
  if (!state.showMap) return;
  const mapRect = getMapRect();

  ctx.save();
  ctx.beginPath();
  ctx.rect(mapRect.left, mapRect.top, mapRect.width, mapRect.height);
  ctx.clip();

  ctx.fillStyle = "rgba(109, 154, 131, 0.28)";
  ctx.strokeStyle = "rgba(62, 97, 84, 0.42)";
  ctx.lineWidth = 1;

  if (worldGeoData && Array.isArray(worldGeoData.features)) {
    for (const feature of worldGeoData.features) {
      const geom = feature && feature.geometry;
      if (!geom) continue;
      const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];

      for (const poly of polys) {
        for (const ring of poly) {
          if (!Array.isArray(ring) || ring.length < 2) continue;
          const stride = ring.length > 240 ? 4 : ring.length > 120 ? 3 : ring.length > 60 ? 2 : 1;
          ctx.beginPath();
          for (let i = 0; i < ring.length; i += stride) {
            const point = ring[i];
            if (!Array.isArray(point) || point.length < 2) continue;
            const x = lonToX(point[0], canvas.clientWidth);
            const y = latToY(point[1], canvas.clientHeight);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  } else {
    ctx.fillStyle = "rgba(109, 154, 131, 0.08)";
    ctx.fillRect(mapRect.left + 2, mapRect.top + 2, mapRect.width - 4, mapRect.height - 4);
    ctx.fillStyle = "rgba(51, 69, 97, 0.45)";
    ctx.font = '600 14px "Avenir Next", "Hiragino Kaku Gothic ProN", sans-serif';
    ctx.fillText("world map loading...", mapRect.left + 16, mapRect.top + 24);
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(79, 98, 129, 0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(mapRect.left, mapRect.top, mapRect.width, mapRect.height);
}

function drawNightMask() {
  if (!state.showNightMask) return;
  const mapRect = getMapRect();
  const cell = 10;

  for (let y = mapRect.top; y < mapRect.bottom; y += cell) {
    for (let x = mapRect.left; x < mapRect.right; x += cell) {
      const lon = ((x - mapRect.left) / mapRect.width) * 360 - 180;
      const lat = 90 - ((y - mapRect.top) / mapRect.height) * 180;
      const cosZ = solarCosZenith(lat, lon, state.sunLat, state.sunLon);
      if (cosZ <= 0) {
        const a = clamp(0.13 + Math.abs(cosZ) * 0.32, 0.13, 0.4);
        ctx.fillStyle = `rgba(24, 33, 52, ${a.toFixed(3)})`;
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }
}

function drawStars(tick) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const mapRect = getMapRect();

  for (const s of state.stars) {
    const cosZ = solarCosZenith(s.lat, s.lon, state.sunLat, state.sunLon);
    if (cosZ > -0.02) continue;
    const x = lonToX(s.lon, w);
    const y = latToY(s.lat, h);
    if (x < mapRect.left || x > mapRect.right || y < mapRect.top || y > mapRect.bottom) continue;
    const a = 0.42 + 0.45 * (0.5 + 0.5 * Math.sin(tick * 2.4 + s.twinkle));
    ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
    ctx.fillRect(x, y, s.size + 0.7, s.size + 0.7);
  }
}

function drawClouds() {
  const w = canvas.clientWidth;
  const mapRect = getMapRect();

  for (const c of state.clouds) {
    c.x += c.speed;
    if (c.x > w + 120) c.x = -150;
    const y = c.y + Math.sin((c.x + c.y) * 0.01) * 6;
    const r = 26 * c.scale;
    if (y < mapRect.top - 20 || y > mapRect.bottom + 20) continue;
    ctx.fillStyle = "rgba(255,255,255,0.52)";
    ctx.beginPath();
    ctx.arc(c.x, y, r, 0, Math.PI * 2);
    ctx.arc(c.x + r * 0.8, y - r * 0.3, r * 0.85, 0, Math.PI * 2);
    ctx.arc(c.x + r * 1.6, y, r * 0.72, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBackground(tick) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const mapRect = getMapRect();

  const base = ctx.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, "#fff8e8");
  base.addColorStop(1, "#e7f4ff");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  drawMapLayer();
  drawNightMask();
  drawStars(tick);
  drawClouds();

  if (state.showGrid) {
    ctx.strokeStyle = "rgba(67, 76, 94, 0.18)";
    ctx.setLineDash([8, 7]);
    for (let i = 1; i <= 4; i += 1) {
      const y = mapRect.top + ((mapRect.bottom - mapRect.top) * i) / 5;
      ctx.beginPath();
      ctx.moveTo(mapRect.left, y);
      ctx.lineTo(mapRect.right, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = "rgba(70, 80, 95, 0.16)";
  ctx.lineWidth = 1;
  ctx.strokeRect(mapRect.left, mapRect.top, mapRect.width, mapRect.height);

  const sunX = lonToX(state.sunLon, w);
  const sunY = latToY(state.sunLat, h);
  const g = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, 70);
  g.addColorStop(0, "rgba(255, 240, 128, 0.95)");
  g.addColorStop(1, "rgba(255, 240, 128, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 72, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f6d35c";
  ctx.beginPath();
  ctx.arc(sunX, sunY, 9, 0, Math.PI * 2);
  ctx.fill();

  updateComet();
  drawComet();
}

function drawCreature(c) {
  const x = c.renderX;
  const y = c.renderY;
  const s = c.size;
  const r = 14;

  if (state.partyMode) {
    const hue = (performance.now() * 0.03 + c.lon * 0.5 + c.lat * 0.35) % 360;
    ctx.fillStyle = `hsl(${hue.toFixed(1)} 78% 66%)`;
  } else {
    ctx.fillStyle = c.color;
  }
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5 + r, y - s * 0.5);
  ctx.lineTo(x + s * 0.5 - r, y - s * 0.5);
  ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.5, x + s * 0.5, y - s * 0.5 + r);
  ctx.lineTo(x + s * 0.5, y + s * 0.5 - r);
  ctx.quadraticCurveTo(x + s * 0.5, y + s * 0.5, x + s * 0.5 - r, y + s * 0.5);
  ctx.lineTo(x - s * 0.5 + r, y + s * 0.5);
  ctx.quadraticCurveTo(x - s * 0.5, y + s * 0.5, x - s * 0.5, y + s * 0.5 - r);
  ctx.lineTo(x - s * 0.5, y - s * 0.5 + r);
  ctx.quadraticCurveTo(x - s * 0.5, y - s * 0.5, x - s * 0.5 + r, y - s * 0.5);
  ctx.closePath();
  ctx.fill();

  const awake = c.isDay || c.dragging;
  const smiling = awake && performance.now() < c.smileUntil;

  ctx.fillStyle = "#eff3f7";
  const eye = Math.max(3.5, s * 0.06);
  if (awake) {
    ctx.fillRect(x - s * 0.18, y - s * 0.11, eye, eye);
    ctx.fillRect(x + s * 0.18 - eye, y - s * 0.11, eye, eye);
  } else {
    ctx.fillRect(x - s * 0.19, y - s * 0.09, eye + 2, 2.2);
    ctx.fillRect(x + s * 0.18 - eye - 2, y - s * 0.09, eye + 2, 2.2);
  }

  if (smiling) {
    ctx.beginPath();
    ctx.arc(x, y + s * 0.1, s * 0.14, 0, Math.PI, false);
    ctx.fill();
  } else if (awake) {
    ctx.fillRect(x - s * 0.14, y + s * 0.1, s * 0.28, Math.max(2, s * 0.03));
  } else {
    ctx.fillRect(x - s * 0.08, y + s * 0.12, s * 0.16, 2);
  }

  if (state.showLabels) {
    ctx.fillStyle = "#202733";
    ctx.textAlign = "center";
    ctx.font = '700 12px "Avenir Next", "Hiragino Kaku Gothic ProN", sans-serif';
    ctx.fillText(state.lang === "ja" ? c.ja : c.en, x, y + s * 0.92);
  }
}

function drawHeaderText(simDate) {
  const dayCount = creatures.filter((c) => c.isDay).length;
  const nightCount = creatures.length - dayCount;
  const utc = `${String(simDate.getUTCHours()).padStart(2, "0")}:${String(simDate.getUTCMinutes()).padStart(2, "0")}:${String(simDate.getUTCSeconds()).padStart(2, "0")}`;
  statusEl.textContent = `${t("status", dayCount, nightCount, utc)} | ${t("dragHint")}`;
}

function updateDebugReadout(simDate) {
  if (!dbgReadout || !state.debugOpen) return;
  const txt = [
    `sun lat ${state.sunLat.toFixed(2)}`,
    `sun lon ${state.sunLon.toFixed(2)}`,
    `sim ${simDate.toISOString().slice(0, 19)}Z`,
    `scale x${state.timeScale}`,
    `offset ${state.manualUtcOffsetHours >= 0 ? "+" : ""}${state.manualUtcOffsetHours}h`,
    `party ${state.partyMode ? "on" : "off"}`,
  ].join("\n");
  dbgReadout.textContent = txt;
}

function canvasPointFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function hitTest(px, py) {
  for (let i = creatures.length - 1; i >= 0; i -= 1) {
    const c = creatures[i];
    const s = c.size;
    if (px >= c.renderX - s * 0.5 && px <= c.renderX + s * 0.5 && py >= c.renderY - s * 0.5 && py <= c.renderY + s * 0.5) {
      return c;
    }
  }
  return null;
}

function onPointerDown(e) {
  const p = canvasPointFromEvent(e);
  const target = hitTest(p.x, p.y);
  if (!target) return;

  target.dragging = true;
  target.smileUntil = performance.now() + 1200;
  state.dragTarget = target;
  state.dragOffsetX = target.x - p.x;
  state.dragOffsetY = target.y - p.y;
  canvas.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
  if (!state.dragTarget) return;
  const p = canvasPointFromEvent(e);
  state.dragTarget.x = p.x + state.dragOffsetX;
  state.dragTarget.y = p.y + state.dragOffsetY;
  state.dragTarget.smileUntil = performance.now() + 900;
  if (Math.random() < 0.18) spawnBurst(state.dragTarget.x, state.dragTarget.y, state.dragTarget.color, state.dragTarget.size * 0.58);
}

function onPointerUp(e) {
  if (!state.dragTarget) return;
  state.dragTarget.dragging = false;
  state.dragTarget.smileUntil = performance.now() + 700;
  state.dragTarget = null;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
}

function applyLang() {
  titleEl.textContent = t("title");
  subtitleEl.textContent = t("subtitle");
  langBtn.textContent = state.lang === "ja" ? "EN" : "JP";
}

function fitAndRecenter() {
  fitCanvas();
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  for (const c of creatures) {
    const x = lonToX(c.lon, w);
    const y = latToY(c.lat, h);
    c.x = x;
    c.y = y;
    c.homeX = x;
    c.homeY = y;
    c.renderX = x;
    c.renderY = y;
  }
}

function bindDebugControls() {
  if (!debugBtn || !debugPanel) return;

  debugBtn.addEventListener("click", () => {
    state.debugOpen = !state.debugOpen;
    debugPanel.classList.toggle("hidden", !state.debugOpen);
  });

  dbgTimeScale.addEventListener("input", (e) => {
    const next = Number(e.target.value);
    setTimeScale(next);
    dbgTimeScaleValue.textContent = `x${next}`;
  });

  dbgUtcOffset.addEventListener("input", (e) => {
    state.manualUtcOffsetHours = Number(e.target.value);
    const v = state.manualUtcOffsetHours;
    dbgUtcOffsetValue.textContent = `${v >= 0 ? "+" : ""}${v}h`;
  });

  dbgShowMap.addEventListener("change", (e) => {
    state.showMap = e.target.checked;
  });

  dbgShowGrid.addEventListener("change", (e) => {
    state.showGrid = e.target.checked;
  });

  dbgShowNight.addEventListener("change", (e) => {
    state.showNightMask = e.target.checked;
  });

  dbgShowLabels.addEventListener("change", (e) => {
    state.showLabels = e.target.checked;
  });

  if (dbgWave) {
    dbgWave.addEventListener("click", () => {
      smileWave();
    });
  }

  if (dbgResetTime) {
    dbgResetTime.addEventListener("click", () => {
      state.manualUtcOffsetHours = 0;
      state.timeBaseEpochMs = Date.now();
      state.timeBasePerf = performance.now();
      if (dbgUtcOffset) dbgUtcOffset.value = "0";
      if (dbgUtcOffsetValue) dbgUtcOffsetValue.textContent = "+0h";
    });
  }

  if (dbgComet) {
    dbgComet.addEventListener("click", () => {
      triggerComet();
    });
  }

  if (dbgParty) {
    dbgParty.addEventListener("click", () => {
      state.partyMode = !state.partyMode;
      dbgParty.textContent = state.partyMode ? "party off" : "party on";
    });
    dbgParty.textContent = "party on";
  }

  // 初期値同期
  if (dbgTimeScale) {
    const initialScale = Number(dbgTimeScale.value);
    setTimeScale(initialScale);
    dbgTimeScaleValue.textContent = `x${initialScale}`;
  }
  if (dbgUtcOffset) {
    const initialOffset = Number(dbgUtcOffset.value);
    state.manualUtcOffsetHours = initialOffset;
    dbgUtcOffsetValue.textContent = `${initialOffset >= 0 ? "+" : ""}${initialOffset}h`;
  }
}

function renderFrame() {
  const tick = performance.now() / 1000;
  const simDate = updateSun();
  updateCreatures(tick);
  drawBackground(tick);
  for (const c of creatures) drawCreature(c);
  drawParticles();
  drawHeaderText(simDate);
  updateDebugReadout(simDate);
}

function animate() {
  renderFrame();
  requestAnimationFrame(animate);
}

function init() {
  if (
    !canvas ||
    !ctx ||
    !statusEl ||
    !titleEl ||
    !subtitleEl ||
    !langBtn ||
    !debugBtn ||
    !debugPanel
  ) {
    throw new Error("Required DOM elements are missing.");
  }

  seedAmbient();
  fitAndRecenter();
  window.addEventListener("resize", fitAndRecenter);

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  langBtn.addEventListener("click", () => {
    state.lang = state.lang === "ja" ? "en" : "ja";
    applyLang();
  });

  bindDebugControls();
  applyLang();
  loadWorldGeoData();
  animate();
}

try {
  init();
} catch (err) {
  if (statusEl) statusEl.textContent = `Init error: ${err.message}`;
}
