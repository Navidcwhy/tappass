// Bygger en kopia av produktionen: ../base.sql + auth + v6…v17 (+ extra filer) och returnerar db.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
const REPO = process.env.TAPPASS_REPO || "/home/claude/tappass";
export const CHAIN = ["v6_dagens_hjul", "v7_buggfixar", "v8_lugna_timmar", "v9_inlosen_tapp", "v10_fler_beloningar", "v11_stamgaster", "v12_insikter", "v13_profil", "v14_konto", "v15_fodelsedag", "v16_bjud_in", "v17_dynamiska_taggar"];
export const mig = (v) => readFileSync(`${REPO}/supabase_migration_${v}.sql`, "utf8");
export async function build(extra = []) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(readFileSync(new URL("../base.sql", import.meta.url), "utf8"));
  await db.exec(`create schema if not exists auth; create table if not exists auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create extension if not exists pgcrypto with schema extensions;`);
  for (const v of CHAIN) await db.exec(mig(v));
  for (const f of extra) await db.exec(readFileSync(new URL(f, import.meta.url), "utf8"));
  return db;
}
