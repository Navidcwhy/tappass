// Stamgästnivåer (v11) — rena hjälpfunktioner. Kunden får Brons, Silver eller Guld
// hos varje ställe utifrån sina besök där senaste 12 månaderna.
//   besök = ett svenskt dygn med minst en stämpling (flera samma dag räknas som ett)
// Samma gränser finns i SQL (guest_level i supabase_migration_v11_stamgaster.sql) och
// i panelen — ändra alla tre.
//   card.visits    — besök senaste 12 månaderna (load_wallet: visits_12m)
//   card.lastVisit — svenskt datum ("2026-11-14") för senaste besöket, eller null
//   card.hasLevels — servern skickar besöken (v11); annars visas inga nivåer

export const LEVELS = [
  { key: "brons", name: "Brons", at: 3, bg: "#F2DCC6", ink: "#5A3315", accent: "#B4703A" },
  { key: "silver", name: "Silver", at: 10, bg: "#E3E7EB", ink: "#2E353B", accent: "#7F8A93" },
  { key: "guld", name: "Guld", at: 25, bg: "#F7E4A3", ink: "#4B3600", accent: "#C0920F" },
];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

// Högsta nivån kunden nått, eller null.
export function levelFor(visits) {
  const v = num(visits);
  let hit = null;
  for (const l of LEVELS) if (v >= l.at) hit = l;
  return hit;
}

// Nästa nivå och hur många besök som är kvar dit, eller null (Guld).
export function nextLevel(visits) {
  const v = num(visits);
  const l = LEVELS.find((x) => x.at > v);
  return l ? { level: l, left: l.at - v } : null;
}

// En ny nivå som nåddes mellan två besöksantal, eller null.
export function crossedLevel(before, after) {
  const a = levelFor(before);
  const b = levelFor(after);
  return b && (!a || b.at > a.at) ? b : null;
}

export const guestName = (level) => (level ? level.name + "gäst" : "");

// Kortets fält från load_wallet-raden.
export function visitsFields(row) {
  const r = row || {};
  const has = r.visits_12m != null && Number.isFinite(Number(r.visits_12m));
  const last = typeof r.last_visit === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.last_visit) ? r.last_visit : null;
  return { visits: has ? num(r.visits_12m) : 0, lastVisit: last, hasLevels: has };
}

// Dagens datum i svensk tid ("2026-11-14"). Faller tillbaka på telefonens datum.
let fmt = null;
try {
  fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" });
} catch {}
export function sthlmDate(now = Date.now()) {
  const d = new Date(now);
  if (fmt) {
    try {
      const p = {};
      fmt.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
      if (p.year && p.month && p.day) return p.year + "-" + p.month + "-" + p.day;
    } catch {}
  }
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

// Efter ett lyckat tapp: första stämpeln i dag hos stället är ett nytt besök.
// prev = kortet före tappet (kan saknas). Servern räknar exakt vid nästa hämtning.
export function afterTap(card, prev, now = Date.now()) {
  const today = sthlmDate(now);
  const p = prev || {};
  const visits = num(p.visits) + (p.lastVisit === today ? 0 : 1);
  return { ...card, visits, lastVisit: today, hasLevels: !!p.hasLevels };
}

// "Silvergäst · 4 besök till Guld", "1 besök · 2 till Brons", "Guldgäst · 31 besök senaste året"
export function progressText(visits) {
  const v = num(visits);
  const lvl = levelFor(v);
  const next = nextLevel(v);
  if (!lvl) return v + " besök · " + next.left + " till " + next.level.name;
  if (!next) return guestName(lvl) + " · " + v + " besök senaste året";
  return guestName(lvl) + " · " + next.left + " besök till " + next.level.name;
}
