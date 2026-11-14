const { chromium } = require("playwright");
const { mock } = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 760, height: 1000 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem("tappass.merchant.session.v2", JSON.stringify({ token: "demo", cafeName: "Miyabi", loginName: "miyabi" })));
  const p = await ctx.newPage();
  await mock(p, {});
  await p.goto("http://127.0.0.1:5174/?lang=sv");
  await p.getByText("Kund #e9b4").waitFor();
  await p.addStyleTag({ content: "header{position:static!important}" });
  await p.waitForTimeout(1200);
  const redeem = p.locator("section").first();
  await redeem.screenshot({ path: "vid/redeem.png" });
  const rec = p.locator("section", { has: p.getByRole("heading", { name: "Senast inlösta", exact: true }) });
  await rec.screenshot({ path: "vid/recent.png" });
  await b.close();
})();
