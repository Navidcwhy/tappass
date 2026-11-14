// md5(prosrc) för valda funktioner efter en kedja av migrationer: node md5-now.mjs v14_konto fn1,fn2
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const upto = process.argv[2], fns = process.argv[3].split(",");
const chain = ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar", "v9_inlosen_tapp", "v10_fler_beloningar", "v11_stamgaster", "v12_insikter", "v13_profil", "v14_konto", "v15_fodelsedag"];
const db = new PGlite();
await db.exec(readFileSync("base.sql", "utf8"));
await db.exec(`create schema if not exists auth; create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;`);
for (const v of chain.slice(0, chain.indexOf(upto) + 1)) await db.exec(readFileSync(`/home/claude/tappass/supabase_migration_${v}.sql`, "utf8"));
const r = await db.query(`select p.oid::regprocedure::text as sig, md5(p.prosrc) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = any($1) order by 1`, [fns]);
for (const row of r.rows) console.log(row.sig, row.h);
