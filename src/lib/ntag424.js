// Programmering av dynamiska stämplar (NTAG 424 DNA, v17) — ren JavaScript ovanpå aes.js,
// så att verktyget når appen med en OTA-uppdatering. Protokollet följer NXP AN12196:
// AuthenticateEV2First, säker kanal (CommMode.Full), ChangeFileSettings och ChangeKey.
// Testat mot AN12196:s exempelvärden och en simulerad tagg (README-v17-ntag424.md).
//
// Nycklarna (admin_sdm_issue_keys) finns bara i minnet medan verktyget är öppet — de
// sparas och loggas aldrig.
import { aesEncryptBlock, aesDecryptBlock, cbcEncrypt, cbcDecrypt, cmac, macTrunc, jamCrc32, bytes, fromHex, toHex, concat, xorBytes, equalBytes } from "./aes";

export const ZERO_KEY = new Uint8Array(16);
export const KEY_VERSION = 0x01;   // nycklar som verktyget satt (fabrik = 0x00)
const ZERO_IV = new Uint8Array(16);
const SELECT_APP = fromHex("00a4040007d276000085010100");   // NDEF-applikationen (DF-namn D2760000850101)
const SELECT_NDEF = fromHex("00a4000002e10400");            // fil E104 = fil 02

const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];                        // minst signifikanta byte först
const u24 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
const rotl = (b) => concat(b.slice(1), b.slice(0, 1));
const ascii = (s) => Uint8Array.from(String(s), (ch) => ch.charCodeAt(0) & 0x7f);
const sw = (r) => (r.length >= 2 ? (r[r.length - 2] << 8) | r[r.length - 1] : -1);
const swHex = (n) => (n < 0 ? "–" : n.toString(16).padStart(4, "0").toUpperCase().replace(/^(..)/, "$1 "));

export class TagError extends Error {
  constructor(code, status) {
    super(code + (status != null && status >= 0 ? " (" + swHex(status) + ")" : ""));
    this.code = code;
    this.status = status == null ? null : status;
  }
}

const STATUS_CODES = {
  0x91ae: "auth", 0x91ad: "auth_delay", 0x911e: "integrity", 0x919d: "permission", 0x6982: "permission",
  0x917e: "length", 0x919e: "parameter", 0x9140: "no_key", 0x91ca: "aborted", 0x91ee: "memory",
  0x6a82: "not_ntag424", 0x6a86: "not_ntag424", 0x6d00: "not_ntag424", 0x6e00: "not_ntag424",
};
const fail = (status, fallback = "protocol") => new TagError(STATUS_CODES[status] || fallback, status);

export function randomBytes(n) {
  const out = new Uint8Array(n);
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (c && typeof c.getRandomValues === "function") {
    try { c.getRandomValues(out); return out; } catch {}
  }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

// ---- Vad taggen ska innehålla (samma som admin_sdm_issue_keys, rad 2, 8, 10 och 12) ----

// NDEF-filen: NLEN (2 byte, största först) ‖ D1 01 <längd> 55 04 ‖ adressen utan "https://"
export function ndefTemplate(token) {
  const t = String(token == null ? "" : token).trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(t)) throw new TagError("bad_token");
  const prefix = "tappass.se/t/" + t + "?e=";
  const uri = prefix + "0".repeat(32) + "&c=" + "0".repeat(16);
  const piccOffset = 7 + prefix.length;     // första tecknet efter ?e=
  const macOffset = piccOffset + 32 + 3;    // första tecknet efter &c=
  const u = ascii(uri);
  const file = concat([(5 + u.length) >>> 8, (5 + u.length) & 0xff, 0xd1, 0x01, 1 + u.length, 0x55, 0x04], u);
  if (file.length > 240) throw new TagError("bad_token");
  return { token: t, url: "https://" + uri, file, piccOffset, macOffset };
}

