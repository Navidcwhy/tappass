// Taggverktyget (src/lib/ntag424.js) hela vägen: nycklar från admin_sdm_issue_keys (PGlite,
// produktionens v17-SQL) → inklistring → programmering av en simulerad NTAG 424 DNA →
// en kundtelefon läser taggen (appens splitTag/wireToken) → tap_token godkänner läsningen.
// Plus avbrott vid varje kommando, återupptagning, fel nycklar, främmande taggar och återställning.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import * as N from "./lib/ntag424.mjs";
import { toHex, fromHex } from "./lib/aes.mjs";
import { splitTag, wireToken } from "./lib/tagurl.mjs";
const require = createRequire(import.meta.url);
const { SimTag, connect } = require("../app/__tests__/sim-ntag424.js");

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
const CHAIN = ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar", "v9_inlosen_tapp", "v10_fler_beloningar", "v11_stamgaster", "v12_insikter", "v13_profil", "v14_konto", "v15_fodelsedag", "v16_bjud_in", "v17_dynamiska_taggar"];

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(BASE + AUTH);
for (const v of CHAIN) await db.exec(read(v));
const LONG = "kafe-" + "x".repeat(40);
await db.exec(`
  insert into cafes (slug, name, type, area, stamps_needed, city) values
    ('miyabi', 'Miyabi', 'Sushi', 'Lidingö', 6, 'Stockholm'),
    ('kafe-bryggan', 'Kafé Bryggan', 'Kafé', 'Södermalm', 8, 'Stockholm'),
    ('a', 'A', 'Kafé', 'X', 8, 'Stockholm'),
    ('${LONG}', 'Lång', 'Kafé', 'X', 8, 'Stockholm');
  insert into tags (cafe_id, token) select id, slug || '-01' from cafes;
`);
const call = async (fn, ...args) => (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const issue = async (token, replace = false) => (await db.query(`select * from public.admin_sdm_issue_keys($1, $2)`, [token, replace])).rows;
const val = (rows, n) => rows.find((r) => r.steg === n).varde;

// Resultatet som det kopieras ur SQL Editor: rutnät (tabbar), CSV, JSON och Markdown
const asTsv = (rows) => "steg\tinstallning\tvarde\n" + rows.map((r) => [r.steg, r.installning, r.varde].join("\t")).join("\n");
const asCsv = (rows) => "steg,installning,varde\n" + rows.map((r) => [r.steg, JSON.stringify(r.installning), JSON.stringify(r.varde)].join(",")).join("\n");
const asJson = (rows) => JSON.stringify(rows, null, 2);
const asMd = (rows) => "| steg | installning | varde |\n|---|---|---|\n" + rows.map((r) => `| ${r.steg} | ${r.installning} | ${r.varde} |`).join("\n");

// ---------- mallen = SQL:en ----------
for (const token of ["miyabi-01", "kafe-bryggan-01", "a-01", LONG + "-01"]) {
  const rows = await issue(token);
  const t = N.ndefTemplate(token);
  eq(toHex(t.file), val(rows, 12), "NDEF-filen = rad 12 (" + token + ")");
  eq(t.piccOffset, parseInt(val(rows, 8)), "PICCDataOffset = rad 8 (" + token + ")");
  eq(t.macOffset, parseInt(val(rows, 10)), "SDMMACOffset = rad 10 (" + token + ")");
  eq(t.url, val(rows, 2), "adressen = rad 2 (" + token + ")");
  for (const [name, fmt] of [["rutnät", asTsv], ["CSV", asCsv], ["JSON", asJson], ["Markdown", asMd]]) {
    const p = N.parseIssuedKeys(fmt(rows));
    eq([p.ok, p.token, p.k0 && toHex(p.k0), p.k1 && toHex(p.k1), p.k2 && toHex(p.k2)], [true, token, val(rows, 3), val(rows, 4), val(rows, 5)], name + " (" + token + ")");
  }
}

// ---------- programmering + kundtelefonen + servern ----------
const rows = await issue("miyabi-01");
const cfg = N.parseIssuedKeys(asTsv(rows));
const K = [cfg.k0, cfg.k1, cfg.k2].map((k) => Buffer.from(k));
const expectProgrammed = (tag, keys = K, label = "") => {
  eq(tag.keys.slice(0, 3).map((k) => k.toString("hex")), keys.map((k) => k.toString("hex")), "nycklarna på taggen " + label);
  eq([...tag.keyVer], [1, 1, 1, 0, 0], "nyckelversioner " + label);
  eq([tag.fileOption, ...tag.ar], [0x40, 0x00, 0xe0], "SDM på, läsa fritt, skriva med nyckel 0 " + label);
  eq(tag.sdm, { options: 0xc1, ar: [0xff, 0x12], picc: cfg && N.ndefTemplate("miyabi-01").piccOffset, macIn: N.ndefTemplate("miyabi-01").macOffset, mac: N.ndefTemplate("miyabi-01").macOffset }, "SDM-inställningarna " + label);
  eq(tag.file.subarray(0, N.ndefTemplate("miyabi-01").file.length).toString("hex"), N.ndefTemplate("miyabi-01").file.length && toHex(N.ndefTemplate("miyabi-01").file), "NDEF-filen " + label);
};

// En kundtelefon läser taggen som NDEF (ISO-kommandon) och skickar adressen till tap_token
async function phoneTap(tag, device) {
  tag.reset();
  const tx = connect(tag);
  await tx(fromHex("00a4040007d276000085010100"));
  await tx(fromHex("00a4000002e10400"));
  const head = await tx(fromHex("00b0000002"));
  const nlen = (head[0] << 8) | head[1];
  const body = await tx(Uint8Array.from([0x00, 0xb0, 0x00, 0x02, nlen]));
  const rec = body.slice(0, nlen);
  eq([rec[0], rec[1], rec[3], rec[4]], [0xd1, 0x01, 0x55, 0x04], "URI-record med https://");
  const url = "https://" + String.fromCharCode(...rec.slice(5)).toLowerCase();   // som nfc.js: hela adressen, gemener
  const tagInfo = splitTag(url);
  return { url, wire: wireToken(tagInfo.token, tagInfo.sun), res: await call("tap_token", device, wireToken(tagInfo.token, tagInfo.sun)) };
}

const tag = new SimTag();
const steps = [];
const result = await N.programTag(connect(tag, { asArray: true }), cfg, (s) => steps.push(s));
eq(steps, ["connect", "ndef", "sdm", "keys", "verify"], "stegen i ordning");
eq([result.token, result.uid, result.url], ["miyabi-01", tag.uid.toString("hex"), val(rows, 2)], "resultatet");
ok(result.counter >= 1, "läsräknaren i kontrollen: " + result.counter);
expectProgrammed(tag);
const FULL_RUN = tag.log.length;
ok(FULL_RUN >= 15 && FULL_RUN <= 25, "antal kommandon i en hel körning: " + FULL_RUN);
eq(tag.log.filter((h) => h.startsWith("90c4")).length, 3, "tre ChangeKey");
eq(tag.log.filter((h) => h.startsWith("00d6")).length, 1, "NDEF skriven en gång (före inloggningen)");
ok(tag.log.indexOf(tag.log.find((h) => h.startsWith("00d6"))) < tag.log.indexOf(tag.log.find((h) => h.startsWith("9071"))), "skrivningen före första inloggningen");
{
  const ck = tag.log.map((h, i) => [h, i]).filter(([h]) => h.startsWith("90c4"));
  eq(ck.map(([h]) => h.slice(10, 12)), ["01", "02", "00"], "nyckel 1, 2 och huvudnyckeln sist");
}

const t1 = await phoneTap(tag, "device-kund-1");
eq([t1.res.ok, t1.res.stamps_added, t1.res.cafe.slug], [true, 1, "miyabi"], "kundens läsning ger en stämpel");
ok(/^miyabi-01\?e=[0-9a-f]{32}&c=[0-9a-f]{16}$/.test(t1.wire), "appen skickar token + SUN: " + t1.wire);
eq(await one(`select encode(uid,'hex') as uid, counter from tag_sdm s join tags t on t.id = s.tag_id where t.token = 'miyabi-01'`), { uid: tag.uid.toString("hex"), counter: tag.readCtr }, "servern band taggens UID och räknare");
eq(await call("tap_token", "device-kopia", t1.wire), { ok: false, error: "replay" }, "kopierad adress nekas");
eq((await phoneTap(tag, "device-kund-2")).res.ok, true, "nästa läsning godkänns");
await call("admin_sdm_enforce", "miyabi-01");
eq((await call("tap_token", "device-statisk", "miyabi-01")).error, "sdm_required", "bara dynamisk: den gamla statiska nekas");
eq((await phoneTap(tag, "device-kund-3")).res.ok, true, "den programmerade taggen fungerar som bara dynamisk");

// ---------- körs om: inget görs två gånger ----------
{
  const before = tag.log.length;
  const again = await N.programTag(connect(tag), cfg);
  eq(again.uid, tag.uid.toString("hex"), "omkörning lyckas");
  const run = tag.log.slice(before);
  eq(run.filter((h) => h.startsWith("90c4") || h.startsWith("00d6") || h.startsWith("908d") || h.startsWith("905f")).length, 0, "omkörning: inga nyckelbyten, skrivningar eller nya filinställningar");
  expectProgrammed(tag, K, "(omkörd)");
  ok(tag.readCtr > 0, "läsräknaren nollställdes inte av omkörningen: " + tag.readCtr);
  eq((await phoneTap(tag, "device-kund-efter-omkorning")).res.ok, true, "servern godkänner taggen efter omkörningen (räknaren fortsätter)");
}

// ---------- avbrott vid varje kommando, före och efter att taggen utfört det ----------
const sdmOk = async (t, r) => (await call("sdm_verify", cfg.k1 && Buffer.from(cfg.k1), Buffer.from(cfg.k2), Buffer.from(r.e, "hex"), Buffer.from(r.c, "hex")));
async function readSun(t) {
  t.reset();
  const tx = connect(t);
  await tx(fromHex("00a4040007d276000085010100"));
  await tx(fromHex("00a4000002e10400"));
  const f = await tx(Uint8Array.from([0x00, 0xb0, 0x00, 0x00, N.ndefTemplate("miyabi-01").file.length]));
  return N.sunFromFile(f.slice(0, f.length - 2), N.ndefTemplate("miyabi-01"));
}
let cuts = 0;
for (let at = 0; at < FULL_RUN; at++) {
  for (const after of [false, true]) {
    const t = new SimTag();
    let code = null;
    try { await N.programTag(connect(t, { cut: { at, after } }), cfg); } catch (e) { code = e.code; }
    eq(code, "lost", `avbrott vid kommando ${at} (${after ? "efter" : "före"}) → lost`);
    const r = await N.programTag(connect(t), cfg);
    eq(r.uid, t.uid.toString("hex"), `återupptagen efter avbrott ${at}/${after}`);
    expectProgrammed(t, K, `(avbrott ${at}/${after})`);
    const s = await readSun(t);
    eq((await sdmOk(t, s)).uid, t.uid.toString("hex"), `servern godkänner SUN efter avbrott ${at}/${after}`);
    cuts++;
  }
}
// Flera avbrott i rad på slumpade ställen
for (let n = 0; n < 40; n++) {
  const t = new SimTag();
  for (let k = 0; k < 3; k++) {
    try { await N.programTag(connect(t, { cut: { at: crypto.randomInt(0, FULL_RUN), after: crypto.randomInt(0, 2) === 1 } }), cfg); } catch (e) { ok(e.code === "lost", "bara lost vid avbrott: " + e.code); }
  }
  await N.programTag(connect(t), cfg);
  expectProgrammed(t, K, "(flera avbrott " + n + ")");
}

// ---------- fel nycklar och främmande taggar ----------
const codeOf = async (p) => { try { await p; return "ok"; } catch (e) { return e.code; } };
{
  const other = N.parseIssuedKeys(asTsv(await issue("kafe-bryggan-01")));
  eq(await codeOf(N.programTag(connect(tag), { ...other, token: "miyabi-01" })), "wrong_key", "programmerad tagg + andra nycklar → wrong_key");
  const t = new SimTag(); t.keys[0] = crypto.randomBytes(16);
  eq(await codeOf(N.programTag(connect(t), cfg)), "foreign_key", "annan huvudnyckel med version 00 → foreign_key");
  const t2 = new SimTag(); t2.keys[0] = crypto.randomBytes(16); t2.keyVer[0] = 5;
  eq(await codeOf(N.programTag(connect(t2), cfg)), "wrong_key", "annan huvudnyckel med version 05 → wrong_key");
  const t3 = new SimTag(); t3.keys[1] = crypto.randomBytes(16);
  eq(await codeOf(N.programTag(connect(t3), cfg)), "foreign_key1", "nyckel 1 bytt av annat verktyg (version 00) → foreign_key1");
  eq(t3.keyVer[0], 0, "huvudnyckeln orörd när nyckel 1 inte gick att byta");
  const t4 = new SimTag(); t4.keys[2] = crypto.randomBytes(16); t4.keyVer[2] = 1;
  eq(await codeOf(N.programTag(connect(t4), cfg)), "key_mismatch", "nyckel 2 med version 01 men fel värde → key_mismatch i kontrollen");
  eq(await codeOf(N.programTag(async () => fromHex("6a82"), cfg)), "not_ntag424", "annan kortsort (6A 82) → not_ntag424");
  eq(await codeOf(N.programTag(async () => { throw new Error("transceive fail"); }, cfg)), "lost", "överföringsfel → lost");
}
// ---------- halvfärdig tagg där filen redan kräver nyckel 0 (WriteData efter inloggningen) ----------
{
  const t = new SimTag(); t.ar = [0x00, 0xe0];
  const r = await N.programTag(connect(t), cfg);
  eq(r.uid, t.uid.toString("hex"), "skrivskyddad fil skrivs efter inloggningen");
  ok(t.log.some((h) => h.startsWith("908d")), "WriteData användes");
  expectProgrammed(t, K, "(WriteData)");
}

// ---------- återställning och ny programmering med nya nycklar ----------
{
  eq(await codeOf(N.resetTag(connect(tag), { ...cfg, k1: crypto.randomBytes(16) })), "wrong_key1", "återställning med fel nyckel 1 → wrong_key1");
  const t = new SimTag();
  await N.programTag(connect(t), cfg);
  const rs = [];
  eq((await N.resetTag(connect(t), cfg, (s) => rs.push(s))).ok, true, "återställd");
  eq(rs, ["connect", "sdm", "keys", "verify"], "återställningens steg");
  eq([t.keys.every((k) => k.equals(Buffer.alloc(16))), [...t.keyVer], t.fileOption, ...t.ar], [true, [0, 0, 0, 0, 0], 0x00, 0xe0, 0xee], "fabriksläge");
  // Avbrott under återställningen → kör om
  const t2 = new SimTag();
  await N.programTag(connect(t2), cfg);
  for (let at = 0; at < 14; at++) {
    try { await N.resetTag(connect(t2, { cut: { at, after: true } }), cfg); } catch (e) { ok(e.code === "lost", "återställning avbruten: " + e.code); }
  }
  await N.resetTag(connect(t2), cfg);
  eq([...t2.keyVer], [0, 0, 0, 0, 0], "återställd trots avbrott");

  // Hela vägen med nya nycklar: taggen har redan godkänts → p_replace
  let msg = "";
  try { await issue("miyabi-01"); } catch (e) { msg = e.message; }
  ok(/p_replace/.test(msg), "nya nycklar kräver p_replace efter godkänd läsning");
  const fresh = N.parseIssuedKeys(asMd(await issue("miyabi-01", true)));
  await N.resetTag(connect(tag), cfg);
  const again = await N.programTag(connect(tag), fresh);
  eq(again.uid, tag.uid.toString("hex"), "omprogrammerad med nya nycklar");
  const t5 = await phoneTap(tag, "device-kund-4");
  eq(t5.res.ok, true, "servern godkänner taggen med de nya nycklarna");
}

// ---------- inklistringen: fel och gränsfall ----------
{
  const ts = asTsv(rows);
  eq(N.parseIssuedKeys("").error, "empty", "tomt");
  eq(N.parseIssuedKeys(ts.replace(/\n4\t[^\n]*/, "")).missing, [1], "saknad nyckel 1");
  eq(N.parseIssuedKeys(ts.replace(/\n[45]\t[^\n]*/g, "")).error, "missing_keys", "saknade nycklar");
  eq(N.parseIssuedKeys(ts + "\n" + asTsv(await issue("kafe-bryggan-01"))).error, "two_tags", "två taggar");
  eq(N.parseIssuedKeys(ts.replace(val(rows, 12), val(rows, 12).slice(0, -2) + "31")).error, "template", "rad 12 stämmer inte med mallen");
  eq(N.parseIssuedKeys(ts.replace(val(rows, 4), val(rows, 3))).error, "same_keys", "samma nyckel två gånger");
  eq(N.parseIssuedKeys(ts.replace(val(rows, 5), "0".repeat(32))).error, "zero_key", "nollnyckel");
  eq(N.parseIssuedKeys("Nyckel 0 " + val(rows, 3) + " Nyckel 1 " + val(rows, 4) + " Nyckel 2 " + val(rows, 5)).error, "no_tag", "utan tagg");
  const minimal = N.parseIssuedKeys("Tagg miyabi-01\nNyckel 0: " + val(rows, 3).toUpperCase() + "\nNyckel 1: " + val(rows, 4) + "\nNyckel 2: " + val(rows, 5));
  eq([minimal.ok, minimal.token, toHex(minimal.k0)], [true, "miyabi-01", val(rows, 3)], "kort form med versaler");
  // README-frågan för en tagg som redan har nycklar (samma rader)
  const readme = (await db.query(`select x.* from public.tag_sdm s join public.tags t on t.id = s.tag_id,
      lateral (values (1, 'Tagg', t.token), (3, 'Nyckel 0', encode(s.master_key, 'hex')), (4, 'Nyckel 1', encode(s.meta_key, 'hex')),
                      (5, 'Nyckel 2', encode(s.file_key, 'hex'))) as x(steg, installning, varde)
      where t.token = 'miyabi-01' order by x.steg`)).rows;
  const pr = N.parseIssuedKeys(asTsv(readme));
  eq([pr.ok, pr.token, toHex(pr.k0), toHex(pr.k1), toHex(pr.k2)], [true, "miyabi-01", ...tag.keys.slice(0, 3).map((k) => k.toString("hex"))], "README-frågan ger nycklarna som taggen har");
}

console.log(`tagtool e2e: ${passed} kontroller, ${cuts} avbrottsfall, ${FULL_RUN} kommandon per körning`);
await db.close();
