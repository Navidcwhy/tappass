const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
  await p.goto("file://" + __dirname + "/sdm-composite.html");
  await p.waitForTimeout(500);
  // Inga rader som bryts: kontrollera att koden i raderna får plats på en rad
  const wraps = await p.evaluate(() => [...document.querySelectorAll(".row code, .pill, .cap")].filter((e) => e.getClientRects().length > 1 || e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  console.log(wraps.length ? "bryts: " + wraps.join(" | ") : "inga radbrytningar");
  await p.screenshot({ path: "shots/15-dynamiska-taggar.png", fullPage: true });
  await b.close();
})();