// ChangeFileSettings för fil 02. FileOption 40 = SDM på, CommMode plain. AccessRights 00 E0 =
// läsa fritt (E), skriva/läsa-skriva/ändra med nyckel 0. SDMOptions C1 = UID + läsräknare
// speglas, ASCII. SDMAccessRights FF 12 = CtrRet F, MetaRead nyckel 1 (krypterar e),
// FileRead nyckel 2 (räknar c). Sedan PICCDataOffset, SDMMACInputOffset = SDMMACOffset
// (tom MAC-indata) — tre byte vardera, minst signifikanta först. Samma upplägg som AN12196 § 6.9.
export function sdmFileSettings(piccOffset, macOffset) {
  return Uint8Array.from([0x40, 0x00, 0xe0, 0xc1, 0xff, 0x12, ...u24(piccOffset), ...u24(macOffset), ...u24(macOffset)]);
}
// Fabriksläget för fil 02: SDM av, läsa/skriva fritt, ändra med nyckel 0
export const FACTORY_FILE_SETTINGS = Uint8Array.from([0x00, 0xe0, 0xee]);

// ChangeKey-data. Nyckeln man är inloggad med: NewKey ‖ KeyVer. Andra nycklar:
// (NewKey ⊕ OldKey) ‖ KeyVer ‖ JAMCRC32(NewKey) (minst signifikanta byte först).
export function changeKeyData(keyNo, authKeyNo, oldKey, newKey, version) {
  const nk = bytes(newKey);
  if (keyNo === authKeyNo) return concat(nk, [version]);
  return concat(xorBytes(nk, bytes(oldKey)), [version], jamCrc32(nk));
}

// ---- Säker kanal (AN12196 § 4–5) ----

export function sessionKeys(key, rndA, rndB) {
  const a = bytes(rndA), b = bytes(rndB);
  const ctx = concat(a.slice(0, 2), xorBytes(a.slice(2, 8), b.slice(0, 6)), b.slice(6, 16), a.slice(8, 16));
  return {
    enc: cmac(key, concat([0xa5, 0x5a, 0x00, 0x01, 0x00, 0x80], ctx)),
    mac: cmac(key, concat([0x5a, 0xa5, 0x00, 0x01, 0x00, 0x80], ctx)),
  };
}

// ISO/IEC 9797-1 metod 2: 80 och nollor — läggs alltid till, även när datat fyller hela block
function pad(d) {
  const out = new Uint8Array((Math.floor(d.length / 16) + 1) * 16);
  out.set(d);
  out[d.length] = 0x80;
  return out;
}
function unpad(d) {
  let i = d.length - 1;
  while (i >= 0 && d[i] === 0x00) i--;
  if (i < 0 || d[i] !== 0x80) throw new TagError("protocol");
  return d.slice(0, i);
}

const sessionIv = (sess, label) => aesEncryptBlock(sess.enc, concat(label, sess.ti, u16(sess.ctr), new Uint8Array(8)));
const macOf = (sess, ...parts) => macTrunc(cmac(sess.mac, concat(...parts)));

// Kommando i CommMode.MAC: data i klartext + MAC
export function wrapMac(sess, cmd, header, data) {
  const payload = concat(header, data);
  const mact = macOf(sess, [cmd], u16(sess.ctr), sess.ti, payload);
  return apdu(cmd, concat(payload, mact));
}

// Kommando i CommMode.Full: headern i klartext, datat krypterat, MAC över allt
export function wrapFull(sess, cmd, header, data) {
  const h = bytes(header), d = bytes(data);
  const enc = d.length ? cbcEncrypt(sess.enc, sessionIv(sess, [0xa5, 0x5a]), pad(d)) : new Uint8Array(0);
  const mact = macOf(sess, [cmd], u16(sess.ctr), sess.ti, h, enc);
  return apdu(cmd, concat(h, enc, mact));
}

function apdu(cmd, payload) {
  if (payload.length > 255) throw new TagError("length");
  return payload.length
    ? concat([0x90, cmd, 0x00, 0x00, payload.length], payload, [0x00])
    : Uint8Array.from([0x90, cmd, 0x00, 0x00, 0x00]);
}

