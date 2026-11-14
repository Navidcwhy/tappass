// v15: Födelsedagspresent — butiken väljer, kunden anger dag + månad på kontot.
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
const CHAIN = ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar", "v9_inlosen_tapp", "v10_fler_beloningar", "v11_stamgaster", "v12_insikter", "v13_profil"];
const V15 = read("v15_fodelsedag");

{ // Ordningen och vakten mot ändrade funktioner
  const early = new PGlite();
  await early.exec(BASE + AUTH);
  for (const v of CHAIN) await early.exec(read(v));
  let msg = "";
  try { await early.exec(V15); } catch (e) { msg = e.message; }
  ok(/Kör v14 först/.test(msg), "v15 kräver v14: " + msg);
  await early.exec(read("v14_konto"));
  await early.exec(`create or replace function public.merchant_recent_redemptions(p_token text) returns jsonb language sql as $$ select '{}'::jsonb $$;`);
  msg = "";
  try { await early.exec(V15); } catch (e) { msg = e.message; }
  ok(/merchant_recent_redemptions är inte v10-versionen/.test(msg), "vakt: " + msg);
  await early.close();
}

const db = new PGlite();
const call = async (fn, ...args) =>
  (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const as = async (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid || ""]);
await db.exec(BASE + AUTH);
for (const v of [...CHAIN, "v14_konto"]) await db.exec(read(v));
await db.exec(`
  insert into cafes(slug, name, type, area, stamps_needed, reward_text, reward_short, city) values
    ('linnea', 'Café Linnea', 'Kafé', 'Vasastan', 10, 'En kaffe på huset', 'Gratis kaffe', 'Stockholm'),
    ('miyabi', 'Miyabi', 'Sushi-restaurang', 'Lidingö', 6, 'En 5-bitars sushi på huset', 'Gratis 5-bitars sushi', 'Stockholm'),
    ('bryggan', 'Bryggans Bageri', 'Bageri', 'Södermalm', 8, 'En kanelbulle på huset', 'Gratis kanelbulle', 'Stockholm'),
    ('nonna', 'Nonna Pizza', 'Pizzeria', 'Hornstull', 6, 'En pizza på huset', 'Gratis pizza', 'Stockholm');
  insert into tags(cafe_id, token) select id, slug || '-01' from cafes;
  insert into merchant_sessions(token_hash, cafe_id, expires_at)
    select encode(sha256(convert_to('tok-' || slug, 'UTF8')), 'hex'), id, now() + interval '30 days' from cafes;
`);
const before = (await one(`select md5(prosrc) h from pg_proc where oid = 'public.stamps_since_last_redeem(uuid,uuid)'::regprocedure`)).h;
await db.exec(V15);
await db.exec(V15);   // kan köras två gånger (vakten känner igen v15-versionerna)
eq((await one(`select md5(prosrc) h from pg_proc where oid = 'public.stamps_since_last_redeem(uuid,uuid)'::regprocedure`)).h, before, "stämpelkortet orört");

// ── Datum ────────────────────────────────────────────────────────────
const d = async (sql) => (await one(`select (${sql})::text as v`)).v;
eq(await d(`public.birthday_in_year(2, 29, 2027)`), "2027-02-28", "29 feb ett vanligt år");
eq(await d(`public.birthday_in_year(2, 29, 2028)`), "2028-02-29", "29 feb ett skottår");
eq(await d(`public.birthday_next_gift(12, 30, '2026-11-14', '2026-11-14')`), "2026-12-30", "sparad i dag: om mer än 30 dagar");
eq(await d(`public.birthday_next_gift(12, 1, '2026-11-14', '2026-11-14')`), "2027-12-01", "mindre än 30 dagar kvar: nästa år");
eq(await d(`public.birthday_next_gift(12, 30, '2025-10-01', '2027-01-03')`), "2026-12-30", "pågående vecka räknas");
eq(await d(`public.birthday_next_gift(12, 30, '2025-10-01', '2027-01-06')`), "2027-12-30", "efter veckan: nästa år");
eq(await d(`public.birthday_next_gift(2, 29, '2026-01-01', '2026-11-14')`), "2027-02-28", "29 feb: 28 feb ett vanligt år");

