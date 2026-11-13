// Säsongsdetaljer efter svensk kalender (telefonens datum). Ren logik, ingen UI.
//   fall     — vad som singlar ner över hemskärmen när appen öppnas (null = inget)
//   burst    — fyrverkeri av konfetti i stället för fall (nyår)
//   greeting — liten hälsning på hemskärmen på själva dagen (null = ingen)
//   chip     — formen och färgen i hälsningens lilla symbol

const SNOW = { kinds: ["flower8", "sunny8", "dot"], colors: ["#A9BED3", "#C3D3E2", "#93AECA"], count: 34, speed: [45, 85], size: [9, 18], spin: 50 };
const FEATHERS = { kinds: ["pill"], colors: ["#F2D35A", "#F4B1C6", "#B3DAA1", "#A6CDE9"], count: 18, speed: [50, 90], size: [10, 18], spin: 140 };
const PETALS = { kinds: ["flower8", "clover4", "cookie9"], colors: ["#F2AFC4", "#F2D35A", "#E58FB0", "#C9EE6B"], count: 22, speed: [45, 85], size: [9, 17], spin: 110 };
const BUNS = { kinds: ["cookie9", "dot"], colors: ["#B5763A", "#D9A066", "#8C5528"], count: 14, speed: [55, 95], size: [10, 18], spin: 80 };

// Påskdagen (gregoriansk kalender, Meeus/Jones/Butcher).
export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Midsommarafton: fredagen mellan 19 och 25 juni.
export function midsummerEve(year) {
  for (let d = 19; d <= 25; d++) { const t = new Date(year, 5, d); if (t.getDay() === 5) return t; }
  return new Date(year, 5, 19);
}

const daysBetween = (a, b) => Math.round((a - b) / 86400000);

export function seasonFor(date = new Date()) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  const day = new Date(y, m - 1, d);
  const easter = daysBetween(day, easterSunday(y));          // 0 = påskdagen
  const midsummer = daysBetween(day, midsummerEve(y));        // 0 = midsommarafton

  if ((m === 12 && d === 31) || (m === 1 && d === 1)) return { id: "nyar", greeting: "Gott nytt år!", burst: true, fall: null, chip: { kind: "burst12", color: "#E3B53B" } };
  if (m === 12 && d === 13) return { id: "lucia", greeting: "Glad Lucia!", fall: SNOW, chip: { kind: "sunny8", color: "#F2C94C" } };
  if (m === 12 && d >= 24 && d <= 26) return { id: "jul", greeting: "God jul!", fall: SNOW, chip: { kind: "flower8", color: "#C0392B" } };
  if (m === 12 || (m === 1 && d <= 6)) return { id: "vinter", greeting: null, fall: SNOW };   // t.o.m. trettondagen
  if (easter === -47) return { id: "fettisdag", greeting: "Glad fettisdag!", fall: null, chip: { kind: "cookie9", color: "#D9A066" } };
  if (easter >= -3 && easter <= 1) return { id: "pask", greeting: "Glad påsk!", fall: FEATHERS, chip: { kind: "cookie12", color: "#F2D35A" } };
  if (midsummer === 0 || midsummer === 1) return { id: "midsommar", greeting: "Glad midsommar!", fall: PETALS, chip: { kind: "flower8", color: "#F2AFC4" } };
  if (m === 10 && d === 4) return { id: "kanelbulle", greeting: "Glad kanelbullens dag!", fall: BUNS, chip: { kind: "cookie9", color: "#B5763A" } };
  return null;
}
