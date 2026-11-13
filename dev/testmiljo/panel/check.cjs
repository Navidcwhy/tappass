// Funktionstest av sektionen "Lugna timmar" i butikspanelen (riktig m.tsx från Lovable-utkastet,
// fejkade RPC-svar). node check.js
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { mock } = require("./mock.cjs");
const URL_ = "http://127.0.0.1:5174/";
const SESSION = JSON.stringify({ token: "demo", cafeName: "Miyabi", loginName: "miyabi" });
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };
const norm = (hours) => hours.map((h) => ({ days: h.days, from: h.from, to: h.to }));

async function open(browser, { lang = "sv", width = 900, height = 1000, clock = false, ...mopts } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript((s) => localStorage.setItem("tappass.merchant.session.v2", s), SESSION);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  if (clock) await page.clock.install();
  const state = await mock(page, mopts);
  await page.goto(URL_ + "?lang=" + lang);
  const title = lang === "sv" ? "Lugna timmar" : "Quiet hours";
  const section = page.locator("section", { has: page.getByRole("heading", { name: title, exact: true }) });
  return { ctx, page, state, section, errors };
}
const setCalls = (state) => state.calls.filter((c) => c.fn === "merchant_set_quiet_hours");

(async () => {
  const browser = await chromium.launch();

  // 1. Läsa, ändra, spara (svenska)
  {
    const { ctx, page, state, section, errors } = await open(browser);
    await section.getByText("Lugn timme just nu – varje stämpling ger 2 stämplar").waitFor();
    ok(true, "aktiv-pill visas");
    await section.getByText("Nu: mån–fre 14–16", { exact: true }).waitFor();
    ok(true, "schemat i klartext");
    await page.waitForTimeout(900);
    const stats = await section.locator("div").filter({ hasText: /^\d+$/ }).allInnerTexts();
    ok(stats.includes("18") && stats.includes("46"), "besök 30 d och totalt: " + stats.join(","));
    const save = section.getByRole("button", { name: "Spara lugna timmar" });
    ok(await save.isDisabled(), "spara avstängd utan ändringar");
    ok(!(await section.getByText("Osparade ändringar").isVisible()), "inga osparade ändringar från start");

    await section.getByRole("button", { name: "+ Lägg till period" }).click();
    await section.getByText("Period 2", { exact: true }).waitFor();
    ok(await section.getByText("Osparade ändringar").isVisible(), "osparade ändringar visas");
    ok(await save.isEnabled(), "spara aktiv efter ändring");
    const chips = section.locator("button[aria-pressed]");
    eq(await chips.count(), 14, "7 dagknappar per period");
    eq(await chips.nth(7).getAttribute("aria-pressed"), "true", "ny period: måndag vald");
    for (let i = 7; i <= 11; i++) await chips.nth(i).click();          // av mån–fre
    await chips.nth(12).click(); await chips.nth(13).click();            // på lör, sön
    eq(await chips.nth(12).getAttribute("aria-pressed"), "true", "lördag vald");
    eq(await chips.nth(9).getAttribute("aria-pressed"), "false", "onsdag avvald");
    const selects = section.locator("select");
    eq(await selects.count(), 4, "från/till per period");
    await selects.nth(2).selectOption("09:00");
    eq(await selects.nth(3).inputValue(), "16:00", "till oförändrad när från < till");
    await selects.nth(3).selectOption("11:00");
    await save.click();
    await section.getByText("Sparat. Gäller från nästa stämpling.").waitFor();
    const call = setCalls(state).at(-1);
    eq(call.body.p_token, "demo", "token skickas");
    eq(norm(call.body.p_hours), [{ days: [1, 2, 3, 4, 5], from: "14:00", to: "16:00" }, { days: [6, 7], from: "09:00", to: "11:00" }], "rätt p_hours");
    await section.getByText("Nu: mån–fre 14–16 · lör, sön 9–11", { exact: true }).waitFor();
    ok(true, "schemat uppdaterat efter sparning");
    ok(await save.isDisabled(), "spara avstängd efter sparning");
    ok(!(await section.getByText("Osparade ändringar").isVisible()), "inga osparade ändringar efter sparning");

    // Validering: till före från, och period utan dagar — inget anrop
    const before = setCalls(state).length;
    await selects.nth(3).selectOption("09:00");
    await save.click();
    await section.getByText("Varje period behöver minst en dag och en starttid före sluttiden.").waitFor();
    eq(setCalls(state).length, before, "inget anrop vid ogiltig tid");
    await selects.nth(3).selectOption("11:00");
    ok(!(await section.getByText("Varje period behöver").isVisible()), "felet försvinner vid ändring");
    await chips.nth(12).click(); await chips.nth(13).click();
    await save.click();
    await section.getByText("Varje period behöver minst en dag och en starttid före sluttiden.").waitFor();
    eq(setCalls(state).length, before, "inget anrop utan dagar");

    // Automatisk sluttid
    await selects.nth(2).selectOption("16:00");
    eq(await selects.nth(3).inputValue(), "17:00", "till = från + 1 h när från >= till");
    await selects.nth(2).selectOption("23:30");
    eq(await selects.nth(3).inputValue(), "24:00", "till högst 24:00");

    // Ta bort perioden och spara → bara vardagar kvar
    await section.getByRole("button", { name: "Ta bort" }).nth(1).click();
    eq(await chips.count(), 7, "period borttagen");
    await save.click();
    await section.getByText("Sparat. Gäller från nästa stämpling.").waitFor();
    eq(norm(setCalls(state).at(-1).body.p_hours), [{ days: [1, 2, 3, 4, 5], from: "14:00", to: "16:00" }], "sparat efter borttagning");

    // Högst 7 perioder
    const add = section.getByRole("button", { name: "+ Lägg till period" });
    for (let i = 0; i < 6; i++) await add.click();
    eq(await chips.count(), 49, "7 perioder");
    ok(await add.isDisabled(), "lägg till avstängd vid 7");
    ok(await section.getByText("Högst 7 perioder.").isVisible(), "tips om max 7");
    eq(errors, [], "inga sidfel");
    await ctx.close();
  }

  // 2. Tom inställning
  {
    const { ctx, section, errors } = await open(browser, { quiet: [] });
    await section.getByText("Inga lugna timmar valda – alla stämplingar ger 1 stämpel.").waitFor();
    await section.getByText("Nu: inga lugna timmar", { exact: true }).waitFor();
    ok(!(await section.getByText("Lugn timme just nu").isVisible()) && !(await section.getByText("Ingen lugn timme just nu").isVisible()), "ingen pill utan tider");
    eq(errors, [], "inga sidfel (tom)");
    await ctx.close();
  }

  // 3. Tider finns men inte nu
  {
    const { ctx, section } = await open(browser, { active: false });
    await section.getByText("Ingen lugn timme just nu", { exact: true }).waitFor();
    ok(true, "neutral pill när det inte är lugn timme");
    await ctx.close();
  }

  // 4. Läsfel → felruta, resten av panelen fungerar
  {
    const { ctx, page, section } = await open(browser, { failQuiet: true });
    await section.getByText("Kunde inte hämta lugna timmar just nu.").waitFor();
    ok(await page.getByText("Kampanjstämplar", { exact: true }).isVisible(), "resten av panelen visas vid läsfel");
    await ctx.close();
  }

  // 5. Ogiltig session i sektionen → utloggad med besked
  {
    const { ctx, page } = await open(browser, { badQuietOnly: true });
    await page.getByText("Du har loggats ut. Logga in igen.").waitFor();
    ok(true, "bad_session loggar ut");
    await ctx.close();
  }

  // 6. Engelska
  {
    const { ctx, section, errors } = await open(browser, { lang: "en" });
    await section.getByText("Quiet hour right now — every tap gives 2 stamps").waitFor();
    await section.getByText("Current: Mon–Fri 14:00–16:00", { exact: true }).waitFor();
    ok(await section.getByRole("button", { name: "Save quiet hours" }).isVisible(), "engelska knappar");
    eq(errors, [], "inga sidfel (en)");
    await ctx.close();
  }

  // 7. Polling var 60:e sekund skriver inte över osparade ändringar
  {
    const { ctx, page, state, section } = await open(browser, { clock: true });
    await page.clock.runFor(1500);
    await section.getByText("Nu: mån–fre 14–16", { exact: true }).waitFor();
    const chips = section.locator("button[aria-pressed]");
    await chips.nth(6).click();                                   // lägger till söndag (osparat)
    state.quiet = [{ days: [6], from: "10:00", to: "12:00" }];     // ändrat från en annan enhet
    await page.clock.runFor(61000);
    await section.getByText("Nu: lör 10–12", { exact: true }).waitFor();
    eq(await chips.nth(6).getAttribute("aria-pressed"), "true", "osparad ändring kvar efter polling");
    eq(await chips.nth(0).getAttribute("aria-pressed"), "true", "utkastet orört (måndag kvar)");
    await ctx.close();
  }
  {
    const { ctx, page, state, section } = await open(browser, { clock: true });
    await page.clock.runFor(1500);
    await section.getByText("Nu: mån–fre 14–16", { exact: true }).waitFor();
    state.quiet = [{ days: [6], from: "10:00", to: "12:00" }];
    await page.clock.runFor(61000);
    await section.getByText("Nu: lör 10–12", { exact: true }).waitFor();
    const chips = section.locator("button[aria-pressed]");
    eq(await chips.nth(5).getAttribute("aria-pressed"), "true", "utan ändringar följer utkastet servern");
    eq(await chips.nth(0).getAttribute("aria-pressed"), "false", "måndag inte längre vald");
    await ctx.close();
  }

  // 8. Mobil 360 px: inget sidledsskroll
  {
    const { ctx, page, section } = await open(browser, { width: 360, height: 800 });
    await section.getByText("Nu: mån–fre 14–16", { exact: true }).waitFor();
    await section.getByRole("button", { name: "+ Lägg till period" }).click();
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 360, "ingen horisontell skroll vid 360 px (" + sw + ")");
    const box1 = await section.locator("select").nth(0).boundingBox(), box2 = await section.locator("select").nth(1).boundingBox();
    ok(Math.abs(box1.y - box2.y) < 2 && box2.x > box1.x, "från och till sida vid sida");
    const small = await section.locator("button").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 40).map((e) => e.textContent));
    eq(small, [], "alla knappar minst 40 px höga");
    await ctx.close();
  }

  await browser.close();
  console.log("Panel OK:", passed, "kontroller");
})().catch((e) => { console.error("FEL:", e.message); process.exit(1); });
