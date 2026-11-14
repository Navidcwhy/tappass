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
  ctx.__state = state;
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

  // 9. Senast inlösta (v9): stämpel/kod, klockslag i svensk tid, "igår", tom lista, ogiltig session
  {
    const { ctx, page, errors } = await open(browser);
    const rec = page.locator("section", { has: page.getByRole("heading", { name: "Senast inlösta", exact: true }) });
    await rec.getByText("Kund #a41f").waitFor();
    const rows = await rec.locator("li").allInnerTexts();
    eq(rows.length, 3, "tre inlösta");
    ok(/Kund #a41f · Valfri kaka\s+Stämpeln\s+\d\d:\d\d$/.test(rows[0]), "stämpeln + klockslag: " + rows[0]);
    ok(/Kund #7c02 · Gratis kaffe\s+Kod\s+\d\d:\d\d$/.test(rows[1]), "koden + klockslag: " + rows[1]);
    ok(/Kund #e9b4 · Valfri kaka\s+Stämpeln\s+igår 21:10$/.test(rows[2]), "igår 21:10: " + rows[2]);
    ok(await page.getByText("Oftast löser kunden in genom att hålla telefonen mot er TapPass-stämpel.", { exact: false }).isVisible(), "ny hjälptext vid koden");
    eq(errors, [], "inga sidfel (senast inlösta)");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { recent: [] });
    await page.getByText("Inga inlösta belöningar det senaste dygnet.").waitFor();
    ok(true, "tom lista");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { badRecentOnly: true });
    await page.getByText("Du har loggats ut. Logga in igen.").waitFor();
    ok(true, "bad_session i listan loggar ut");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { lang: "en" });
    const rec = page.locator("section", { has: page.getByRole("heading", { name: "Recently redeemed", exact: true }) });
    await rec.getByText("Kund #e9b4").waitFor();
    ok(/yesterday 21:10$/.test((await rec.locator("li").allInnerTexts())[2]), "engelska: yesterday");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { width: 360, height: 800, recent: [{ redeemed_at: new Date().toISOString(), via: "tap", customer_label: "Kund #a41f med ett väldigt långt namn som inte får tränga ut tiden" }] });
    const rec = page.locator("section", { has: page.getByRole("heading", { name: "Senast inlösta", exact: true }) });
    await rec.locator("li").first().waitFor();
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 360, "ingen sidledsskroll med långt namn (" + sw + ")");
    const time = await rec.locator("li").first().locator("span").last().boundingBox();
    ok(time && time.x + time.width <= 360, "klockslaget syns helt");
    await ctx.close();
  }

  // 10. Belöningar (v10): huvudbelöning, mindre belöningar, validering, belöning i listorna, "Lämna ut"
  {
    const { ctx, page, state, errors } = await open(browser);
    const sec = page.locator("section", { has: page.getByRole("heading", { name: "Belöningar", exact: true }) });
    await sec.getByText("En kaffe på huset").waitFor();
    ok(await sec.getByText("Huvudbelöning · 10 stämplar").isVisible(), "huvudbelöningen visas");
    ok(await sec.getByText("Valfri kaka 12 · Gratis kaffe 4", { exact: false }).isVisible(), "inlösta per belöning");
    // Textfälten (belöningarnas text) och värdefälten (inputmode=numeric: huvudbelöningen först, sedan en per rad)
    const selects = sec.locator("select"), inputs = sec.locator("input:not([inputmode=numeric])"), values = sec.locator("input[inputmode=numeric]");
    eq(await selects.count(), 1, "en mindre belöning");
    eq([await selects.nth(0).inputValue(), await inputs.nth(0).inputValue()], ["5", "Valfri kaka"], "befintlig belöning");
    eq((await selects.nth(0).locator("option").allInnerTexts()).slice(0, 2), ["1 stämpel", "2 stämplar"], "1 stämpel / 2 stämplar");
    eq(await selects.nth(0).locator("option").count(), 9, "1–9 stämplar (under 10)");
    const add = sec.getByRole("button", { name: "+ Lägg till belöning" });
    await add.click();
    eq(await selects.nth(1).inputValue(), "1", "ny rad: minsta lediga (5 upptaget)");
    const save = sec.getByRole("button", { name: "Spara belöningar" });
    const calls = () => state.calls.filter((c) => c.fn === "merchant_set_reward_tiers").length;
    await save.click();
    await sec.getByText("Varje belöning behöver en text och ett eget antal stämplar, färre än huvudbelöningen.").waitFor();
    eq(calls(), 0, "tom text: inget anrop");
    await inputs.nth(1).fill("Kanelbulle");
    await selects.nth(1).selectOption("5");
    await save.click();
    await sec.getByText("Varje belöning behöver en text").waitFor();
    eq(calls(), 0, "dubblett: inget anrop");
    await selects.nth(1).selectOption("3");
    ok(await sec.getByText("Osparade ändringar").isVisible(), "osparade ändringar");
    await save.click();
    await sec.getByText("Sparat", { exact: true }).waitFor();
    const sent = state.calls.filter((c) => c.fn === "merchant_set_reward_tiers").at(-1).body;
    eq(sent.p_tiers, [{ at: 5, text: "Valfri kaka", value_kr: null }, { at: 3, text: "Kanelbulle", value_kr: null }], "skickar belöningarna (tomma värden = null)");
    ok("p_reward_value_kr" in sent && sent.p_reward_value_kr === null, "skickar alltid huvudbelöningens värde (null)");
    eq(await inputs.nth(0).inputValue(), "Kanelbulle", "sorterad efter sparning (3 först)");
    await add.click();
    ok(await add.isDisabled(), "högst 3");
    ok(await sec.getByText("Högst 3 mindre belöningar.").isVisible(), "tips om max 3");
    // Väntande och senast inlösta visar belöningen; "Lämna ut" efter inlösen med kod
    ok(await page.getByText("Kund #A41F · Valfri kaka", { exact: true }).isVisible(), "väntande: belöning");
    ok(await page.getByText("Kund #a41f · Valfri kaka", { exact: true }).isVisible(), "senast inlösta: belöning");
    await page.locator("input[autocomplete=one-time-code]").fill("482913");
    await page.getByRole("button", { name: "Bekräfta inlösen" }).click();
    await page.getByText("Lämna ut: Valfri kaka").waitFor();
    ok(true, "Lämna ut: Valfri kaka");
    eq(errors, [], "inga sidfel (belöningar)");
    await ctx.close();
  }

  // 10b. Värde i kronor (sparat-räknaren): huvudbelöningen och varje mindre belöning
  {
    const { ctx, page, state, errors } = await open(browser, { mainValue: 39, tiers: [{ at: 5, text: "Valfri kaka", value_kr: 35 }] });
    const sec = page.locator("section", { has: page.getByRole("heading", { name: "Belöningar", exact: true }) });
    await sec.getByText("En kaffe på huset").waitFor();
    const main = sec.locator("#main-reward-value"), tier0 = sec.locator("#tier-value-0");
    await page.waitForFunction(() => document.querySelector("#main-reward-value") && document.querySelector("#main-reward-value").value === "39");
    eq([await main.inputValue(), await tier0.inputValue()], ["39", "35"], "värdena läses in");
    ok(await sec.getByText("Värde i kronor", { exact: true }).isVisible(), "etikett: Värde i kronor");
    ok(await sec.getByText("Värde (kr)", { exact: true }).isVisible(), "etikett: Värde (kr)");
    ok(await sec.getByText("Värdet visas för kunden i appen", { exact: false }).isVisible(), "hjälptext om värdet");
    eq(await main.getAttribute("placeholder"), "t.ex. 39", "platshållare");
    const save = sec.getByRole("button", { name: "Spara belöningar" });
    const calls = () => state.calls.filter((c) => c.fn === "merchant_set_reward_tiers");
    ok(await save.isDisabled(), "inget ändrat: spara avstängd");
    for (const bad of ["0", "10001", "3,5", "abc", "-5"]) {
      await main.fill(bad);
      ok(await sec.getByText("Ange ett heltal mellan 1 och 10 000.").first().isVisible() && await save.isDisabled(), "ogiltigt huvudvärde: " + bad);
    }
    await main.fill("42");
    ok(await sec.getByText("Ange ett heltal mellan 1 och 10 000.").count() === 0 && !(await save.isDisabled()), "bara värdet ändrat: kan spara");
    await tier0.fill("abc");
    ok(await save.isDisabled(), "ogiltigt nivåvärde: spara avstängd");
    await tier0.fill("");
    await save.click();
    await sec.getByText("Sparat", { exact: true }).waitFor();
    eq(calls().at(-1).body.p_reward_value_kr, 42, "skickar 42");
    eq(calls().at(-1).body.p_tiers, [{ at: 5, text: "Valfri kaka", value_kr: null }], "tömt nivåvärde = null");
    eq([state.mainValue, await main.inputValue(), await tier0.inputValue()], [42, "42", ""], "laddas om efter sparning");
    await main.fill("");
    await save.click();
    await page.waitForFunction(() => document.querySelector("#main-reward-value").value === "" );
    await sec.getByText("Sparat", { exact: true }).waitFor();
    eq(calls().at(-1).body.p_reward_value_kr, null, "tömt huvudvärde = null");
    eq(state.mainValue, null, "inget värde sparat");
    eq(errors, [], "inga sidfel (värden)");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { forceInvalidValue: true });
    const sec = page.locator("section", { has: page.getByRole("heading", { name: "Belöningar", exact: true }) });
    await sec.getByText("En kaffe på huset").waitFor();
    await sec.locator("#main-reward-value").fill("39");
    await sec.getByRole("button", { name: "Spara belöningar" }).click();
    await sec.getByText("Ange ett heltal mellan 1 och 10 000.").waitFor();
    ok(true, "serverns invalid_value visas vid huvudvärdet");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { width: 360, height: 800, mainValue: 39, tiers: [{ at: 3, text: "Kanelbulle med kardemumma och pärlsocker", value_kr: 25 }, { at: 5, text: "Valfri kaka", value_kr: 35 }] });
    const sec = page.locator("section", { has: page.getByRole("heading", { name: "Belöningar", exact: true }) });
    await sec.getByText("En kaffe på huset").waitFor();
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 360, "värden: ingen sidledsskroll vid 360 px (" + sw + ")");
    const box = await sec.locator("#tier-value-1").boundingBox();
    ok(box && box.x >= 0 && box.x + box.width <= 360, "värdefältet ryms vid 360 px");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { failTiers: true });
    await page.getByText("Kunde inte hämta belöningarna just nu.").waitFor();
    ok(await page.getByText("Lugna timmar", { exact: true }).isVisible(), "resten av panelen fungerar utan v10");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { width: 360, height: 800 });
    await page.getByText("En kaffe på huset").waitFor();
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 360, "belöningar: ingen sidledsskroll vid 360 px (" + sw + ")");
    await ctx.close();
  }

  // 11. Stamgäster (v11): kunder per nivå, högsta först; tomt läge, fel, 360 px, engelska
  {
    const { ctx, page, state, errors } = await open(browser);
    const sec = page.locator("section", { has: page.getByRole("heading", { name: "Stamgäster", exact: true }) });
    await sec.getByText("128 kunder har besökt er senaste 12 månaderna.").waitFor();
    ok(await sec.getByText("en dag med stämpel räknas som ett besök", { exact: false }).isVisible(), "förklaring");
    const order = await page.evaluate(() => [...document.querySelectorAll("section h3")].map((h) => h.textContent));
    ok(order.indexOf("Stamgäster") === order.indexOf("Belöningar") + 1, "direkt efter Belöningar: " + order.join(" / "));
    await page.waitForTimeout(900);   // talen räknas upp
    const tiles = await sec.locator(".grid > div").allInnerTexts();
    eq(tiles.map((x) => x.replace(/\s+/g, " ").trim()), ["GULD 3 från 25 besök", "SILVER 12 från 10 besök", "BRONS 34 från 3 besök"], "Guld, Silver, Brons med antal");
    const calls = () => state.calls.filter((c) => c.fn === "merchant_guest_levels").length;
    eq(calls(), 1, "hämtas en gång vid start");
    eq(errors, [], "inga sidfel (stamgäster)");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { guests: { brons: 1, silver: 0, guld: 0, customers: 1 } });
    await page.getByText("1 kund har besökt er senaste 12 månaderna.").waitFor();
    ok(true, "singular: 1 kund");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { guests: { brons: 0, silver: 0, guld: 0, customers: 0 } });
    await page.getByText("Inga besök registrerade senaste 12 månaderna än.").waitFor();
    ok(await page.locator("section", { has: page.getByRole("heading", { name: "Stamgäster", exact: true }) }).locator(".grid").count() === 0, "tomt läge utan rutor");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { failGuests: true });
    await page.getByText("Kunde inte hämta stamgästerna just nu.").waitFor();
    ok(await page.getByText("Belöningar", { exact: true }).isVisible(), "resten av panelen fungerar utan v11");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { width: 360, height: 800 });
    const sec = page.locator("section", { has: page.getByRole("heading", { name: "Stamgäster", exact: true }) });
    await sec.getByText("128 kunder", { exact: false }).waitFor();
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 360, "stamgäster: ingen sidledsskroll vid 360 px (" + sw + ")");
    const boxes = await sec.locator(".grid > div").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    ok(boxes.length === 3 && boxes[0] < boxes[1] && boxes[1] < boxes[2], "rutorna staplas på mobil");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { lang: "en" });
    const sec = page.locator("section", { has: page.getByRole("heading", { name: "Regulars", exact: true }) });
    await sec.getByText("128 customers visited you in the last 12 months.").waitFor();
    await page.waitForTimeout(900);
    const tiles = await sec.locator(".grid > div").allInnerTexts();
    eq(tiles.map((x) => x.replace(/\s+/g, " ").trim()), ["GOLD 3 from 25 visits", "SILVER 12 from 10 visits", "BRONZE 34 from 3 visits"], "engelska");
    await ctx.close();
  }
  {
    const { ctx, page, state } = await open(browser, { clock: true });
    await page.getByText("128 kunder har besökt er senaste 12 månaderna.").waitFor();
    const n0 = state.calls.filter((c) => c.fn === "merchant_guest_levels").length;
    await page.clock.runFor(61000);
    await page.waitForTimeout(300);
    ok(state.calls.filter((c) => c.fn === "merchant_guest_levels").length > n0, "uppdateras efter 60 s");
    await ctx.close();
  }

  // 12. Insikter, Vinn tillbaka och Månadsrapport (v12)
  const secOf = (page, name) => page.locator("section", { has: page.getByRole("heading", { name, exact: true }) });
  const MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
  const sthlmYM = (k) => { const [y, m] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit" }).format(new Date()).split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 - k, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; };
  {
    const { ctx, page, errors } = await open(browser);
    const ins = secOf(page, "Insikter");
    await ins.getByText("21 av 48 kunder kom mer än en gång").waitFor();
    const order = await page.evaluate(() => [...document.querySelectorAll("section h3")].map((h) => h.textContent));
    const at = (n) => order.indexOf(n);
    ok(at("Insikter") === at("Stamgäster") + 1 && at("Vinn tillbaka") === at("Insikter") + 1 && at("Månadsrapport") === at("Vinn tillbaka") + 1, "ordning: " + order.join(" / "));
    ok(await ins.getByText("Senaste 90 dagarna. Ett besök = en dag med stämpel.").isVisible(), "insikter: förklaring");
    await page.waitForTimeout(900);
    const txt = (await ins.innerText()).replace(/\s+/g, " ");
    ok(/44\s?%/.test(txt), "återkommande 44 %");
    ok(txt.includes("9 dagar"), "typisk tid 9 dagar");
    ok(txt.includes("133") && txt.includes("senaste 90 dagarna"), "besök 133");
    ok(await ins.locator('[title="lördag kl. 10–11: 12 stämplingar"]').count() === 1, "värmekarta: cellens förklaring");
    ok(await ins.locator('[title="måndag kl. 13–14: 0 stämplingar"]').count() === 1, "värmekarta: tom cell finns (timmarna 8–16)");
    ok(txt.includes("Mest besök: lördagar kl. 10–11"), "mest besök");
    for (const tip of ["4 stamgäster har inte kommit på ett tag. Ge dem en dubbelstämpel under Vinn tillbaka.",
                       "2 kunder har fullt kort men har inte löst in. Påminn dem i kassan.",
                       "Tisdagar är er lugnaste dag (4 % av besöken). Prova lugna timmar då – dubbla stämplar lockar fler.",
                       "Ange belöningens värde i kronor under Belöningar, så ser kunderna vad de har sparat."])
      ok(txt.includes(tip), "tips: " + tip.slice(0, 40));

    // Vinn tillbaka
    const wb = secOf(page, "Vinn tillbaka");
    await wb.getByText("Kund #a41f · 14 besök").waitFor();
    const wtxt = (await wb.innerText()).replace(/\s+/g, " ");
    ok(/Brukar komma var 7:e dag · senast för 79 dagar sedan \(\d{1,2} \w+\.?\) · 4\/10 på kortet/.test(wtxt), "rad: vanlig tid, dagar sedan, kortet");
    ok(wtxt.includes("Brukar komma varannan dag"), "varannan dag");
    ok(wtxt.includes("Brukar komma var dag"), "var dag");
    ok(/Dubbelstämpel skickad \d{1,2} \w+/.test(wtxt), "chip: skickad");
    ok(wtxt.includes("Senaste 60 dagarna: 5 fick en dubbelstämpel, 2 har kommit tillbaka."), "utfall 60 dagar");
    const give = wb.getByRole("button", { name: "Ge 3 kunder en dubbelstämpel" });
    const sends = () => state0.calls.filter((c) => c.fn === "merchant_winback").length;
    const state0 = ctx.__state;
    await give.click();
    await wb.getByText("Ge 3 kunder en dubbelstämpel som gäller i 14 dagar?").waitFor();
    await wb.getByRole("button", { name: "Avbryt" }).click();
    ok(await wb.getByText("Ge 3 kunder en dubbelstämpel som gäller i 14 dagar?").count() === 0, "avbryt stänger frågan");
    await give.click();
    await wb.getByRole("button", { name: "Ja, skicka" }).click();
    await wb.getByText(/Klart! 3 kunder fick en dubbelstämpel som gäller t\.o\.m\. \d{1,2} \w+/).waitFor();
    ok(true, "skickat: Klart!");
    await wb.getByText("Alla i listan har redan fått en dubbelstämpel (högst en gång per 60 dagar).").waitFor();
    ok(await wb.getByRole("button", { name: /dubbelstämpel/ }).first().isDisabled(), "knappen avstängd när ingen kan få");
    ok((await wb.innerText()).includes("Senaste 60 dagarna: 8 fick en dubbelstämpel"), "utfallet uppdaterat");

    // Månadsrapport
    const mr = secOf(page, "Månadsrapport");
    await mr.locator("select").waitFor();
    const cur = sthlmYM(0), prev = sthlmYM(1);
    const opts = await mr.locator("select option").allInnerTexts();
    ok(opts[0].includes(MONTHS[cur.m] + " " + cur.y), "månader: " + opts.join(" | "));
    ok(opts.join(" ").includes("pågår"), "innevarande månad: pågår");
    const rtxt = () => mr.innerText().then((x) => x.replace(/\s+/g, " "));
    await page.waitForTimeout(700);
    let r = await rtxt();
    ok(r.includes("Besök") && r.includes("88") && /\+11\s?% mot /.test(r) && r.includes(MONTHS[prev.m]), "besök 88, +11 % mot förra månaden");
    ok(r.includes("12 nya · 29 återkommande"), "nya och återkommande");
    ok(r.includes("+ 7 extra (dubbelstämplar och lugna timmar)"), "extra stämplar");
    ok(/värde 1[\s  ]234 kr/.test(r), "värde med mellanslag: 1 234 kr");
    ok(r.includes("lördagar kl. 10–11"), "mest besök i månaden");
    await mr.locator("select").selectOption({ index: 1 });
    await page.waitForTimeout(700);
    r = await rtxt();
    ok(r.includes("79") && r.includes("9 nya · 27 återkommande"), "byter månad");
    const sent = ctx.__state.calls.filter((c) => c.fn === "merchant_month_report").at(-1).body.p_month;
    eq(sent, `${prev.y}-${String(prev.m + 1).padStart(2, "0")}`, "skickar vald månad");
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await mr.getByRole("button", { name: "Skriv ut / spara som PDF" }).click();
    eq(await page.evaluate(() => window.__printed), 1, "skriv ut");
    await page.emulateMedia({ media: "print" });
    ok(await mr.isVisible() && !(await page.getByRole("heading", { name: "Belöningar", exact: true }).isVisible()), "utskrift: bara rapporten");
    await page.emulateMedia({ media: "screen" });
    eq(errors, [], "inga sidfel (insikter)");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { insights: { customers_90d: 0, repeat_90d: 0, repeat_rate: null, visits_90d: 0, median_gap_days: null, gap_pairs: 0, heatmap: [], busiest: null, stamps_90d: 0, lapsed_count: 0, tips: [] },
      lapsed: { count: 0, eligible: 0, stamps_needed: 10, sent_60d: 0, returned_60d: 0, customers: [] } });
    const ins = secOf(page, "Insikter");
    await ins.getByText("Inga besök än").waitFor();
    await ins.getByText("Inga tips just nu – det ser bra ut.").waitFor();
    const t = (await ins.innerText()).replace(/\s+/g, " ");
    ok(t.includes("För lite data än") && t.includes("Inga tips just nu – det ser bra ut.") && !t.includes("Mest besök"), "tomt läge: insikter");
    await secOf(page, "Vinn tillbaka").getByText("Ingen stamgäst har slutat komma just nu.").waitFor();
    ok(!(await secOf(page, "Vinn tillbaka").innerText()).includes("Senaste 60 dagarna"), "tomt läge: vinn tillbaka");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { failInsights: true, failLapsed: true });
    await page.getByText("Belöningar", { exact: true }).waitFor();
    await page.waitForTimeout(1200);
    ok(await secOf(page, "Insikter").isVisible() && await secOf(page, "Vinn tillbaka").isVisible(), "fel: sektionerna finns kvar");
    ok(await page.getByText("21 av 48").count() === 0, "fel: inga påhittade siffror");
    ok(await secOf(page, "Månadsrapport").locator("select").isVisible(), "fel i insikter stoppar inte rapporten");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { failWinback: true });
    const wb = secOf(page, "Vinn tillbaka");
    await wb.getByRole("button", { name: "Ge 3 kunder en dubbelstämpel" }).click();
    await wb.getByRole("button", { name: "Ja, skicka" }).click();
    await wb.getByText("Kunde inte skicka just nu. Försök igen.").waitFor();
    ok(true, "fel vid utskick visas");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { width: 360, height: 800 });
    await secOf(page, "Insikter").getByText("21 av 48", { exact: false }).waitFor();
    await secOf(page, "Vinn tillbaka").getByText("Kund #a41f · 14 besök").waitFor();
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 360, "insikter: ingen sidledsskroll vid 360 px (" + sw + ")");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { lang: "en" });
    const ins = secOf(page, "Insights");
    await ins.getByText("21 of 48 customers came more than once").waitFor();
    const t = (await ins.innerText()).replace(/\s+/g, " ");
    ok(t.includes("Busiest: Saturdays 10:00–11:00") && t.includes("Tuesdays are your quietest day (4% of visits)."), "engelska: insikter");
    await secOf(page, "Win back").getByRole("button", { name: "Give 3 customers a double stamp" }).waitFor();
    ok(true, "engelska: vinn tillbaka");
    await secOf(page, "Monthly report").locator("select").waitFor();
    ok(true, "engelska: månadsrapport");
    await ctx.close();
  }

  await browser.close();
  console.log("Panel OK:", passed, "kontroller");
})().catch((e) => { console.error("FEL:", e.message); process.exit(1); });
