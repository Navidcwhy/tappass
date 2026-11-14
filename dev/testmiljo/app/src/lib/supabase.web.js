// Demodata för webbförhandsvisning (bara i testkopian, aldrig i repot).
const q = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
const S = q.get("s") || "ready";
const iso = (h) => new Date(Date.now() + h * 3600000).toISOString();
const midnight = (d) => { const x = new Date(); return new Date(x.getFullYear(), x.getMonth(), x.getDate() + d).toISOString(); };
const MIYABI = { slug: "miyabi", name: "Miyabi", type: "Sushi-restaurang", area: "Lidingö", ink_color: "#1B5A66", reward_text: "En 5-bitars sushi på huset", reward_short: "Gratis 5-bitars sushi", stamps_needed: 6, city: "Stockholm", quiet_hours: [{ days: [1, 2, 3, 4, 5], from: "14:00", to: "16:00" }] };
const BRYGGAN = { slug: "bryggan", name: "Bryggans Bageri", type: "Bageri", area: "Södermalm", ink_color: "#56642B", reward_text: "En kanelbulle på huset", reward_short: "Gratis kanelbulle", stamps_needed: 8, city: "Stockholm", quiet_hours: [{ days: [6, 7], from: "09:00", to: "11:00" }] };
const LINNEA = { slug: "linnea", name: "Café Linnea", type: "Kafé", area: "Vasastan", ink_color: "#7A4A26", reward_text: "En kaffe på huset", reward_short: "Gratis kaffe", stamps_needed: 8, city: "Stockholm" };
const RAMEN = { slug: "ramenkai", name: "Ramen Kai", type: "Ramen-bar", area: "Kungsholmen", ink_color: "#8C3A2B", reward_text: "En ramen på huset", reward_short: "Gratis ramen", stamps_needed: 10, city: "Stockholm" };
const NONNA = { slug: "nonna", name: "Nonna Pizza", type: "Pizzeria", area: "Hornstull", ink_color: "#2F4B7C", reward_text: "En pizza på huset", reward_short: "Gratis pizza", stamps_needed: 6, city: "Stockholm" };
const BLOM = { slug: "blom", name: "Blom & Böna", type: "Kafé", area: "Östermalm", ink_color: "#6A4A86", reward_text: "En latte på huset", reward_short: "Gratis latte", stamps_needed: 8, city: "Stockholm" };
const FIKA = { slug: "fika", name: "Fikafabriken", type: "Konditori", area: "Vasastan", ink_color: "#2E6B4F", reward_text: "En bakelse på huset", reward_short: "Gratis bakelse", stamps_needed: 5, city: "Stockholm" };
const CITIES = [{ city: "Stockholm", places: 3 }, { city: "Göteborg", places: 1 }];
const OFFERS = [{ cafe: MIYABI, stamps: 5, is_new: false }, { cafe: BRYGGAN, stamps: 2, is_new: false }, { cafe: LINNEA, stamps: 0, is_new: true }];
let claimed = false;
let spun = null;   // senaste snurret — hjulets läge efteråt (som servern)
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export const supabase = {};
export const getDeviceId = async () => "d_web_demo";
const D = Number(q.get("d") || 150);   // ms innan tappet "svarar" — låter hemskärmen synas först i videor
export async function tapToken() {
  await delay(D);
  if (S === "full") return { ok: true, cafe: MIYABI, stamps: 7, complete: true, stamps_added: 2, bonus_applied: true, carry_over: 1 };
  if (S === "plus1") return { ok: true, cafe: MIYABI, stamps: 4, complete: false, stamps_added: 1, bonus_applied: false, carry_over: 0 };
  if (S === "last") return { ok: true, cafe: MIYABI, stamps: 5, complete: false, stamps_added: 1, bonus_applied: false, carry_over: 0 };
  if (S === "first") return { ok: true, cafe: BRYGGAN, stamps: 1, complete: false, stamps_added: 1, bonus_applied: false, carry_over: 0 };
  if (S === "quiet") return { ok: true, cafe: MIYABI, stamps: 5, complete: false, stamps_added: 2, bonus_applied: false, quiet_applied: true, carry_over: 0 };
  return { ok: true, cafe: MIYABI, stamps: 5, complete: false, stamps_added: 2, bonus_applied: true, carry_over: 0 };
}
// ?s=tap: fullt kort (7/6) som löses in med butikens stämpel (v9). Fel stämpel = Bryggan.
let savedCode = null;
let redeemedByTap = false;
export const saveReward = async () => { await delay(S === "tap" ? 350 : 0); savedCode = "305174"; return { ok: true, code: "305174" }; };
let codeCalls = 0;
export const getCurrentSavedCode = async () => {
  codeCalls++;
  if (S === "tap") return { ok: true, code: redeemedByTap ? null : savedCode };
  return S === "redeem" && codeCalls > 2 ? { ok: true, code: null } : { ok: true, code: "305174" };
};
export async function redeemByTap(slug, token) {
  await delay(500);
  const t = String(token || "").toLowerCase();
  if (t.startsWith("bryggan")) return { ok: false, error: "wrong_tag", expected: "Miyabi", got: "Bryggans Bageri" };
  if (!t.startsWith("miyabi")) return { ok: false, error: "unknown_tag", expected: "Miyabi" };
  redeemedByTap = true;
  savedCode = null;
  return { ok: true, carry_over: 1, stamps: 1 };
}
export async function loadWallet() {
  await delay(50);
  if (S === "first") return [];
  if (S === "stack") return [
    { cafe: MIYABI, stamps: 6, pending: false, bonus_expires_at: null },
    { cafe: LINNEA, stamps: 8, pending: true, bonus_expires_at: null },
    { cafe: NONNA, stamps: 5, pending: false, bonus_expires_at: null },
    { cafe: BRYGGAN, stamps: 2, pending: false, bonus_expires_at: null },
    { cafe: RAMEN, stamps: 4, pending: false, bonus_expires_at: null },
    { cafe: FIKA, stamps: 3, pending: false, bonus_expires_at: null },
    { cafe: BLOM, stamps: 1, pending: false, bonus_expires_at: null },
  ];
  const miyabiStamps = S === "plus2" || S === "full" || S === "plus1" || S === "quiet" ? 3 : S === "last" ? 4 : 5;
  const rows = [
    S === "tap" ? { cafe: MIYABI, stamps: redeemedByTap ? 1 : 7, pending: !!savedCode && !redeemedByTap, bonus_expires_at: null }
      : S === "redeem" ? { cafe: MIYABI, stamps: 7, pending: true, bonus_expires_at: null }
      : { cafe: MIYABI, stamps: miyabiStamps, pending: false, bonus_expires_at: S === "home" || S === "blocked" || S === "plus2" || claimed ? midnight(3) : null },
    { cafe: BRYGGAN, stamps: 2, pending: false, bonus_expires_at: null },
  ];
  if (claimed) rows.push({ cafe: LINNEA, stamps: 0, pending: false, bonus_expires_at: midnight(3) });
  return rows;
}
export const loadCafes = async () => (S === "stack" ? [BRYGGAN, LINNEA, MIYABI, RAMEN, NONNA, BLOM, FIKA] : [BRYGGAN, LINNEA, MIYABI]);
export async function wheelStatus() {
  await delay(80);
  const base = { ok: true, can_spin: true, next_spin_at: midnight(1), today: null, prize: null, bonuses: [], cities: CITIES };
  if (S === "done") return { ...base, can_spin: false, today: { spin_id: "x", won: false, segment: 1 } };
  if (S === "home") return { ...base, bonuses: [{ cafe: MIYABI, expires_at: midnight(3) }] };
  if (S === "blocked") return { ...base, cities: [{ city: "Stockholm", places: 3, available: 0 }, { city: "Göteborg", places: 1, available: 1 }], bonuses: [MIYABI, BRYGGAN, LINNEA].map((c, i) => ({ cafe: c, expires_at: midnight(1 + i) })) };
  if (claimed) return { ...base, can_spin: false, today: { spin_id: "x", won: true, segment: 3 }, bonuses: [{ cafe: LINNEA, expires_at: midnight(3) }] };
  if (spun) return { ...base, can_spin: false, today: { spin_id: spun.spin_id, won: spun.won, segment: spun.segment }, prize: spun.won ? { spin_id: spun.spin_id, offers: spun.offers, claim_until: spun.claim_until } : null };
  return base;
}
export async function spinWheel() {
  await delay(300);
  if (S === "win") return (spun = { ok: true, won: true, segment: 3, spin_id: "spin-1", offers: OFFERS, claim_until: midnight(3), next_spin_at: midnight(1) });
  return (spun = { ok: true, won: false, segment: 1, spin_id: "spin-2", offers: [], claim_until: null, next_spin_at: midnight(1) });
}
export async function claimWheelPrize() { await delay(200); claimed = true; return { ok: true, cafe: LINNEA, expires_at: midnight(3), stamps: 0 }; }
