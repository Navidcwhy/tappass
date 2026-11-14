// v17: Dynamiska taggar (NTAG 424 DNA, SUN) — kontrollen mot NXP:s och RFC:s testvärden,
// stämpling med äkta/kopierade/förfalskade läsningar, läget före och efter "bara dynamisk",
// administrationen och behörigheterna. Taggens utdata räknas fram med en egen
// JS-implementation (Node crypto) som först kontrolleras mot NXP AN12196.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";

let passed = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };
const ok = (c, msg) => { assert.ok(c, msg); passed++; };
const R = "/home/claude/tappass/supabase_migration_";
const read = (v) => fs.readFileSync(R + v + ".sql", "utf8");
const BASE = fs.readFileSync(new URL("./base.sql", import.meta.url), "utf8");
const AUTH = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create extension if not exists pgcrypto with schema extensions;
`;
const CHAIN = ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar", "v9_inlosen_tapp", "v10_fler_beloningar", "v11_stamgaster", "v12_insikter", "v13_profil", "v14_konto", "v15_fodelsedag"];
const V17 = read("v17_dynamiska_taggar");
const V8_TAP = "7a39275742fc5e2b0fa612dffd19c368";

// ---------- taggen i JS (oberoende av SQL-koden) ----------
const aes = (key, block) => { const c = crypto.createCipheriv("aes-128-ecb", key, null); c.setAutoPadding(false); return Buffer.concat([c.update(block), c.final()]); };
const xor = (a, b) => Buffer.from(a.map((v, i) => v ^ b[i]));
const dbl = (b) => { const o = Buffer.alloc(16); for (let i = 0; i < 16; i++) o[i] = ((b[i] << 1) | (i < 15 ? b[i + 1] >> 7 : 0)) & 0xff; if (b[0] & 0x80) o[15] ^= 0x87; return o; };
function cmac(key, msg) {
  const k1 = dbl(aes(key, Buffer.alloc(16))), k2 = dbl(k1);
  const n = Math.max(1, Math.ceil(msg.length / 16));
  let last;
  if (msg.length && msg.length % 16 === 0) last = xor(msg.subarray((n - 1) * 16), k1);
  else { const p = Buffer.alloc(16); msg.copy(p, 0, (n - 1) * 16); p[msg.length - (n - 1) * 16] = 0x80; last = xor(p, k2); }
  let x = Buffer.alloc(16);
  for (let i = 0; i < n - 1; i++) x = aes(key, xor(x, msg.subarray(i * 16, i * 16 + 16)));
  return aes(key, xor(x, last));
}
// En läsning: e och c som taggen skriver in i adressen
function sun(k1, k2, uid, ctr, { rnd = crypto.randomBytes(5), tagByte = 0xc7 } = {}) {
  const c3 = Buffer.from([ctr & 0xff, (ctr >> 8) & 0xff, (ctr >> 16) & 0xff]);
  const e = aes(k1, Buffer.concat([Buffer.from([tagByte]), uid, c3, rnd]));
  const mac = cmac(cmac(k2, Buffer.concat([Buffer.from("3cc300010080", "hex"), uid, c3])), Buffer.alloc(0));
  return { e: e.toString("hex"), c: Buffer.from([1, 3, 5, 7, 9, 11, 13, 15].map((i) => mac[i])).toString("hex") };
}
const Z = Buffer.alloc(16);
{
  // JS-taggen mot NXP AN12196 (exempel med krypterad PICC-data, nycklar 00…00)
  const a = sun(Z, Z, Buffer.from("04de5f1eacc040", "hex"), 61, { rnd: Buffer.from("da5cf60941", "hex") });
  eq(a, { e: "ef963ff7828658a599f3041510671e88", c: "94eed9ee65337086" }, "JS-taggen = AN12196");
  eq(cmac(Buffer.from("2b7e151628aed2a6abf7158809cf4f3c", "hex"), Buffer.alloc(0)).toString("hex"), "bb1d6929e95937287fa37d129b756746", "JS-CMAC = RFC 4493");
}

// ---------- vakterna ----------
{
  const early = new PGlite({ extensions: { pgcrypto } });
  await early.exec(BASE + AUTH);
  for (const v of CHAIN) await early.exec(read(v));
  let msg = "";
  try { await early.exec(V17); } catch (e) { msg = e.message; }
  ok(/Kör v16 först/.test(msg), "v17 kräver v16: " + msg);
  await early.exec(read("v16_bjud_in"));
  const def = (await early.query(`select pg_get_functiondef('public.tap_token(text,text)'::regprocedure) as d`)).rows[0].d;
  await early.exec(def.replace("'bad_device'", "'bad_device2'"));
  msg = "";
  try { await early.exec(V17); } catch (e) { msg = e.message; }
  ok(/tap_token är inte v8-versionen/.test(msg), "vakt tap_token: " + msg);
  eq((await early.query(`select to_regprocedure('public.tap_token_core(text,text)') is null as n`)).rows[0].n, true, "inget bytt namn när vakten slår till");
  await early.close();
}

const db = new PGlite({ extensions: { pgcrypto } });
const call = async (fn, ...args) =>
  (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
await db.exec(BASE + AUTH);
for (const v of CHAIN) await db.exec(read(v));
await db.exec(read("v16_bjud_in"));

await db.exec(`
  insert into cafes (slug, name, type, area, stamps_needed, city) values
    ('miyabi', 'Miyabi', 'Sushi', 'Lidingö', 6, 'Stockholm'),
    ('linnea', 'Café Linnea', 'Kafé', 'Vasastan', 8, 'Stockholm');
  insert into tags (cafe_id, token) select id, slug || '-01' from cafes;
