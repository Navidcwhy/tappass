import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
const db = new PGlite({ extensions: { pgcrypto } });   // v17 behöver pgcrypto (i produktion: schema extensions)
await db.exec(readFileSync("base.sql", "utf8"));
await db.exec(`create schema if not exists auth; create table if not exists auth.users (id uuid primary key, email text);
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create extension if not exists pgcrypto with schema extensions;`);
for (const v of ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar", "v9_inlosen_tapp", "v10_fler_beloningar", "v11_stamgaster", "v12_insikter", "v13_profil", "v14_konto", ...(process.argv[3] ? process.argv[3].split(",") : [])])
  await db.exec(readFileSync(`/home/claude/tappass/supabase_migration_${v}.sql`, "utf8"));
const src = readFileSync(`/home/claude/tappass/supabase_migration_${process.argv[2]}.sql`, "utf8");
// Dela vid ; i slutet av rader utanför $-citat
const parts = []; let cur = "", inq = null;
for (const line of src.split("\n")) {
  cur += line + "\n";
  const m = line.match(/\$[a-z_]*\$/g) || [];
  for (const t of m) { if (inq === null) inq = t; else if (inq === t) inq = null; }
  if (inq === null && /;\s*(--.*)?$/.test(line)) { parts.push(cur); cur = ""; }
}
for (const p of parts) {
  try { await db.exec(p); } catch (e) { console.log("FEL:", e.message, "pos", e.position, "\n", p.slice(0, 300)); const pos = Number(e.position); if (pos) console.log("…", JSON.stringify(p.slice(Math.max(0, pos - 120), pos + 40))); process.exit(1); }
}
console.log("alla", parts.length, "satser ok");
