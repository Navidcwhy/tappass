// Gemensamt för skärmbilder och video: server, Supabase-attrapp, klocka och hjälpfunktioner.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { freshState, makeHandler, cafesList } = require("./demo.cjs");

// Webbygget från setup-app.sh (APP_DIST pekar någon annanstans om kopian ligger på annan plats)
const DIST = process.env.APP_DIST || path.resolve(__dirname, "../../../../tappass-butiksbilder-app/dist");
const SUPABASE = "https://yaizagzyjfxvbqpknlsj.supabase.co";
// Tisdag 24 november 2026 kl. 09.41 svensk tid (ingen säsongsdetalj det datumet)
const START = new Date("2026-11-24T09:41:00+01:00");

let server = null;
function startServer(port = 8091) {
  if (server) return Promise.resolve(port);
  const types = { ".html": "text/html", ".js": "application/javascript", ".ttf": "font/ttf", ".json": "application/json", ".png": "image/png" };
  server = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split("?")[0]);
    let f = path.join(DIST, p);
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(port)));
}
function stopServer() { if (server) { server.close(); server = null; } }

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-expose-headers": "*",
};

// os: "ios" | "android". size: { width, height } i punkter. Returnerar { browser, context, page, state }.
// Telefonens statusrad och hemindikator ritas ovanpå appen (som på en riktig telefon).
const GROTESK = "data:font/woff2;base64," + fs.readFileSync(path.join(__dirname, "node_modules/@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-600-normal.woff2")).toString("base64");
const INSETS = { ios: { top: 59, bottom: 34 }, android: { top: 32, bottom: 24 } };
function chromeOverlay(os) {
  const ios = os === "ios";
  return `
  <style>@font-face{font-family:SbFont;font-weight:600;src:url(${GROTESK}) format("woff2");}
  #__sb{position:fixed;left:0;right:0;top:0;height:${ios ? 54 : 32}px;z-index:2147483647;pointer-events:none;font-family:SbFont,sans-serif;color:#111;}
  #__sb .t{position:absolute;top:${ios ? 18 : 7}px;left:${ios ? 51 : 22}px;font-size:${ios ? 17 : 14}px;font-weight:600;letter-spacing:-.01em}
  #__sb .i{position:absolute;top:${ios ? 21 : 9}px;right:${ios ? 30 : 18}px;display:flex;gap:${ios ? 6 : 5}px;align-items:center}
  #__sb .island{position:absolute;left:50%;top:11px;width:125px;height:37px;margin-left:-62.5px;border-radius:19px;background:#000}
  #__sb .cam{position:absolute;left:50%;top:8px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:#000}
  #__home{position:fixed;left:50%;bottom:${ios ? 8 : 9}px;width:${ios ? 134 : 108}px;height:${ios ? 5 : 4}px;margin-left:${ios ? -67 : -54}px;border-radius:3px;background:#111;z-index:2147483647;pointer-events:none;opacity:.9}
  </style>
  <div id="__sb"><span class="t">9:41</span>${ios ? '<span class="island"></span>' : '<span class="cam"></span>'}
   <span class="i">${ios
     ? '<svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 11.5 10.6 8.6a3.6 3.6 0 0 0-5.2 0L8 11.5Zm-4.5-4.6a6.4 6.4 0 0 1 9 0l1.5-1.6a8.6 8.6 0 0 0-12 0l1.5 1.6ZM.6 3.9a10.6 10.6 0 0 1 14.8 0L16 3.3a12 12 0 0 0-16 0l.6.6Z"/></svg><svg width="27" height="13" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="#111" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2"/><rect x="24.6" y="4.3" width="1.6" height="4.4" rx=".8" opacity=".4"/></svg>'
     : '<svg width="15" height="12" viewBox="0 0 16 12"><path d="M8 12 0 3.4a11.7 11.7 0 0 1 16 0L8 12Z"/></svg><svg width="12" height="12" viewBox="0 0 12 12"><path d="M12 0v12H0L12 0Z"/></svg><svg width="8" height="13" viewBox="0 0 8 13"><rect x="0" y="1.5" width="8" height="11.5" rx="1.4"/><rect x="2.5" y="0" width="3" height="2" rx=".6"/></svg>'}</span></div>
  <div id="__home"></div>`;
}

async function openApp({ os = "ios", size, scale = 3, path: urlPath = "/", video = null, prefs = {}, mutate, chrome = true } = {}) {
  const port = await startServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: size, deviceScaleFactor: scale, locale: "sv-SE", timezoneId: "Europe/Stockholm",
    hasTouch: true, isMobile: true, colorScheme: "light",
    ...(video ? { recordVideo: { dir: video.dir, size: video.size } } : {}),
  });
  const state = freshState(START.getTime());
  if (mutate) mutate(state);
  const handle = makeHandler(state);
  const calls = [];
  await context.route(SUPABASE + "/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    let body = null;
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.split("/").pop();
      let args = {};
      try { args = JSON.parse(req.postData() || "{}"); } catch {}
      calls.push(fn);
      body = handle(fn, args);
    } else if (url.pathname === "/rest/v1/cafes") {
      calls.push("cafes");
      body = cafesList();
    } else {
      calls.push("?" + url.pathname);
      body = {};
    }
    return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
  });
  const allPrefs = {
    "tappass.onboarded": "1", "tappass.firstStamp": "1", "tappass.wheel.city": "Stockholm",
    "tappass.inviteHint": "1", "tappass.accountHint": "1", ...prefs,
  };
  await context.addInitScript((p) => {
    try { for (const [k, v] of Object.entries(p)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } } catch {}
  }, allPrefs);
  if (chrome) {
    await context.addInitScript((html) => {
      const add = () => { if (document.getElementById("__sb")) return; const d = document.createElement("div"); d.innerHTML = html; document.body.appendChild(d); };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
    }, chromeOverlay(os));
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.install({ time: START });
  await page.clock.resume();
  const ins = INSETS[os];
  await page.goto(`http://localhost:${port}${urlPath}?os=${os}&top=${chrome ? ins.top : 0}&bottom=${chrome ? ins.bottom : 0}`);
  return { browser, context, page, state, calls, errors };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Klicka på första synliga text (exakt eller delvis)
async function tapText(page, text, { exact = false, timeout = 8000 } = {}) {
  const loc = page.getByText(text, { exact }).first();
  await loc.waitFor({ state: "visible", timeout });
  await loc.click();
}

async function waitText(page, text, { exact = false, timeout = 10000 } = {}) {
  await page.getByText(text, { exact }).first().waitFor({ state: "visible", timeout });
}

module.exports = { openApp, startServer, stopServer, sleep, tapText, waitText, START };
