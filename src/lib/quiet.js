// Lugna timmar (v8) — rena hjälpfunktioner. Butiken väljer dagar och tider
// (svensk tid) då varje stämpling ger 2 stämplar. Servern avgör vid stämplingen
// (tap_token); appen visar bara schemat och om det är lugn timme just nu.
//   hours = [{ days: [1..7] (1 = måndag), from: "HH:MM", to: "HH:MM" }]

const DAY = ["", "mån", "tis", "ons", "tors", "fre", "lör", "sön"];
const ISO = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

let fmt = null;
try {
  fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Stockholm", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
} catch {}

// Veckodag (1–7) och minut på dygnet i svensk tid. Faller tillbaka på telefonens
// egen tid om tidszoner inte stöds.
export function sthlmClock(now = Date.now()) {
  const d = new Date(now);
  if (fmt) {
    try {
      const p = {};
      fmt.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
      const dow = ISO[p.weekday];
      const h = Number(p.hour) % 24, m = Number(p.minute);
      if (dow && Number.isFinite(h) && Number.isFinite(m)) return { dow, minutes: h * 60 + m };
    } catch {}
  }
  return { dow: d.getDay() === 0 ? 7 : d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
}

const toMin = (s) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

const valid = (h) => h && Array.isArray(h.days) && h.days.length > 0 && toMin(h.from) < toMin(h.to);

// Perioden som gäller just nu, eller null.
export function quietNow(hours, now = Date.now()) {
  if (!Array.isArray(hours) || hours.length === 0) return null;
  const { dow, minutes } = sthlmClock(now);
  return hours.find((h) => valid(h) && h.days.includes(dow) && minutes >= toMin(h.from) && minutes < toMin(h.to)) || null;
}

// "14" / "14.30" / "24"
export function clockText(s) {
  const m = toMin(s);
  if (!Number.isFinite(m)) return "";
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? h + "." + String(mm).padStart(2, "0") : String(h);
}

// "mån–fre", "lör–sön", "mån, ons, fre", "alla dagar"
export function daysText(days) {
  const d = [...new Set((days || []).filter((x) => x >= 1 && x <= 7))].sort((a, b) => a - b);
  if (d.length === 7) return "alla dagar";
  const runs = [];
  d.forEach((x) => {
    const last = runs[runs.length - 1];
    if (last && x === last[1] + 1) last[1] = x; else runs.push([x, x]);
  });
  return runs.map(([a, b]) => (a === b ? DAY[a] : b === a + 1 ? DAY[a] + ", " + DAY[b] : DAY[a] + "–" + DAY[b])).join(", ");
}

// Perioderna i klartext: ["mån–fre 14–16", "lör 9.30–11"]
export function quietParts(hours) {
  if (!Array.isArray(hours)) return [];
  return hours.filter(valid).map((h) => daysText(h.days) + " " + clockText(h.from) + "–" + clockText(h.to));
}

// Hela schemat på en rad: "mån–fre 14–16 · lör 9.30–11"
export const quietSummary = (hours) => quietParts(hours).join(" · ");
