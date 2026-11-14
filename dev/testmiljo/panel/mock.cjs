// Fejkade svar för butikspanelens RPC:er (Supabase). Ingen trafik når produktion.
//   mock(page, { quiet, failQuiet, badSession, log })
const DAY = 86400000;
function daily() {
  const out = [];
  const today = new Date("2026-11-14T12:00:00Z");
  const base = [3, 5, 4, 6, 2, 7, 8, 4, 5, 6, 3, 4, 9, 7, 5, 4, 6, 5, 3, 8, 6, 7, 4, 5, 6, 9, 7, 5, 6, 6];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY);
    out.push({ day: d.toISOString().slice(0, 10), stamps: base[29 - i] });
  }
  return out;
}
// I går kl. hh:mm svensk tid som ISO-sträng.
function yesterdayAt(h, m) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" });
  const today = fmt.format(new Date());
  const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - 1);
  const ymd = d.toISOString().slice(0, 10);
  // Stockholm är UTC+1 vintertid (räcker för testet i november)
  return new Date(`${ymd}T${String(h - 1).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`).toISOString();
}
function clean(hours) {
  if (!Array.isArray(hours) || hours.length > 7) return null;
  const out = [];
  for (const h of hours) {
    if (!h || !Array.isArray(h.days) || !h.days.length) return null;
    if (!h.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)) return null;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h.from || "") || !/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(h.to || "")) return null;
    if (h.from >= h.to) return null;
    out.push({ days: [...new Set(h.days)].sort((a, b) => a - b), from: h.from, to: h.to });
  }
  return out;
}
async function mock(page, opts = {}) {
  const state = {
    quiet: opts.quiet ?? [{ days: [1, 2, 3, 4, 5], from: "14:00", to: "16:00" }],
    active: opts.active ?? true,
    visits30: opts.visits30 ?? 18,
    visitsTotal: opts.visitsTotal ?? 46,
    failQuiet: !!opts.failQuiet,
    badSession: !!opts.badSession,
    calls: [],
    // Senast inlösta (v9): två i dag, en i går kväll (svensk tid)
    recent: opts.recent ?? [
      { redeemed_at: new Date(Date.now() - 3 * 60000).toISOString(), via: "tap", customer_label: "Kund #a41f", reward: "Valfri kaka" },
      { redeemed_at: new Date(Date.now() - 41 * 60000).toISOString(), via: "code", customer_label: "Kund #7c02", reward: "Gratis kaffe" },
      { redeemed_at: yesterdayAt(21, 10), via: "tap", customer_label: "Kund #e9b4", reward: "Valfri kaka" },
    ],
    // Fler belöningar (v10)
    needed: opts.needed ?? 10,
    tiers: opts.tiers ?? [{ at: 5, text: "Valfri kaka" }],
    failTiers: !!opts.failTiers,
  };
  await page.route("**/rest/v1/rpc/**", async (route) => {
    const fn = route.request().url().split("/rpc/")[1].split("?")[0];
    let body = {};
    try { body = route.request().postDataJSON() || {}; } catch {}
    state.calls.push({ fn, body });
    if (opts.log) opts.log(fn, body);
    const json = (data, delay = 120) => new Promise((r) => setTimeout(r, delay)).then(() =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) }));
    if (state.badSession && fn !== "merchant_logout") return json({ ok: false, error: "bad_session" });
    if (opts.badQuietOnly && /quiet_hours/.test(fn)) return json({ ok: false, error: "bad_session" });
    switch (fn) {
      case "merchant_stats": return json({ ok: true, today: 6, week: 31, month: 118, total: 412, pending: 1 });
      case "merchant_daily": return json({ ok: true, days: daily() });
      case "merchant_pending_list":
        return json({ ok: true, pending: [{ code: "482913", saved_at: new Date(Date.now() - 25 * 60000).toISOString(), customer_label: "Kund #A41F", reward: "Valfri kaka" }] });
      case "merchant_campaign_stats":
        return json({ ok: true, bonus_stamps_30d: 4, bonus_stamps_total: 4, active_bonuses: 1, new_customers_30d: 2, carried_over_30d: 1 });
      case "merchant_get_settings":
        return json({ ok: true, stamp_cooldown_seconds: 60, cooldown_min_seconds: 10, cooldown_max_seconds: 86400, login_name: "miyabi" });
      case "merchant_get_quiet_hours":
        if (state.failQuiet) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "fel" }) });
        return json({ ok: true, quiet_hours: state.quiet, active_now: state.quiet.length ? state.active : false,
          visits_30d: state.visits30, visits_total: state.visitsTotal });
      case "merchant_set_quiet_hours": {
        const c = clean(body.p_hours);
        if (!c) return json({ ok: false, error: "invalid_quiet_hours", max_periods: 7 }, 350);
        state.quiet = c;
        return json({ ok: true, quiet_hours: c, active_now: c.length ? state.active : false }, 450);
      }
      case "merchant_recent_redemptions":
        if (opts.badRecentOnly) return json({ ok: false, error: "bad_session" });
        return json({ ok: true, recent: state.recent });
      case "merchant_get_reward_tiers":
        if (state.failTiers) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "PGRST202", message: "not found" }) });
        return json({ ok: true, stamps_needed: state.needed, reward_text: "En kaffe på huset", reward_short: "Gratis kaffe", tiers: state.tiers, max_tiers: 3,
          redeemed_30d: [{ tier_at: 5, reward: "Valfri kaka", count: 12 }, { tier_at: 10, reward: "Gratis kaffe", count: 4 }] });
      case "merchant_set_reward_tiers": {
        const t = body.p_tiers;
        const okList = Array.isArray(t) && t.length <= 3 && t.every((x) => Number.isInteger(x.at) && x.at >= 1 && x.at < state.needed && String(x.text || "").trim().length >= 1 && String(x.text).trim().length <= 40)
          && new Set(t.map((x) => x.at)).size === t.length;
        if (!okList) return json({ ok: false, error: "invalid_tiers", max_tiers: 3, stamps_needed: state.needed }, 300);
        state.tiers = t.map((x) => ({ at: x.at, text: String(x.text).trim() })).sort((a, b) => a.at - b.at);
        return json({ ok: true, tiers: state.tiers, stamps_needed: state.needed }, 400);
      }
      case "merchant_redeem_by_code":
        return json({ ok: true, code: body.p_code, carry_over: 0, tier_at: 5, reward: "Valfri kaka" }, 300);
      case "merchant_logout": return json({ ok: true });
      default: return json({ ok: false, error: "unknown_fn_" + fn });
    }
  });
  return state;
}
module.exports = { mock };
