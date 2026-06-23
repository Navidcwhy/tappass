-- ═══════════════════════════════════════════════════════════════════════
-- TapPass v2 schema migration — kör DENNA fil i Supabase SQL Editor
-- (Bygger ovanpå supabase_schema.sql. Kör efter den, inte istället för.)
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. ADD redeem_code COLUMN TO REDEMPTIONS ─────────────────────────

alter table redemptions
  add column if not exists redeem_code text unique;

create index if not exists redemptions_code_idx on redemptions(redeem_code);

-- ─── 2. ADD cafe_pins TABLE FOR MERCHANT LOGIN ────────────────────────

create table if not exists cafe_pins (
  cafe_id   uuid primary key references cafes(id) on delete cascade,
  pin_hash  text not null,                       -- bcrypt-like hash stored using pgcrypto crypt()
  created_at timestamptz not null default now(),
  last_login timestamptz
);

-- Enable pgcrypto for password hashing
create extension if not exists pgcrypto;

-- ─── 3. HELPER: generate 6-digit code (avoid leading zero confusion) ──

create or replace function gen_redeem_code() returns text
language plpgsql
as $$
declare
  v_code text;
  v_tries int := 0;
begin
  loop
    -- 6 digits, first digit is 1-9
    v_code := (1 + floor(random() * 9))::int::text;
    for i in 1..5 loop
      v_code := v_code || floor(random() * 10)::int::text;
    end loop;
    -- Ensure unique among unredeemed codes
    if not exists(select 1 from redemptions where redeem_code = v_code and status = 'saved') then
      return v_code;
    end if;
    v_tries := v_tries + 1;
    if v_tries > 50 then
      raise exception 'Could not generate unique code';
    end if;
  end loop;
end $$;

-- ─── 4. REPLACE save_reward TO RETURN A CODE ──────────────────────────

