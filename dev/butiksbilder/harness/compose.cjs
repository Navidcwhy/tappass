// Bygger butiksbilderna: rubrik i varumärkets typsnitt + telefon med appens riktiga skärmbild.
// node compose.cjs  → out/appstore/<lang>/NN-namn.png (1320×2868) och out/play/<lang>/NN-namn.png (1080×1920)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const RAW = path.join(__dirname, "out/raw");
const FONTS = path.join(__dirname, "node_modules/@fontsource");
const font = (pkg, file) => "data:font/woff2;base64," + fs.readFileSync(path.join(FONTS, pkg, "files", file)).toString("base64");
const img = (f) => "data:image/png;base64," + fs.readFileSync(path.join(RAW, f)).toString("base64");

const FACES = `
@font-face{font-family:Fraunces;font-weight:600;src:url(${font("fraunces", "fraunces-latin-600-normal.woff2")}) format("woff2");}
@font-face{font-family:Fraunces;font-weight:600;src:url(${font("fraunces", "fraunces-latin-ext-600-normal.woff2")}) format("woff2");unicode-range:U+0100-024F;}
@font-face{font-family:Grotesk;font-weight:400;src:url(${font("schibsted-grotesk", "schibsted-grotesk-latin-400-normal.woff2")}) format("woff2");}
@font-face{font-family:Grotesk;font-weight:600;src:url(${font("schibsted-grotesk", "schibsted-grotesk-latin-600-normal.woff2")}) format("woff2");}
@font-face{font-family:Mono;font-weight:700;src:url(${font("space-mono", "space-mono-latin-700-normal.woff2")}) format("woff2");}
`;

const THEMES = {
  dark: { bg: "radial-gradient(120% 70% at 50% 18%, #3B2D1D 0%, #221A11 62%)", ink: "#F0E9D9", eyebrow: "#CBEB57", sub: "rgba(240,233,217,0.78)", glow: "rgba(203,235,87,0.16)" },
  cream: { bg: "radial-gradient(120% 70% at 50% 15%, #F7F1E3 0%, #F0E9D9 60%)", ink: "#221A11", eyebrow: "#5F7D0C", sub: "rgba(34,26,17,0.72)", glow: "rgba(203,235,87,0.35)" },
  lime: { bg: "radial-gradient(120% 70% at 50% 12%, #D8F276 0%, #CBEB57 60%)", ink: "#222D08", eyebrow: "rgba(34,45,8,0.72)", sub: "rgba(34,45,8,0.78)", glow: "rgba(255,255,255,0.35)" },
};

// Skärmarna och texterna. ios/android = vilken råbild som används; top/bottom = färg på statusraden och längst ned.
const SLIDES = [
  { key: "kort", theme: "dark", ios: "ios-home.png", android: "android-home.png",
    sv: { eyebrow: "Det digitala stämpelkortet", title: "Alla dina kort på ett ställe.", sub: "Kaféet, bageriet och lunchstället – samlade i mobilen." },
    en: { eyebrow: "The digital stamp card", title: "All your cards in one place.", sub: "The café, the bakery and the lunch spot – all in your phone." } },
  { key: "stampla", theme: "cream", ios: "ios-stamp-1800.png", android: "android-stamp-1800.png",
    sv: { eyebrow: "Tappa. Stämpla. Klart.", title: "En stämpel på en sekund.", sub: { ios: "Tryck på Skanna och håll iPhonen mot stämpeln i kassan.", android: "Håll telefonen mot stämpeln i kassan." } },
    en: { eyebrow: "Tap. Stamp. Done.", title: "A stamp in one second.", sub: { ios: "Tap Scan and hold your iPhone to the stamp at the counter.", android: "Hold your phone to the stamp at the counter." } } },
  { key: "hjul", theme: "lime", ios: "ios-wheel-5000.png", android: "android-wheel-5000.png",
    sv: { eyebrow: "Dagens hjul", title: "Snurra och vinn dubbla stämplar.", sub: "Dagens hjul är gratis – ett snurr per dag." },
    en: { eyebrow: "Daily wheel", title: "Spin to win double stamps.", sub: "The daily wheel is free – one spin a day." } },
  { key: "beloning", theme: "dark", ios: "ios-celebrate-4600.png", android: "android-celebrate-5400.png",
    sv: { eyebrow: "Belöningar", title: "Fullt kort? Belöningen väntar.", sub: "Och mindre belöningar på vägen dit." },
    en: { eyebrow: "Rewards", title: "Full card? Your reward is waiting.", sub: "Plus smaller rewards along the way." } },
  { key: "losin", theme: "cream", ios: "ios-redeem-done-2400.png", android: "android-redeem-done-2400.png",
    sv: { eyebrow: "Lös in", title: "Personalen tappar – klart.", sub: "Och du ser direkt hur mycket du har sparat." },
    en: { eyebrow: "Redeem", title: "Staff tap – done.", sub: "And you see right away how much you've saved." } },
  { key: "stallen", theme: "lime", ios: "ios-place.png", android: "android-place.png",
    sv: { eyebrow: "Ställen", title: "Se vad varje ställe bjuder på.", sub: "Öppettider, belöningar och dubbla stämplar när det är lugnt." },
    en: { eyebrow: "Places", title: "See what every place offers.", sub: "Opening hours, rewards and double stamps at quiet times." } },
];

