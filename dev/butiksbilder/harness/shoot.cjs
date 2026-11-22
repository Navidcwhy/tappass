// Tar appens skärmbilder (riktiga appen i webbläsaren, påhittad data).
// node shoot.cjs [ios|android] [scen ...]
const fs = require("fs");
const { openApp, stopServer, sleep, tapText, waitText } = require("./lib.cjs");

const OS = process.argv[2] || "ios";
const ONLY = process.argv.slice(3);
const SIZE = OS === "ios" ? { width: 393, height: 852 } : { width: 412, height: 915 };
const OUT = "out/raw";
fs.mkdirSync(OUT, { recursive: true });

const shot = (page, name) => page.screenshot({ path: `${OUT}/${OS}-${name}.png` });
const nfc = (page, token) => page.evaluate((t) => window.__nfcTap("https://tappass.se/t/" + t), token);

async function startScan(page) {
  if (OS === "ios") { await tapText(page, "Skanna stämpel"); await sleep(400); }
}

const SCENES = {
  async home(page) {
    await waitText(page, "Bageri Glöd");
    await sleep(3500);
    await shot(page, "home");
  },
  async stamp(page) {
    await waitText(page, "Café Blåklint");
    await sleep(1500);
    await startScan(page);
    await nfc(page, "cafe-blaklint-k7");
    const t0 = Date.now();
    for (const t of [700, 1800, 3000]) {
      await sleep(Math.max(0, t - (Date.now() - t0)));
      await shot(page, `stamp-${t}`);
    }
  },
  async wheel(page) {
    await waitText(page, "Bageri Glöd");
    await sleep(800);
    await tapText(page, "Hjul", { exact: true });
    await waitText(page, "Snurra", { exact: true });
    await sleep(1200);
    await shot(page, "wheel-idle");
    await tapText(page, "Snurra", { exact: true });
    const t0 = Date.now();
    for (const t of [1500, 3500, 5000, 6000, 7000, 8500, 10000]) {
      await sleep(Math.max(0, t - (Date.now() - t0)));
      await shot(page, `wheel-${t}`);
    }
  },
  async celebrate(page) {
    await waitText(page, "Lunchkompaniet");
    await sleep(1200);
    await startScan(page);
    await nfc(page, "lunchkompaniet-m4");
    const t0 = Date.now();
    for (const t of [1700, 2300, 3000, 3800, 4600, 5400, 6200]) {
      await sleep(Math.max(0, t - (Date.now() - t0)));
      await shot(page, `celebrate-${t}`);
    }
  },
  async redeem(page) {
    await waitText(page, "Bageri Glöd");
    await sleep(1200);
    await tapText(page, "Lös in", { exact: true });
    await sleep(1200);
    await shot(page, "redeem-sheet");
    // arket har en egen "Lös in"-knapp
    const btns = page.getByText("Lös in", { exact: true });
    const n = await btns.count();
    await btns.nth(n - 1).click();
    await sleep(1600);
    await shot(page, "redeem-tap");
    if (OS === "ios") {
      const scan = page.getByText(/Skanna|Håll iPhonen|Starta/).first();
      if (await scan.isVisible().catch(() => false)) { await scan.click().catch(() => {}); await sleep(400); }
    }
    await nfc(page, "bageri-glod-p2");
    const t0 = Date.now();
    for (const t of [900, 1600, 2400, 3200]) {
      await sleep(Math.max(0, t - (Date.now() - t0)));
      await shot(page, `redeem-done-${t}`);
    }
  },
  async places(page) {
    await waitText(page, "Bageri Glöd");
    await sleep(800);
    await tapText(page, "Ställen", { exact: true });
    await sleep(1800);
    await shot(page, "places");
    await tapText(page, "Café Blåklint", { exact: true });
    await sleep(1600);
    await shot(page, "place");
  },
};

(async () => {
  const names = ONLY.length ? ONLY : Object.keys(SCENES);
  for (const name of names) {
    const { browser, page, errors } = await openApp({ os: OS, size: SIZE, scale: 3 });
    try {
      await SCENES[name](page);
      console.log("ok", OS, name, errors.length ? "fel: " + errors.slice(0, 3).join(" | ") : "");
    } catch (e) {
      console.log("MISSLYCKADES", OS, name, String(e.message || e).split("\n")[0]);
      await shot(page, `${name}-FEL`).catch(() => {});
    }
    await browser.close();
  }
  stopServer();
})();