// Svar med MAC (sess.ctr redan uppräknad). full = datat är krypterat.
export function unwrapResponse(sess, resp, full) {
  const r = bytes(resp);
  const status = sw(r);
  if (status !== 0x9100) throw fail(status);
  if (r.length < 10) throw new TagError("protocol", status);
  const data = r.slice(0, r.length - 10);
  if (!equalBytes(macOf(sess, [0x00], u16(sess.ctr), sess.ti, data), r.slice(r.length - 10, r.length - 2))) throw new TagError("mac");
  if (!full || !data.length) return data;
  if (data.length % 16) throw new TagError("protocol");
  return unpad(cbcDecrypt(sess.enc, sessionIv(sess, [0x5a, 0xa5]), data));
}

// AuthenticateEV2First med nyckel keyNo → session { ti, enc, mac, ctr }
export async function authenticate(tx, keyNo, key, rndA = randomBytes(16)) {
  const a = bytes(rndA);
  const r1 = await tx(Uint8Array.from([0x90, 0x71, 0x00, 0x00, 0x02, keyNo, 0x00, 0x00]));
  if (sw(r1) !== 0x91af || r1.length !== 18) throw fail(sw(r1));
  const rndB = cbcDecrypt(key, ZERO_IV, r1.slice(0, 16));
  const r2 = await tx(concat([0x90, 0xaf, 0x00, 0x00, 0x20], cbcEncrypt(key, ZERO_IV, concat(a, rotl(rndB))), [0x00]));
  if (sw(r2) !== 0x9100 || r2.length !== 34) throw fail(sw(r2));
  const plain = cbcDecrypt(key, ZERO_IV, r2.slice(0, 32));
  if (!equalBytes(plain.slice(4, 20), rotl(a))) throw new TagError("auth");
  return { ti: plain.slice(0, 4), ...sessionKeys(key, a, rndB), ctr: 0, keyNo };
}

// ---- Dynamiska adressen (SUN) — som servern räknar (sdm_verify) ----

export function sunVerify(sun, k1, k2) {
  const e = String((sun && sun.e) || ""), c = String((sun && sun.c) || "");
  if (!/^[0-9a-f]{32}$/i.test(e) || !/^[0-9a-f]{16}$/i.test(c)) return { ok: false };
  const p = aesDecryptBlock(bytes(k1), fromHex(e));   // ett block, IV 0
  if (p[0] !== 0xc7) return { ok: false };
  const uid = p.slice(1, 8), ctr = p.slice(8, 11);
  const kses = cmac(bytes(k2), concat([0x3c, 0xc3, 0x00, 0x01, 0x00, 0x80], uid, ctr));
  if (!equalBytes(macTrunc(cmac(kses, new Uint8Array(0))), fromHex(c))) return { ok: false };
  return { ok: true, uid: toHex(uid), counter: ctr[0] | (ctr[1] << 8) | (ctr[2] << 16) };
}

const isHexChar = (b) => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66);

// Stämmer filen med mallen? Platserna för e och c får innehålla vilka hex-tecken som helst
// (nollor före programmeringen, taggens värden när speglingen är på).
export function ndefMatches(file, tpl) {
  const f = bytes(file);
  if (f.length < tpl.file.length) return false;
  for (let i = 0; i < tpl.file.length; i++) {
    const mirrored = (i >= tpl.piccOffset && i < tpl.piccOffset + 32) || (i >= tpl.macOffset && i < tpl.macOffset + 16);
    if (mirrored ? !isHexChar(f[i]) : f[i] !== tpl.file[i]) return false;
  }
  return true;
}

export function sunFromFile(file, tpl) {
  const text = (from, n) => String.fromCharCode(...bytes(file).slice(from, from + n)).toLowerCase();
  return { e: text(tpl.piccOffset, 32), c: text(tpl.macOffset, 16) };
}

