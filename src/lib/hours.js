// Öppettider (v13) — rena hjälpfunktioner. Butiken anger dem i panelen i samma form
// som lugna timmar: [{ days: [1..7] (1 = måndag), from: "HH:MM", to: "HH:MM" }].
// Öppet över midnatt skrivs som två perioder (18–24 och 00–02 dagen efter).
import { sthlmClock, clockText, quietParts } from "./quiet";

const DAY = ["", "mån", "tis", "ons", "tors", "fre", "lör", "sön"];
const toMin = (s) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const valid = (h) => h && Array.isArray(h.days) && h.days.length > 0 && toMin(h.from) < toMin(h.to);
const nextDow = (d) => (d % 7) + 1;

// Öppet just nu? { open: true, until: "18:00" } | { open: false, next: { inDays, dow, from } | null } | null (inga tider)
export function openState(hours, now = Date.now()) {
  const list = Array.isArray(hours) ? hours.filter(valid) : [];
  if (!list.length) return null;
  const { dow, minutes } = sthlmClock(now);
  const at = (d, min) => list.find((h) => h.days.includes(d) && toMin(h.from) <= min && min < toMin(h.to));
  const cur = at(dow, minutes);
  if (cur) {
    // Perioder som tar vid direkt (även över midnatt: 18–24 + 00–02) räknas som en
    let until = cur.to, d = dow;
    for (let hop = 0; hop < 3; hop++) {
      const end = toMin(until);
      const nd = end >= 1440 ? nextDow(d) : d;
      const next = at(nd, end >= 1440 ? 0 : end);
      if (!next) break;
      until = next.to;
      d = nd;
    }
    return { open: true, until };
  }
  for (let k = 0; k <= 7; k++) {
    const d = ((dow - 1 + k) % 7) + 1;
    const opens = list.filter((h) => h.days.includes(d) && (k > 0 || toMin(h.from) > minutes))
      .sort((a, b) => toMin(a.from) - toMin(b.from));
    if (opens.length) return { open: false, next: { inDays: k, dow: d, from: opens[0].from } };
  }
  return { open: false, next: null };
}

// "Öppet nu · stänger 18", "Stängt · öppnar 14", "Stängt · öppnar i morgon 7", "Stängt · öppnar mån 7"
export function openText(state) {
  if (!state) return "";
  if (state.open) return "Öppet nu · stänger " + clockText(state.until);
  if (!state.next) return "Stängt";
  const n = state.next;
  const when = n.inDays === 0 ? "" : n.inDays === 1 ? "i morgon " : DAY[n.dow] + " ";
  return "Stängt · öppnar " + when + clockText(n.from);
}

// Schemat rad för rad: ["mån–fre 7–18", "lör–sön 9–16"]
export const hoursLines = (hours) => quietParts(hours);

// Visningsform för webbplats och Instagram
export const siteLabel = (url) => String(url || "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
export const instagramUrl = (handle) => "https://instagram.com/" + String(handle || "").replace(/^@/, "");
