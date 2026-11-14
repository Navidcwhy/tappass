import { build } from "./chain.mjs";
import { readFileSync } from "node:fs";
const prod = JSON.parse(readFileSync("prod-md5.json", "utf8"));
const db = await build(process.argv.slice(2).map((f) => "./" + f));
const r = await db.query(`select p.proname, md5(p.prosrc) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`);
const local = Object.fromEntries(r.rows.map((x) => [x.proname, x.h]));
const missing = [], diff = [];
for (const [k, v] of Object.entries(prod)) { if (!local[k]) missing.push(k); else if (local[k] !== v) diff.push(k); }
console.log("saknas lokalt:", missing.join(", ") || "-");
console.log("skiljer sig:", diff.join(", ") || "-");
