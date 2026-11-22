// Påhittad data för butiksbilderna. Inga riktiga butiker, inga riktiga kunder.
// Svarar på appens Supabase-anrop (rpc + tabellen cafes) med samma former som produktionen.

const DAY = 86400000;

function cafe(o) {
  return {
    id: o.id, slug: o.slug, name: o.name, type: o.type, area: o.area, city: "Stockholm",
    symbol: o.symbol, ink_color: o.ink, soft_color: null, deep_color: null,
    reward_text: o.reward, reward_short: o.short, stamps_needed: o.needed, active: true,
    quiet_hours: o.quiet || [], reward_tiers: o.tiers || [], reward_value_kr: o.value || null,
    address: o.address || null, description: o.description || null, website: o.website || null,
    instagram: o.instagram || null, opening_hours: o.hours || [], logo_version: 0,
    birthday_text: o.birthday || null, birthday_value_kr: null,
    chain_id: null, is_chain: false, own_card: false, wheel_enabled: true, invite_enabled: true,
  };
}

const WEEK = [1, 2, 3, 4, 5];
const ALL = [1, 2, 3, 4, 5, 6, 7];

const CAFES = {
  blaklint: cafe({
    id: "00000000-0000-4000-8000-000000000001", slug: "cafe-blaklint", name: "Café\u00a0Blåklint", type: "Kafé",
    area: "Södermalm", symbol: "coffee", ink: "#2C4F7C", needed: 10,
    reward: "Valfri kaffe på huset", short: "Gratis kaffe", value: 45,
    tiers: [{ at: 5, text: "Valfri kaka", value_kr: 35 }],
    quiet: [{ days: WEEK, from: "14:00", to: "16:00" }],
    hours: [{ days: WEEK, from: "07:00", to: "18:00" }, { days: [6, 7], from: "09:00", to: "17:00" }],
    address: "Skånegatan, Stockholm",
    description: "Kvarterskafé med eget rosteri, surdegsmackor och kardemummabullar varje morgon.",
    website: "https://example.com",
  }),
  glod: cafe({
    id: "00000000-0000-4000-8000-000000000002", slug: "bageri-glod", name: "Bageri Glöd", type: "Bageri",
    area: "Vasastan", symbol: "croissant", ink: "#C2662D", needed: 8,
    reward: "En kanelbulle och en kaffe", short: "Bulle + kaffe", value: 55,
    hours: [{ days: ALL, from: "07:30", to: "17:00" }],
    address: "Odengatan, Stockholm",
    description: "Stenugnsbakat bröd och bullar från tidig morgon.",
  }),
  lunch: cafe({
    id: "00000000-0000-4000-8000-000000000003", slug: "lunchkompaniet", name: "Lunchkompaniet", type: "Restaurang",
    area: "Kungsholmen", symbol: "utensils", ink: "#7A2E4C", needed: 9,
    reward: "Dagens lunch på huset", short: "Gratis lunch", value: 129,
    tiers: [{ at: 5, text: "Gratis efterrätt", value_kr: 49 }],
    hours: [{ days: WEEK, from: "11:00", to: "14:30" }],
    address: "Fleminggatan, Stockholm",
  }),
  grona: cafe({
    id: "00000000-0000-4000-8000-000000000004", slug: "grona-skalen", name: "Gröna Skålen", type: "Salladsbar",
    area: "Östermalm", symbol: "leaf", ink: "#4C7A2A", needed: 10,
    reward: "En valfri skål", short: "Gratis skål", value: 115,
    hours: [{ days: WEEK, from: "10:30", to: "19:00" }, { days: [6], from: "11:00", to: "16:00" }],
    address: "Karlavägen, Stockholm",
  }),
  maja: cafe({
    id: "00000000-0000-4000-8000-000000000005", slug: "glassbaren-maja", name: "Glassbaren Maja", type: "Glassbar",
    area: "Hornstull", symbol: "icecream", ink: "#B8456F", needed: 6,
    reward: "En kula glass", short: "Gratis glass", value: 38,
    hours: [{ days: ALL, from: "12:00", to: "21:00" }],
    address: "Hornsgatan, Stockholm",
  }),
};

