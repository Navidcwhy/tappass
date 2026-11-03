-- ═══════════════════════════════════════════════════════════════════════
-- TapPass v4 — säkerhetsfix (2026-11-03)
-- STATUS 2026-11-03: EJ KÖRD ÄN. Kör HELA filen en gång i Supabase SQL Editor
--   (Supabase-MCP:ns bekräftelseruta kunde inte visas från AI-sessionen).
--   Provkörd mot en kopia av live-schemat med funktionsdefinitionerna hämtade
--   från produktion 2026-11-03. Idempotent: tål att köras flera gånger.
--
-- Bygger på det som faktiskt körs live: supabase_schema.sql + v2.
-- v3 är INTE körd (se varningen överst i supabase_migration_v3.sql).
-- Funktionerna nedan utgår från live-definitionerna — inte repots äldre SQL —
-- och ändrar bara det som står under "Stänger". Stämpling, inlösen i kassan
-- och allt kunden ser är oförändrat.
--
-- Stänger:
--   1. save_reward skapade giltiga belöningskoder utan fullt kort
--      (ett enda API-anrop med den publika nyckeln räckte).
--   2. redeem_reward var anropbar från appen → appen markerade belöningar
--      som inlösta själv efter att personalen löst in (fantomrader), och vid
--      ett nätfel i kassan kunde en sparad belöning brännas. Appen ignorerar
--      redan svaret, så inget syns för kunden.
--   3. Policyn tags_read gjorde alla taggtoken listbara via REST. Inget
--      läser tags direkt (varken appen eller tappass.se). Smart-länkssidan
--      tappass.se/t/… anropar tag_public_info, som saknades — skapas här.
--   4. search_path låst på alla RPC:er (Supabase Security Advisor, WARN).
--      Samma sökväg som PostgREST redan använder → ingen funktionsändring.
-- Härdning/stabilitet:
--   5. gen_redeem_code kollade unikhet bara mot sparade koder, men kolumnen
--      redeem_code är UNIQUE över alla rader → sparande kunde krascha när
--      antalet inlösta koder växer.
--   6. Max en sparad belöning per kort (unikt index; 0 dubbletter fanns).
--   7. cafe_pins: RLS var redan på i produktion (repots v2 saknar det).
--      Här tas även tabellrättigheterna bort för klientroller, så PIN-hashar
--      förblir oåtkomliga även om RLS någon gång stängs av.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 7. cafe_pins: RLS på + inga tabellrättigheter för klientroller ───
-- merchant_*-RPC:erna är SECURITY DEFINER och påverkas inte.
alter table public.cafe_pins enable row level security;
revoke all on table public.cafe_pins from public, anon, authenticated;

-- ─── Hjälpfunktion: stämplar på pågående kort ─────────────────────────
-- Exakt samma räkning som tap_token och load_wallet använder live.
create or replace function public.stamps_since_last_redeem(p_user_id uuid, p_cafe_id uuid)
returns int
language sql
stable
security definer
set search_path = public, extensions
as $$
  select count(*)::int
  from stamps s
  where s.user_id = p_user_id
    and s.cafe_id = p_cafe_id
    and s.stamped_at > coalesce(
      (select max(r.redeemed_at) from redemptions r
        where r.user_id = p_user_id and r.cafe_id = p_cafe_id and r.status = 'redeemed'),
      'epoch'::timestamptz);
$$;
revoke execute on function public.stamps_since_last_redeem(uuid, uuid) from public, anon, authenticated;

-- ─── 5. gen_redeem_code: unik mot ALLA rader ──────────────────────────
-- Generatorn är oförändrad; bara unikhetskontrollen är ändrad.
create or replace function public.gen_redeem_code()
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  v_code  text;
  v_tries int := 0;
begin
  loop
    -- 6 siffror, första siffran 1-9
    v_code := (1 + floor(random() * 9))::int::text;
    for i in 1..5 loop
      v_code := v_code || floor(random() * 10)::int::text;
    end loop;
    -- Unik mot alla rader (kolumnen är UNIQUE), inte bara sparade
    if not exists (select 1 from redemptions where redeem_code = v_code) then
      return v_code;
    end if;
    v_tries := v_tries + 1;
    if v_tries > 50 then
      raise exception 'Could not generate unique code';
    end if;
  end loop;
end $$;
-- Intern funktion — anropas bara från save_reward.
revoke execute on function public.gen_redeem_code() from public, anon, authenticated;

-- ─── 1. save_reward: kräver fullt kort ────────────────────────────────
create or replace function public.save_reward(
  p_device_id text,
  p_cafe_slug text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid;
  v_cafe    cafes%rowtype;
  v_code    text;
begin
  select id into v_user_id from users where device_id = p_device_id;
  select * into v_cafe from cafes where slug = p_cafe_slug;
  if v_user_id is null or v_cafe.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Redan sparad belöning → samma kod (oförändrat)
  select redeem_code into v_code from redemptions
    where user_id = v_user_id and cafe_id = v_cafe.id and status = 'saved'
    limit 1;
  if v_code is not null then
    return jsonb_build_object('ok', true, 'code', v_code);
  end if;

  -- NYTT: kortet måste vara fullt
  if v_cafe.stamps_needed is null
     or public.stamps_since_last_redeem(v_user_id, v_cafe.id) < v_cafe.stamps_needed then
    return jsonb_build_object('ok', false, 'error', 'not_complete');
  end if;

  v_code := public.gen_redeem_code();
  insert into redemptions(user_id, cafe_id, saved_at, status, redeem_code)
    values (v_user_id, v_cafe.id, now(), 'saved', v_code);
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

-- ─── 2. Bara personalen löser in — aldrig appen ───────────────────────
revoke execute on function public.redeem_reward(text, text) from public, anon, authenticated;

-- ─── 6. Max en sparad belöning per kort ───────────────────────────────
create unique index if not exists redemptions_one_saved_per_card
  on public.redemptions(user_id, cafe_id) where status = 'saved';

-- ─── 3. Taggtoken inte listbara; publik info bara per känd token ──────
drop policy if exists "tags_read" on public.tags;

create or replace function public.tag_public_info(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_cafe cafes%rowtype;
begin
  select c.* into v_cafe
    from tags t join cafes c on c.id = t.cafe_id
    where t.token = lower(coalesce(p_token, '')) and t.active = true and c.active = true;
  if v_cafe.id is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object(
    'ok', true,
    'name', v_cafe.name,
    'reward_short', v_cafe.reward_short,
    'stamps_needed', v_cafe.stamps_needed
  );
end $$;
grant execute on function public.tag_public_info(text) to anon, authenticated;

-- ─── 4. Lås search_path på övriga RPC:er (ingen funktionsändring) ─────
alter function public.tap_token(text, text)                     set search_path = public, extensions;
alter function public.load_wallet(text)                         set search_path = public, extensions;
alter function public.current_saved_code(text, text)            set search_path = public, extensions;
alter function public.redeem_reward(text, text)                 set search_path = public, extensions;
alter function public.merchant_login(text, text)                set search_path = public, extensions;
alter function public.merchant_stats(text, text)                set search_path = public, extensions;
alter function public.merchant_daily(text, text)                set search_path = public, extensions;
alter function public.merchant_pending_list(text, text)         set search_path = public, extensions;
alter function public.merchant_redeem_by_code(text, text, text) set search_path = public, extensions;
