const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await p.goto("file://" + __dirname + "/tag-composite.html");
  await p.waitForTimeout(600);
  const wraps = await p.evaluate(() => [...document.querySelectorAll(".chip, .cap")].filter((e) => e.getClientRects().length > 1).map((e) => e.textContent));
  console.log(wraps.length ? "bryts: " + wraps.join(" | ") : "inga radbrytningar i chips/rubriker");
  await p.screenshot({ path: "shots/16-taggverktyget.png", fullPage: true });
  await b.close();
})();