// ---- Klistra in resultatet från admin_sdm_issue_keys ----
// Tål kopiering som tabell (tabbar), CSV, JSON och Markdown: varje "Nyckel N" tar den
// första 32-teckens hex-strängen efter sig (före nästa "Nyckel"). Token tas ur adressen
// (rad 2) eller raden "Tagg"; rad 12 (NDEF-filen) jämförs med appens mall om den finns.
// Alla träffar av ett mönster med (sista gruppen, position) — utan matchAll och lookbehind,
// som inte alla JS-motorer har. Första gruppen är tecknet före träffen (eller början).
function scan(s, re) {
  const out = [];
  const g = new RegExp(re.source, "gi");
  let m;
  while ((m = g.exec(s))) {
    out.push({ text: m[m.length - 1], at: m.index + m[1].length, end: m.index + m[0].length });
    if (m[0].length === 0) g.lastIndex++;
  }
  return out;
}

export function parseIssuedKeys(text) {
  const s = String(text == null ? "" : text);
  if (!s.trim()) return { ok: false, error: "empty" };
  const labels = scan(s, /(^|[^a-zåäö])nyckel\s*([0-9])/).map((m) => ({ no: Number(m.text), at: m.end }));
  const hexes = scan(s, /(^|[^0-9a-f])([0-9a-f]{32})(?![0-9a-f])/).map((m) => ({ hex: m.text.toLowerCase(), at: m.at }));
  const keys = {};
  let conflict = false;
  labels.forEach((l, i) => {
    if (l.no > 2) return;
    const end = i + 1 < labels.length ? labels[i + 1].at : Infinity;
    const h = hexes.find((x) => x.at >= l.at && x.at < end);
    if (!h) return;
    if (keys[l.no] && keys[l.no] !== h.hex) conflict = true;
    else keys[l.no] = h.hex;
  });

  // Taggens namn: ur adressmallen och efter varje "Tagg" — mer än ett namn = två taggars resultat
  const tokens = new Set();
  scan(s, /(^|[^a-z0-9.])tappass\.se\/t\/([a-z0-9_-]+)\?e=0{32}&c=0{16}/).forEach((m) => tokens.add(m.text.toLowerCase()));
  scan(s, /(^|[^a-zåäö])(tagg)(?![a-zåäö])/).forEach((m) => {
    const next = scan(s.slice(m.end), /(^|[^a-z0-9_-])([a-z0-9][a-z0-9_]*(?:-[a-z0-9_]+)*-\d{2})(?![a-z0-9_-])/)[0];
    if (next) tokens.add(next.text.toLowerCase());
  });
  if (tokens.size > 1 || conflict) return { ok: false, error: "two_tags" };
  const token = tokens.size ? [...tokens][0] : null;

  const missing = [0, 1, 2].filter((n) => !keys[n]);
  if (!token) return { ok: false, error: "no_tag", missing };
  if (missing.length) return { ok: false, error: "missing_keys", missing, token };
  if (keys[0] === keys[1] || keys[0] === keys[2] || keys[1] === keys[2]) return { ok: false, error: "same_keys", token };
  if ([keys[0], keys[1], keys[2]].some((k) => /^0+$/.test(k))) return { ok: false, error: "zero_key", token };

  let tpl;
  try { tpl = ndefTemplate(token); } catch { return { ok: false, error: "no_tag" }; }
  const ndefRow = scan(s, /(^|[^0-9a-f])(00[0-9a-f]{2}d101[0-9a-f]{2}5504[0-9a-f]{40,})(?![0-9a-f])/)[0];
  if (ndefRow && ndefRow.text.toLowerCase() !== toHex(tpl.file)) return { ok: false, error: "template", token };

  return { ok: true, token, url: tpl.url, k0: fromHex(keys[0]), k1: fromHex(keys[1]), k2: fromHex(keys[2]) };
}

export const maskKey = (k) => "••••" + toHex(k).slice(-4);

// ---- Programmera och återställa ----

export const PROGRAM_STEPS = [
  { id: "connect", label: "Ansluter till taggen" },
  { id: "ndef", label: "Skriver adressen" },
  { id: "sdm", label: "Slår på den dynamiska adressen" },
  { id: "keys", label: "Byter nycklarna" },
  { id: "verify", label: "Kontrollerar" },
];
export const RESET_STEPS = [
  { id: "connect", label: "Ansluter till taggen" },
  { id: "sdm", label: "Stänger av den dynamiska adressen" },
  { id: "keys", label: "Återställer nycklarna" },
  { id: "verify", label: "Kontrollerar" },
];

