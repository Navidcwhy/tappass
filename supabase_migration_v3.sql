-- ═══════════════════════════════════════════════════════════════════════
-- TapPass v3 — anti-fusk och härdning. Kör HELA filen i Supabase SQL Editor.
-- (Bygger ovanpå supabase_schema.sql + supabase_migration_v2.sql.)
--
-- ORDNING VID UTRULLNING:
--   1. Skicka app-patchen via `eas update` FÖRST (den hanterar både gamla
--      och nya svar från tap_token).
--   2. Kör sedan denna fil. Annars visar gamla appar "Okänd tagg" vid cooldown.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. STÄNG ANON-LÄSNING AV TAGGAR ─────────────────────────────────
-- Appen läser aldrig `tags` direkt (bara via RPC). Policyn exponerade alla
-- butikers tokens via REST.
drop policy if exists "tags_read" on tags;

-- ─── 2. DEMOKAFÉ BORT FRÅN PRODUKTION ────────────────────────────────
update cafes set active = false where slug = 'bryggan';

-- ─── 3. COOLDOWN PER CAFÉ ─────────────────────────────────────────────
-- Minsta tid mellan två stämplar för samma enhet hos samma café.
-- Stoppar både "sex tapp i rad vid kassan" och dubbelstämpel på Android
-- (App Link + skannerloop). 0 = av. Justera per café i Table Editor.
alter table cafes
  add column if not exists stamp_cooldown_minutes int not null default 120
  check (stamp_cooldown_minutes >= 0);

create or replace function tap_token(
  p_device_id text,
  p_token     text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id    uuid;
  v_cafe       cafes%rowtype;
  v_tag        tags%rowtype;
  v_pending    redemptions%rowtype;
  v_last_red   timestamptz;
  v_last_stamp timestamptz;
  v_count      int;
  v_complete   boolean;
  v_retry_min  int;
begin
  if p_device_id is null or length(p_device_id) < 8 or length(p_device_id) > 64 then
    return jsonb_build_object('ok', false, 'error', 'bad_device');
  end if;

  -- Resolve tag → cafe
  select * into v_tag from tags where token = lower(p_token) and active = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_tag', 'token', p_token);
  end if;
  select * into v_cafe from cafes where id = v_tag.cafe_id and active = true;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'inactive_cafe');
  end if;

  -- Get-or-create user
  select id into v_user_id from users where device_id = p_device_id;
  if v_user_id is null then
    insert into users(device_id) values (p_device_id) returning id into v_user_id;
  end if;

  -- Pending redemption? Block.
  select * into v_pending from redemptions
    where user_id = v_user_id and cafe_id = v_cafe.id and status = 'saved'
    limit 1;
  if found then
    return jsonb_build_object('ok', false, 'error', 'pending_reward', 'cafe', row_to_json(v_cafe));
  end if;

  -- Stamps since last redeemed redemption (or since beginning)
  select coalesce(max(redeemed_at), 'epoch'::timestamptz) into v_last_red
    from redemptions where user_id = v_user_id and cafe_id = v_cafe.id and status = 'redeemed';

  -- Cooldown: senaste stämpeln för samma enhet hos samma café
  if v_cafe.stamp_cooldown_minutes > 0 then
    select max(stamped_at) into v_last_stamp
      from stamps where user_id = v_user_id and cafe_id = v_cafe.id;
    if v_last_stamp is not null
       and v_last_stamp > now() - make_interval(mins => v_cafe.stamp_cooldown_minutes) then
      select count(*) into v_count from stamps
        where user_id = v_user_id and cafe_id = v_cafe.id and stamped_at > v_last_red;
      v_retry_min := greatest(1, ceil(extract(epoch from
        (v_last_stamp + make_interval(mins => v_cafe.stamp_cooldown_minutes) - now())) / 60)::int);
      return jsonb_build_object(
        'ok', false,
        'error', 'cooldown',
        'cafe', row_to_json(v_cafe),
        'stamps', v_count,
        'retry_after_minutes', v_retry_min
      );
    end if;
  end if;

  -- Insert the new stamp
  insert into stamps(user_id, cafe_id, tag_id) values (v_user_id, v_cafe.id, v_tag.id);

  select count(*) into v_count from stamps
    where user_id = v_user_id and cafe_id = v_cafe.id and stamped_at > v_last_red;

  v_complete := v_count >= v_cafe.stamps_needed;

  return jsonb_build_object(
    'ok', true,
    'cafe', row_to_json(v_cafe),
    'stamps', v_count,
    'complete', v_complete
  );
