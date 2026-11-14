// v12: Insikter i panelen — återkomst, tid mellan besök, veckodag/timme, tips,
// vinn tillbaka (dubbelstämpel) och månadsrapport.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

let passed = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };
const ok = (c, msg) => { assert.ok(c, msg); passed++; };
const R = "/home/claude/tappass/supabase_migration_";
const read = (v) => fs.readFileSync(R + v + ".sql", "utf8");
const BASE = fs.readFileSync(new URL("./base.sql", import.meta.url), "utf8");
const V12 = read("v12_insikter");

// v12 före v11: stoppas
{
  const early = new PGlite();
  await early.exec(BASE);
  for (const v of ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar", "v9_inlosen_tapp", "v10_fler_beloningar"]) await early.exec(read(v));
  let msg = "";
  try { await early.exec(V12); } catch (e) { msg = e.message; }
  ok(/Kör v11 först/.test(msg), "v12 kräver v11: " + msg);
  await early.close();
}

const db = new PGlite();
const call = async (fn, ...args) =>
  (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
await db.exec(BASE);
for (const v of ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar", "v9_inlosen_tapp", "v10_fler_beloningar", "v11_stamgaster"]) await db.exec(read(v));
await db.exec(`
  insert into cafes(slug, name, type, area, stamps_needed, reward_text, reward_short, city, stamp_cooldown_seconds, reward_value_kr) values
    ('linnea', 'Café Linnea', 'Kafé', 'Vasastan', 10, 'En kaffe på huset', 'Gratis kaffe', 'Stockholm', 10, 39),
    ('miyabi', 'Miyabi', 'Sushi-restaurang', 'Lidingö', 6, 'En 5-bitars sushi på huset', 'Gratis 5-bitars sushi', 'Stockholm', 10, null),
    ('bryggan', 'Bryggans Bageri', 'Bageri', 'Södermalm', 8, 'En kanelbulle på huset', 'Gratis kanelbulle', 'Stockholm', 10, 32);
  insert into tags(cafe_id, token) select id, slug || '-01' from cafes;
  insert into merchant_sessions(token_hash, cafe_id, expires_at)
    select encode(sha256(convert_to('tok-' || slug, 'UTF8')), 'hex'), id, now() + interval '30 days' from cafes;
`);
// En wheel-bonus från v6 finns kvar och får origin = 'wheel'
const wheelUser = (await one(`insert into users(device_id) values ('device-WHEEL-001') returning id`)).id;
await db.query(`insert into stamp_bonuses(user_id, cafe_id, expires_at) select $1, id, now() + interval '2 days' from cafes where slug = 'bryggan'`, [wheelUser]);
await db.exec(V12);
await db.exec(V12);   // kan köras två gånger
eq((await one(`select origin from stamp_bonuses where user_id = $1`, [wheelUser])).origin, "wheel", "befintliga bonusar = wheel");

let devN = 0;
const newUser = async () => (await one(`insert into users(device_id) values ($1) returning id`, ["device-T-" + String(++devN).padStart(6, "0")])).id;
// Stämplar k dygn bakåt kl. 11 svensk tid
const visit = (uid, slug, days, source = "tap", hour = 11) => db.query(
  `insert into stamps(user_id, cafe_id, stamped_at, source)
     select $1, c.id, public.sthlm_midnight(public.sthlm_today() - d) + make_interval(hours => $5::int, mins => 5), $4
     from cafes c, unnest($3::int[]) d where c.slug = $2`, [uid, slug, days, source, hour]);
const deviceOf = async (uid) => (await one(`select device_id from users where id = $1`, [uid])).device_id;

// ── Vinn tillbaka ────────────────────────────────────────────────────
const L1 = await newUser(); await visit(L1, "linnea", [100, 93, 86, 79]);       // varje vecka, borta 79 d → slutat
const L2 = await newUser(); await visit(L2, "linnea", [40, 30, 20]);            // senast 20 d → inte borta
const L3 = await newUser(); await visit(L3, "linnea", [200, 140, 80]);          // var 60:e dag, 80 < 120 → inte borta
const L4 = await newUser(); await visit(L4, "linnea", [100, 35]);               // bara 2 besök → ingen stamgäst
const L5 = await newUser(); await visit(L5, "linnea", [50, 45, 40]);            // var 5:e dag, borta 40 → slutat
const L6 = await newUser(); await visit(L6, "linnea", [400, 390, 380, 370]);    // äldre än 12 månader → räknas inte
const lp = await call("merchant_lapsed", "tok-linnea");
eq([lp.ok, lp.count, lp.eligible, lp.stamps_needed], [true, 2, 2, 10], "två stamgäster har slutat komma");
eq(lp.customers.map((c) => [c.visits, c.gap_days, c.days_since, c.card_stamps, c.eligible, c.winback_at]),
   [[4, 7, 79, 4, true, null], [3, 5, 40, 3, true, null]], "listan: flest besök först, vanlig tid och dagar sedan");
ok(lp.customers.every((c) => /^Kund #[0-9a-f]{4}$/.test(c.customer_label)), "anonyma etiketter");
ok(lp.customers.every((c) => /^\d{4}-\d{2}-\d{2}$/.test(c.last_visit)), "senaste besöket som datum");

const wb = await call("merchant_winback", "tok-linnea");
eq([wb.ok, wb.sent], [true, 2], "dubbelstämpel till båda");
const exp = (await one(`select public.sthlm_midnight(public.sthlm_today() + 15) as e`)).e;
eq(new Date(wb.expires_at).getTime(), new Date(exp).getTime(), "gäller 14 dagar t.o.m. 23.59");
eq((await call("merchant_winback", "tok-linnea")).sent, 0, "andra trycket: ingen får två");
const w1 = (await call("load_wallet", await deviceOf(L1))).find((w) => w.cafe.slug === "linnea");
ok(!!w1.bonus_expires_at, "appen ser dubbelstämpeln (Dubbelstämpel aktiv)");
const lp2 = await call("merchant_lapsed", "tok-linnea");
eq([lp2.count, lp2.eligible, lp2.sent_60d, lp2.returned_60d], [2, 0, 2, 0], "skickat till 2, ingen tillbaka än");
ok(lp2.customers.every((c) => c.winback_at && c.eligible === false), "visar när bonusen skickades");
// L1 kommer tillbaka och stämplar: bonusen används
const t1 = await call("tap_token", await deviceOf(L1), "linnea-01");
eq([t1.ok, t1.stamps_added, t1.bonus_applied], [true, 2, true], "dubbelstämpeln används vid besöket");
const lp3 = await call("merchant_lapsed", "tok-linnea");
eq([lp3.count, lp3.sent_60d, lp3.returned_60d], [1, 2, 1], "L1 är tillbaka: 1 av 2");
// 60-dagarsregeln: en vinn tillbaka för 30 dagar sedan (utgången) spärrar, 70 dagar sedan gör det inte
await db.query(`update stamp_bonuses set created_at = now() - interval '30 days', expires_at = now() - interval '16 days' where user_id = $1 and origin = 'winback'`, [L5]);
eq((await call("merchant_lapsed", "tok-linnea")).eligible, 0, "inom 60 dagar: inte igen");
await db.query(`update stamp_bonuses set created_at = now() - interval '70 days', expires_at = now() - interval '56 days' where user_id = $1 and origin = 'winback'`, [L5]);
eq((await call("merchant_lapsed", "tok-linnea")).eligible, 1, "efter 60 dagar: igen");
eq((await call("merchant_lapsed", "tok-linnea")).sent_60d, 1, "räknar bara utskick senaste 60 dagarna");
// En aktiv bonus från hjulet spärrar också
const LW = await newUser(); await visit(LW, "bryggan", [90, 80, 70]);
await db.query(`insert into stamp_bonuses(user_id, cafe_id, expires_at) select $1, id, now() + interval '2 days' from cafes where slug = 'bryggan'`, [LW]);
const lb = await call("merchant_lapsed", "tok-bryggan");
eq([lb.count, lb.eligible], [1, 0], "aktiv hjulbonus: ingen vinn tillbaka");
eq((await call("merchant_winback", "tok-bryggan")).sent, 0, "inget skickas");

// ── Översikt ─────────────────────────────────────────────────────────
// Linnea senaste 90 dagarna: L1 (86, 79, i dag), L2 (40, 30, 20), L3 (80), L4 (35), L5 (50, 45, 40)
const ins = await call("merchant_insights", "tok-linnea");
// besök: L1 3 (86, 79, i dag) · L2 3 · L3 1 · L4 1 · L5 3 = 11
eq([ins.ok, ins.customers_90d, ins.repeat_90d, ins.repeat_rate, ins.visits_90d], [true, 5, 3, 0.6, 11], "återkomst senaste 90 dagarna");
// Tider mellan besök senaste 12 månaderna: L1 7,7,7,79 · L2 10,10 · L3 60,60 · L4 65 · L5 5,5 → 11 st, median 10
eq([ins.gap_pairs, ins.median_gap_days], [11, 10], "typisk tid mellan besök");
const heatSum = ins.heatmap.reduce((a, c) => a + c[2], 0);
eq([heatSum, ins.stamps_90d], [11, 11], "veckodag/timme summerar stämplingarna (bara riktiga tryck)");
ok(ins.heatmap.every(([dow, hr]) => dow >= 1 && dow <= 7 && (hr === 11 || hr === new Date().getHours() || hr >= 0)), "veckodag 1–7, timme 0–23");
ok(ins.busiest && ins.busiest.stamps >= 1, "mest besökt: " + JSON.stringify(ins.busiest));
eq(ins.lapsed_count, 1, "en kvar att vinna tillbaka");
eq(ins.tips.map((t) => t.key), [], "Linnea: inga tips (få kunder, värde angivet)");
eq((await call("merchant_insights", "fel")).error, "bad_session", "fel session");

// Tips: Miyabi — många engångskunder, lugn tisdag, inget värde
const today = (await one(`select extract(isodow from public.sthlm_today())::int as d`)).d;
const daysAgoFor = (dow, weeks) => { const back = ((today - dow) % 7 + 7) % 7; return Array.from({ length: weeks }, (_, w) => back + 7 * w + (back === 0 ? 7 : 0)); };
for (let i = 0; i < 14; i++) {
  const u = await newUser();
  const dow = [1, 3, 4, 5, 6, 7][i % 6];                     // ingen tisdag (2)
  await visit(u, "miyabi", daysAgoFor(dow, 1).map((d) => d + 7 * (i % 4)));
}
for (let i = 0; i < 3; i++) { const u = await newUser(); await visit(u, "miyabi", daysAgoFor(1, 3).map((d) => d + i)); }
const tue = await newUser(); await visit(tue, "miyabi", daysAgoFor(2, 1));
for (let i = 0; i < 10; i++) { const u = await newUser(); await visit(u, "miyabi", daysAgoFor(6, 1).map((d) => d + 7 * i)); }
const im = await call("merchant_insights", "tok-miyabi");
ok(im.visits_90d >= 30, "Miyabi: minst 30 besök (" + im.visits_90d + ")");
const keys = im.tips.map((t) => t.key);
ok(keys.includes("return_low"), "tips: få kommer tillbaka " + JSON.stringify(im.tips));
const rl = im.tips.find((t) => t.key === "return_low");
eq([rl.has_tiers, rl.rate < 0.3], [false, true], "return_low: inga mindre belöningar, under 30 %");
const qd = im.tips.find((t) => t.key === "quiet_day");
eq(qd && qd.dow, 2, "lugnaste dagen: tisdag");
ok(keys.includes("no_value"), "tips: ange värde");
ok(keys.length <= 4, "högst 4 tips");
await db.query(`update cafes set quiet_hours = '[{"days":[2],"from":"14:00","to":"16:00"}]' where slug = 'miyabi'`);
ok(!(await call("merchant_insights", "tok-miyabi")).tips.some((t) => t.key === "quiet_day"), "lugna timmar satta: inget dagstips");

// Tips: Bryggan — fullt kort som inte lösts in, och 3 som slutat komma
const full = await newUser(); await visit(full, "bryggan", [20, 19, 18, 17, 16, 15, 14, 13]);   // 8 av 8, senast 13 d
for (let i = 0; i < 3; i++) { const u = await newUser(); await visit(u, "bryggan", [100 + i, 93 + i, 86 + i]); }
const ib = await call("merchant_insights", "tok-bryggan");
eq(ib.tips.slice(0, 2).map((t) => [t.key, t.count]), [["lapsed", 4], ["unclaimed", 1]], "vinn tillbaka först, sedan fullt kort");
await call("tap_token", await deviceOf(full), "bryggan-01");   // nytt besök i dag → inte längre "glömt"
ok(!(await call("merchant_insights", "tok-bryggan")).tips.some((t) => t.key === "unclaimed"), "besök senaste veckan: inget påminnelsetips");

// ── Månadsrapport ────────────────────────────────────────────────────
const m = await one(`select to_char(date_trunc('month', public.sthlm_today()) - interval '1 month', 'YYYY-MM') as m1,
                            to_char(date_trunc('month', public.sthlm_today()) - interval '2 month', 'YYYY-MM') as m2,
                            to_char(date_trunc('month', public.sthlm_today()), 'YYYY-MM') as m0,
                            (date_trunc('month', public.sthlm_today()) - interval '1 month')::date::text as d1,
                            (date_trunc('month', public.sthlm_today()) - interval '2 month')::date::text as d2`);
const at = (uid, day, hour = 9, source = "tap") => db.query(
  `insert into stamps(user_id, cafe_id, stamped_at, source) select $1, id, public.sthlm_midnight($2::date) + make_interval(hours => $3::int), $4 from cafes where slug = 'fika'`,
  [uid, day, hour, source]);
await db.exec(`insert into cafes(slug, name, type, area, stamps_needed, reward_text, reward_short, city, reward_value_kr)
               values ('fika', 'Fikafabriken', 'Konditori', 'Vasastan', 5, 'En bakelse på huset', 'Gratis bakelse', 'Stockholm', 45);
               insert into merchant_sessions(token_hash, cafe_id, expires_at)
                 select encode(sha256(convert_to('tok-fika', 'UTF8')), 'hex'), id, now() + interval '30 days' from cafes where slug = 'fika';`);
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const F1 = await newUser(), F2 = await newUser(), F3 = await newUser();
// Månad −2: F1 två besök (dag 3 och 10)
await at(F1, addDays(m.d2, 2), 9); await at(F1, addDays(m.d2, 9), 9);
// Månad −1: F1 (återkommande) 2 besök, ett med två stämplingar + en bonusstämpel; F2 och F3 nya
await at(F1, addDays(m.d1, 4), 9); await at(F1, addDays(m.d1, 4), 15); await at(F1, addDays(m.d1, 4), 15, "bonus"); await at(F1, addDays(m.d1, 11), 9);
await at(F2, addDays(m.d1, 4), 9); await at(F3, addDays(m.d1, 20), 9);
// Två inlösen i månad −1: en med värde 45 (sparat), en utan värde → butikens värde (45)
await db.query(`insert into redemptions(user_id, cafe_id, saved_at, status, redeemed_at, value_kr)
                select $1, id, public.sthlm_midnight($2::date) + interval '10 hours', 'redeemed', public.sthlm_midnight($2::date) + interval '10 hours', 45 from cafes where slug = 'fika'`, [F1, addDays(m.d1, 11)]);
await db.query(`insert into redemptions(user_id, cafe_id, saved_at, status, redeemed_at)
                select $1, id, public.sthlm_midnight($2::date) + interval '10 hours', 'redeemed', public.sthlm_midnight($2::date) + interval '10 hours' from cafes where slug = 'fika'`, [F2, addDays(m.d1, 12)]);
const rep = await call("merchant_month_report", "tok-fika", m.m1);
const c = rep.current, p = rep.previous;
eq([rep.ok, rep.month, rep.complete, c.month, p.month], [true, m.m1, true, m.m1, m.m2], "rätt månader");
eq([c.stamps, c.extra_stamps, c.visits, c.customers, c.new_customers, c.returning_customers], [5, 1, 4, 3, 2, 1], "månad −1: stämplar, besök och kunder");
eq([c.rewards, c.rewards_value_kr, c.rewards_unvalued], [2, 90, 0], "inlösta belöningar och värde");
const dow1 = (await one(`select extract(isodow from $1::date)::int as d`, [addDays(m.d1, 4)])).d;
eq([c.busiest_dow, c.busiest_hour], [dow1, 9], "mest besök: dag och timme");
eq([p.stamps, p.visits, p.customers, p.new_customers, p.returning_customers, p.rewards], [2, 2, 1, 1, 0, 0], "månad −2");
ok(rep.months[0] === m.m0 && rep.months.includes(m.m1) && rep.months.includes(m.m2), "valbara månader, nyast först: " + rep.months.join(","));
eq((await call("merchant_month_report", "tok-fika", "2999-01")).month, m.m0, "framtida månad → innevarande");
eq((await call("merchant_month_report", "tok-fika", "nonsens")).month, m.m0, "ogiltig → innevarande");
eq((await call("merchant_month_report", "tok-fika", null)).complete, false, "innevarande månad är inte klar");
eq((await call("merchant_month_report", "fel", null)).error, "bad_session", "fel session");
const empty = await call("merchant_month_report", "tok-miyabi", "2020-01");
eq([empty.current.stamps, empty.current.busiest_dow, empty.current.rewards_value_kr], [0, null, 0], "tom månad");

// ── Behörigheter ─────────────────────────────────────────────────────
const priv = async (fn) => (await one(`select has_function_privilege('anon', 'public.${fn}', 'execute') as a`)).a;
for (const fn of ["cafe_visit_days(uuid, date)", "lapsed_customers(uuid)", "winback_eligible(uuid, uuid)", "cafe_month_stats(uuid, date)"])
  eq(await priv(fn), false, "stängd: " + fn);
for (const fn of ["merchant_insights(text)", "merchant_lapsed(text)", "merchant_winback(text)", "merchant_month_report(text, text)"])
  eq(await priv(fn), true, "anon: " + fn);

console.log("v12 OK:", passed, "kontroller");