// tx(bytes) → svaret inklusive SW1 SW2. Fel i överföringen (taggen flyttades) blir "lost".
function transport(tx) {
  return async (cmd) => {
    let r;
    try { r = await tx(cmd); } catch { throw new TagError("lost"); }
    const out = bytes(r);
    if (out.length < 2) throw new TagError("protocol");
    return out;
  };
}

// ISO-kommando (svar 90 00). code = felkoden för alla fel (t.ex. not_ntag424 när
// applikationen saknas); annars tolkas statusen, men "fil saknas" blir protocol.
async function iso(t, cmd, code = null) {
  const r = await t(cmd);
  const s = sw(r);
  if (s !== 0x9000) throw new TagError(code || (STATUS_CODES[s] && STATUS_CODES[s] !== "not_ntag424" ? STATUS_CODES[s] : "protocol"), s);
  return r.slice(0, r.length - 2);
}

async function keyVersion(t, keyNo) {
  const r = await t(Uint8Array.from([0x90, 0x64, 0x00, 0x00, 0x01, keyNo, 0x00]));
  if (sw(r) !== 0x9100 || r.length !== 3) throw fail(sw(r));
  return r[0];
}

// GetFileSettings för fil 02 (fri åtkomst, klartext utan inloggning)
async function fileSettings(t) {
  const r = await t(Uint8Array.from([0x90, 0xf5, 0x00, 0x00, 0x01, 0x02, 0x00]));
  if (sw(r) !== 0x9100) throw fail(sw(r));
  return r.slice(0, r.length - 2);
}

// Svaret (FileType ‖ FileOption ‖ AccessRights ‖ FileSize ‖ SDM-fälten) mot ChangeFileSettings-datat
export function settingsMatch(current, wanted) {
  const c = bytes(current), w = bytes(wanted);
  return c.length === w.length + 4 && equalBytes(c.slice(1, 4), w.slice(0, 3)) && equalBytes(c.slice(7), w.slice(3));
}

async function readFile(t, length) {
  await iso(t, SELECT_APP, "not_ntag424");
  await iso(t, SELECT_NDEF);
  return iso(t, Uint8Array.from([0x00, 0xb0, 0x00, 0x00, length]));
}

async function full(t, sess, cmd, header, data, { authKeyChanged = false } = {}) {
  const r = await t(wrapFull(sess, cmd, header, data));
  sess.ctr = (sess.ctr + 1) & 0xffff;
  // Byter man nyckeln man är inloggad med avslutas sessionen och svaret saknar MAC
  if (authKeyChanged && sw(r) === 0x9100 && r.length === 2) return new Uint8Array(0);
  return unwrapResponse(sess, r, true);
}

async function login(t, key, code, rnd) {
  await iso(t, SELECT_APP, "not_ntag424");
  try { return await authenticate(t, 0, key, rnd(16)); }
  catch (e) { throw e.code === "auth" ? new TagError(code, e.status) : e; }
}

function keyTriple(cfg) {
  const k = [cfg.k0, cfg.k1, cfg.k2].map((x) => bytes(x));
  if (k.some((x) => x.length !== 16)) throw new TagError("bad_keys");
  return k;
}

