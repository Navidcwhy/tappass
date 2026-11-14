// v14: Konto (valfritt) — koppla telefoner, slå ihop stämplar, radera konto.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

let passed = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };
const ok = (c, msg) => { assert.ok(c, msg); passed++; };
const R = "/home/claude/tappass/supabase_migration_";
const read = (v) => fs.readFileSync(R + v + ".sql", "utf8");
const BASE = fs.readFileSync(new URL("./base.sql", import.meta.url), "utf8");
// Supabase Auth i liten skala: auth.users och auth.uid() (läser test.uid)
const AUTH = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
`;
const CHAIN = ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar", "v9_inlosen_tapp", "v10_fler_beloningar", "v11_stamgaster", "v12_insikter"];

{
  const early = new PGlite();
  await early.exec(BASE + AUTH);
  for (const v of CHAIN) await early.exec(read(v));
  let msg = "";
  try { await early.exec(read("v14_konto")); } catch (e) { msg = e.message; }
  ok(/Kör v13 först/.test(msg), "v14 kräver v13: " + msg);
  await early.close();
}

const db = new PGlite();
const call = async (fn, ...args) =>
  (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const as = async (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid || ""]);
await db.exec(BASE + AUTH);
for (const v of [...CHAIN, "v13_profil"]) await db.exec(read(v));
await db.exec(`
  insert into cafes(slug, name, type, area, stamps_needed, reward_text, reward_short, city) values
    ('linnea', 'Café Linnea', 'Kafé', 'Vasastan', 10, 'En kaffe på huset', 'Gratis kaffe', 'Stockholm'),
    ('miyabi', 'Miyabi', 'Sushi-restaurang', 'Lidingö', 6, 'En 5-bitars sushi på huset', 'Gratis 5-bitars sushi', 'Stockholm'),
    ('bryggan', 'Bryggans Bageri', 'Bageri', 'Södermalm', 8, 'En kanelbulle på huset', 'Gratis kanelbulle', 'Stockholm');
  insert into tags(cafe_id, token) select id, slug || '-01' from cafes;
