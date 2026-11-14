// Dynamiska taggar (v17) i webbförhandsvisningen: äkta läsning, förfalskad länk, länk utan e/c.
const { chromium } = require("playwright");
const E1 = "4f0b9c27e54b1d8a7f3e2c6b9d0a1e57", C1 = "8a1de54b2c7f9e03";
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    for (const k of ["tappass.onboarded", "tappass.firstStamp", "tappass.accountHint", "tappass.inviteHint"]) localStorage.setItem(k, "1");
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/vibrate/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await p.goto("http://localhost:8099/?s=sdm&d=250");
  await p.getByText("Dina kort").waitFor({ timeout: 15000 });
  await p.waitForTimeout(1200);
  const tag = (v) => p.evaluate((x) => window.__tappassTag && window.__tappassTag(x), v);

  // 1. Äkta läsning från den dynamiska taggen
  await tag("https://tappass.se/t/miyabi-01?e=" + E1.toUpperCase() + "&c=" + C1.toUpperCase());
  await p.getByText("+1").first().waitFor({ timeout: 8000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: "shots/sdm-1.png" });
  await p.waitForTimeout(5200);   // arket stänger sig och spärren för samma token (5 s) släpper

  // 2. Påhittad länk (fel kontrollsumma)
  await tag("https://tappass.se/t/miyabi-01?e=9c27e54b1d8a7f3e2c6b9d0a1e574f0b&c=0000000000000000");
  await p.getByText("Stämpeln kunde inte kontrolleras").waitFor({ timeout: 8000 });
  await p.waitForTimeout(700);
  await p.screenshot({ path: "shots/sdm-2.png" });
  await p.waitForTimeout(5200);

  // 3. Länk utan e/c till en tagg som bara godtar dynamiska läsningar
  await tag("miyabi-01");
  await p.getByText("Läs av stämpeln i kassan").waitFor({ timeout: 8000 });
  await p.waitForTimeout(700);
  await p.screenshot({ path: "shots/sdm-3.png" });
  await p.waitForTimeout(5200);

  // 4. Samma äkta länk igen (kopia): inget händer, kortet visar fortfarande 4
  await tag("https://tappass.se/t/miyabi-01?e=" + E1 + "&c=" + C1);
  await p.waitForTimeout(1500);
  const t = await p.evaluate(() => document.body.innerText);
  console.log("kopian:", /kunde inte kontrolleras|Läs av stämpeln|Ingen anslutning|\+1/.test(t) ? "BESKED SYNS (fel)" : "tyst (rätt)");
  await p.screenshot({ path: "shots/sdm-4.png" });
  console.log(errs.length ? errs.join("\n") : "inga sidfel");
  await b.close();
})();
