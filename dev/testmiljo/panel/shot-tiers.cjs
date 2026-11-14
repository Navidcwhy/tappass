const { chromium } = require("playwright");
const { mock } = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 760, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem("tappass.merchant.session.v2", JSON.stringify({ token: "demo", cafeName: "Café Linnea", loginName: "linnea" })));
  const p = await ctx.newPage();
  await mock(p, { tiers: [{ at: 3, text: "Kanelbulle" }, { at: 5, text: "Valfri kaka" }] });
  await p.goto("http://127.0.0.1:5174/?lang=sv");
  await p.getByText("En kaffe på huset").waitFor();
  await p.addStyleTag({ content: "header{position:static!important}" });
  await p.waitForTimeout(900);
  const sec = p.locator("section", { has: p.getByRole("heading", { name: "Belöningar", exact: true }) });
  await sec.screenshot({ path: "vid/tiers.png" });
  await b.close();
})();