// Gör en NTAG 424 DNA till en dynamisk stämpel. Kan köras om på en halvfärdig tagg:
// nyckelversionerna (00 = fabrik, 01 = satt av verktyget) visar vad som redan är gjort.
//   cfg     { token, k0, k1, k2 } (parseIssuedKeys)
//   onStep  (id) när ett steg börjar (PROGRAM_STEPS)
// → { token, url, uid, counter }
export async function programTag(tx, cfg, onStep = () => {}, opts = {}) {
  const t = transport(tx);
  const rnd = opts.random || randomBytes;
  const tpl = ndefTemplate(cfg.token);
  const [k0, k1, k2] = keyTriple(cfg);

  onStep("connect");
  await iso(t, SELECT_APP, "not_ntag424");
  const v = [await keyVersion(t, 0), await keyVersion(t, 1), await keyVersion(t, 2)];
  const fresh0 = v[0] === 0x00;
  // Redan rätt inställd (omkörning)? Då rörs inställningarna inte — en ny ChangeFileSettings
  // kan nollställa läsräknaren, och servern godtar bara räknare över den senast godkända.
  const wanted = sdmFileSettings(tpl.piccOffset, tpl.macOffset);
  let settingsDone = false;
  try { settingsDone = settingsMatch(await fileSettings(t), wanted); }
  catch (e) { if (e.code === "lost") throw e; }

  onStep("ndef");
  let writeLater = false;
  if (!ndefMatches(await readFile(t, tpl.file.length), tpl)) {
    // Fabrikstagg: filen får skrivas fritt — ISO UPDATE BINARY före inloggningen.
    // Kräver filen redan nyckel 0 (halvfärdig tagg) skrivs den efter inloggningen.
    const r = await t(concat([0x00, 0xd6, 0x00, 0x00, tpl.file.length], tpl.file));
    if (sw(r) === 0x6982) writeLater = true;
    else if (sw(r) !== 0x9000) throw fail(sw(r));
  }

  onStep("sdm");
  const sess = await login(t, fresh0 ? ZERO_KEY : k0, fresh0 ? "foreign_key" : "wrong_key", rnd);
  if (writeLater) {
    // WriteData i klartext (filens CommMode) — räknar ändå upp sessionens räknare
    const r = await t(concat([0x90, 0x8d, 0x00, 0x00, 7 + tpl.file.length, 0x02], u24(0), u24(tpl.file.length), tpl.file, [0x00]));
    sess.ctr = (sess.ctr + 1) & 0xffff;
    if (sw(r) !== 0x9100) throw fail(sw(r));
  }
  if (!settingsDone) await full(t, sess, 0x5f, [0x02], wanted);

  onStep("keys");
  // Nyckel 1 och 2 först, huvudnyckeln sist. Version 00 men inte nollor = bytt av någon annan
  // (taggen kontrollerar den gamla nyckeln med CRC:n och svarar 91 1E).
  const change = async (no, key) => {
    try { await full(t, sess, 0xc4, [no], changeKeyData(no, 0, ZERO_KEY, key, KEY_VERSION)); }
    catch (e) { throw e.code === "integrity" ? new TagError("foreign_key" + no, e.status) : e; }
  };
  if (v[1] === 0x00) await change(1, k1);
  if (v[2] === 0x00) await change(2, k2);
  if (fresh0) await full(t, sess, 0xc4, [0x00], changeKeyData(0, 0, null, k0, KEY_VERSION), { authKeyChanged: true });

  onStep("verify");
  const file = await readFile(t, tpl.file.length);
  if (!ndefMatches(file, tpl)) throw new TagError("ndef_mismatch");
  const sun = sunFromFile(file, tpl);
  if (/^0+$/.test(sun.e)) throw new TagError("sdm_off");
  const check = sunVerify(sun, k1, k2);
  if (!check.ok) throw new TagError("key_mismatch");
  await login(t, k0, "key0_mismatch", rnd);
  return { token: tpl.token, url: tpl.url, uid: check.uid, counter: check.counter };
}