end $$;

-- ─── 4. PIN-LOCKOUT FÖR BUTIKSPANELEN ─────────────────────────────────
-- 5 felaktiga försök → låst 15 min. Gäller alla merchant_*-RPC:er.
alter table cafe_pins add column if not exists failed_attempts int not null default 0;
alter table cafe_pins add column if not exists locked_until timestamptz;

create or replace function merchant_check_pin(
  p_cafe_id uuid,
  p_pin     text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_row cafe_pins%rowtype;
begin
  select * into v_row from cafe_pins where cafe_id = p_cafe_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'bad_pin');
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return jsonb_build_object(
      'ok', false, 'error', 'locked',
      'retry_after_seconds', ceil(extract(epoch from (v_row.locked_until - now())))::int
    );
  end if;

  if p_pin is not null and v_row.pin_hash = crypt(p_pin, v_row.pin_hash) then
    update cafe_pins set failed_attempts = 0, locked_until = null, last_login = now()
      where cafe_id = p_cafe_id;
    return jsonb_build_object('ok', true);
  end if;

  if v_row.failed_attempts + 1 >= 5 then
    update cafe_pins set failed_attempts = 0, locked_until = now() + interval '15 minutes'
      where cafe_id = p_cafe_id;
    return jsonb_build_object('ok', false, 'error', 'locked', 'retry_after_seconds', 900);
  end if;

  update cafe_pins set failed_attempts = failed_attempts + 1 where cafe_id = p_cafe_id;
  return jsonb_build_object('ok', false, 'error', 'bad_pin');
end $$;

-- Endast via RPC:erna nedan — aldrig direkt från klient.
revoke execute on function merchant_check_pin(uuid, text) from public, anon, authenticated;

