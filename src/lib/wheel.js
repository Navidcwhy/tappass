// Dagens hjul — rena hjälpfunktioner (ingen UI). Servern avgör utfallet;
// appen räknar bara ut hur hjulet ska snurra för att landa på serverns fält.

export const SEGMENTS = 10;
export const SEGMENT_DEG = 360 / SEGMENTS;          // 36°
export const WIN_SEGMENTS = [0, 3, 5, 8];          // samma som spin_wheel i v6
export const isWinSegment = (i) => WIN_SEGMENTS.includes(i);

// Fält i räknas medurs från toppen: fält 0 täcker 0–36°, mitten på 18°.
export const segmentCenter = (i) => i * SEGMENT_DEG + SEGMENT_DEG / 2;

// Vilan för ett visst fält: fältets mitt rakt under pekaren (överst).
export const restRotation = (segment) => -segmentCenter(segment);

const mod = (v, m) => ((v % m) + m) % m;

// Ny total rotation (grader) som snurrar `turns` varv framåt och landar på
// `segment`. jitter (±grader) gör att visaren inte alltid hamnar mitt i fältet.
export function targetRotation(current, segment, { turns = 6, jitter = 0 } = {}) {
  const j = Math.max(-SEGMENT_DEG / 2 + 4, Math.min(SEGMENT_DEG / 2 - 4, jitter));
  const want = mod(-segmentCenter(segment) + j, 360);
  const delta = mod(want - mod(current, 360), 360);
  return current + turns * 360 + delta;
}

// Tidpunkter (ms från start) då en fältgräns passerar pekaren under ett snurr
// från `from` till `to` grader med Easing.out(Easing.cubic) — en tick (vibration)
// per fält. Ticks tätare än minGap hoppas över: vibratorn hinner inte med fler.
export function tickTimes(from, to, duration, minGap = 55) {
  const out = [];
  if (!(to > from) || !(duration > 0)) return out;
  let last = -Infinity;
  for (let k = Math.floor(from / SEGMENT_DEG) + 1; k * SEGMENT_DEG <= to; k++) {
    const u = (k * SEGMENT_DEG - from) / (to - from);   // andel av sträckan
    const t = (1 - Math.cbrt(1 - u)) * duration;       // invers av 1 − (1 − t)³
    if (t - last >= minGap) { out.push(Math.round(t)); last = t; }
  }
  return out;
}

// Vilket fält pekaren står på vid en viss rotation (för test och tillgänglighet).
export function segmentAt(rotation) {
  const a = mod(-rotation, 360);                    // vinkeln på hjulet som står under pekaren
  return Math.floor(a / SEGMENT_DEG) % SEGMENTS;
}

// "13 h 22 min" / "22 min" / "under en minut" till nästa snurr.
export function countdownText(nextAt, now = Date.now()) {
  const ms = Date.parse(nextAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "nu";
  const mins = Math.ceil(ms / 60000);
  if (mins < 1) return "under en minut";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return m + " min";
  return m === 0 ? h + " h" : h + " h " + m + " min";
}

const DAYS = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
const DAYS_SHORT = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"];

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// Bonusen går ut vid midnatt (start på dag 3). Visas som sista giltiga dag:
// "t.o.m. i dag 23.59", "t.o.m. i morgon 23.59", "t.o.m. fredag 23.59".
export function expiryText(expiresAt, now = Date.now(), { short = false } = {}) {
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return "";
  const last = new Date(t - 60 * 1000);             // 23.59 sista dagen
  const days = Math.round((startOfDay(last) - startOfDay(new Date(now))) / 86400000);
  const day = days <= 0 ? "i dag" : days === 1 ? "i morgon" : (short ? DAYS_SHORT : DAYS)[last.getDay()];
  return "t.o.m. " + day + " 23.59";
}

// En dubbelstämpel räknas bara som aktiv fram till utgångstiden — även om
// plånboken i appen är gammal (cache, appen låg i bakgrunden).
export function isActiveUntil(expiresAt, now = Date.now()) {
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t > now;
}

// Hur många ställen i staden kunden kan vinna just nu (v7: `available`).
// 0 = kunden har redan dubbelstämpel hos alla. null = staden finns inte i listan.
export function availableIn(city, cities) {
  const key = String(city || "").toLowerCase();
  const c = (Array.isArray(cities) ? cities : []).find((x) => x && String(x.city).toLowerCase() === key);
  if (!c) return null;
  return typeof c.available === "number" ? c.available : c.places;
}

// Städer från servern, med användarens sparade stad först om den finns.
export function pickCity(saved, cities) {
  const list = Array.isArray(cities) ? cities : [];
  if (saved && list.some((c) => c.city.toLowerCase() === String(saved).toLowerCase())) {
    return list.find((c) => c.city.toLowerCase() === String(saved).toLowerCase()).city;
  }
  return null;
}
