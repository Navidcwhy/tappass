// v16: Bjud in en vän — koden, inlösen, triggern på riktiga stämplingar, fuskskydd.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
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
`;
const CHAIN = ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar", "v9_inlosen_tapp", "v10_fler_beloningar", "v11_stamgaster", "v12_insikter", "v13_profil", "v14_konto"];
const V16 = read("v16_bjud_in");

{
  const early = new PGlite();
  await early.exec(BASE + AUTH);
  for (const v of CHAIN) await early.exec(read(v));
  let msg = "";
  try { await early.exec(V16); } catch (e) { msg = e.message; }
  ok(/Kör v15 först/.test(msg), "v16 kräver v15: " + msg);
  await early.exec(read("v15_fodelsedag"));
  await early.exec(`create or replace function public.merge_users(p_from uuid, p_to uuid) returns int language sql as $$ select 0 $$;`);
  msg = "";
  try { await early.exec(V16); } catch (e) { msg = e.message; }
  ok(/merge_users är inte v14-versionen/.test(msg), "vakt: " + msg);
  await early.close();
}

const db = new PGlite();
const call = async (fn, ...args) =>
  (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const as = async (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid || ""]);
await db.exec(BASE + AUTH);
for (const v of [...CHAIN, "v15_fodelsedag"]) await db.exec(read(v));
await db.exec(`
  insert into cafes(slug, name, type, area, stamps_needed, reward_text, reward_short, city) values
    ('linnea', 'Café Linnea', 'Kafé', 'Vasastan', 10, 'En kaffe på huset', 'Gratis kaffe', 'Stockholm'),
    ('miyabi', 'Miyabi', 'Sushi-restaurang', 'Lidingö', 6, 'En 5-bitars sushi på huset', 'Gratis 5-bitars sushi', 'Stockholm'),
    ('bryggan', 'Bryggans Bageri', 'Bageri', 'Södermalm', 8, 'En kanelbulle på huset', 'Gratis kanelbulle', 'Stockholm');
  insert into tags(cafe_id, token) select id, slug || '-01' from cafes;
  insert into merchant_sessions(token_hash, cafe_id, expires_at)
    select encode(sha256(convert_to('tok-' || slug, 'UTF8')), 'hex'), id, now() + interval '30 days' from cafes;
