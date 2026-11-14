// Som rec2.js men med handlingar under inspelningen:
//   node rec3.js <utkatalog> '<namn>=<sökväg>@<sek>|click:<text>@<t>|scroll:<dy>:<ms>@<t>' ...
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const OUT = process.argv[2];
const clips = process.argv.slice(3).map((arg) => {
  const [head, ...acts] = arg.split("|");
  const eq = head.indexOf("="), at = head.lastIndexOf("@");
  return {
    name: head.slice(0, eq), url: head.slice(eq + 1, at), secs: Number(head.slice(at + 1)),
    acts: acts.map((a) => { const i = a.lastIndexOf("@"); const [kind, ...rest] = a.slice(0, i).split(":"); return { kind, args: rest, t: Number(a.slice(i + 1)) }; }),
  };
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  for (const c of clips) {
    const ctx = await browser.newContext({ viewport: { width: 780, height: 1688 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => {
      localStorage.setItem("tappass.onboarded", "1"); localStorage.setItem("tappass.wheel.city", "Stockholm");
      // ?now=2026-12-13T09:00 flyttar klockan (tiden fortsätter gå) — för säsongsdetaljer
      const want = new URLSearchParams(location.search).get("now");
      if (want) {
        const Real = Date, off = new Real(want).getTime() - Real.now();
        class Shifted extends Real {
          constructor(...a) { if (a.length === 0) super(Real.now() + off); else super(...a); }
          static now() { return Real.now() + off; }
        }
        Shifted.parse = Real.parse; Shifted.UTC = Real.UTC;
        window.Date = Shifted;
      }
      const vv = window.visualViewport;
      if (vv) { Object.defineProperty(vv, "width", { get: () => 390 }); Object.defineProperty(vv, "height", { get: () => 844 }); }
      const zoom = () => { if (document.documentElement) document.documentElement.style.zoom = "2"; };
      zoom(); document.addEventListener("DOMContentLoaded", zoom);
    });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(c.name + ": " + e.message));
    p.on("console", (m) => { if (m.type() === "error" && !/vibrate/.test(m.text())) errors.push(c.name + " console: " + m.text().slice(0, 160)); });
    const client = await ctx.newCDPSession(p);
    const frames = [];
    client.on("Page.screencastFrame", async (f) => {
      frames.push({ data: f.data, ts: f.metadata.timestamp });
      try { await client.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {}
    });
    await p.goto("http://localhost:8099" + c.url);
    await client.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
    const t0 = Date.now() / 1000;
    const run = async (a) => {
      try {
        if (a.kind === "click") await p.getByText(a.args.join(":"), { exact: true }).first().click({ timeout: 3000 });
        if (a.kind === "clicklast") await p.getByText(a.args.join(":"), { exact: true }).last().click({ timeout: 3000 });
        if (a.kind === "eval") { const r = await p.evaluate(a.args.join(":")); if (r === false) errors.push(c.name + " eval gav false: " + a.args.join(":")); }
        if (a.kind === "scroll") {
          await p.evaluate(({ dy, ms }) => new Promise((done) => {
            const el = [...document.querySelectorAll("div")].filter((d) => /(auto|scroll)/.test(getComputedStyle(d).overflowY) && d.scrollHeight > d.clientHeight + 4)
              .sort((x, y) => y.clientHeight - x.clientHeight)[0];
            if (!el) return done();
            const from = el.scrollTop, start = performance.now();
            const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
            const step = (now) => {
              const k = Math.min(1, (now - start) / ms);
              el.scrollTop = from + dy * ease(k);
              if (k < 1) requestAnimationFrame(step); else done();
            };
            requestAnimationFrame(step);
          }), { dy: Number(a.args[0]), ms: Number(a.args[1]) });
        }
      } catch (e) { errors.push(c.name + " " + a.kind + ": " + e.message.split("\n")[0]); }
    };
    await Promise.all([p.waitForTimeout(c.secs * 1000), ...c.acts.map((a) => sleep(a.t * 1000).then(() => run(a)))]);
    await client.send("Page.stopScreencast");
    const tEnd = Date.now() / 1000;
    await ctx.close();

    const dir = path.join(OUT, c.name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir);
    frames.sort((a, b) => a.ts - b.ts);
    let list = "";
    frames.forEach((f, i) => {
      const file = `f${String(i).padStart(5, "0")}.jpg`;
      fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, "base64"));
      const next = i + 1 < frames.length ? frames[i + 1].ts : Math.max(f.ts + 0.04, frames[0].ts + (tEnd - t0));
      list += `file '${file}'\nduration ${Math.max(0.001, next - f.ts).toFixed(4)}\n`;
    });
    if (frames.length) list += `file 'f${String(frames.length - 1).padStart(5, "0")}.jpg'\n`;
    fs.writeFileSync(path.join(dir, "list.txt"), list);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "list.txt", "-vf", "fps=30,format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", path.resolve(OUT, c.name + ".mp4")], { cwd: dir });
    console.log(c.name, frames.length, "rutor,", (frames.length ? (frames[frames.length - 1].ts - frames[0].ts).toFixed(1) : 0) + " s");
  }
  await browser.close();
  console.log(errors.length ? "FEL:\n" + errors.join("\n") : "inga sidfel");
})().catch((e) => { console.error(e); process.exit(1); });
