// Vad en TapPass-stämpel ger appen → { token, sun }.
//   Statisk tagg:   "miyabi-01" (textrecord) eller https://tappass.se/t/miyabi-01
//   Dynamisk tagg:  https://tappass.se/t/miyabi-01?e=<32 hex>&c=<16 hex> (NTAG 424 DNA, v17)
// e och c (SUN) skrivs om av taggen vid varje läsning. Servern kontrollerar dem och godkänner
// varje läsning en gång — appen skickar dem bara vidare: tap_token("miyabi-01?e=…&c=…").

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;

// "e=…&c=…" → { e, c } eller null. p= godtas som e= (som på servern).
export function sunFromQuery(query) {
  let e = null;
  let c = null;
  for (const part of String(query || "").replace(/^[?&]+/, "").split("&")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const key = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim().toLowerCase();
    if ((key === "e" || key === "p") && !e && HEX32.test(value)) e = value;
    else if (key === "c" && !c && HEX16.test(value)) c = value;
  }
  return e && c ? { e, c } : null;
}

// Ett läst värde → { token, sun } eller null.
//   "miyabi-01", "MIYABI-01 ", "miyabi" (→ "miyabi-01", databasens form),
//   "https://tappass.se/t/miyabi-01?e=…&c=…" eller bara "miyabi-01?e=…&c=…".
// Okända värden skickas vidare som de är — servern svarar då unknown_tag.
export function splitTag(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase().split("#")[0];
  const q = s.indexOf("?");
  const path = (q < 0 ? s : s.slice(0, q)).replace(/\/+$/, "");
  let token = path.slice(path.lastIndexOf("/") + 1).trim();
  if (!token) return null;
  if (!token.includes("-")) token += "-01";
  return { token, sun: q < 0 ? null : sunFromQuery(s.slice(q + 1)) };
}

// Det som skickas som p_token till tap_token
export function wireToken(token, sun) {
  return sun && HEX32.test(sun.e || "") && HEX16.test(sun.c || "") ? token + "?e=" + sun.e + "&c=" + sun.c : token;
}
