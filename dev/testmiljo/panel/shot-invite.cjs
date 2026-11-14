const { chromium } = require("playwright");
const { mock } = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem("tappass.merchant.session.v2", JSON.stringify({ token: "demo", cafeName: "Café Linnea", loginName: "linnea" })));
  const p = await ctx.newPage();
  await mock(p, { campaign: { bonus_stamps_30d: 21, bonus_stamps_total: 48 }, invite: { friends_30d: 4, friends_total: 11, stamps_30d: 16 } });
  await p.goto("http://127.0.0.1:5174/?lang=sv");
  const sec = p.locator("section", { has: p.getByRole("heading", { name: "Kampanjstämplar", exact: true }) });
  await sec.getByText("Nya kunder via inbjudan · 30 dagar").waitFor();
  await p.addStyleTag({ content: "header{position:static!important}" });
  await p.waitForTimeout(1400);
  await sec.screenshot({ path: "vid/invite.png" });
  await b.close();
})();
