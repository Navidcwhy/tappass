// Funktionstest av kedjestödet i butikspanelen (v18): huvudkontot (översikt, Visa, tillbaka, utgången
// visning), ställe i kedja (låsta belöningar, present och färg) och vanligt ställe (oförändrat).
// Riktig m.tsx från Lovable-utkastet, fejkade RPC-svar (mock.cjs + kedjeanropen här). node check-chain.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { mock } = require("./mock.cjs");
const URL_ = "http://127.0.0.1:5174/";
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };

const sthlmDay = (k) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() - k * 864e5));
const at = (k, hh, mm) => new Date(`${sthlmDay(k)}T${String(hh - 1).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`).toISOString();   // UTC+1 i november
const CHAIN = { slug: "kaffekedjan", name: "Kaffekedjan", reward_short: "Gratis kaffe", stamps_needed: 8 };
const STORES = [
  { slug: "kk-kungsholmen", name: "Kaffekedjan Kungsholmen", area: "Kungsholmen", own_card: true, active: true },
  { slug: "kk-soder", name: "Kaffekedjan Södermalm", area: "Södermalm", own_card: false, active: true },
  { slug: "kk-vasa", name: "Kaffekedjan Vasastan", area: "Vasastan", own_card: false, active: true },
  { slug: "borta", name: "Kaffekedjan Gamla stan", area: "Gamla stan", own_card: false, active: false },
];
const ROWS = [
  { ...STORES[1], stamps_today: 9, stamps_7d: 61, stamps_30d: 244, customers_30d: 118, redeemed_30d: 14, last_stamp_at: at(0, 9, 12) },
  { ...STORES[2], stamps_today: 5, stamps_7d: 35, stamps_30d: 166, customers_30d: 87, redeemed_30d: 9, last_stamp_at: at(1, 14, 5) },
  { ...STORES[0], stamps_today: 0, stamps_7d: 0, stamps_30d: 12, customers_30d: 10, redeemed_30d: 0, last_stamp_at: at(4, 10, 30) },
  { ...STORES[3], stamps_today: 0, stamps_7d: 0, stamps_30d: 0, customers_30d: 0, redeemed_30d: 0, last_stamp_at: null },
];
const OVERVIEW = { ok: true, chain: { slug: "kaffekedjan", name: "Kaffekedjan" },
  totals: { stamps_today: 14, stamps_7d: 96, stamps_30d: 422, customers_30d: 188, redeemed_30d: 23 }, stores: ROWS };
const PROFILE = { name: "Kaffekedjan Södermalm", slug: "kk-soder", city: "Stockholm", stamps_needed: 8, type: "Kafé", area: "Södermalm",
  reward_text: "En kaffe på huset", reward_short: "Gratis kaffe", ink_color: "#6B3A1F", address: "Götgatan 21", description: "", website: "", instagram: "",
  opening_hours: [], logo_version: 0, logo: null, updated_at: null, managed_by_chain: true, chain_name: "Kaffekedjan" };