// ── Konto och födelsedag ─────────────────────────────────────────────
const U1 = "11111111-1111-4111-8111-111111111111";
await db.query(`insert into auth.users(id, email) values ($1, 'anna@exempel.se')`, [U1]);
const A = "device-PHONE-A001";
await db.query(`insert into users(device_id) values ($1), ('device-ANON-0001')`, [A]);
const ua = (await one(`select id from users where device_id = $1`, [A])).id;
const stampAt = (dev, slug, daysAgo, source = "tap", n = 1) => db.query(
  `insert into stamps(user_id, cafe_id, stamped_at, source)
     select u.id, c.id, now() - make_interval(days => $3::int) - (g || ' minutes')::interval, $4
     from users u, cafes c, generate_series(1, $5::int) g where u.device_id = $1 and c.slug = $2`, [dev, slug, daysAgo, source, n]);
await stampAt(A, "linnea", 3, "tap", 4);
await stampAt(A, "miyabi", 200);
await stampAt(A, "bryggan", 10);
await stampAt(A, "nonna", 5, "bonus");
await as(U1);
eq((await call("account_link", A)).created, true, "konto");
await as(null);

eq((await call("account_set_birthday", "device-ANON-0001", 5, 12)).error, "not_linked", "bara konton");
for (const [m, dd] of [[2, 30], [13, 1], [4, 31], [0, 5], [6, null]]) {
  eq((await call("account_set_birthday", A, m, dd)).error, "invalid_date", "ogiltigt: " + m + "/" + dd);
}
const today = await d(`public.sthlm_today()`);
const [ty, tm, td] = today.split("-").map(Number);
const set = await call("account_set_birthday", A, tm, td);
eq([set.ok, set.birthday], [true, { month: tm, day: td }], "sparad");
ok(set.next_gift > today, "första presenten nästa år (mindre än 30 dagar kvar): " + set.next_gift);
let st = await call("birthday_status", A);
eq([st.linked, st.birthday, st.window, st.gifts], [true, { month: tm, day: td }, null, []], "nyss sparad: ingen present i år");
eq((await call("birthday_status", "device-ANON-0001")).linked, false, "anonym telefon");

// Sparad för 40 dagar sedan → presenter den här veckan
await db.query(`update accounts set birthday_set_at = now() - interval '40 days' where auth_uid = $1`, [U1]);
const setAt = (await one(`select birthday_set_at::text v from accounts where auth_uid = $1`, [U1])).v;
eq((await call("account_set_birthday", A, tm, td)).ok, true, "samma datum igen");
eq((await one(`select birthday_set_at::text v from accounts where auth_uid = $1`, [U1])).v, setAt, "oförändrat datum nollställer inte");
st = await call("birthday_status", A);
eq(st.window, { from: today, to: await d(`public.sthlm_today() + 6`) }, "veckan pågår");
eq(st.next_gift, today, "nästa present: i dag");
eq(st.gifts, [], "inga ställen erbjuder present än");

// Butikerna väljer
eq((await call("merchant_set_birthday", "fel", "Kaka", null)).error, "bad_session", "fel session");
eq((await call("merchant_set_birthday", "tok-linnea", "x", null)).error, "invalid_text", "för kort");
eq((await call("merchant_set_birthday", "tok-linnea", "En\tkaka", null)).error, "invalid_text", "styrtecken");
eq((await call("merchant_set_birthday", "tok-linnea", "En kaka på huset", 0)).error, "invalid_value", "värde 0");
eq((await call("merchant_set_birthday", "tok-linnea", "En kaka på huset", 20000)).error, "invalid_value", "för högt värde");
const ml = await call("merchant_set_birthday", "tok-linnea", "  En kaka på huset ", 35);
eq([ml.ok, ml.text, ml.value_kr, ml.redeemed_30d, ml.redeemed_total], [true, "En kaka på huset", 35, 0, 0], "Linnea erbjuder");
await call("merchant_set_birthday", "tok-miyabi", "Två makirullar", null);
await call("merchant_set_birthday", "tok-nonna", "En pizza", null);
st = await call("birthday_status", A);
eq(st.gifts.map((g) => [g.cafe_slug, g.reward, g.value_kr, g.status, g.code]),
  [["linnea", "En kaka på huset", 35, "available", null], ["miyabi", "Två makirullar", null, "available", null]],
  "Linnea + Miyabi (stämplat i år); inte Bryggan (erbjuder inte) eller Nonna (bara kampanjstämplar)");
eq(st.gifts[0].valid_until.slice(0, 10) >= today, true, "giltig veckan ut");

