// v7: butiksstatistik i svensk tid + dagserie i rätt ordning med nollor.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

const FIX = process.argv[2];
const db = new PGlite();
let passed = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };
const call = async (fn, ...args) =>
  (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];

await db.exec(fs.readFileSync(new URL("./base.sql", import.meta.url), "utf8"));
await db.exec(fs.readFileSync("/home/claude/tappass/supabase_migration_v6_dagens_hjul.sql", "utf8"));
await db.exec(`
  insert into cafes(slug, name, type, area, stamps_needed, city) values
    ('miyabi', 'Miyabi', 'Sushi-restaurang', 'Lidingö', 6, 'Stockholm'),
    ('tom', 'Tomma Caféet', 'Kafé', 'Vasastan', 8, 'Stockholm');
  insert into tags(cafe_id, token) select id, slug || '-01' from cafes;
  insert into users(device_id) values ('device-TEST-0001');
  insert into merchant_sessions(token_hash, cafe_id, expires_at)
    select encode(sha256(convert_to('tok-' || slug, 'UTF8')), 'hex'), id, now() + interval '30 days' from cafes;
`);

// Stämplar på kända svenska klockslag: i dag 00.30, i går 23.50, för 3 dagar sedan 12.00, och en bonus i dag.
await db.exec(`
  insert into stamps(user_id, cafe_id, tag_id, stamped_at, source)
  select u.id, c.id, t.id, x.ts, x.src
    from users u, cafes c join tags t on t.cafe_id = c.id,
         (values (public.sthlm_midnight(public.sthlm_today()) + interval '30 minutes', 'tap'),
                 (public.sthlm_midnight(public.sthlm_today()) - interval '10 minutes', 'tap'),
                 (public.sthlm_midnight(public.sthlm_today() - 3) + interval '12 hours', 'tap'),
                 (public.sthlm_midnight(public.sthlm_today()) + interval '31 minutes', 'bonus')) x(ts, src)
   where c.slug = 'miyabi';
`);

const today = (await one(`select to_char(public.sthlm_today(), 'YYYY-MM-DD') as d`)).d;
const yday = (await one(`select to_char(public.sthlm_today() - 1, 'YYYY-MM-DD') as d`)).d;
const d3 = (await one(`select to_char(public.sthlm_today() - 3, 'YYYY-MM-DD') as d`)).d;

// Före fixen: visa felet (dagserien fallande, UTC-dygn).
const oldDaily = await call("merchant_daily", "tok-miyabi");
const oldDays = oldDaily.days.map((x) => x.day);
console.log("före:", JSON.stringify(oldDaily.days), "| idag (stats):", (await call("merchant_stats", "tok-miyabi")).today);

await db.exec(fs.readFileSync(FIX, "utf8"));
await db.exec(fs.readFileSync(FIX, "utf8")); // tål att köras två gånger

const st = await call("merchant_stats", "tok-miyabi");
eq(st.ok, true, "stats ok");
eq(Number(st.today), 1, "idag = bara 00.30-stämpeln (inte gårdagens 23.50, inte bonusen)");
eq(Number(st.total), 3, "totalt = tre riktiga tryck");

const dl = await call("merchant_daily", "tok-miyabi");
eq(dl.ok, true, "daily ok");
eq(dl.days.length, 30, "30 dagar");
const days = dl.days.map((x) => x.day);
eq([...days].sort(), days, "stigande ordning");
eq(days[29], today, "sista = i dag (svensk tid)");
const byDay = Object.fromEntries(dl.days.map((x) => [x.day, Number(x.stamps)]));
eq(byDay[today], 1, "i dag 1");
eq(byDay[yday], 1, "i går 1 (23.50)");
eq(byDay[d3], 1, "för 3 dagar sedan 1");
eq(dl.days.filter((x) => Number(x.stamps) === 0).length, 27, "övriga dagar 0");
// Panelens 7D-vy = de 7 senaste dagarna
eq(days.slice(-7)[6], today, "slice(-7) slutar på i dag");

const empty = await call("merchant_daily", "tok-tom");
eq(empty, { ok: true, days: [] }, "butik utan stämplar: tom lista");
eq(await call("merchant_daily", "fel"), { ok: false, error: "bad_session" }, "ogiltig session");
eq(await call("merchant_stats", "fel"), { ok: false, error: "bad_session" }, "ogiltig session (stats)");

// Vecka/månad: måndag resp. den 1:a i svensk tid
const wk = await one(`select to_char(date_trunc('week', public.sthlm_today()::timestamp), 'Dy') as d`);
eq(wk.d, "Mon", "veckan börjar måndag");
console.log("före-ordning:", oldDays.join(","));
console.log(`OK – ${passed} kontroller`);
