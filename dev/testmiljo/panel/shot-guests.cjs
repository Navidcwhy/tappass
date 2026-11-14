const { chromium } = require("playwright");
const { mock } = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem("tappass.merchant.session.v2", JSON.stringify({ token: "demo", cafeName: "Café Linnea", loginName: "linnea" })));
  const p = await ctx.newPage();
  await mock(p, {});
  await p.goto("http://127.0.0.1:5174/?lang=sv");
  const sec = p.locator("section", { has: p.getByRole("heading", { name: "Stamgäster", exact: true }) });
  await sec.getByText("128 kunder", { exact: false }).waitFor();
  await p.addStyleTag({ content: "header{position:static!important}" });
  await p.waitForTimeout(1200);
  await sec.screenshot({ path: "vid/guests.png" });
  await b.close();
})();