// ── Lös in med koden ─────────────────────────────────────────────────
const wallet = async () => (await call("load_wallet", A)).map((w) => [w.cafe.slug, w.stamps]).sort();
const w0 = await wallet();
const c1 = await call("birthday_claim", A, "linnea");
ok(c1.ok && /^0\d{5}$/.test(c1.code), "kod som börjar med 0: " + c1.code);
eq((await call("birthday_claim", A, "linnea")).code, c1.code, "samma kod igen");
eq((await call("birthday_claim", A, "bryggan")).error, "not_eligible", "Bryggan erbjuder inte");
eq((await call("birthday_code", A, "linnea")), { ok: true, code: c1.code, redeemed: false, redeemed_at: null }, "kodrutan");
eq((await call("birthday_status", A)).gifts[0].status, "saved", "sparad");
eq((await call("merchant_redeem_by_code", "tok-miyabi", c1.code)).error, "wrong_cafe", "fel butik");
const r1 = await call("merchant_redeem_by_code", "tok-linnea", c1.code);
eq([r1.ok, r1.kind, r1.reward], [true, "birthday", "Födelsedagspresent: En kaka på huset"], "inlöst med koden");
eq((await call("merchant_redeem_by_code", "tok-linnea", c1.code)).error, "invalid_code", "redan inlöst");
const bc = await call("birthday_code", A, "linnea");
eq([bc.code, bc.redeemed, !!bc.redeemed_at], [null, true, true], "kodrutan ser inlösen");
eq((await call("birthday_claim", A, "linnea")).error, "already_redeemed", "en present per ställe och år");
eq((await call("birthday_status", A)).gifts[0].status, "redeemed", "status inlöst");
eq(await wallet(), w0, "stämpelkorten orörda");
const rec = await call("merchant_recent_redemptions", "tok-linnea");
eq(rec.recent.map((x) => [x.reward, x.via]), [["Födelsedagspresent: En kaka på huset", "code"]], "Senast inlösta");

// ── Lös in med stämpeln (utan att först trycka Lös in) ─────────────────
const wt = await call("redeem_birthday_by_tap", A, "miyabi", "linnea-01");
eq([wt.ok, wt.error, wt.expected, wt.got], [false, "wrong_tag", "Miyabi", "Café Linnea"], "fel stämpel");
eq((await call("redeem_birthday_by_tap", A, "miyabi", "okand-01")).error, "unknown_tag", "okänd stämpel");
const t1 = await call("redeem_birthday_by_tap", A, "miyabi", "miyabi-01");
eq([t1.ok, t1.reward, t1.already], [true, "Två makirullar", undefined], "inlöst med stämpeln");
eq((await call("redeem_birthday_by_tap", A, "miyabi", "miyabi-01")).already, true, "dubbelläsning");
eq((await one(`select redeemed_via v from birthday_gifts g join cafes c on c.id = g.cafe_id where c.slug = 'miyabi'`)).v, "tap", "via stämpeln");
eq((await call("redeem_birthday_by_tap", A, "bryggan", "bryggan-01")).error, "not_eligible", "ingen present hos Bryggan");
eq((await call("merchant_recent_redemptions", "tok-miyabi")).recent[0].via, "tap", "Miyabis lista");
eq((await call("merchant_get_birthday", "tok-linnea")).redeemed_30d, 1, "panelen räknar");

// ── Utgången present ─────────────────────────────────────────────────
await db.query(`update birthday_gifts set status = 'saved', redeemed_at = null, redeemed_via = null, valid_until = now() - interval '1 minute'
                where cafe_id = (select id from cafes where slug = 'linnea')`);
eq((await call("merchant_redeem_by_code", "tok-linnea", c1.code)).error, "expired", "utgången");
eq((await call("birthday_code", A, "linnea")).code, null, "kodrutan visar ingen utgången kod");
eq((await call("merchant_redeem_by_code", "tok-linnea", "012345")).error, "invalid_code", "okänd presentkod");

// ── Vanliga koder fungerar som förut ────────────────────────────────
await stampAt(A, "bryggan", 1, "tap", 7);
const sr = await call("save_reward", A, "bryggan");
ok(sr.ok && /^[1-9]\d{5}$/.test(sr.code), "vanlig kod börjar aldrig med 0: " + sr.code);
const nr = await call("merchant_redeem_by_code", "tok-bryggan", sr.code);
eq([nr.ok, nr.carry_over, nr.kind], [true, 0, undefined], "vanlig inlösen");

