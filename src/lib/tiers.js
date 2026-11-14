// Fler belöningar (v10) — rena hjälpfunktioner. Butiken kan ha upp till 3 mindre
// belöningar under huvudbelöningen, t.ex. "Valfri kaka" vid 5 när kortet är fullt
// vid 10. Kunden väljer själv: lös in en mindre belöning — då börjar kortet om på
// stämplarna utöver den — eller samla vidare. Servern avgör (save_reward med vald nivå).
//   tiers = [{ at, text }] — at < needed, sorterade (minst först)

// Butikens nivåer från servern (cafes.reward_tiers), kontrollerade mot kortets längd.
export function cleanTiers(raw, needed) {
  if (!Array.isArray(raw)) return [];
  const n = Number(needed) || 0;
  const seen = new Set();
  return raw
    .map((t) => ({ at: Number(t && t.at), text: String((t && t.text) || "").trim() }))
    .filter((t) => {
      if (!Number.isInteger(t.at) || t.at < 1 || t.at >= n || !t.text || seen.has(t.at)) return false;
      seen.add(t.at);
      return true;
    })
    .sort((a, b) => a.at - b.at);
}

// Alla belöningar på kortet, minst först: de mindre och sist huvudbelöningen.
//   { at, text, title, full } — title är den längre texten för rubriker
export function rewardOptions(card) {
  const c = card || {};
  const needed = Math.max(1, c.needed || 1);
  const tiers = (c.tiers || []).filter((t) => t.at < needed);
  return [
    ...tiers.map((t) => ({ at: t.at, text: t.text, title: t.text, full: false })),
    { at: needed, text: c.rewardShort || c.reward || "Belöning", title: c.reward || c.rewardShort || "Belöning", full: true },
  ];
}

// Belöningen för en nivå (huvudbelöningen om nivån saknas eller är null).
export function optionFor(card, at) {
  const list = rewardOptions(card);
  return list.find((o) => o.at === at) || list[list.length - 1];
}

// Största belöningen kunden kan lösa in nu, eller null.
export function bestReached(card) {
  const stamps = (card && card.stamps) || 0;
  const reached = rewardOptions(card).filter((o) => o.at <= stamps);
  return reached.length ? reached[reached.length - 1] : null;
}

// Den största mindre belöningen (inte huvudbelöningen) som kortet nått, eller null.
export function tierReady(card) {
  const best = bestReached(card);
  return best && !best.full ? best : null;
}

// En mindre belöning som nåddes med det senaste tappet (added = stämplar det gav).
export function crossedTier(card, added) {
  const c = card || {};
  const stamps = c.stamps || 0;
  if (stamps >= (c.needed || 0)) return null;             // fullt kort firas som vanligt
  const before = stamps - Math.max(1, added || 1);
  const crossed = (c.tiers || []).filter((t) => before < t.at && t.at <= stamps);
  return crossed.length ? crossed[crossed.length - 1] : null;
}

// Stämplar som blir kvar på kortet när belöningen på nivå `at` löses in.
export const carryAfter = (stamps, at) => Math.max(0, (stamps || 0) - (at || 0));