`);
// Före v17: stämpla statiskt (oförändrat beteende jämförs efteråt)
const before = await call("tap_token", "device-before-1", "miyabi-01");
eq(before.ok, true, "statisk stämpling före v17");

await db.exec(V17);
const fp = Object.fromEntries((await rows(`select p.proname as n, md5(p.prosrc) as h from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.proname = any($1)`, [["tap_token", "tap_token_core", "aes_cmac", "sdm_aes", "sdm_bits", "sdm_bytes", "sdm_verify", "admin_sdm_issue_keys", "admin_sdm_enforce", "admin_sdm_disable", "admin_sdm_status"]])).map((r) => [r.n, r.h]));
eq(fp.tap_token_core, V8_TAP, "tap_token_core = v8-versionen oförändrad");
ok(fp.tap_token && fp.tap_token !== V8_TAP, "tap_token är den nya yttre funktionen");

// ---------- kryptot ----------
const hex = async (sql, args = []) => (await one(sql, args)).h;
const RFC_K = "2b7e151628aed2a6abf7158809cf4f3c";
for (const [m, want] of [
  ["", "bb1d6929e95937287fa37d129b756746"],
  ["6bc1bee22e409f96e93d7e117393172a", "070a16b46b4d4144f79bdd9dd04a287c"],
  ["6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411", "dfa66747de9ae63030ca32611497c827"],
  ["6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710", "51f0bebf7e3b9d92fc49741779363cfe"],
]) {
  eq(await hex(`select encode(public.aes_cmac(decode($1,'hex'), decode($2,'hex')), 'hex') as h`, [RFC_K, m]), want, "RFC 4493, " + m.length / 2 + " byte");
}
// AN12196: sessionsnyckeln och CMAC över en icke-tom indata (exempel med "&cmac=")
const kses = await hex(`select encode(public.aes_cmac(decode(repeat('00',16),'hex'), decode('3cc30001008004958caa5c5e80080000','hex')), 'hex') as h`);
eq(kses, "3ed0920e5e6a0320d823d5987feafbb1", "AN12196 KSesSDMFileReadMAC");
eq(await hex(`select encode(public.aes_cmac(decode($1,'hex'), convert_to('CEE9A53E3E463EF1F459635736738962&cmac=', 'UTF8')), 'hex') as h`, [kses]),
  "81ec45c175e72ff6fac61bc7ab3baef6", "AN12196 CMAC över 38 byte");
const verify = async (k1, k2, e, c) => call("sdm_verify", k1, k2, Buffer.from(e, "hex"), Buffer.from(c, "hex"));
eq(await verify(Z, Z, "ef963ff7828658a599f3041510671e88", "94eed9ee65337086"), { ok: true, uid: "04de5f1eacc040", counter: 61 }, "AN12196 exempel");
eq((await verify(Z, Z, "ef963ff7828658a599f3041510671e88", "94eed9ee65337087")).ok, false, "fel c");
eq((await verify(Z, Z, "ef963ff7828658a599f3041510671e89", "94eed9ee65337086")).ok, false, "fel e");
eq((await call("sdm_verify", Z, Z, Buffer.alloc(15), Buffer.alloc(8))).ok, false, "fel längd");
{
  const k = crypto.randomBytes(16), k2 = crypto.randomBytes(16), uid = crypto.randomBytes(7);
  const s = sun(k, k2, uid, 70000);
  eq(await verify(k, k2, s.e, s.c), { ok: true, uid: uid.toString("hex"), counter: 70000 }, "slumpade nycklar, räknare över 65535");
  const noCtr = sun(k, k2, uid, 5, { tagByte: 0x87 });
  eq((await verify(k, k2, noCtr.e, noCtr.c)).ok, false, "utan läsräknare (87) godtas inte");
  eq((await verify(k2, k, s.e, s.c)).ok, false, "nycklarna i fel ordning");
}

// ---------- administrationen ----------
let msg = "";
try { await call("admin_sdm_enforce", "miyabi-01"); } catch (e) { msg = e.message; }
ok(/saknar nycklar/.test(msg), "bara dynamisk kräver nycklar: " + msg);
const issued = await rows(`select * from public.admin_sdm_issue_keys('Miyabi-01')`);
eq(issued.map((r) => r.steg), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], "tolv rader att programmera efter");
const val = (n) => issued.find((r) => r.steg === n).varde;
eq(val(1), "miyabi-01", "taggen");
eq(val(2), "https://tappass.se/t/miyabi-01?e=00000000000000000000000000000000&c=0000000000000000", "adressmallen");
ok([3, 4, 5].every((n) => /^[0-9a-f]{32}$/.test(val(n))), "tre nycklar à 16 byte");
ok(new Set([val(3), val(4), val(5)]).size === 3, "olika nycklar");
const K0 = Buffer.from(val(3), "hex"), K1 = Buffer.from(val(4), "hex"), K2 = Buffer.from(val(5), "hex");
{
  // Offseten pekar på platshållarna i NDEF-filen, och NLEN/längdbyten stämmer (jfr AN12196: 0051D1014D5504…)
  const ndef = Buffer.from(val(12), "hex");
  const picc = parseInt(val(8)), mac = parseInt(val(10));
  eq(ndef.subarray(picc - 3, picc).toString(), "?e=", "PICCDataOffset efter ?e=");
  eq(ndef.subarray(mac - 3, mac).toString(), "&c=", "SDMMACOffset efter &c=");
  eq(parseInt(val(9)), mac, "MAC-indata tom (samma offset)");
  eq(ndef.readUInt16BE(0), ndef.length - 2, "NLEN");
  eq([...ndef.subarray(2, 4)], [0xd1, 0x01], "kort URI-record");
  eq(ndef[4], ndef.length - 6, "nyttolastens längd");
  eq(ndef.subarray(5, 7).toString("hex"), "5504", "U + https://");
  ok(val(8).includes("(0x"), "offset även hex");
  // AN12196:s exempeladress ger exakt deras offset (0x20 / 0x43) med samma räkning
  const prefix = "choose.url.com/ntag424?e=";
  eq([7 + prefix.length, 7 + prefix.length + 35], [0x20, 0x43], "offsetformeln = AN12196");
}
const sdmRow = async () => one(`select encode(uid,'hex') as uid, counter, enforced, first_at is not null as seen from tag_sdm s join tags t on t.id = s.tag_id where t.token = 'miyabi-01'`);
eq(await sdmRow(), { uid: null, counter: null, enforced: false, seen: false }, "nycklar sparade, inget läst än");
eq(await one(`select encode(meta_key,'hex') = $1 and encode(file_key,'hex') = $2 and encode(master_key,'hex') = $3 as m from tag_sdm`, [val(4), val(5), val(3)]), { m: true }, "nycklarna som visades är de som sparades");

// ---------- stämpling ----------
const stampsOf = async (device) => Number((await one(`select count(*) as n from stamps s join users u on u.id = s.user_id where u.device_id = $1`, [device])).n);
const UID = crypto.randomBytes(7);
const wire = (token, s, upper = false) => { const w = token + "?e=" + s.e + "&c=" + s.c; return upper ? w.toUpperCase() : w; };

// Övergångsläge: den gamla statiska stämpeln fungerar fortfarande
eq((await call("tap_token", "device-static-2", "miyabi-01")).ok, true, "statisk stämpling i övergångsläget");
eq((await call("tap_token", "device-static-3", "linnea-01")).ok, true, "tagg utan nycklar som förut");

const s1 = sun(K1, K2, UID, 1);
const r1 = await call("tap_token", "device-sun-a1", wire("miyabi-01", s1));
eq([r1.ok, r1.stamps_added, r1.cafe.slug], [true, 1, "miyabi"], "äkta läsning ger en stämpel");
eq(await sdmRow(), { uid: UID.toString("hex"), counter: 1, enforced: false, seen: true }, "UID bundet, räknare 1");
eq((await one(`select s.source, t.token from stamps s join tags t on t.id = s.tag_id join users u on u.id = s.user_id where u.device_id = 'device-sun-a1'`)), { source: "tap", token: "miyabi-01" }, "riktig stämpling med taggen");

eq(await call("tap_token", "device-copy-b1", wire("miyabi-01", s1)), { ok: false, error: "replay" }, "kopierad länk (annan telefon) nekas");
eq(await stampsOf("device-copy-b1"), 0, "ingen stämpel för kopian");
eq((await call("tap_token", "device-copy-b1", wire("miyabi-01", sun(K1, K2, UID, 1)))).error, "replay", "samma räknare med annan fyllnad nekas");
const r5 = await call("tap_token", "device-sun-a2", wire("miyabi-01", sun(K1, K2, UID, 5)));
eq(r5.ok, true, "räknaren får hoppa (5)");
eq((await call("tap_token", "device-sun-a3", wire("miyabi-01", sun(K1, K2, UID, 3)))).error, "replay", "lägre räknare nekas");
const bad = sun(K1, K2, UID, 6);
eq(await call("tap_token", "device-forge-c1", "miyabi-01?e=" + bad.e + "&c=" + (bad.c.slice(0, 15) + (bad.c[15] === "0" ? "1" : "0"))), { ok: false, error: "sdm_invalid" }, "förfalskad c nekas");
eq((await call("tap_token", "device-forge-c1", wire("miyabi-01", sun(crypto.randomBytes(16), K2, UID, 6)))).error, "sdm_invalid", "fel nyckel 1 nekas");
eq((await call("tap_token", "device-forge-c1", wire("miyabi-01", sun(K1, K2, crypto.randomBytes(7), 7)))).error, "sdm_invalid", "annan tagg (UID) med samma nycklar nekas");
eq((await sdmRow()).counter, 5, "misslyckade läsningar ändrar inte räknaren");
eq(await stampsOf("device-forge-c1"), 0, "inga stämplar vid förfalskning");

// Formerna äldre appbyggen och andra verktyg skickar
const r6 = await call("tap_token", "device-old-d1", wire("miyabi-01", sun(K1, K2, UID, 6), true));
eq(r6.ok, true, "versaler (\"MIYABI-01?E=…&C=…\") godtas");
const s7 = sun(K1, K2, UID, 7);
eq((await call("tap_token", "device-old-d2", "miyabi-01?c=" + s7.c + "&e=" + s7.e)).ok, true, "c före e");
const s8 = sun(K1, K2, UID, 8);
eq((await call("tap_token", "device-old-d3", "miyabi-01?p=" + s8.e + "&c=" + s8.c)).ok, true, "p= godtas som e=");
const s9 = sun(K1, K2, UID, 9);
eq((await call("tap_token", "device-old-d4", " https://tappass.se/t/miyabi-01?e=" + s9.e + "&c=" + s9.c + "&x=1 ")).ok, true, "hela adressen med extra parameter");
eq((await call("tap_token", "device-old-d5", "miyabi-01?e=" + s9.e)).ok, true, "bara e (ingen c) = statiskt anrop i övergångsläget");

// Felaktig telefon förbrukar ingen läsning; okänd tagg som förut
const s10 = sun(K1, K2, UID, 10);
eq(await call("tap_token", "kort", wire("miyabi-01", s10)), { ok: false, error: "bad_device" }, "bad_device före kontrollen");
eq((await sdmRow()).counter, 9, "bad_device förbrukar inte räknaren");
eq((await call("tap_token", "device-sun-a4", wire("miyabi-01", s10))).ok, true, "samma läsning fungerar sedan");
eq(await call("tap_token", "device-x-e1", "okand-01?e=" + s10.e + "&c=" + s10.c), { ok: false, error: "unknown_tag", token: "okand-01" }, "okänd tagg (token utan e/c i svaret)");

// Väntetid och sparad belöning: läsningen är förbrukad (en ny läsning krävs)
const s11 = sun(K1, K2, UID, 11);
const cd = await call("tap_token", "device-sun-a4", wire("miyabi-01", s11));
eq(cd.error, "cooldown", "väntetid gäller dynamiska läsningar");
eq((await call("tap_token", "device-sun-a4", wire("miyabi-01", s11))).error, "replay", "läsningen förbrukades ändå");

// Bara dynamiskt: den statiska stämpeln slutar fungera
msg = "";
try { await call("admin_sdm_issue_keys", "miyabi-01"); } catch (e) { msg = e.message; }
ok(/redan godkänt läsningar/.test(msg), "nya nycklar skyddade: " + msg);
const enf = await call("admin_sdm_enforce", "miyabi-01");
eq([enf.ok, enf.enforced, enf.counter], [true, true, 11], "bara dynamisk");
eq(await call("tap_token", "device-static-f1", "miyabi-01"), { ok: false, error: "sdm_required" }, "statisk stämpling nekas");
eq(await call("tap_token", "device-static-f1", "miyabi"), { ok: false, error: "unknown_tag", token: "miyabi" }, "slug utan -01 som förut (okänd)");
eq(await stampsOf("device-static-f1"), 0, "ingen stämpel");
eq((await call("tap_token", "device-static-f2", "miyabi-01?e=" + s11.e)).error, "sdm_required", "halv SUN = statisk");
eq((await call("tap_token", "device-sun-a5", wire("miyabi-01", sun(K1, K2, UID, 12)))).ok, true, "dynamisk läsning fungerar");
eq((await call("tap_token", "device-static-f3", "linnea-01")).ok, true, "andra taggar påverkas inte");
eq((await call("admin_sdm_enforce", "miyabi-01")).ok, true, "bara dynamisk igen = ingen ändring");

// Sparad belöning blockerar som förut — och förbrukar läsningen
await db.exec(`insert into redemptions (user_id, cafe_id, saved_at, status, redeem_code)
  select u.id, c.id, now(), 'saved', '512345' from users u, cafes c where u.device_id = 'device-sun-a1' and c.slug = 'miyabi'`);
const s13 = sun(K1, K2, UID, 13);
eq((await call("tap_token", "device-sun-a1", wire("miyabi-01", s13))).error, "pending_reward", "sparad belöning blockerar");
eq((await sdmRow()).counter, 13, "läsningen förbrukad");

// Ett undantag i stämplingen ångrar även räknaren (samma transaktion)
const coreDef = (await one(`select pg_get_functiondef('public.tap_token_core(text,text)'::regprocedure) as d`)).d;
await db.exec(`create or replace function public.tap_token_core(p_device_id text, p_token text) returns jsonb language plpgsql as $$ begin raise exception 'krasch'; end $$;`);
const s14 = sun(K1, K2, UID, 14);
msg = "";
try { await call("tap_token", "device-sun-a6", wire("miyabi-01", s14)); } catch (e) { msg = e.message; }
ok(/krasch/.test(msg), "undantaget når klienten");
eq((await sdmRow()).counter, 13, "räknaren ångrad");
await db.exec(coreDef);
await db.exec(`revoke execute on function public.tap_token_core(text, text) from public, anon, authenticated;`);
eq(await hex(`select md5(prosrc) as h from pg_proc where oid = 'public.tap_token_core(text,text)'::regprocedure`), V8_TAP, "kärnan återställd");
eq((await call("tap_token", "device-sun-a6", wire("miyabi-01", s14))).ok, true, "samma läsning kan skickas igen efter ett fel");

// Inaktiv tagg: som förut, och nycklarna rörs inte
await db.exec(`update tags set active = false where token = 'miyabi-01'`);
eq((await call("tap_token", "device-sun-a7", wire("miyabi-01", sun(K1, K2, UID, 20)))).error, "unknown_tag", "inaktiv tagg");
eq((await sdmRow()).counter, 14, "räknaren orörd");
await db.exec(`update tags set active = true where token = 'miyabi-01'`);

// v16: en ny kund med en väns kod belönas av en dynamisk stämpling (triggern ligger kvar)
{
  const host = await call("invite_code", "device-host-g1");
  eq(host.ok, true, "inbjudarens kod");
  eq((await call("tap_token", "device-friend-g2", "linnea-01")).ok, true, "vännen finns (statiskt hos Linnea)");
  await db.exec(`delete from stamps where user_id = (select id from users where device_id = 'device-friend-g2')`);
  eq((await call("invite_redeem", "device-friend-g2", host.code)).ok, true, "vännen anger koden");
  const g = await call("tap_token", "device-friend-g2", wire("miyabi-01", sun(K1, K2, UID, 21)));
  eq([g.ok, g.stamps], [true, 3], "1 + 2 inbjudningsstämplar i svaret");
}

// Status utan hemligheter
const st = await rows(`select * from public.admin_sdm_status()`);
eq(st.length, 2, "en rad per tagg");
const mi = st.find((r) => r.tagg === "miyabi-01");
eq([mi.butik, mi.nycklar, mi.bara_dynamisk, mi.uid_bunden, mi.raknare], ["Miyabi", true, true, true, 21], "status för Miyabi");
eq([st.find((r) => r.tagg === "linnea-01").nycklar, st.find((r) => r.tagg === "linnea-01").bara_dynamisk], [false, false], "status för tagg utan nycklar");
ok(!JSON.stringify(st).includes(val(4)) && !Object.keys(mi).some((k) => /key|nyckel/.test(k) && !/^nycklar/.test(k)), "inga nycklar i statusen");

// Ny tagg på samma token (p_replace): nya nycklar, övergångsläge, den gamla taggen nekas
const re = await rows(`select * from public.admin_sdm_issue_keys('miyabi-01', p_replace => true)`);
const K1b = Buffer.from(re.find((r) => r.steg === 4).varde, "hex"), K2b = Buffer.from(re.find((r) => r.steg === 5).varde, "hex");
ok(!K1b.equals(K1), "nya nycklar");
eq(await sdmRow(), { uid: null, counter: null, enforced: false, seen: false }, "nollställd och i övergångsläge");
eq((await call("tap_token", "device-old-h1", wire("miyabi-01", sun(K1, K2, UID, 30)))).error, "sdm_invalid", "gamla taggen nekas");
const UID2 = crypto.randomBytes(7);
eq((await call("tap_token", "device-new-h2", wire("miyabi-01", sun(K1b, K2b, UID2, 1)))).ok, true, "nya taggen börjar om på räknare 1");

// Nödläge: tillbaka till statisk
eq(await call("admin_sdm_disable", "miyabi-01"), { ok: true, token: "miyabi-01", removed: true }, "nycklarna borttagna");
eq((await call("tap_token", "device-static-i1", "miyabi-01")).ok, true, "statisk igen");
eq((await call("tap_token", "device-static-i2", wire("miyabi-01", sun(K1b, K2b, UID2, 2)))).ok, true, "den programmerade taggen fungerar som statisk");
eq((await call("admin_sdm_disable", "miyabi-01")).removed, false, "ingenting att ta bort");
msg = "";
try { await call("admin_sdm_issue_keys", "finns-inte"); } catch (e) { msg = e.message; }
ok(/Okänd tagg/.test(msg), "okänd tagg: " + msg);
msg = "";
await db.query(`select * from public.admin_sdm_issue_keys('miyabi-01')`);
try { await call("admin_sdm_enforce", "miyabi-01"); } catch (e) { msg = e.message; }
ok(/Ingen läsning/.test(msg), "bara dynamisk kräver en godkänd läsning: " + msg);

// ---------- behörigheter ----------
const can = async (role, sig) => (await one(`select has_function_privilege($1, $2, 'execute') as x`, [role, sig])).x;
for (const role of ["anon", "authenticated"]) {
  eq(await can(role, "public.tap_token(text,text)"), true, role + " får stämpla");
  for (const sig of ["public.tap_token_core(text,text)", "public.sdm_verify(bytea,bytea,bytea,bytea)", "public.aes_cmac(bytea,bytea)", "public.sdm_aes(bytea,bytea)",
    "public.sdm_bits(bytea)", "public.sdm_bytes(bit)", "public.admin_sdm_issue_keys(text,boolean)", "public.admin_sdm_enforce(text)", "public.admin_sdm_disable(text)", "public.admin_sdm_status()"]) {
    eq(await can(role, sig), false, role + " stängd: " + sig);
  }
  eq((await one(`select has_table_privilege($1, 'public.tag_sdm', 'select') as x`, [role])).x, false, role + " kan inte läsa tag_sdm");
}
eq((await one(`select relrowsecurity as x from pg_class where oid = 'public.tag_sdm'::regclass`)).x, true, "RLS på tag_sdm");
{
  // Som anon via rollbyte: stämpling fungerar, kärnan och tabellen gör det inte
  await db.exec(`grant usage on schema public to anon; grant usage on schema extensions to anon;`);
  await db.exec(`set role anon`);
  const r = (await db.query(`select public.tap_token('device-anon-j1', 'linnea-01') as r`)).rows[0].r;
  eq(r.ok, true, "anon stämplar via tap_token");
  let m1 = "", m2 = "";
  try { await db.query(`select public.tap_token_core('device-anon-j1', 'linnea-01')`); } catch (e) { m1 = e.message; }
  try { await db.query(`select * from public.tag_sdm`); } catch (e) { m2 = e.message; }
  await db.exec(`reset role`);
  ok(/permission denied/.test(m1), "anon kan inte anropa kärnan: " + m1);
  ok(/permission denied/.test(m2), "anon kan inte läsa nycklarna: " + m2);
}

// ---------- kan köras igen ----------
const keysBefore = await one(`select encode(meta_key,'hex') as k from tag_sdm`);
await db.exec(V17);
eq(await hex(`select md5(prosrc) as h from pg_proc where oid = 'public.tap_token_core(text,text)'::regprocedure`), V8_TAP, "andra körningen: kärnan orörd");
eq(await hex(`select md5(prosrc) as h from pg_proc where oid = 'public.tap_token(text,text)'::regprocedure`), fp.tap_token, "andra körningen: samma yttre funktion");
eq(await one(`select encode(meta_key,'hex') as k from tag_sdm`), keysBefore, "nycklarna ligger kvar");
eq(await can("anon", "public.tap_token_core(text,text)"), false, "kärnan fortfarande stängd");

console.log("Fingeravtryck efter körning:");
for (const [n, h] of Object.entries(fp).sort()) console.log("  " + n, h);
console.log(passed + " kontroller OK");
