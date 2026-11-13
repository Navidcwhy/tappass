// v7: kunden har aktiv dubbelstämpel hos alla ställen i staden.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

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
    ('miyabi', 'Miyabi', 'Sushi', 'Lidingö', 6, 'Stockholm'),
    ('bryggan', 'Bryggans Bageri', 'Bageri', 'Södermalm', 8, 'Stockholm'),
    ('kaffe-gbg', 'Kaffe GBG', 'Kafé', 'Haga', 5, 'Göteborg');
  insert into tags(cafe_id, token) select id, slug || '-01' from cafes;
  insert into users(device_id) values ('device-BONUS-0001');
  -- Vinster i förrgår (Miyabi) och i går (Bryggan), båda hämtade men inte använda.
  insert into wheel_spins(user_id, spin_date, segment, won, offers, claimed_cafe_id, claimed_at)
    select u.id, public.sthlm_today() - x.k, 0, true, array[c.id], c.id, now()
      from users u, cafes c, (values (2, 'miyabi'), (1, 'bryggan')) x(k, slug)
     where c.slug = x.slug;
  insert into stamp_bonuses(user_id, cafe_id, spin_id, expires_at)
    select w.user_id, w.claimed_cafe_id, w.id, public.sthlm_midnight(w.spin_date + 3) from wheel_spins w;
`);
const A = "device-BONUS-0001";

// Före v7: felet (kan snurra enligt läget, men snurret säger "inga ställen").
const before = await call("wheel_status", A);
const spinBefore = await call("spin_wheel", A, "Stockholm");
console.log("före v7: can_spin =", before.can_spin, "| spin =", JSON.stringify(spinBefore));

const v7 = process.argv[2];
await db.exec(fs.readFileSync(v7, "utf8"));
await db.exec(fs.readFileSync(v7, "utf8"));

const st = await call("wheel_status", A);
eq(st.can_spin, true, "inget snurr i dag än");
eq(st.cities, [{ city: "Stockholm", places: 2, available: 0 }, { city: "Göteborg", places: 1, available: 1 }], "available per stad");
eq((await call("spin_wheel", A, "Stockholm")).error, "all_bonused", "alla ställen har bonus → all_bonused");
eq((await call("spin_wheel", A, "stockholm ")).error, "all_bonused", "skiftläge/blanksteg");
eq((await one(`select count(*)::int as n from wheel_spins where spin_date = public.sthlm_today()`)).n, 0, "snurret förbrukas inte");
eq((await call("spin_wheel", A, "Malmö")).error, "no_places", "stad utan ställen är fortfarande no_places");

// Ny kund: available = places.
const fresh = await call("wheel_status", "device-NEW-00000002");
eq(fresh.cities.map((c) => c.available), [2, 1], "ny kund kan vinna överallt");

// Kunden använder Miyabi-bonusen (stämplar) → ett ställe ledigt → snurret går.
const tap = await call("tap_token", A, "miyabi-01");
eq([tap.ok, tap.stamps_added, tap.bonus_applied], [true, 2, true], "bonusen används");
const st2 = await call("wheel_status", A);
eq(st2.cities[0].available, 1, "Stockholm: ett ställe ledigt");
const sp = await call("spin_wheel", A, "Stockholm");
eq(sp.ok, true, "snurret går nu");
if (sp.won) eq(sp.offers.map((o) => o.cafe.slug), ["miyabi"], "bara stället utan aktiv bonus erbjuds");

// En utgången bonus räknas inte.
await db.exec(`update stamp_bonuses set expires_at = now() - interval '1 minute' where used_at is null`);
eq((await call("wheel_status", A)).cities[0].available, 2, "utgången bonus spärrar inte");

console.log(`OK – ${passed} kontroller`);