const COLORS = {}; // fylls med top/bottom-färg per råbild
function sample(file) {
  const p = path.join(RAW, file);
  const at = (args) => "#" + execFileSync("convert", [p, ...args, "-format", "%[hex:p{0,0}]", "info:"]).toString().trim();
  return { top: at(["-crop", "1x1+20+4"]), bottom: at(["-gravity", "SouthWest", "-crop", "1x1+20+2"]) };
}

function statusBar(os, color) {
  const dark = isLight(color) ? "#111" : "#fff";
  if (os === "ios") {
    return `<div class="sb ios" style="background:${color};color:${dark}">
      <span class="time">9:41</span><span class="island"></span>
      <span class="icons"><svg viewBox="0 0 18 12" width="18"><rect x="0" y="8" width="3" height="4" rx="1" fill="${dark}"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="${dark}"/><rect x="10" y="3" width="3" height="9" rx="1" fill="${dark}"/><rect x="15" y="0" width="3" height="12" rx="1" fill="${dark}"/></svg>
      <svg viewBox="0 0 16 12" width="16"><path d="M8 11.5 10.6 8.6a3.6 3.6 0 0 0-5.2 0L8 11.5Zm-4.5-4.6a6.4 6.4 0 0 1 9 0l1.5-1.6a8.6 8.6 0 0 0-12 0l1.5 1.6ZM.6 3.9a10.6 10.6 0 0 1 14.8 0L16 3.3a12 12 0 0 0-16 0l.6.6Z" fill="${dark}"/></svg>
      <svg viewBox="0 0 27 13" width="26"><rect x="0.5" y="0.5" width="23" height="12" rx="3.5" fill="none" stroke="${dark}" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2" fill="${dark}"/><rect x="24.6" y="4.3" width="1.6" height="4.4" rx=".8" fill="${dark}" opacity=".4"/></svg></span></div>`;
  }
  return `<div class="sb android" style="background:${color};color:${dark}">
    <span class="time">9:41</span><span class="cam"></span>
    <span class="icons"><svg viewBox="0 0 16 12" width="15"><path d="M8 12 0 3.4a11.7 11.7 0 0 1 16 0L8 12Z" fill="${dark}"/></svg>
    <svg viewBox="0 0 12 12" width="12"><path d="M12 0v12H0L12 0Z" fill="${dark}"/></svg>
    <svg viewBox="0 0 8 13" width="8"><rect x="0" y="1.5" width="8" height="11.5" rx="1.4" fill="${dark}"/><rect x="2.5" y="0" width="3" height="2" rx=".6" fill="${dark}"/></svg></span></div>`;
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

function page({ W, H, os, slide, lang }) {
  const t = THEMES[slide.theme];
  const c = slide[lang];
  const sub = typeof c.sub === "string" ? c.sub : c.sub[os];
  const raw = slide[os];
  // Telefonens mått: skärm (pt) = app + statusrad + nederkant
  const pt = os === "ios" ? { w: 393, h: 852 } : { w: 412, h: 915 };
  const screenH = pt.h;
  const tall = H / W > 2;
  const textTop = Math.round(H * (tall ? 0.075 : 0.06));
  const phoneW = Math.round(W * (tall ? 0.80 : 0.62));
  const k = phoneW / pt.w; // px per punkt inne i telefonen
  const bezel = Math.round(phoneW * 0.032);
  const radius = Math.round(phoneW * (os === "ios" ? 0.14 : 0.10));
  const screenPx = Math.round(screenH * k);
  const phoneH = screenPx + bezel * 2;
  const phoneTop = H - phoneH - Math.round(H * (tall ? 0.035 : 0.03));
  const titleSize = Math.round(W * (tall ? 0.086 : 0.074));
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FACES}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${W}px;height:${H}px;overflow:hidden}
  body{background:${t.bg};position:relative;font-family:Grotesk,sans-serif;-webkit-font-smoothing:antialiased}
  .glow{position:absolute;left:50%;top:${phoneTop + phoneH * 0.18}px;width:${W * 1.1}px;height:${W * 1.1}px;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle, ${t.glow} 0%, transparent 62%)}
  .text{position:absolute;left:${Math.round(W * 0.07)}px;right:${Math.round(W * 0.07)}px;top:${textTop}px;text-align:center}
  .eyebrow{font-family:Mono;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:${t.eyebrow};font-size:${Math.round(W * 0.026)}px}
  h1{text-wrap:balance;font-family:Fraunces,serif;font-weight:600;color:${t.ink};font-size:${titleSize}px;line-height:1.04;letter-spacing:-.02em;margin-top:${Math.round(W * 0.03)}px}
  .sub{text-wrap:balance;color:${t.sub};font-size:${Math.round(W * 0.036)}px;line-height:1.35;margin-top:${Math.round(W * 0.03)}px}
  .phone{position:absolute;left:50%;top:${phoneTop}px;width:${phoneW}px;height:${phoneH}px;transform-origin:50% 0;transform:translateX(-50%) scale(var(--s,1));background:#141210;border-radius:${radius}px;padding:${bezel}px;
    box-shadow:0 ${Math.round(W * 0.03)}px ${Math.round(W * 0.08)}px rgba(20,14,6,.35), inset 0 0 0 ${Math.max(2, Math.round(bezel * 0.18))}px #3a3632}
  .screen{width:100%;height:100%;border-radius:${radius - bezel}px;overflow:hidden;background:#000}
  .screen img{display:block;width:100%;height:100%}
  </style></head><body><div class="glow"></div>
  <div class="text"><div class="eyebrow">${c.eyebrow}</div><h1>${c.title}</h1><div class="sub">${sub}</div></div>
  <div class="phone"><div class="screen"><img src="${img(raw)}"></div></div>
  <script>
    window.__fit = () => {
      const text = document.querySelector('.text').getBoundingClientRect();
      const phone = document.querySelector('.phone');
      const gap = ${Math.round(H * (tall ? 0.03 : 0.028))};
      const bottom = ${Math.round(H * (tall ? 0.03 : 0.025))};
      const top = Math.ceil(text.bottom + gap);
      const s = Math.min(1, (${H} - top - bottom) / ${phoneH});
      phone.style.top = top + 'px';
      phone.style.setProperty('--s', s.toFixed(4));
      const g = document.querySelector('.glow');
      g.style.top = (top + ${phoneH} * s * 0.3) + 'px';
      return s;
    };
  </script>
  </body></html>`;
}

(async () => {
  const browser = await chromium.launch();
  // Tre storlekar för iPhone i App Store Connect (läge 2026-11-23):
  // appstore    1320×2868  "iPhone with Dynamic Island (large display)", gäller 6,5"/6,7"/6,9"
  // appstore-63 1206×2622  "iPhone with Dynamic Island (medium display)", 6,1"/6,3"
  // appstore-65 1284×2778  "iPhone with Face ID (large display)", 6,5" (den gamla sidan använde bara den)
  // ONLY=appstore-63,appstore-65 gör bara de valda.
  const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
  const targets = [
    { store: "appstore", os: "ios", W: 1320, H: 2868 },
    { store: "appstore-63", os: "ios", W: 1206, H: 2622 },
    { store: "appstore-65", os: "ios", W: 1284, H: 2778 },
    { store: "play", os: "android", W: 1080, H: 1920 },
  ].filter((t) => !ONLY.length || ONLY.includes(t.store));
  for (const tg of targets) {
    const ctx = await browser.newContext({ viewport: { width: tg.W, height: tg.H }, deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    for (const lang of ["sv", "en"]) {
      const dir = path.join(__dirname, "out", tg.store, lang);
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < SLIDES.length; i++) {
        const slide = SLIDES[i];
        await pg.setContent(page({ ...tg, slide, lang }), { waitUntil: "load" });
        await pg.evaluate(() => document.fonts.ready);
        const scale = await pg.evaluate(() => window.__fit());
        if (scale < 0.6) console.log("liten telefon:", tg.store, lang, slide.key, scale.toFixed(2));
        const tmp = path.join(dir, `.tmp.png`);
        const out = path.join(dir, `${String(i + 1).padStart(2, "0")}-${slide.key}.png`);
        await pg.screenshot({ path: tmp });
        // utan alfakanal (24-bit PNG), som båda butikerna vill ha
        execFileSync("convert", [tmp, "-background", "#000", "-alpha", "remove", "-alpha", "off", "-define", "png:color-type=2", out]);
        fs.unlinkSync(tmp);
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log("klart");
})().catch((e) => { console.error(e); process.exit(1); });