create or replace function save_reward(
  p_device_id text,
  p_cafe_slug text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_cafe_id uuid;
  v_code    text;
begin
  select id into v_user_id from users where device_id = p_device_id;
  select id into v_cafe_id from cafes where slug = p_cafe_slug;
  if v_user_id is null or v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- If already a saved redemption, return its code
  select redeem_code into v_code from redemptions
    where user_id = v_user_id and cafe_id = v_cafe_id and status = 'saved'
    limit 1;
  if v_code is not null then
    return jsonb_build_object('ok', true, 'code', v_code);
  end if;

  v_code := gen_redeem_code();
  insert into redemptions(user_id, cafe_id, saved_at, status, redeem_code)
    values (v_user_id, v_cafe_id, now(), 'saved', v_code);
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

-- ─── 5. REPLACE redeem_reward TO ALSO HANDLE direct redeem ────────────

create or replace function redeem_reward(
  p_device_id text,
  p_cafe_slug text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_cafe_id uuid;
  v_red_id  uuid;
  v_code    text;
begin
  select id into v_user_id from users where device_id = p_device_id;
  select id into v_cafe_id from cafes where slug = p_cafe_slug;
  if v_user_id is null or v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Find pending (saved) redemption; if none, create one then immediately redeem
  select id, redeem_code into v_red_id, v_code
    from redemptions
    where user_id = v_user_id and cafe_id = v_cafe_id and status = 'saved'
    limit 1;
  if v_red_id is null then
    v_code := gen_redeem_code();
    insert into redemptions(user_id, cafe_id, saved_at, redeemed_at, status, redeem_code)
      values (v_user_id, v_cafe_id, now(), now(), 'redeemed', v_code)
      returning id into v_red_id;
  else
    update redemptions set status = 'redeemed', redeemed_at = now() where id = v_red_id;
  end if;
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

-- ─── 6. CURRENT SAVED CODE (so app can re-display it on the card) ─────

create or replace function current_saved_code(
  p_device_id text,
  p_cafe_slug text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_cafe_id uuid;
  v_code    text;
begin
  select id into v_user_id from users where device_id = p_device_id;
  select id into v_cafe_id from cafes where slug = p_cafe_slug;
  if v_user_id is null or v_cafe_id is null then
    return jsonb_build_object('ok', false);
  end if;
  select redeem_code into v_code from redemptions
    where user_id = v_user_id and cafe_id = v_cafe_id and status = 'saved'
    limit 1;
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

-- ─── 7. MERCHANT: LOGIN ───────────────────────────────────────────────
-- Returns a "session token" (just the cafe_id + a checksum) — for MVP we
-- pass cafe_slug + pin together on every merchant RPC instead of session state.

create or replace function merchant_login(
  p_cafe_slug text,
  p_pin       text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_cafe_id uuid;
  v_match   boolean;
begin
  select id into v_cafe_id from cafes where slug = p_cafe_slug and active = true;
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_cafe');
  end if;
  select pin_hash = crypt(p_pin, pin_hash) into v_match from cafe_pins where cafe_id = v_cafe_id;
  if not coalesce(v_match, false) then
    return jsonb_build_object('ok', false, 'error', 'bad_pin');
  end if;
  update cafe_pins set last_login = now() where cafe_id = v_cafe_id;
  return jsonb_build_object('ok', true, 'cafe_id', v_cafe_id);
end $$;

-- ─── 8. MERCHANT: REDEEM BY CODE ──────────────────────────────────────

create or replace function merchant_redeem_by_code(
  p_cafe_slug text,
  p_pin       text,
  p_code      text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_cafe_id   uuid;
  v_match     boolean;
  v_red_id    uuid;
  v_red_cafe  uuid;
  v_stamps    int;
begin
  -- Auth
  select id into v_cafe_id from cafes where slug = p_cafe_slug and active = true;
  if v_cafe_id is null then return jsonb_build_object('ok', false, 'error', 'unknown_cafe'); end if;
  select pin_hash = crypt(p_pin, pin_hash) into v_match from cafe_pins where cafe_id = v_cafe_id;
  if not coalesce(v_match, false) then return jsonb_build_object('ok', false, 'error', 'bad_pin'); end if;

  -- Find redemption by code
  select id, cafe_id into v_red_id, v_red_cafe from redemptions
    where redeem_code = p_code and status = 'saved'
    limit 1;
  if v_red_id is null then return jsonb_build_object('ok', false, 'error', 'invalid_code'); end if;
  if v_red_cafe <> v_cafe_id then return jsonb_build_object('ok', false, 'error', 'wrong_cafe'); end if;

  -- Mark redeemed
  update redemptions set status = 'redeemed', redeemed_at = now() where id = v_red_id;

  return jsonb_build_object('ok', true, 'code', p_code);
end $$;

-- ─── 9. MERCHANT: STATS ───────────────────────────────────────────────

create or replace function merchant_stats(
  p_cafe_slug text,
  p_pin       text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_cafe_id    uuid;
  v_match      boolean;
  v_today      int;
  v_week       int;
  v_month      int;
  v_total      int;
  v_pending    int;
  v_unique_30d int;
  v_redeemed_30d int;
begin
  select id into v_cafe_id from cafes where slug = p_cafe_slug and active = true;
  if v_cafe_id is null then return jsonb_build_object('ok', false, 'error', 'unknown_cafe'); end if;
  select pin_hash = crypt(p_pin, pin_hash) into v_match from cafe_pins where cafe_id = v_cafe_id;
  if not coalesce(v_match, false) then return jsonb_build_object('ok', false, 'error', 'bad_pin'); end if;

  select count(*) into v_today from stamps where cafe_id = v_cafe_id and stamped_at >= date_trunc('day', now());
  select count(*) into v_week  from stamps where cafe_id = v_cafe_id and stamped_at >= date_trunc('week', now());
  select count(*) into v_month from stamps where cafe_id = v_cafe_id and stamped_at >= date_trunc('month', now());
  select count(*) into v_total from stamps where cafe_id = v_cafe_id;
  select count(*) into v_pending from redemptions where cafe_id = v_cafe_id and status = 'saved';
  select count(distinct user_id) into v_unique_30d from stamps where cafe_id = v_cafe_id and stamped_at > now() - interval '30 days';
  select count(*) into v_redeemed_30d from redemptions where cafe_id = v_cafe_id and status = 'redeemed' and redeemed_at > now() - interval '30 days';

  return jsonb_build_object(
    'ok', true,
    'today', v_today,
    'week',  v_week,
    'month', v_month,
    'total', v_total,
    'pending', v_pending,
    'unique_customers_30d', v_unique_30d,
    'redeemed_30d', v_redeemed_30d
  );
end $$;

-- ─── 10. MERCHANT: RECENT STAMPS (daily breakdown for chart) ──────────

create or replace function merchant_daily(
  p_cafe_slug text,
  p_pin       text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_cafe_id uuid;
  v_match   boolean;
  v_result  jsonb;
begin
  select id into v_cafe_id from cafes where slug = p_cafe_slug and active = true;
  if v_cafe_id is null then return jsonb_build_object('ok', false, 'error', 'unknown_cafe'); end if;
  select pin_hash = crypt(p_pin, pin_hash) into v_match from cafe_pins where cafe_id = v_cafe_id;
  if not coalesce(v_match, false) then return jsonb_build_object('ok', false, 'error', 'bad_pin'); end if;

  select coalesce(jsonb_agg(row_to_json(d) order by d.day desc), '[]'::jsonb) into v_result from (
    select
      to_char(date_trunc('day', stamped_at), 'YYYY-MM-DD') as day,
      count(*) as stamps
    from stamps
    where cafe_id = v_cafe_id and stamped_at > now() - interval '30 days'
    group by date_trunc('day', stamped_at)
  ) d;

  return jsonb_build_object('ok', true, 'days', v_result);
end $$;

-- ─── 11. MERCHANT: LIST PENDING REDEMPTIONS ───────────────────────────

create or replace function merchant_pending_list(
  p_cafe_slug text,
  p_pin       text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_cafe_id uuid;
  v_match   boolean;
  v_result  jsonb;
begin
  select id into v_cafe_id from cafes where slug = p_cafe_slug and active = true;
  if v_cafe_id is null then return jsonb_build_object('ok', false, 'error', 'unknown_cafe'); end if;
  select pin_hash = crypt(p_pin, pin_hash) into v_match from cafe_pins where cafe_id = v_cafe_id;
  if not coalesce(v_match, false) then return jsonb_build_object('ok', false, 'error', 'bad_pin'); end if;

  select coalesce(jsonb_agg(row_to_json(r) order by r.saved_at desc), '[]'::jsonb) into v_result from (
    select
      redeem_code as code,
      saved_at,
      'Kund #' || substring(replace(user_id::text, '-', '') from 1 for 4) as customer_label
    from redemptions
    where cafe_id = v_cafe_id and status = 'saved'
  ) r;

  return jsonb_build_object('ok', true, 'pending', v_result);
end $$;

-- ─── 12. GRANT RPC EXECUTION ──────────────────────────────────────────

grant execute on function current_saved_code(text, text) to anon, authenticated;
grant execute on function merchant_login(text, text) to anon, authenticated;
grant execute on function merchant_redeem_by_code(text, text, text) to anon, authenticated;
grant execute on function merchant_stats(text, text) to anon, authenticated;
grant execute on function merchant_daily(text, text) to anon, authenticated;
grant execute on function merchant_pending_list(text, text) to anon, authenticated;

-- ─── 13. SET MIYABI'S PIN ─────────────────────────────────────────────
-- PIN: 482917 (hashed with pgcrypto's crypt + blowfish salt)

insert into cafe_pins (cafe_id, pin_hash)
select id, crypt('482917', gen_salt('bf'))
from cafes where slug = 'miyabi'
on conflict (cafe_id) do update set pin_hash = excluded.pin_hash;

-- Also set a test PIN for Bryggan: 111111
insert into cafe_pins (cafe_id, pin_hash)
select id, crypt('111111', gen_salt('bf'))
from cafes where slug = 'bryggan'
on conflict (cafe_id) do update set pin_hash = excluded.pin_hash;
