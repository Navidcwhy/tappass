-- ════════════════════════════════════════════════════════════════════
-- TapPass v9: Inlösen med tapp
-- Kunden trycker "Lös in" i appen och personalen håller butikens TapPass-stämpel
-- mot telefonen. Appen skickar stämpelns token; servern kontrollerar att den hör
-- till rätt butik och löser in belöningen. Sifferkoden finns kvar som reserv
-- (merchant_redeem_by_code är oförändrad).
--   redemptions.redeemed_via        'tap' vid inlösen med stämpeln, annars null (= koden)
--   redeem_by_tap                   appens inlösen med stämpeln
--   merchant_recent_redemptions     panelens lista "Senast inlösta" (24 h, högst 10)
-- Säkerhet: samma nivå som stämplingen (statiska taggar, se NTAG 424 DNA). Kunden kan
-- bara lösa in sin egen belöning; den som anropar API:t hemifrån vinner ingenting.
-- Bakåtkompatibel: äldre appar använder koden som förut. Kan köras flera gånger.
-- ════════════════════════════════════════════════════════════════════

-- 1. Schema ------------------------------------------------------------------
alter table public.redemptions add column if not exists redeemed_via text;
alter table public.redemptions drop constraint if exists redemptions_redeemed_via_check;
alter table public.redemptions add constraint redemptions_redeemed_via_check
  check (redeemed_via is null or redeemed_via in ('code', 'tap'));

-- 2. Inlösen med stämpeln ----------------------------------------------------------
-- Svar: { ok: true, carry_over, stamps } (stamps = kortets nya antal) eller
-- { ok: true, already: true } om belöningen nyss lösts in på annat sätt (koden), eller
-- { ok: false, error: bad_device | not_found | unknown_tag | wrong_tag | not_complete }.
-- wrong_tag/unknown_tag har expected (butikens namn) så att appen kan säga vilken
-- stämpel som gäller; wrong_tag har även got (stämpelns butik).
create or replace function public.redeem_by_tap(p_device_id text, p_cafe_slug text, p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_user_id uuid;
  v_cafe    cafes%rowtype;
  v_tag     tags%rowtype;
  v_other   text;
  v_red     redemptions%rowtype;
  v_count   int;
  v_carry   int;
begin
  if coalesce(length(p_device_id), 0) < 8 then
    return jsonb_build_object('ok', false, 'error', 'bad_device');
  end if;
  select * into v_cafe from cafes where slug = p_cafe_slug and active = true;
  if v_cafe.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_tag from tags where token = lower(trim(coalesce(p_token, ''))) and active = true;
  if v_tag.id is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_tag', 'expected', v_cafe.name);
  end if;
  if v_tag.cafe_id <> v_cafe.id then
    select name into v_other from cafes where id = v_tag.cafe_id;
    return jsonb_build_object('ok', false, 'error', 'wrong_tag', 'expected', v_cafe.name, 'got', v_other);
  end if;
  select id into v_user_id from users where device_id = p_device_id;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Ett tryck i taget per enhet (samma lås som tap_token)
  perform pg_advisory_xact_lock(hashtextextended('tappass:tap:' || p_device_id, 0));

  select * into v_red from redemptions
    where user_id = v_user_id and cafe_id = v_cafe.id and status = 'saved'
    limit 1
    for update;
  v_count := public.stamps_since_last_redeem(v_user_id, v_cafe.id);
  v_carry := greatest(0, v_count - coalesce(v_cafe.stamps_needed, 0));

  if v_red.id is not null then
    update redemptions set status = 'redeemed', redeemed_at = now(), carry_over = v_carry, redeemed_via = 'tap'
      where id = v_red.id;
  elsif v_cafe.stamps_needed is not null and v_count >= v_cafe.stamps_needed then
    -- Fullt kort utan sparad kod: lös in direkt
    insert into redemptions(user_id, cafe_id, saved_at, status, redeemed_at, carry_over, redeemed_via)
      values (v_user_id, v_cafe.id, now(), 'redeemed', now(), v_carry, 'tap');
  elsif exists (select 1 from redemptions
                  where user_id = v_user_id and cafe_id = v_cafe.id and status = 'redeemed'
                    and redeemed_at > now() - interval '2 minutes') then
    -- Nyss inlöst på annat sätt (personalen skrev in koden samtidigt)
    return jsonb_build_object('ok', true, 'already', true, 'carry_over', v_count, 'stamps', v_count);
  else
    return jsonb_build_object('ok', false, 'error', 'not_complete', 'stamps', v_count, 'needed', v_cafe.stamps_needed);
  end if;

  return jsonb_build_object('ok', true, 'carry_over', v_carry, 'stamps', v_carry);
end $function$;

-- 3. Butikspanelen: senast inlösta ----------------------------------------------------
-- Samma kundetikett som merchant_pending_list, så att personalen kan känna igen kunden.
create or replace function public.merchant_recent_redemptions(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
  v_result  jsonb;
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  select coalesce(jsonb_agg(row_to_json(r) order by r.redeemed_at desc), '[]'::jsonb) into v_result from (
    select redeemed_at, coalesce(redeemed_via, 'code') as via,
      'Kund #' || substring(replace(user_id::text, '-', '') from 1 for 4) as customer_label
    from redemptions
    where cafe_id = v_cafe_id and status = 'redeemed' and redeemed_at > now() - interval '24 hours'
    order by redeemed_at desc
    limit 10
  ) r;
  return jsonb_build_object('ok', true, 'recent', v_result);
end $function$;

-- 4. Behörigheter ------------------------------------------------------------------
grant execute on function public.redeem_by_tap(text, text, text) to anon, authenticated;
grant execute on function public.merchant_recent_redemptions(text) to anon, authenticated;
