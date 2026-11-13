const { chromium } = require("playwright");
const { mock } = require("./mock.cjs");
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => localStorage.setItem("tappass.merchant.session.v2", JSON.stringify({ token: "demo", cafeName: "Miyabi", loginName: "miyabi" })));
  const p = await ctx.newPage();
  await mock(p, { quiet: [{ days: [1, 2, 3, 4, 5], from: "14:00", to: "16:00" }, { days: [6, 7], from: "09:30", to: "11:00" }] });
  await p.goto("http://127.0.0.1:5174/?lang=sv");
  const s = p.locator("section", { has: p.getByRole("heading", { name: "Lugna timmar", exact: true }) });
  await s.getByText("Period 2", { exact: true }).waitFor();
  await p.waitForTimeout(900);
  await s.screenshot({ path: "vid/mobile.png" });
  await b.close();
})();