// ── Veckan över nyår och sparad för sent ────────────────────────────
await db.query(`update accounts set birth_month = 12, birth_day = 30, birthday_set_at = '2025-10-01' where auth_uid = $1`, [U1]);
eq(await d(`public.birthday_window('${ua}', '2027-01-03')`), "2026-12-30", "nyårsveckan");
eq(await d(`public.birthday_window('${ua}', '2027-01-05')`), "2026-12-30", "sista dagen");
eq(await d(`public.birthday_window('${ua}', '2027-01-06')`), null, "efter veckan");
eq(await d(`public.birthday_window('${ua}', '2026-12-29')`), null, "före födelsedagen");
await db.query(`update accounts set birthday_set_at = '2026-12-10 12:00+01' where auth_uid = $1`, [U1]);
eq(await d(`public.birthday_window('${ua}', '2026-12-30')`), null, "sparad 20 dagar innan: ingen present");

// ── Kommande födelsedagar (panelen, bara antal) ──────────────────────
const mk = async (uid, dev, email, inDays, setDaysAgo, visit) => {
  await db.query(`insert into auth.users(id, email) values ($1, $2)`, [uid, email]);
  await db.query(`insert into users(device_id) values ($1)`, [dev]);
  if (visit) await stampAt(dev, "linnea", 20);
  await as(uid); await call("account_link", dev); await as(null);
  const b = await one(`select extract(month from public.sthlm_today() + ${inDays})::int m, extract(day from public.sthlm_today() + ${inDays})::int d`);
  await db.query(`update accounts set birth_month = $2, birth_day = $3, birthday_set_at = now() - make_interval(days => $4::int) where auth_uid = $1`,
    [uid, b.m, b.d, setDaysAgo]);
};
await mk("22222222-2222-4222-8222-222222222222", "device-PHONE-B002", "b@exempel.se", 10, 60, true);
await mk("33333333-3333-4333-8333-333333333333", "device-PHONE-C003", "c@exempel.se", 10, 5, true);
await mk("44444444-4444-4444-8444-444444444444", "device-PHONE-D004", "d@exempel.se", 10, 60, false);
await mk("55555555-5555-4555-8555-555555555555", "device-PHONE-E005", "e@exempel.se", 45, 90, true);
eq((await call("merchant_get_birthday", "tok-linnea")).upcoming_30d, 1, "en kund fyller år inom 30 dagar och får presenten");

// ── Ta bort födelsedagen och radera kontot ───────────────────────────
eq(await call("account_set_birthday", "device-PHONE-B002", null, null), { ok: true, birthday: null, next_gift: null }, "borttagen");
eq((await call("merchant_get_birthday", "tok-linnea")).upcoming_30d, 0, "räknas inte längre");
eq((await call("merchant_set_birthday", "tok-nonna", "", 99)).text, null, "Nonna slutar erbjuda");
await as(U1);
await call("account_delete");
await as(null);
eq((await one(`select count(*)::int n from accounts where auth_uid = $1`, [U1])).n, 0, "födelsedagen raderas med kontot");
eq((await one(`select count(*)::int n from birthday_gifts where user_id = $1`, [ua])).n, 2, "presenterna finns kvar i statistiken utan koppling");

// ── Behörigheter ─────────────────────────────────────────────────────
const priv = async (role, fn) => (await one(`select has_function_privilege($1, 'public.${fn}', 'execute') as a`, [role])).a;
for (const fn of ["account_set_birthday(text, int, int)", "birthday_status(text)", "birthday_claim(text, text)", "birthday_code(text, text)",
  "redeem_birthday_by_tap(text, text, text)", "merchant_get_birthday(text)", "merchant_set_birthday(text, text, int)"]) eq(await priv("anon", fn), true, "öppen: " + fn);
for (const fn of ["birthday_in_year(int, int, int)", "birthday_window(uuid, date)", "birthday_next_gift(int, int, date, date)", "birthday_offers(uuid)",
  "gen_gift_code()", "birthday_gift_json(uuid, uuid, date)"]) eq(await priv("anon", fn), false, "stängd: " + fn);
eq((await one(`select has_table_privilege('anon', 'public.birthday_gifts', 'select') as a`)).a, false, "birthday_gifts stängd");

console.log("v15 OK:", passed, "kontroller");