// Tillbaka till fabriksläget (nycklar = nollor, version 00, SDM av) — t.ex. för en testtagg
// eller en tagg som ska få nya nycklar. Kräver taggens nuvarande nycklar.
export async function resetTag(tx, cfg, onStep = () => {}, opts = {}) {
  const t = transport(tx);
  const rnd = opts.random || randomBytes;
  const [k0, k1, k2] = keyTriple(cfg);

  onStep("connect");
  await iso(t, SELECT_APP, "not_ntag424");
  const v = [await keyVersion(t, 0), await keyVersion(t, 1), await keyVersion(t, 2)];

  onStep("sdm");
  const sess = await login(t, v[0] === 0x00 ? ZERO_KEY : k0, v[0] === 0x00 ? "foreign_key" : "wrong_key", rnd);
  await full(t, sess, 0x5f, [0x02], FACTORY_FILE_SETTINGS);

  onStep("keys");
  const change = async (no, old) => {
    try { await full(t, sess, 0xc4, [no], changeKeyData(no, 0, old, ZERO_KEY, 0x00)); }
    catch (e) { throw e.code === "integrity" ? new TagError("wrong_key" + no, e.status) : e; }
  };
  if (v[1] !== 0x00) await change(1, k1);
  if (v[2] !== 0x00) await change(2, k2);
  if (v[0] !== 0x00) await full(t, sess, 0xc4, [0x00], changeKeyData(0, 0, null, ZERO_KEY, 0x00), { authKeyChanged: true });

  onStep("verify");
  await iso(t, SELECT_APP, "not_ntag424");
  const after = [await keyVersion(t, 0), await keyVersion(t, 1), await keyVersion(t, 2)];
  if (after.some((x) => x !== 0x00)) throw new TagError("protocol");
  await login(t, ZERO_KEY, "protocol", rnd);
  return { ok: true };
}

// ---- Texter ----

export function programErrorText(err) {
  const code = err && err.code;
  const sw4 = err && err.status != null && err.status >= 0 ? " (" + swHex(err.status) + ")" : "";
  switch (code) {
    case "lost": return "Kontakten bröts. Håll taggen stilla mot telefonens baksida och försök igen – programmeringen fortsätter där den slutade.";
    case "not_ntag424": return "Det här är ingen NTAG 424 DNA-tagg.";
    case "foreign_key": return "Taggen har en okänd huvudnyckel. Använd en ny NTAG 424 DNA-tagg.";
    case "foreign_key1": case "foreign_key2": return "Taggens nyckel " + code.slice(-1) + " är redan bytt av ett annat verktyg. Använd en ny NTAG 424 DNA-tagg.";
    case "wrong_key": return "Taggen är redan programmerad med andra nycklar. Klistra in nycklarna för den här taggen – eller använd en ny tagg.";
    case "wrong_key1": return "Nyckel 1 på taggen stämmer inte med de inklistrade.";
    case "wrong_key2": return "Nyckel 2 på taggen stämmer inte med de inklistrade.";
    case "key_mismatch": return "Nyckel 1 eller 2 på taggen stämmer inte med de inklistrade. Taggen kan inte användas för den här stämpeln – återställ den med rätt nycklar eller använd en ny tagg.";
    case "key0_mismatch": return "Huvudnyckeln på taggen stämmer inte med den inklistrade.";
    case "sdm_off": return "Den dynamiska adressen slogs inte på. Försök igen.";
    case "ndef_mismatch": return "Adressen på taggen blev inte rätt. Försök igen.";
    case "auth_delay": return "Taggen spärrar inloggning en stund efter misslyckade försök. Vänta en minut och försök igen.";
    case "bad_token": case "bad_keys": return "Nycklarna eller taggens namn är ogiltiga. Klistra in resultatet igen.";
    case "mac": return "Taggens svar gick inte att kontrollera. Försök igen.";
    default: return "Taggen svarade oväntat" + sw4 + ". Försök igen.";
  }
}

export function parseErrorText(r) {
  if (!r || r.ok) return "";
  switch (r.error) {
    case "empty": return "";
    case "missing_keys": return "Hittar inte " + r.missing.map((n) => "nyckel " + n).join(", ").replace(/, ([^,]*)$/, " och $1") + ". Kopiera hela resultatet.";
    case "no_tag": return "Hittar inte taggens namn (raden Tagg eller Adress). Kopiera hela resultatet.";
    case "two_tags": return "Texten innehåller två olika taggar. Klistra in resultatet för en tagg.";
    case "same_keys": case "zero_key": return "Nycklarna ser inte rätt ut. Kopiera resultatet igen.";
    case "template": return "Adressen i resultatet stämmer inte med appens mall. Uppdatera appen.";
    default: return "Kunde inte läsa nycklarna.";
  }
}