async function open(browser, { role = "main", lang = "sv", width = 1000, height = 1100 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript((s) => localStorage.setItem("tappass.merchant.session.v2", s),
    JSON.stringify({ token: "demo", cafeName: role === "store" ? "Kaffekedjan Vasastan" : role === "main" ? "Kaffekedjan" : "Café Linnea", loginName: "x" }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  const st = { role, expired: false, calls: [], profileSaves: [] };
  await mock(page, {});
  if (role !== "standalone-404") {
    await page.route("**/rest/v1/rpc/**", async (route) => {
      const fn = route.request().url().split("/rpc/")[1].split("?")[0];
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch {}
      const tok = String(body.p_token || "");
      const viewing = tok.startsWith("view-");
      st.calls.push({ fn, tok, body });
      const json = (d) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(d) });
      if (role === "standalone") {
        if (fn === "merchant_chain") return json({ ok: true, role: "standalone" });
        return route.fallback();
      }
      if (st.expired && viewing) return json({ ok: false, error: "bad_session" });
      const place = (slug) => { const s = STORES.find((x) => x.slug === slug); return { slug: s.slug, name: s.name, area: s.area }; };
      if (fn === "merchant_chain") {
        if (viewing) return json({ ok: true, role: "store", own_card: false, viewing: true, chain: CHAIN, place: place(tok.slice(5)), stores: STORES });
        if (role === "main") return json({ ok: true, role: "main", own_card: false, viewing: false, chain: CHAIN, place: null, stores: STORES });
        return json({ ok: true, role: "store", own_card: false, viewing: false, chain: CHAIN, place: place("kk-vasa"), stores: STORES });
      }
      if (fn === "merchant_chain_overview") return json(role === "main" && !viewing ? OVERVIEW : { ok: false, error: "not_main" });
      if (fn === "merchant_chain_view") {
        if (body.p_slug === "borta") return json({ ok: false, error: "not_found" });
        return json({ ok: true, token: "view-" + body.p_slug, place: place(body.p_slug) });
      }
      const storeLike = viewing || role === "store";
      if (storeLike && fn === "merchant_get_reward_tiers")
        return json({ ok: true, stamps_needed: 8, reward_text: "En kaffe på huset", reward_short: "Gratis kaffe", reward_value_kr: 39, tiers: [{ at: 4, text: "En kanelbulle", value_kr: 25 }],
          max_tiers: 3, redeemed_30d: [{ tier_at: 8, reward: "Gratis kaffe", count: 6 }], managed_by_chain: true, chain_name: "Kaffekedjan" });
      if (storeLike && fn === "merchant_get_birthday")
        return json({ ok: true, text: "En kaka", value_kr: 30, redeemed_30d: 1, redeemed_total: 2, upcoming_30d: 1, managed_by_chain: true, chain_name: "Kaffekedjan" });
      if (storeLike && fn === "merchant_get_profile") return json({ ok: true, ...PROFILE });
      if (storeLike && fn === "merchant_set_profile") { st.profileSaves.push(body.p_profile); return json({ ok: true, ...PROFILE, ...body.p_profile }); }
      if (storeLike && (fn === "merchant_set_reward_tiers" || fn === "merchant_set_birthday")) return json({ ok: false, error: "chain_managed" });
      if (fn === "merchant_recent_redemptions" && !storeLike)
        return json({ ok: true, recent: [
          { redeemed_at: at(0, 9, 40), via: "tap", customer_label: "Kund #1a2b", reward: "Gratis kaffe", place: "Kaffekedjan Södermalm" },
          { redeemed_at: at(0, 8, 55), via: "code", customer_label: "Kund #9f3c", reward: "En kanelbulle", place: "Kaffekedjan Vasastan" }] });
      return route.fallback();
    });
  }
  await page.goto(URL_ + "?lang=" + lang);
  return { ctx, page, st, errors };
}
const sectionBy = (page, name) => page.locator("section", { has: page.getByRole("heading", { name, exact: true }) });
const tokensAfter = (st, i) => [...new Set(st.calls.slice(i).filter((c) => c.fn.startsWith("merchant_") && c.fn !== "merchant_chain_view" && c.fn !== "merchant_logout").map((c) => c.tok))];

(async () => {
  const browser = await chromium.launch();

  // ── Huvudkontot ──────────────────────────────────────────────────────
  {
    const { ctx, page, st, errors } = await open(browser, { role: "main" });
    const chainSec = sectionBy(page, "Kaffekedjan – hela kedjan");
    await chainSec.waitFor({ timeout: 15000 });
    await chainSec.getByText("Kaffekedjan Södermalm").first().waitFor({ timeout: 10000 });
    await chainSec.getByText("422", { exact: true }).first().waitFor({ timeout: 10000 });   // siffrorna räknas upp
    const t = await chainSec.innerText();
    if (process.env.SHOTS) { await page.waitForTimeout(600); await chainSec.screenshot({ path: "shots/chain-main.png" }); }
    for (const s of ["Siffrorna nedan gäller alla ställen", "14", "96", "422", "188", "23", "Kaffekedjan Södermalm", "Kaffekedjan Vasastan", "Kaffekedjan Kungsholmen",
      "Eget kort", "Inaktivt", "i dag 09.12", "igår 14.05", "Räknas en gång"]) ok(t.includes(s), "Kedjan: " + s);
    ok(/\b244\b/.test(t) && /\b118\b/.test(t), "Södermalms siffror");
    eq(await chainSec.getByRole("button", { name: /Visa/ }).count(), 4, "en Visa-knapp per ställe");
    // Lugna timmar och väntetid ställs in per ställe
    eq(await sectionBy(page, "Lugna timmar").count(), 0, "huvudkontot: ingen sektion Lugna timmar");
    ok((await page.getByText("Lugna timmar och väntetid ställs in per ställe").count()) >= 1, "huvudkontot: informationsrutan");
    ok(!(await page.getByText("Väntetid mellan stämplar").isVisible().catch(() => false)), "huvudkontot: väntetiden är dold");
    ok(await page.getByText("Byt PIN").first().isVisible(), "huvudkontot: byta PIN finns kvar");
    ok((await page.getByText("Koder från alla ställen i Kaffekedjan går att lösa in här.").count()) >= 1, "kodrutan nämner hela kedjan");
    await page.getByText("Kund #1a2b").first().waitFor({ timeout: 10000 });
    ok((await page.getByText("Kaffekedjan Södermalm").count()) >= 2, "Senast inlösta visar stället");
    // Inaktivt ställe som inte finns kvar
    await chainSec.getByRole("button", { name: /Visa/ }).nth(3).click();
    await page.getByText("Stället finns inte längre i kedjan.").first().waitFor({ timeout: 5000 });
    ok(true, "not_found visas");

    // Visa Södermalm
    const before = st.calls.length;
    const sod = chainSec.locator("li, tr, [data-store], article, div").filter({ hasText: "Kaffekedjan Södermalm" }).filter({ has: page.getByRole("button", { name: /Visa/ }) }).last();
    await sod.getByRole("button", { name: /Visa/ }).click();
    await page.getByText("Du tittar på Kaffekedjan Södermalm som huvudkontot.", { exact: false }).first().waitFor({ timeout: 10000 });
    ok(true, "visningslisten");
    eq(st.calls.find((c, i) => i >= before && c.fn === "merchant_chain_view").body.p_slug, "kk-soder", "merchant_chain_view med stället");
    await sectionBy(page, "Lugna timmar").waitFor({ timeout: 10000 });
    ok(true, "visningen: Lugna timmar finns");
    eq(await sectionBy(page, "Kaffekedjan – hela kedjan").count(), 0, "visningen: ingen kedjeöversikt");
    await page.waitForTimeout(1500);
    eq(tokensAfter(st, st.calls.findIndex((c, i) => i >= before && c.fn === "merchant_chain_view") + 1), ["view-kk-soder"], "alla anrop använder visningens token");
    ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes("view-"), "visningens token sparas aldrig");
    ok(await page.getByText("Väntetid mellan stämplar").first().isVisible(), "visningen: väntetiden finns");
    eq(await page.getByText("Byt PIN").count(), 0, "visningen: inget PIN-byte");
    const tiers = sectionBy(page, "Belöningar");
    await tiers.getByText("Belöningen gäller på alla ställen i Kaffekedjan och ändras av huvudkontot.").waitFor({ timeout: 10000 });
    eq(await tiers.getByRole("button", { name: "Spara belöningar" }).count(), 0, "visningen: belöningarna går inte att spara");
    ok((await tiers.innerText()).includes("En kanelbulle"), "visningen: kedjans mindre belöning syns");
    eq(await tiers.locator("input").count(), 0, "visningen: inga fält i Belöningar");
    if (process.env.SHOTS) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(500);
      await page.screenshot({ path: "shots/chain-view-top.png" });
      await tiers.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await tiers.screenshot({ path: "shots/chain-view-tiers.png" });
    }
    const bday = sectionBy(page, "Födelsedagspresent");
    await bday.getByText("Födelsedagspresenten gäller i hela Kaffekedjan och ändras av huvudkontot.").waitFor({ timeout: 10000 });
    eq(await bday.getByRole("button", { name: "Spara födelsedagspresent" }).count(), 0, "visningen: presenten går inte att spara");
    const prof = sectionBy(page, "Profil");
    await prof.getByText("Belöning och färg är kedjans och ändras av huvudkontot.").waitFor({ timeout: 10000 });
    eq(await prof.getByText("Kort belöningstext", { exact: true }).count(), 0, "visningen: inga belöningsfält i profilen");
    eq(await prof.getByText("Hexfärg", { exact: true }).count(), 0, "visningen: ingen färgväljare");
    const addr = prof.getByLabel("Adress");
    await addr.fill("Götgatan 22");
    await prof.getByRole("button", { name: "Spara profil" }).click();
    await page.waitForTimeout(800);
    const saved = st.profileSaves[st.profileSaves.length - 1] || {};
    eq(["reward_text", "reward_short", "ink_color"].filter((k) => k in saved), [], "profilen skickar inte kedjans fält");
    eq(saved.address, "Götgatan 22", "profilen sparar ställets adress");

    // Tillbaka
    const back = st.calls.length;
    await page.getByRole("button", { name: "Tillbaka till hela kedjan" }).click();
    await sectionBy(page, "Kaffekedjan – hela kedjan").waitFor({ timeout: 10000 });
    await page.waitForTimeout(1200);
    eq(tokensAfter(st, back), ["demo"], "tillbaka: huvudkontots token igen");
    eq(await page.getByText("Du tittar på", { exact: false }).count(), 0, "tillbaka: listen borta");

    // Utgången visning: tillbaka till hela kedjan, inte utloggad
    st.expired = true;
    const vasa = sectionBy(page, "Kaffekedjan – hela kedjan").locator("li, tr, [data-store], article, div").filter({ hasText: "Kaffekedjan Vasastan" }).filter({ has: page.getByRole("button", { name: /Visa/ }) }).last();
    await vasa.getByRole("button", { name: /Visa/ }).click();
    await page.getByText("Visningen har gått ut – du är tillbaka på hela kedjan.").first().waitFor({ timeout: 10000 });
    ok(await sectionBy(page, "Kaffekedjan – hela kedjan").isVisible(), "utgången visning: hela kedjan igen");
    ok((await page.evaluate(() => localStorage.getItem("tappass.merchant.session.v2"))) !== null, "utgången visning: inte utloggad");
    st.expired = false;
    eq(errors, [], "huvudkontot: inga sidfel");
    await ctx.close();
  }

  // ── Huvudkontot på engelska och 360 px ───────────────────────────────
  {
    const { ctx, page, errors } = await open(browser, { role: "main", lang: "en", width: 360, height: 800 });
    await sectionBy(page, "Kaffekedjan – the whole chain").waitFor({ timeout: 15000 });
    ok(true, "engelska: rubriken");
    await page.waitForTimeout(800);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(over <= 0, "360 px: ingen sidledes skroll (" + over + ")");
    ok((await page.getByRole("button", { name: /View/ }).count()) >= 4, "engelska: View-knappar");
    await page.screenshot({ path: "shots-chain-360.png", fullPage: false });
    eq(errors, [], "engelska: inga sidfel");
    await ctx.close();
  }

  // ── Ställe i kedjan ──────────────────────────────────────────────────
  {
    const { ctx, page, st, errors } = await open(browser, { role: "store" });
    await page.getByText("del av Kaffekedjan", { exact: false }).first().waitFor({ timeout: 15000 });
    ok(true, "ställe: del av kedjan i rubriken");
    eq(await sectionBy(page, "Kaffekedjan – hela kedjan").count(), 0, "ställe: ingen översikt");
    eq(st.calls.filter((c) => c.fn === "merchant_chain_overview").length, 0, "ställe: översikten hämtas inte");
    await sectionBy(page, "Lugna timmar").waitFor({ timeout: 10000 });
    ok(true, "ställe: Lugna timmar finns");
    ok(await page.getByText("Byt PIN").first().isVisible(), "ställe: eget PIN-byte finns");
    ok((await page.getByText("Koder från alla ställen i Kaffekedjan går att lösa in här.").count()) >= 1, "ställe: kodrutan");
    await sectionBy(page, "Belöningar").getByText("Belöningen gäller på alla ställen i Kaffekedjan och ändras av huvudkontot.").waitFor({ timeout: 10000 });
    ok(true, "ställe: belöningen låst");
    eq(errors, [], "ställe: inga sidfel");
    await ctx.close();
  }

  // ── Vanligt ställe: som förut ────────────────────────────────────────
  for (const role of ["standalone", "standalone-404"]) {
    const { ctx, page, st, errors } = await open(browser, { role });
    await sectionBy(page, "Lugna timmar").waitFor({ timeout: 15000 });
    await page.waitForTimeout(1000);
    eq(await page.getByText("hela kedjan", { exact: false }).count(), 0, role + ": ingen kedja");
    eq(await page.getByText("del av", { exact: false }).count(), 0, role + ": ingen kedjerad");
    eq(await page.getByText("Koder från alla ställen", { exact: false }).count(), 0, role + ": kodrutan som förut");
    ok(await page.getByRole("button", { name: "Spara belöningar" }).first().isVisible(), role + ": belöningarna går att spara");
    ok(await page.getByText("Väntetid mellan stämplar").first().isVisible(), role + ": väntetiden finns");
    if (role === "standalone") eq(st.calls.filter((c) => c.fn === "merchant_chain").map((c) => c.tok), ["demo"], role + ": rollen hämtas en gång");
    eq(errors.filter((e) => !/404|Failed to load resource/.test(e)), [], role + ": inga sidfel");
    await ctx.close();
  }

  await browser.close();
  console.log(`Kedjan i panelen OK: ${passed} kontroller`);
})().catch((e) => { console.error("FEL:", e.message.split("\n").slice(0, 6).join("\n")); process.exit(1); });