`);
await db.exec(V16);
await db.exec(V16);   // kan köras två gånger

const uid = async (dev) => (await one(`select id from users where device_id = $1`, [dev]) || {}).id;
const card = async (dev, slug) => ((await call("load_wallet", dev)).find((w) => w.cafe.slug === slug) || {}).stamps || 0;
const tapStamp = (dev, slug, at = "now()") => db.query(
  `insert into stamps(user_id, cafe_id, stamped_at, source) select u.id, c.id, ${at}, 'tap' from users u, cafes c where u.device_id = $1 and c.slug = $2`, [dev, slug]);
const ageUser = (dev, days) => db.query(`update users set created_at = now() - make_interval(days => $2::int) where device_id = $1`, [dev, days]);

// ── Koden ────────────────────────────────────────────────────────────
const ANNA = "device-ANNA-0001", BOB = "device-BOB-00001";
eq((await call("invite_status", ANNA)), { ok: true, code: null, can_redeem: true, redeem_until: null, entered: null, friends: 0, rewarded: 0, unseen: [] }, "ny telefon: ingen kod än");
const ic = await call("invite_code", ANNA);
ok(/^[2-9A-HJKMNP-Z]{6}$/.test(ic.code), "kod utan 0/O/1/I/L: " + ic.code);
ok(!!(await uid(ANNA)), "kundraden skapas");
eq((await call("invite_code", ANNA)).code, ic.code, "samma kod igen");
eq((await call("invite_code", "kort")).error, "bad_device", "ogiltigt id");
await ageUser(ANNA, 40);   // Anna har haft appen länge
await tapStamp(ANNA, "linnea", "now() - interval '30 days'");

// ── Ange en kod: fel ─────────────────────────────────────────────────
eq((await call("invite_redeem", BOB, "ABC")).error, "unknown_code", "fel format");
eq((await call("invite_redeem", BOB, "ZZZZZZ")).error, "unknown_code", "okänd kod");
eq((await call("invite_redeem", ANNA, ic.code)).error, "own_code", "sin egen kod");
eq((await call("invite_redeem", ANNA, (await call("invite_code", "device-ANY-00001")).code)).error, "too_late", "Anna är inte ny");

// ── Bob anger Annas kod (gemener och bindestreck går bra) ───────────────
const messy = ic.code.slice(0, 3).toLowerCase() + "-" + ic.code.slice(3);
const r1 = await call("invite_redeem", BOB, messy);
eq([r1.ok, r1.status], [true, "pending"], "väntar på Bobs första stämpel");
ok(!!r1.until, "giltig 7 dagar");
eq((await call("invite_redeem", BOB, ic.code)).error, "already_used", "en kod per telefon");
const bobStatus = await call("invite_status", BOB);
eq([bobStatus.can_redeem, bobStatus.entered.status], [false, "pending"], "Bobs status");
eq((await call("invite_status", ANNA)).friends, 1, "Anna har bjudit in en vän");
const bobCode = (await call("invite_code", BOB)).code;
eq((await call("invite_redeem", ANNA, bobCode)).error, "too_late", "Anna kan inte ange Bobs kod");

// Kampanjstämplar (bonus) ger inget — bara riktiga stämplingar
await db.query(`insert into stamps(user_id, cafe_id, source) select id, (select id from cafes where slug = 'miyabi'), 'bonus' from users where device_id = $1`, [BOB]);
eq((await one(`select status from invites where friend_id = $1`, [await uid(BOB)])).status, "pending", "bonusstämpel räknas inte");

// Bobs första riktiga stämpling via tap_token: 1 + 2 och Anna får 2 hos Café Linnea
const annaBefore = await card(ANNA, "linnea");
const tap = await call("tap_token", BOB, "linnea-01");
eq([tap.ok, tap.stamps], [true, 3], "tap_token: 1 + 2 i svaret");
eq(await card(ANNA, "linnea"), annaBefore + 2, "Anna fick 2");
const inv = await one(`select status, friend_stamps, inviter_stamps, (cafe_id = (select id from cafes where slug = 'linnea')) as here from invites where friend_id = $1`, [await uid(BOB)]);
eq([inv.status, inv.friend_stamps, inv.inviter_stamps, inv.here], ["rewarded", 2, 2, true], "inbjudan belönad hos Café Linnea");
eq((await one(`select count(*)::int n from stamps where user_id = $1 and source = 'bonus' and cafe_id = (select id from cafes where slug = 'linnea')`, [await uid(BOB)])).n, 2, "Bobs stämplar är kampanjstämplar");
const as1 = await call("invite_status", ANNA);
eq([as1.rewarded, as1.unseen.map((u) => u.cafe_name)], [1, ["Café Linnea"]], "Anna ser att Bob stämplat");
eq((await call("invite_ack", ANNA)).acked, 1, "kvitterat");
eq((await call("invite_status", ANNA)).unseen, [], "visas en gång");
eq((await call("invite_status", BOB)).entered.cafe_name, "Café Linnea", "Bob ser var");
await tapStamp(BOB, "miyabi");
eq(await card(ANNA, "miyabi"), 0, "bara en gång");

// ── Redan stämplat innan koden angavs (inom 7 dagar) ─────────────────
const CARL = "device-CARL-0001";
await call("invite_code", CARL);
await tapStamp(CARL, "miyabi", "now() - interval '1 day'");
await tapStamp(CARL, "bryggan");
const r2 = await call("invite_redeem", CARL, ic.code);
eq([r2.status, r2.cafe_slug], ["rewarded", "miyabi"], "belönas direkt hos första stället");
eq([await card(CARL, "miyabi"), await card(ANNA, "miyabi")], [3, 2], "Carl 1 + 2, Anna 2 hos Miyabi");

// ── För sent: stämpeln kom efter de 7 dagarna ───────────────────────
const DORA = "device-DORA-0001";
await call("invite_code", DORA);
await ageUser(DORA, 6);
eq((await call("invite_redeem", DORA, ic.code)).status, "pending", "dag 6: kod godtas");
await tapStamp(DORA, "bryggan", "now() + interval '2 days'");
eq((await one(`select status from invites where friend_id = $1`, [await uid(DORA)])).status, "expired", "stämpel dag 8: utgången");
eq(await card(DORA, "bryggan"), 1, "inga extra stämplar");

// ── Ställe utan inbjudningsstämplar ─────────────────────────────────
await db.query(`update cafes set invite_enabled = false where slug = 'bryggan'`);
const ERIK = "device-ERIK-0001";
eq((await call("invite_redeem", ERIK, ic.code)).status, "pending", "Erik");
await tapStamp(ERIK, "bryggan");
eq((await one(`select status from invites where friend_id = $1`, [await uid(ERIK)])).status, "pending", "Bryggan ger inget — väntar kvar");
await tapStamp(ERIK, "linnea");
eq((await one(`select status from invites where friend_id = $1`, [await uid(ERIK)])).status, "rewarded", "nästa ställe ger stämplarna");
await db.query(`update cafes set invite_enabled = true where slug = 'bryggan'`);

// ── Ömsesidigt ──────────────────────────────────────────────────────
const FIA = "device-FIA-00001", GUS = "device-GUS-00001";
const fiaCode = (await call("invite_code", FIA)).code;
const gusCode = (await call("invite_code", GUS)).code;
eq((await call("invite_redeem", GUS, fiaCode)).status, "pending", "Gus anger Fias kod");
eq((await call("invite_redeem", FIA, gusCode)).error, "mutual", "Fia kan inte ange Gus kod tillbaka");

// ── Tak: högst 5 belönade per inbjudare och 30 dagar ────────────────
for (let i = 0; i < 3; i++) {   // Anna har redan Bob, Carl och Erik = 3; två till ger 5
  const dev = "device-CAP-" + i + "0000";
  await call("invite_redeem", dev, ic.code);
  await tapStamp(dev, "linnea");
}
const capped = await one(`select inviter_stamps, friend_stamps from invites where friend_id = $1`, [await uid("device-CAP-20000")]);
eq([capped.friend_stamps, capped.inviter_stamps], [2, 0], "sjätte vännen: vännen får sina, Anna inga");
eq((await call("invite_status", ANNA)).rewarded, 5, "fem belönade");

// ── En trasig inbjudan stoppar aldrig en stämpling ──────────────────
const HUGO = "device-HUGO-0001";
eq((await call("invite_redeem", HUGO, fiaCode)).status, "pending", "Hugo");
await db.exec(`create or replace function public.invite_grant(p_invite uuid, p_cafe uuid) returns jsonb language plpgsql as $$ begin raise exception 'trasig'; end $$;`);
const t2 = await call("tap_token", HUGO, "miyabi-01");
eq([t2.ok, t2.stamps], [true, 1], "stämplingen gick igenom");
eq((await one(`select status from invites where friend_id = $1`, [await uid(HUGO)])).status, "pending", "inbjudan orörd");
await db.exec(V16);   // återställ

// ── Raderad kunds kod fungerar inte ─────────────────────────────────
const U1 = "11111111-1111-4111-8111-111111111111";
await db.query(`insert into auth.users(id, email) values ($1, 'fia@exempel.se')`, [U1]);
await as(U1); await call("account_link", FIA); await call("account_delete"); await as(null);
eq((await call("invite_redeem", "device-IDA-00001", fiaCode)).error, "unknown_code", "raderat konto: koden fungerar inte");

// ── Konto: telefoner slås ihop ──────────────────────────────────────
// Jonas (ny) har angett Annas kod på telefon P och bjudit in Kim; loggar sedan in på sitt
// befintliga konto (telefon K) — inbjudningarna följer med
const P = "device-JONAS-P01", K = "device-JONAS-K01", KIM = "device-KIM-00001";
const U2 = "22222222-2222-4222-8222-222222222222";
await db.query(`insert into auth.users(id, email) values ($1, 'jonas@exempel.se')`, [U2]);
await call("invite_code", K); await ageUser(K, 100);
await as(U2); await call("account_link", K); await as(null);
const kCode = (await call("invite_code", K)).code;
// Annas inbjudningar är redan uppe i taket; nollställ tidsstämplarna så att Jonas fall belönas
await db.query(`update invites set rewarded_at = now() - interval '40 days' where inviter_id = $1`, [await uid(ANNA)]);
eq((await call("invite_redeem", P, ic.code)).status, "pending", "P anger Annas kod");
const pCode = (await call("invite_code", P)).code;
eq((await call("invite_redeem", KIM, pCode)).status, "pending", "Kim anger P:s kod");
await as(U2);
eq((await call("account_link", P)).merged, true, "P slås ihop med kontot");
await as(null);
const ku = await uid(K);
eq((await one(`select count(*)::int n from invites where friend_id = $1 and status = 'pending'`, [ku])).n, 1, "Annas inbjudan följde med");
eq((await one(`select count(*)::int n from invites where inviter_id = $1`, [ku])).n, 1, "Kims inbjudan följde med");
eq((await call("invite_code", K)).code, kCode, "kontots kod behålls");
eq((await call("invite_redeem", "device-LISA-0001", pCode)).error, "unknown_code", "telefonens gamla kod är borta");
await tapStamp(K, "linnea");
eq((await one(`select status from invites where friend_id = $1`, [ku])).status, "rewarded", "kontot stämplar inom fönstret → belönat");
// Samma person: telefonen hade angett kontots kod
const Q = "device-JONAS-Q01";
eq((await call("invite_redeem", Q, kCode)).status, "pending", "Q anger kontots kod");
await as(U2); await call("account_link", Q); await as(null);
eq((await one(`select count(*)::int n from invites where friend_id = $1 or (inviter_id = $1 and friend_id = $1)`, [ku])).n, 1, "inbjudan mellan egna telefoner försvann");

// ── Panelen ─────────────────────────────────────────────────────────
const ms = await call("merchant_invite_stats", "tok-linnea");
// Annas äldre inbjudningar flyttades 40 dagar bakåt ovan; inom 30 dagar finns bara Jonas (2 + 2)
eq([ms.ok, ms.friends_30d, ms.friends_total, ms.stamps_30d], [true, 1, 6, 4], "panelen: vänner och stämplar hos Café Linnea");
eq((await call("merchant_invite_stats", "fel")).error, "bad_session", "fel session");
const camp = await call("merchant_campaign_stats", "tok-linnea");
ok(camp.bonus_stamps_30d >= ms.stamps_30d, "räknas i Kampanjstämplar");
const st = await call("merchant_stats", "tok-linnea");
ok(st.total < camp.bonus_stamps_30d + 100, "statistiken räknar bara riktiga stämplingar");

// ── Behörigheter ─────────────────────────────────────────────────────
const priv = async (role, fn) => (await one(`select has_function_privilege($1, 'public.${fn}', 'execute') as a`, [role])).a;
for (const fn of ["invite_status(text)", "invite_code(text)", "invite_redeem(text, text)", "invite_ack(text)", "merchant_invite_stats(text)"]) eq(await priv("anon", fn), true, "öppen: " + fn);
for (const fn of ["gen_invite_code()", "invite_grant(uuid, uuid)", "invite_on_stamp()", "merge_users(uuid, uuid)"]) eq(await priv("anon", fn), false, "stängd: " + fn);
for (const t of ["invites", "invite_codes"]) eq((await one(`select has_table_privilege('anon', 'public.${t}', 'select') as a`)).a, false, t + " stängd");

console.log("v16 OK:", passed, "kontroller");
