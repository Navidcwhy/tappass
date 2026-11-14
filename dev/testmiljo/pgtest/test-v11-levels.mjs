// v11: Stamgästnivåer — besök (svenska dygn med riktig stämpling) senaste 12 månaderna.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

let passed = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };
const ok = (c, msg) => { assert.ok(c, msg); passed++; };
const R = "/home/claude/tappass/supabase_migration_";
const read = (v) => fs.readFileSync(R + v + ".sql", "utf8");
const BASE = fs.readFileSync(new URL("./base.sql", import.meta.url), "utf8");
const V11 = read("v11_stamgaster");

// v11 före v10: stoppas med ett tydligt fel
{
  const early = new PGlite();
  await early.exec(BASE);
  for (const v of ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar", "v9_inlosen_tapp"]) await early.exec(read(v));
  let msg = "";
  try { await early.exec(V11); } catch (e) { msg = e.message; }
  ok(/Kör v10 först/.test(msg), "v11 kräver v10: " + msg);
  await early.close();
}

const db = new PGlite();
const call = async (fn, ...args) =>
  (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
await db.exec(BASE);
for (const v of ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar", "v9_inlosen_tapp", "v10_fler_beloningar"]) await db.exec(read(v));
await db.exec(`
  insert into cafes(slug, name, type, area, stamps_needed, reward_text, reward_short, city, stamp_cooldown_seconds, reward_value_kr) values
    ('linnea', 'Café Linnea', 'Kafé', 'Vasastan', 10, 'En kaffe på huset', 'Gratis kaffe', 'Stockholm', 10, 39),
    ('miyabi', 'Miyabi', 'Sushi-restaurang', 'Lidingö', 6, 'En 5-bitars sushi på huset', 'Gratis 5-bitars sushi', 'Stockholm', 10, null);
  insert into tags(cafe_id, token) select id, slug || '-01' from cafes;
  insert into merchant_sessions(token_hash, cafe_id, expires_at)
    select encode(sha256(convert_to('tok-' || slug, 'UTF8')), 'hex'), id, now() + interval '30 days' from cafes;
`);
await db.exec(V11);
await db.exec(V11);   // kan köras två gånger

// Nivågränserna
for (const [v, want] of [[null, null], [0, null], [2, null], [3, "brons"], [9, "brons"], [10, "silver"], [24, "silver"], [25, "guld"], [400, "guld"]])
  eq((await one(`select public.guest_level($1::int) as l`, [v])).l, want, "nivå vid " + v + " besök");

const user = async (dev, slug = "linnea") => {
  await call("tap_token", dev, slug + "-01");   // dagens besök
  return (await one(`select id from users where device_id = $1`, [dev])).id;
};
// Stämplar k dygn bakåt (svensk tid, mitt på dagen). source: tap | bonus | quiet
const visit = (uid, slug, days, source = "tap", perDay = 1) => db.query(
  `insert into stamps(user_id, cafe_id, stamped_at, source)
     select $1, c.id, public.sthlm_midnight(public.sthlm_today() - d) + interval '11 hours' + (n || ' minutes')::interval, $4
     from cafes c, unnest($3::int[]) d, generate_series(1, $5::int) n where c.slug = $2`, [uid, slug, days, source, perDay]);
const card = async (dev, slug = "linnea") => (await call("load_wallet", dev)).find((w) => w.cafe.slug === slug);
const today = (await one(`select public.sthlm_today()::text as d`)).d;

// ── Plånboken ────────────────────────────────────────────────────────
const A = "device-AAAA-0001";
const ua = await user(A);                                   // i dag
let ca = await card(A);
eq([ca.visits_12m, ca.last_visit], [1, today], "första besöket: 1, i dag");
eq([ca.rewards_redeemed, ca.saved_kr], [0, 0], "v10-fälten finns kvar");
await visit(ua, "linnea", [0], "tap", 3);                  // fler stämplar i dag
await visit(ua, "linnea", [0], "bonus");
await visit(ua, "linnea", [0], "quiet");
eq((await card(A)).visits_12m, 1, "samma dag, dubbelstämpel och lugn timme = ett besök");
await visit(ua, "linnea", [1, 2, 7, 30, 200, 364]);
ca = await card(A);
eq([ca.visits_12m, ca.last_visit], [7, today], "365 dygn inklusive i dag (dag −364 räknas)");
await visit(ua, "linnea", [365, 400, 900]);
eq((await card(A)).visits_12m, 7, "äldre än 12 månader räknas inte");
await visit(ua, "linnea", [3, 4, 5]);                       // 10 besök
eq((await card(A)).visits_12m, 10, "10 besök = silver i appen");
await visit(ua, "linnea", [8, 9, 10], "bonus");
eq((await card(A)).visits_12m, 10, "bara bonusstämplar en dag är inget besök");
await visit(ua, "miyabi", [1, 2]);
const am = await card(A, "miyabi");
eq([am.visits_12m, (await card(A)).visits_12m], [2, 10], "räknas per ställe");
const B = "device-BBBB-0002";
const ub = await user(B, "miyabi");
await db.query(`delete from stamps where user_id = $1`, [ub]);
await visit(ub, "miyabi", [500]);                           // bara gamla besök
const bm = await card(B, "miyabi");
eq([bm.visits_12m, bm.last_visit], [0, null], "inga besök senaste året: 0 och inget datum");
eq((await one(`select (now() at time zone 'Europe/Stockholm')::date::text = $1 as same`, [today])).same, true, "i dag = svenskt dygn");

// ── Panelen: fördelning ──────────────────────────────────────────────
const mk = async (dev, days) => {
  const u = await user(dev);
  await visit(u, "linnea", days.filter((d) => d > 0));
  return u;
};
await mk("device-C3-000003", [1, 2]);                         // 3 → brons
await mk("device-C9-000009", Array.from({ length: 8 }, (_, i) => i + 1));    // 9 → brons
await mk("device-C25-00025", Array.from({ length: 24 }, (_, i) => i + 1));   // 25 → guld
await mk("device-C2-000002", [1]);                            // 2 → ingen nivå
const lv = await call("merchant_guest_levels", "tok-linnea");
// Linnea: A 10 (silver), C3 brons, C9 brons, C25 guld, C2 inget
eq(lv.levels.map((l) => [l.key, l.name, l.visits, l.customers]), [["brons", "Brons", 3, 2], ["silver", "Silver", 10, 1], ["guld", "Guld", 25, 1]], "fördelning per nivå");
eq([lv.ok, lv.customers, lv.period_days], [true, 5, 365], "5 kunder med besök senaste året");
const lm = await call("merchant_guest_levels", "tok-miyabi");
eq([lm.customers, lm.levels.map((l) => l.customers)], [1, [0, 0, 0]], "miyabi: bara A (2 besök), gamla besök räknas inte");
eq((await call("merchant_guest_levels", "fel")).error, "bad_session", "fel session");

// ── Behörigheter ─────────────────────────────────────────────────────
const priv = async (fn) => (await one(`select has_function_privilege('anon', 'public.${fn}', 'execute') as a`)).a;
eq(await priv("guest_level(integer)"), false, "stängd: guest_level");
eq(await priv("merchant_guest_levels(text)"), true, "anon: merchant_guest_levels");
eq(await priv("load_wallet(text)"), true, "anon: load_wallet");

console.log("v11 OK:", passed, "kontroller");