`);
const V14 = read("v14_konto");
await db.exec(V14);
await db.exec(V14);   // kan köras två gånger

const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222";
await db.query(`insert into auth.users(id, email) values ($1, 'navid.test@example.se'), ($2, 'annan@example.se')`, [U1, U2]);

// ── Inloggningssätt ──────────────────────────────────────────────────
eq(await call("auth_methods"), { email: false, apple: false, google: false }, "allt avstängt från början");
await db.query(`update app_settings set value = '{"email": true, "apple": false, "google": true}' where key = 'auth_methods'`);
eq(await call("auth_methods"), { email: true, apple: false, google: true }, "slås på i app_settings");

// Hjälpare
const uid = async (dev) => (await one(`select id from users where device_id = $1`, [dev]) || {}).id;
const stamp = (dev, slug, n, hoursAgo = 3) => db.query(
  `insert into stamps(user_id, cafe_id, stamped_at)
     select u.id, c.id, now() - make_interval(hours => $4::int) - (g || ' minutes')::interval
     from users u, cafes c, generate_series(1, $3::int) g where u.device_id = $1 and c.slug = $2`, [dev, slug, n, hoursAgo]);
const user = async (dev) => { await db.query(`insert into users(device_id) values ($1) on conflict do nothing`, [dev]); return uid(dev); };
const card = async (dev, slug) => ((await call("load_wallet", dev)).find((w) => w.cafe.slug === slug) || {}).stamps;

// ── Nytt konto ───────────────────────────────────────────────────────
const A = "device-PHONE-A001", B = "device-PHONE-B002";
await user(A); await stamp(A, "linnea", 6); await stamp(A, "miyabi", 2);
await as(null);
eq((await call("account_link", A)).error, "not_signed_in", "kräver inloggning");
await as(U1);
eq((await call("account_link", "kort")).error, "bad_device", "ogiltigt id");
const l1 = await call("account_link", A);
eq([l1.ok, l1.device_id, l1.created, l1.merged], [true, A, true, false], "nytt konto: telefonens id blir kontonyckeln");
const st = await call("account_status", A);
eq([st.linked, st.email, !!st.since], [true, "n***@example.se", true], "status: maskad e-post");
eq((await call("account_status", B)).linked, false, "annan telefon: inte kopplad");
eq((await call("account_link", A)).already, true, "redan kopplad");

// ── Andra telefonen: stämplarna slås ihop ────────────────────────────
await user(B); await stamp(B, "linnea", 3); await stamp(B, "bryggan", 4);
const l2 = await call("account_link", B);
eq([l2.ok, l2.device_id, l2.created, l2.merged, l2.moved_stamps], [true, A, false, true, 7], "telefon B får kontonyckeln, 7 stämplar flyttade");
eq(await uid(B), undefined, "B:s gamla rad är borta");
eq([await card(A, "linnea"), await card(A, "miyabi"), await card(A, "bryggan")], [9, 2, 4], "korten summeras: 6 + 3, 2, 4");
// Vanliga RPC:er fungerar med kontonyckeln (B:s telefon har nu A:s nyckel)
await as(null);
const tap = await call("tap_token", A, "miyabi-01");
eq([tap.ok, tap.stamps], [true, 3], "stämpling på kontonyckeln: 2 + 1");
await as(U1);

// ── Inlösen på ena telefonen: inga stämplar försvinner ───────────────
// Kontot har löst in hos Linnea (överskott 1) och har 4 nya; telefon C har 5 äldre stämplar
const ua = await uid(A);
await db.query(`delete from stamps where user_id = $1 and cafe_id = (select id from cafes where slug = 'linnea')`, [ua]);
await stamp(A, "linnea", 9, 30);                            // gamla, före inlösen
await db.query(`insert into redemptions(user_id, cafe_id, saved_at, status, redeemed_at, carry_over)
                select $1, id, now() - interval '20 hours', 'redeemed', now() - interval '20 hours', 1 from cafes where slug = 'linnea'`, [ua]);
await stamp(A, "linnea", 4, 3);                              // efter inlösen
eq(await card(A, "linnea"), 5, "kontot: 1 + 4");
const C = "device-PHONE-C003";
await user(C); await stamp(C, "linnea", 5, 40);              // äldre än kontots inlösen
eq(await card(C, "linnea"), 5, "telefon C: 5");
eq((await call("account_link", C)).merged, true, "C slås ihop");
eq(await card(A, "linnea"), 10, "5 + 5 — de äldre stämplarna räknas via överskottet");

// ── Krockar: sparad belöning och hjulsnurr samma dag ─────────────────
const D = "device-PHONE-D004";
const ud = await user(D);
await stamp(A, "miyabi", 3); await stamp(D, "miyabi", 6);    // båda fulla
await as(null);
const sa = await call("save_reward", A, "miyabi");
const sd = await call("save_reward", D, "miyabi");
ok(sa.ok && sd.ok && sa.code !== sd.code, "båda har sparad belöning");
await db.query(`insert into wheel_spins(user_id, spin_date, segment, won) values ($1, public.sthlm_today(), 1, false), ($2, public.sthlm_today(), 3, true)`, [ua, ud]);
await db.query(`insert into stamp_bonuses(user_id, cafe_id, expires_at) select $1, id, now() + interval '2 days' from cafes where slug = 'bryggan'`, [ud]);
await as(U1);
const l4 = await call("account_link", D);
eq([l4.ok, l4.merged], [true, true], "D slås ihop utan krock");
eq((await one(`select count(*)::int n from redemptions where user_id = $1 and status = 'saved'`, [ua])).n, 1, "en sparad belöning per kort (D:s ångrad)");
eq((await one(`select status from redemptions where redeem_code = $1`, [sd.code])).status, "cancelled", "D:s kod ångrad");
eq((await one(`select count(*)::int n from wheel_spins where user_id = $1 and spin_date = public.sthlm_today()`, [ua])).n, 1, "ett snurr i dag");
ok(!!(await call("load_wallet", A)).find((w) => w.cafe.slug === "bryggan").bonus_expires_at, "dubbelstämpeln följde med");
eq(await card(A, "miyabi"), 12, "miyabi: 2 + 1 (tapp) + 3 + 6");
eq((await one(`select won from wheel_spins where user_id = $1 and spin_date = public.sthlm_today()`, [ua])).won, true, "vinsten behölls före förlusten");
eq(l4.moved_stamps, 6, "D:s kort hade 6 stämplar");

// ── Ny telefon utan stämplar: får kontonyckeln direkt ────────────────
const E = "device-PHONE-E005";
const l5 = await call("account_link", E);
eq([l5.device_id, l5.merged, await uid(E)], [A, false, undefined], "tom telefon: ingen rad skapas");
// Dubbelstämpel hos samma ställe på två telefoner: en behålls
const G = "device-PHONE-G007";
const ug = await user(G);
await db.query(`insert into stamp_bonuses(user_id, cafe_id, expires_at) select $1, id, now() + interval '1 day' from cafes where slug = 'bryggan'`, [ug]);
await stamp(G, "bryggan", 1);
eq((await call("account_link", G)).moved_stamps, 1, "G slås ihop");
eq((await one(`select count(*)::int n from stamp_bonuses b join cafes c on c.id = b.cafe_id
                where b.user_id = $1 and c.slug = 'bryggan' and b.used_at is null and b.expires_at > now()`, [ua])).n, 1, "en aktiv dubbelstämpel per ställe");
eq(await card(A, "bryggan"), 5, "bryggan: 4 + 1");

// ── Annat konto ──────────────────────────────────────────────────────
await as(U2);
const F = "device-PHONE-F006";
await user(F); await stamp(F, "linnea", 2);
eq((await call("account_link", F)).created, true, "konto 2");
await as(U1);
eq((await call("account_link", F)).error, "other_account", "telefon med annat konto slås inte ihop");
eq(await card(F, "linnea"), 2, "konto 2 orört");

// ── Ny kontonyckel (tappad telefon) ──────────────────────────────────
await as(null);
eq((await call("account_rotate")).error, "not_signed_in", "byta nyckel kräver inloggning");
const U3 = "33333333-3333-4333-8333-333333333333";
await db.query(`insert into auth.users(id, email) values ($1, 'utan.konto@example.se')`, [U3]);
await as(U3);
eq((await call("account_rotate")).error, "not_linked", "inloggad utan konto");
await as(U2);
const rot = await call("account_rotate");
ok(rot.ok && /^k_[0-9a-f]{32}$/.test(rot.device_id), "ny nyckel: " + rot.device_id);
eq([await card(rot.device_id, "linnea"), (await call("load_wallet", F)).length], [2, 0], "korten följer nyckeln; den gamla är tom");
eq([(await call("account_status", rot.device_id)).linked, (await call("account_status", F)).linked], [true, false], "gamla telefonen är utloggad");
const back = await call("account_link", F);
eq([back.device_id, back.merged], [rot.device_id, false], "logga in igen: får den nya nyckeln");

// ── Radera konto ─────────────────────────────────────────────────────
await as(null);
eq((await call("account_delete")).error, "not_signed_in", "radera kräver inloggning");
await as(U3);
eq(await call("account_delete"), { ok: true, deleted: false }, "inloggning utan konto raderas");
eq((await one(`select count(*)::int n from auth.users where id = $1`, [U3])).n, 0, "U3 borta");
// Kontot har en sparad belöning (miyabi) och en oanvänd dubbelstämpel (bryggan)
await as(U1);
const stampsBefore = (await one(`select count(*)::int n from stamps where user_id = $1`, [ua])).n;
const del = await call("account_delete");
eq(del, { ok: true, deleted: true }, "raderat");
eq([(await one(`select count(*)::int n from auth.users where id = $1`, [U1])).n, (await one(`select count(*)::int n from accounts where auth_uid = $1`, [U1])).n], [0, 0], "inloggning och konto borta");
eq([(await call("load_wallet", A)).length, (await call("account_status", A)).linked], [0, false], "stämplarna borta ur appen");
const anon = await one(`select device_id from users where id = $1`, [ua]);
ok(/^raderad_[0-9a-f]{32}$/.test(anon.device_id), "kundraden har en oåtkomlig nyckel");
eq((await one(`select count(*)::int n from stamps where user_id = $1`, [ua])).n, stampsBefore, "butikernas statistik orörd");
eq((await one(`select count(*)::int n from redemptions where user_id = $1 and status = 'saved'`, [ua])).n, 0, "sparade belöningar ångrade");
eq((await one(`select count(*)::int n from stamp_bonuses where user_id = $1 and used_at is null`, [ua])).n, 0, "oanvända dubbelstämplar borta");
eq(await card(rot.device_id, "linnea"), 2, "andra konton orörda");
await as(null);
const fresh = await call("tap_token", A, "linnea-01");
eq([fresh.ok, fresh.stamps], [true, 1], "gamla nyckeln börjar om från noll");

// ── Behörigheter ─────────────────────────────────────────────────────
const priv = async (role, fn) => (await one(`select has_function_privilege($1, 'public.${fn}', 'execute') as a`, [role])).a;
eq(await priv("anon", "account_link(text)"), false, "anon kan inte koppla");
eq(await priv("authenticated", "account_link(text)"), true, "inloggad kan koppla");
for (const fn of ["merge_users(uuid, uuid)", "mask_email(text)"]) eq(await priv("anon", fn), false, "stängd: " + fn);
for (const fn of ["account_rotate()", "account_delete()"]) {
  eq(await priv("anon", fn), false, "inloggning krävs: " + fn);
  eq(await priv("authenticated", fn), true, "inloggad: " + fn);
}
for (const fn of ["auth_methods()", "account_status(text)"]) eq(await priv("anon", fn), true, "anon: " + fn);
eq((await one(`select has_table_privilege('anon', 'public.accounts', 'select') as a`)).a, false, "accounts stängd");
eq((await one(`select has_table_privilege('anon', 'public.app_settings', 'select') as a`)).a, false, "app_settings stängd");

console.log("v14 OK:", passed, "kontroller");
