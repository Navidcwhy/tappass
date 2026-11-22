// Spelar in förhandsvideon: riktiga appen i webbläsaren, påhittad data.
// node video.cjs [ios|android]  → out/video/<os>-raw.webm + tider i out/video/<os>-marks.json
const fs = require("fs");
const path = require("path");
const { openApp, stopServer, sleep, tapText, waitText } = require("./lib.cjs");

const OS = process.argv[2] || "ios";
const DIR = path.join(__dirname, "out/video");
fs.mkdirSync(DIR, { recursive: true });
// 6,9 tum ≈ 440×956 pt; videon blir 886×1920 (ios) eller 1080×1920 (android, för YouTube)
const SIZE = OS === "ios" ? { width: 443, height: 960 } : { width: 432, height: 768 };
const VIDEO = OS === "ios" ? { width: 886, height: 1920 } : { width: 1080, height: 1920 };

(async () => {
  const t0 = Date.now();
  const { browser, context, page, errors } = await openApp({
    os: OS, size: OS === "ios" ? SIZE : { width: 432, height: 768 }, scale: OS === "ios" ? 2 : 2.5,
  });
  const FR = path.join(DIR, `${OS}-frames`);
  fs.rmSync(FR, { recursive: true, force: true });
  fs.mkdirSync(FR, { recursive: true });
  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const f = path.join(FR, `f${String(frames.length).padStart(6, "0")}.jpg`);
    fs.writeFileSync(f, Buffer.from(data, "base64"));
    frames.push({ f, t: metadata.timestamp });
    try { await cdp.send("Page.screencastFrameAck", { sessionId }); } catch {}
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VIDEO.width, maxHeight: VIDEO.height, everyNthFrame: 1 });
  const nfc = (token) => page.evaluate((t) => window.__nfcTap("https://tappass.se/t/" + t), token);
  const marks = {};
  await waitText(page, "Bageri Glöd");
  await sleep(1200);
  marks.start = Date.now() / 1000;

  // 1. Korten
  await sleep(2600);

  // 2. Stämpla hos Café Blåklint (dubbelstämpel + ny nivå)
  if (OS === "ios") { await tapText(page, "Skanna stämpel"); await sleep(700); }
  await nfc("cafe-blaklint-k7");
  await sleep(4200);
  await tapText(page, "Klart", { exact: true });
  await sleep(900);

  // 3. Dagens hjul
  await tapText(page, "Hjul", { exact: true });
  await waitText(page, "Snurra", { exact: true });
  await sleep(900);
  await tapText(page, "Snurra", { exact: true });
  await waitText(page, "Använd hos", { timeout: 15000 });
  await sleep(1600);
  await tapText(page, "Använd hos");
  await sleep(1100);

  // 4. Lös in med butikens stämpel
  await tapText(page, "Kort", { exact: true });
  await sleep(1000);
  await tapText(page, "Lös in", { exact: true });
  await sleep(1000);
  const btns = page.getByText("Lös in", { exact: true });
  await btns.nth((await btns.count()) - 1).click();
  await sleep(1700);
  await nfc("bageri-glod-p2");
  await sleep(3200);
  marks.end = Date.now() / 1000;

  await cdp.send("Page.stopScreencast");
  await sleep(300);
  fs.writeFileSync(path.join(DIR, `${OS}-marks.json`), JSON.stringify({ ...marks, frames }));
  await context.close();
  await browser.close();
  stopServer();
  console.log(OS, "inspelad", frames.length, "bildrutor", (marks.end - marks.start).toFixed(1) + " s", errors.length ? "fel: " + errors.slice(0, 3).join(" | ") : "");
})().catch((e) => { console.error(e); process.exit(1); });
