// Spelar in sektionen "Lugna timmar" i butikspanelen (iPad stående, 2x) med fejkade RPC-svar.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { mock } = require("./mock.cjs");
const OUT = process.argv[2] || "vid";
const W = 768, H = 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "f"), { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    localStorage.setItem("tappass.merchant.session.v2", JSON.stringify({ token: "demo", cafeName: "Miyabi", loginName: "miyabi" }));
    // Synlig "fingertopp" (headless ritar ingen muspekare)
    addEventListener("DOMContentLoaded", () => {
      const c = document.createElement("div");
      c.id = "fake-cursor";
      Object.assign(c.style, { position: "fixed", left: "0px", top: "0px", width: "26px", height: "26px", marginLeft: "-13px", marginTop: "-13px",
        borderRadius: "50%", background: "rgba(34,26,17,0.28)", border: "2px solid rgba(255,255,255,0.9)", boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        zIndex: 9999, pointerEvents: "none", transition: "left 420ms cubic-bezier(.22,.61,.36,1), top 420ms cubic-bezier(.22,.61,.36,1), transform 120ms ease", opacity: "0" });
      document.body.appendChild(c);
    });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const state = await mock(page, {});
  const client = await ctx.newCDPSession(page);
  const frames = [];
  client.on("Page.screencastFrame", async (f) => {
    frames.push({ data: f.data, ts: f.metadata.timestamp });
    try { await client.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {}
  });
  await page.goto("http://127.0.0.1:5174/?lang=sv");
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Lugna timmar", exact: true }) });
  await section.getByText("Nu: mån–fre 14–16", { exact: true }).waitFor();
  await page.waitForTimeout(700);
  await client.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 });
  const t0 = Date.now();
  const mark = {};

  const scrollTo = (y, ms) => page.evaluate(({ y, ms }) => new Promise((done) => {
    const from = scrollY, start = performance.now();
    const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
    const step = (now) => { const k = Math.min(1, (now - start) / ms); scrollTo(0, from + (y - from) * ease(k)); if (k < 1) requestAnimationFrame(step); else done(); };
    requestAnimationFrame(step);
  }), { y, ms });
  const topOf = (loc, offset = 84) => loc.evaluate((el, off) => el.getBoundingClientRect().top + scrollY - off, offset);
  const point = async (loc) => {
    const b = await loc.boundingBox();
    await page.evaluate(({ x, y }) => { const c = document.getElementById("fake-cursor"); c.style.opacity = "1"; c.style.left = x + "px"; c.style.top = y + "px"; }, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
    await sleep(460);
  };
  const tap = async (loc, after = 260) => {
    await point(loc);
    await page.evaluate(() => { document.getElementById("fake-cursor").style.transform = "scale(0.78)"; });
    await loc.click();
    await sleep(110);
    await page.evaluate(() => { document.getElementById("fake-cursor").style.transform = "scale(1)"; });
    await sleep(after);
  };

  await sleep(1300);                                                      // panelen överst
  await scrollTo(await topOf(section.getByRole("heading", { name: "Lugna timmar" })), 1400);
  await sleep(2600);                                                      // status, schema, period 1
  mark.edit = (Date.now() - t0) / 1000;
  await tap(section.getByRole("button", { name: "+ Lägg till period" }), 500);
  await scrollTo(await topOf(section.getByText("Period 2", { exact: true }), 150), 900);
  await sleep(500);
  const chips = section.locator("button[aria-pressed]");
  for (let i = 7; i <= 11; i++) await tap(chips.nth(i), 60);
  await tap(chips.nth(12), 60);
  await tap(chips.nth(13), 400);
  const selects = section.locator("select");
  await point(selects.nth(2)); await selects.nth(2).focus(); await sleep(250);
  await selects.nth(2).selectOption("09:00"); await sleep(600);
  await point(selects.nth(3)); await selects.nth(3).focus(); await sleep(250);
  await selects.nth(3).selectOption("11:00"); await sleep(700);
  const save = section.getByRole("button", { name: "Spara lugna timmar" });
  await scrollTo(await topOf(save, 560), 700);
  await sleep(500);
  mark.save = (Date.now() - t0) / 1000;
  await tap(save, 300);
  await section.getByText("Sparat. Gäller från nästa stämpling.").waitFor();
  await page.evaluate(() => { document.getElementById("fake-cursor").style.opacity = "0"; });
  await sleep(1300);
  await scrollTo(await topOf(section.getByText("Besök under lugna timmar, 30 dagar"), 470), 1000);
  await sleep(1900);                                                      // besök under lugna timmar
  mark.summary = (Date.now() - t0) / 1000;
  await scrollTo(await topOf(section.getByRole("heading", { name: "Lugna timmar" })), 1200);
  await sleep(3000);                                                      // nytt schema i klartext
  await client.send("Page.stopScreencast");
  const total = (Date.now() - t0) / 1000;
  await ctx.close(); await browser.close();

  frames.sort((a, b) => a.ts - b.ts);
  let list = "";
  frames.forEach((f, i) => {
    const file = `f${String(i).padStart(5, "0")}.jpg`;
    fs.writeFileSync(path.join(OUT, "f", file), Buffer.from(f.data, "base64"));
    const next = i + 1 < frames.length ? frames[i + 1].ts : Math.max(f.ts + 0.04, frames[0].ts + total);
    list += `file '${file}'\nduration ${Math.max(0.001, next - f.ts).toFixed(4)}\n`;
  });
  list += `file 'f${String(frames.length - 1).padStart(5, "0")}.jpg'\n`;
  fs.writeFileSync(path.join(OUT, "f", "list.txt"), list);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-vf", "fps=30,scale=900:-2:flags=lanczos,format=yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", path.resolve(OUT, "raw.mp4")], { cwd: path.join(OUT, "f") });
  fs.writeFileSync(path.join(OUT, "marks.json"), JSON.stringify({ ...mark, total }));
  const calls = state.calls.filter((c) => c.fn === "merchant_set_quiet_hours").map((c) => JSON.stringify(c.body.p_hours));
  console.log(frames.length, "rutor,", total.toFixed(1), "s; markeringar", JSON.stringify(mark), "\nsparat:", calls.join(" | "), "\n", errors.length ? "FEL: " + errors.join("; ") : "inga sidfel");
})().catch((e) => { console.error(e); process.exit(1); });