// Kortens läge för den påhittade kunden. Ändras när appen stämplar eller löser in.
function freshState(now) {
  const iso = (ms) => new Date(ms).toISOString();
  const today = new Date(now).toISOString().slice(0, 10);
  const days = (n) => new Date(now - n * DAY).toISOString().slice(0, 10);
  return {
    now,
    cards: {
      "cafe-blaklint": { stamps: 7, pending: false, bonus: iso(now + 2 * DAY), redeemed: 3, saved: 135, visits: 9, last: days(2) },
      "bageri-glod": { stamps: 8, pending: false, bonus: null, redeemed: 2, saved: 110, visits: 26, last: days(1) },
      "lunchkompaniet": { stamps: 8, pending: false, bonus: null, redeemed: 0, saved: 0, visits: 8, last: days(3) },
      "grona-skalen": { stamps: 2, pending: false, bonus: null, redeemed: 0, saved: 0, visits: 2, last: days(6) },
    },
    savedCode: {},       // slug -> { code, reward, tier_at }
    spun: false,
    today,
  };
}

function walletRows(st) {
  return Object.entries(st.cards).map(([slug, c]) => {
    const cafeRow = Object.values(CAFES).find((x) => x.slug === slug);
    return {
      cafe: cafeRow, stamps: c.stamps, pending: !!c.pending,
      pending_tier: c.pending ? c.pendingTier || null : null,
      pending_reward: c.pending ? c.pendingReward || null : null,
      bonus_expires_at: c.bonus, rewards_redeemed: c.redeemed, saved_kr: c.saved, rewards_unvalued: 0,
      visits_12m: c.visits, last_visit: c.last, stores: null,
    };
  });
}

function nextMidnight(now) {
  const d = new Date(now);
  // Stockholm (UTC+1 i november)
  const local = new Date(d.getTime() + 3600000);
  local.setUTCHours(24, 0, 0, 0);
  return new Date(local.getTime() - 3600000).toISOString();
}

// tokens som appen kan "läsa" i bilderna
const TOKENS = {
  "cafe-blaklint-k7": "cafe-blaklint", "bageri-glod-p2": "bageri-glod", "lunchkompaniet-m4": "lunchkompaniet",
  "grona-skalen-q9": "grona-skalen", "glassbaren-maja-x3": "glassbaren-maja",
};