create or replace function merchant_login(
  p_cafe_slug text,
  p_pin       text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_cafe_id uuid;
  v_auth    jsonb;
begin
  select id into v_cafe_id from cafes where slug = p_cafe_slug and active = true;
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_cafe');
  end if;
  v_auth := merchant_check_pin(v_cafe_id, p_pin);
  if not (v_auth->>'ok')::boolean then return v_auth; end if;
  return jsonb_build_object('ok', true, 'cafe_id', v_cafe_id);
end $$;

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
  v_auth      jsonb;
  v_red_id    uuid;
  v_red_cafe  uuid;
begin
  select id into v_cafe_id from cafes where slug = p_cafe_slug and active = true;
  if v_cafe_id is null then return jsonb_build_object('ok', false, 'error', 'unknown_cafe'); end if;
  v_auth := merchant_check_pin(v_cafe_id, p_pin);
  if not (v_auth->>'ok')::boolean then return v_auth; end if;

  select id, cafe_id into v_red_id, v_red_cafe from redemptions
    where redeem_code = regexp_replace(coalesce(p_code, ''), '\D', '', 'g') and status = 'saved'
    limit 1;
  if v_red_id is null then return jsonb_build_object('ok', false, 'error', 'invalid_code'); end if;
  if v_red_cafe <> v_cafe_id then return jsonb_build_object('ok', false, 'error', 'wrong_cafe'); end if;

  update redemptions set status = 'redeemed', redeemed_at = now() where id = v_red_id;
  return jsonb_build_object('ok', true, 'code', p_code);
end $$;

create or replace function merchant_stats(
  p_cafe_slug text,
  p_pin       text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_cafe_id      uuid;
  v_auth         jsonb;
  v_today        int;
  v_week         int;
  v_month        int;
  v_total        int;
  v_pending      int;
  v_unique_30d   int;
  v_redeemed_30d int;
begin
  select id into v_cafe_id from cafes where slug = p_cafe_slug and active = true;
  if v_cafe_id is null then return jsonb_build_object('ok', false, 'error', 'unknown_cafe'); end if;
  v_auth := merchant_check_pin(v_cafe_id, p_pin);
  if not (v_auth->>'ok')::boolean then return v_auth; end if;

  select count(*) into v_today from stamps where cafe_id = v_cafe_id and stamped_at >= date_trunc('day', now());
  select count(*) into v_week  from stamps where cafe_id = v_cafe_id and stamped_at >= date_trunc('week', now());
  select count(*) into v_month from stamps where cafe_id = v_cafe_id and stamped_at >= date_trunc('month', now());
  select count(*) into v_total from stamps where cafe_id = v_cafe_id;
  select count(*) into v_pending from redemptions where cafe_id = v_cafe_id and status = 'saved';
  select count(distinct user_id) into v_unique_30d from stamps where cafe_id = v_cafe_id and stamped_at > now() - interval '30 days';
  select count(*) into v_redeemed_30d from redemptions where cafe_id = v_cafe_id and status = 'redeemed' and redeemed_at > now() - interval '30 days';

  return jsonb_build_object(
    'ok', true,
    'today', v_today, 'week', v_week, 'month', v_month, 'total', v_total,
    'pending', v_pending, 'unique_customers_30d', v_unique_30d, 'redeemed_30d', v_redeemed_30d
  );
end $$;

create or replace function merchant_daily(
  p_cafe_slug text,
  p_pin       text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_cafe_id uuid;
  v_auth    jsonb;
  v_result  jsonb;
begin
  select id into v_cafe_id from cafes where slug = p_cafe_slug and active = true;
  if v_cafe_id is null then return jsonb_build_object('ok', false, 'error', 'unknown_cafe'); end if;
  v_auth := merchant_check_pin(v_cafe_id, p_pin);
  if not (v_auth->>'ok')::boolean then return v_auth; end if;

  select coalesce(jsonb_agg(row_to_json(d) order by d.day desc), '[]'::jsonb) into v_result from (
    select to_char(date_trunc('day', stamped_at), 'YYYY-MM-DD') as day, count(*) as stamps
    from stamps
    where cafe_id = v_cafe_id and stamped_at > now() - interval '30 days'
    group by date_trunc('day', stamped_at)
  ) d;
  return jsonb_build_object('ok', true, 'days', v_result);
end $$;

create or replace function merchant_pending_list(
  p_cafe_slug text,
  p_pin       text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_cafe_id uuid;
  v_auth    jsonb;
  v_result  jsonb;
begin
  select id into v_cafe_id from cafes where slug = p_cafe_slug and active = true;
  if v_cafe_id is null then return jsonb_build_object('ok', false, 'error', 'unknown_cafe'); end if;
  v_auth := merchant_check_pin(v_cafe_id, p_pin);
  if not (v_auth->>'ok')::boolean then return v_auth; end if;

  select coalesce(jsonb_agg(row_to_json(r) order by r.saved_at desc), '[]'::jsonb) into v_result from (
    select redeem_code as code, saved_at,
           'Kund #' || substring(replace(user_id::text, '-', '') from 1 for 4) as customer_label
    from redemptions
    where cafe_id = v_cafe_id and status = 'saved'
  ) r;
  return jsonb_build_object('ok', true, 'pending', v_result);
end $$;

-- ─── 5. PUBLIK TAGG-INFO FÖR SMARTA LÄNKEN (tappass.se/t/<token>) ──────
-- Returnerar bara butiksnamn + belöning. Ingen lista — token måste vara känd.
create or replace function tag_public_info(p_token text) returns jsonb
language plpgsql
security definer
stable
as $$
declare
  v_cafe cafes%rowtype;
begin
  select c.* into v_cafe
    from tags t join cafes c on c.id = t.cafe_id
    where t.token = lower(coalesce(p_token, '')) and t.active = true and c.active = true;
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object(
    'ok', true, 'name', v_cafe.name,
    'reward_short', v_cafe.reward_short, 'stamps_needed', v_cafe.stamps_needed
  );
end $$;
grant execute on function tag_public_info(text) to anon, authenticated;

-- ─── 6. BYT MIYABIS PIN (den gamla låg i klartext i ett publikt repo) ──
-- Byt ut NY_PIN mot en ny 6-siffrig kod innan du kör. Skicka den till
-- Miyabi via SMS. Lägg ALDRIG PIN-koder i git igen.
-- insert into cafe_pins (cafe_id, pin_hash)
-- select id, crypt('NY_PIN', gen_salt('bf')) from cafes where slug = 'miyabi'
-- on conflict (cafe_id) do update set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null;

-- ─── NOTERING ────────────────────────────────────────────────────────
-- Tokens är i dag gissningsbara (<slug>-01) och sluggen är publik via `cafes`.
-- Cooldownen begränsar skadan, men nya stämplar bör få slumpade tokens
-- (t.ex. 'miyabi-k7q2x9'). Strukturell lösning på sikt: NTAG 424 DNA (SUN)
-- med rullande signatur — kräver nya taggar, inte nu.
