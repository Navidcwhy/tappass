// Sparat-räknaren (v10): vad kunden har fått med TapPass, summerat över korten.
// Siffrorna kommer från load_wallet per kort:
//   redeemed — inlösta belöningar hos stället
//   savedKr  — deras värde i kronor (värdet butiken angett)
//   unvalued — inlösta belöningar som saknar värde (butiken har inte angett något)
// Saknar några belöningar värde är summan ett golv: appen skriver då "minst".

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

// Kortets fält från load_wallet-raden.
export function savingsFields(row) {
  const r = row || {};
  return { redeemed: num(r.rewards_redeemed), savedKr: num(r.saved_kr), unvalued: num(r.rewards_unvalued) };
}

// Ett tapp ger ett nytt kortläge utan sparat-siffrorna — behåll dem tills plånboken
// laddas om, annars hoppar räknaren ner och upp igen.
export function keepSavings(card, prev) {
  if (!prev) return card;
  return { ...card, redeemed: prev.redeemed || 0, savedKr: prev.savedKr || 0, unvalued: prev.unvalued || 0 };
}

// Summan över alla kort. places = ställen med minst en inlöst belöning, mest sparat först.
export function walletSavings(cards) {
  let rewards = 0;
  let kr = 0;
  let unvalued = 0;
  const places = [];
  for (const c of cards || []) {
    const n = num(c && c.redeemed);
    if (!n) continue;
    const k = num(c.savedKr);
    const u = Math.min(n, num(c.unvalued));
    rewards += n;
    kr += k;
    unvalued += u;
    places.push({ slug: c.slug, name: c.name || "", ink: c.ink, rewards: n, kr: k, unvalued: u });
  }
  places.sort((a, b) => b.kr - a.kr || b.rewards - a.rewards || a.name.localeCompare(b.name, "sv"));
  return { rewards, kr, unvalued, partial: kr > 0 && unvalued > 0, places };
}

// 1245 → "1 245 kr" med hårda mellanslag, så att beloppet aldrig bryts över två rader.
const NBSP = " ";
export function formatKr(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) + NBSP + "kr";
}

export const rewardsText = (n) => (n === 1 ? "1 belöning" : n + " belöningar");
export const placesText = (places) =>
  places.length === 1 ? "hos " + places[0].name : "hos " + places.length + " ställen";