function makeHandler(st) {
  return function handle(fn, args) {
    const now = Date.now();
    switch (fn) {
      case "load_wallet": return walletRows(st);
      case "auth_methods": return { email: false, apple: false, google: false };
      case "account_status": return { ok: true, linked: false };
      case "birthday_status": return { ok: true, gifts: [] };
      case "invite_status": return { ok: true, code: "K7M3QF", can_redeem: false, redeem_until: null, entered: null, friends: 2, rewarded: 1, unseen: [] };
      case "invite_code": return { ok: true, code: "K7M3QF" };
      case "invite_ack": return { ok: true };
      case "cafe_logo": return { ok: false };
      case "wheel_status": {
        const bonuses = Object.entries(st.cards).filter(([, c]) => c.bonus)
          .map(([slug, c]) => ({ cafe: Object.values(CAFES).find((x) => x.slug === slug), expires_at: c.bonus }));
        return {
          ok: true, can_spin: !st.spun, next_spin_at: nextMidnight(now),
          today: st.spun ? { spin_id: "spin-1", won: true, segment: 3 } : null,
          prize: st.spun && !st.claimed ? { spin_id: "spin-1", claim_until: new Date(now + 3 * DAY).toISOString(), offers: st.offers } : null,
          bonuses,
          cities: [{ city: "Stockholm", places: 5, available: 4 }],
        };
      }
      case "spin_wheel": {
        st.spun = true;
        st.offers = [
          { cafe: CAFES.maja, stamps: 0 },
          { cafe: CAFES.grona, stamps: 2 },
          { cafe: CAFES.glod, stamps: 8 },
        ];
        return { ok: true, spin_id: "spin-1", won: true, segment: 3, next_spin_at: nextMidnight(now), claim_until: new Date(now + 3 * DAY).toISOString(), offers: st.offers };
      }
      case "claim_wheel_prize": {
        const slug = args.p_cafe_slug;
        st.claimed = true;
        if (!st.cards[slug]) st.cards[slug] = { stamps: 0, pending: false, bonus: null, redeemed: 0, saved: 0, visits: 0, last: null };
        st.cards[slug].bonus = new Date(now + 3 * DAY).toISOString();
        const c = Object.values(CAFES).find((x) => x.slug === slug);
        return { ok: true, cafe: c, expires_at: st.cards[slug].bonus, stamps: st.cards[slug].stamps };
      }
      case "tap_token": {
        const raw = String(args.p_token || "").split("?")[0].toLowerCase();
        const slug = TOKENS[raw];
        if (!slug) return { ok: false, error: "unknown_tag", token: raw };
        const c = Object.values(CAFES).find((x) => x.slug === slug);
        if (!st.cards[slug]) st.cards[slug] = { stamps: 0, pending: false, bonus: null, redeemed: 0, saved: 0, visits: 0, last: null };
        const card = st.cards[slug];
        const added = card.bonus ? 2 : 1;
        const bonusApplied = !!card.bonus;
        card.bonus = null;
        card.stamps += added;
        if (card.last !== st.today) { card.visits += 1; card.last = st.today; }
        const complete = card.stamps >= c.stamps_needed;
        return { ok: true, cafe: c, stamps: card.stamps, complete, stamps_added: added, bonus_applied: bonusApplied, quiet_applied: false, carry_over: Math.max(0, card.stamps - c.stamps_needed) };
      }
      case "save_reward": {
        const slug = args.p_cafe_slug;
        const c = Object.values(CAFES).find((x) => x.slug === slug);
        const tier = args.p_tier_at || c.stamps_needed;
        const t = (c.reward_tiers || []).find((x) => x.at === tier);
        const reward = t ? t.text : c.reward_text;
        st.savedCode[slug] = { code: "482915", reward, tier_at: tier };
        st.cards[slug].pending = true; st.cards[slug].pendingTier = tier; st.cards[slug].pendingReward = reward;
        return { ok: true, code: "482915", tier_at: tier, reward };
      }
      case "current_saved_code": {
        const s = st.savedCode[args.p_cafe_slug];
        return s ? { ok: true, code: s.code, tier_at: s.tier_at, reward: s.reward } : { ok: true, code: null };
      }
      case "redeem_by_tap": {
        const slug = args.p_cafe_slug;
        const s = st.savedCode[slug];
        const c = Object.values(CAFES).find((x) => x.slug === slug);
        const card = st.cards[slug];
        const tier = s ? s.tier_at : c.stamps_needed;
        const carry = Math.max(0, card.stamps - tier);
        delete st.savedCode[slug];
        card.pending = false; card.stamps = carry; card.redeemed += 1;
        const t = (c.reward_tiers || []).find((x) => x.at === tier);
        card.saved += t ? (t.value_kr || 0) : (c.reward_value_kr || 0);
        return { ok: true, carry_over: carry, stamps: carry, tier_at: tier, reward: s ? s.reward : c.reward_text };
      }
      case "cancel_saved_reward": {
        delete st.savedCode[args.p_cafe_slug];
        st.cards[args.p_cafe_slug].pending = false;
        return { ok: true, stamps: st.cards[args.p_cafe_slug].stamps };
      }
      default:
        return { ok: false, error: "network" };
    }
  };
}

const cafesList = () => Object.values(CAFES).sort((a, b) => a.name.localeCompare(b.name, "sv"));

module.exports = { CAFES, TOKENS, freshState, makeHandler, cafesList };
