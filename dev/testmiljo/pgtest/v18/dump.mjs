import { build } from "./chain.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const db = await build();
mkdirSync("orig", { recursive: true });
const r = await db.query(`select p.proname, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'`);
for (const x of r.rows) writeFileSync(`orig/${x.proname}.sql`, x.d);
const t = await db.query(`select table_name, string_agg(column_name || ' ' || data_type || case when is_nullable='NO' then ' nn' else '' end, ', ' order by ordinal_position) cols from information_schema.columns where table_schema='public' group by 1 order by 1`);
writeFileSync("orig/_tables.txt", t.rows.map((x) => `${x.table_name}: ${x.cols}`).join("\n"));
console.log(r.rows.length, "funktioner");
