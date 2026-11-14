const { chromium } = require("playwright");
const fs = require("fs");
const { mock } = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem("tappass.merchant.session.v2", JSON.stringify({ token: "demo", cafeName: "Café Linnea", loginName: "linnea" })));
  const p = await ctx.newPage();
  const logo = fs.readFileSync("fixture-logo.png").toString("base64");
  await mock(p, { profile: { name: "Café Linnea", slug: "linnea", city: "Stockholm", stamps_needed: 10, type: "Kafé", area: "Vasastan",
    reward_text: "En kaffe på huset", reward_short: "Gratis kaffe", ink_color: "#7A4A26", address: "Upplandsgatan 9, 113 23 Stockholm",
    description: "Surdeg, kardemummabullar och kaffe från lokala rosterier sedan 2012.", website: "https://cafelinnea.se", instagram: "cafe.linnea",
    opening_hours: [{ days: [1, 2, 3, 4, 5], from: "07:00", to: "18:00" }, { days: [6, 7], from: "09:00", to: "16:00" }],
    logo_version: 1, logo: { mime: "image/png", data: logo }, updated_at: null } });
  await p.goto("http://127.0.0.1:5174/?lang=sv");
  const sec = p.locator("section", { has: p.getByRole("heading", { name: "Profil", exact: true }) });
  await sec.getByText("Café Linnea · Stockholm", { exact: false }).waitFor();
  await p.addStyleTag({ content: "header{position:static!important}" });
  await p.waitForTimeout(1200);
  await sec.screenshot({ path: "vid/profil.png" });
  await b.close();
})();
