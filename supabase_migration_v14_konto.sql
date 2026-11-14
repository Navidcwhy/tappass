-- ════════════════════════════════════════════════════════════════════
-- TapPass v14: Konto (valfritt) — kräver v13
-- Utan konto är telefonens slumpade device_id kunden, och stämplarna finns bara där.
-- Med konto (inloggning med en kod på e-post via Supabase Auth) sparas de på kontot
-- och följer med till nya telefoner:
--   accounts(auth_uid → user_id)  ett konto = en rad i users. Radens device_id är
--                                 "kontonyckeln": alla telefoner som loggar in får den.
--                                 Befintliga RPC:er (tap_token, load_wallet …) är orörda.
--   account_link(device)          (inloggad) kopplar telefonen till kontot. Nytt konto:
--                                 telefonens id blir kontonyckeln. Befintligt konto: det
--                                 telefonen samlat flyttas in i kontot och telefonen får
--                                 kontonyckeln (svaret device_id). Korten summeras per
--                                 ställe — inga stämplar försvinner.
--   account_status(device)        är telefonen kopplad? (maskad e-post)
--   account_rotate()              (inloggad) ny kontonyckel: alla andra telefoner loggas
--                                 ut (tappad telefon)
--   account_delete()              (inloggad) raderar kontot och inloggningen (App Store
--                                 5.1.1(v)). Stämplarna försvinner ur appen; raderna blir
--                                 kvar utan koppling till kunden så att butikernas
--                                 statistik inte ändras i efterhand.
--   app_settings / auth_methods() vilka inloggningssätt appen visar. Allt är avstängt tills
--                                 e-postkoden är inställd i Supabase (se README-v14-konto.md).
-- Inloggning krävs för att koppla, byta nyckel och radera — kontonyckeln räcker inte,
-- så den som hittar en borttappad telefon kan inte ta över eller radera kontot.
-- Kan köras flera gånger.
-- ════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.merchant_get_profile(text)') is null then
    raise exception 'Kör v13 först (supabase_migration_v13_profil.sql)';
  end if;
end $$;

-- 1. Schema ------------------------------------------------------------------------
create table if not exists public.accounts (
  auth_uid     uuid primary key references auth.users(id) on delete cascade,
  user_id      uuid not null unique references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_link_at timestamptz not null default now()
);
alter table public.accounts enable row level security;
revoke all on public.accounts from anon, authenticated;

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
insert into public.app_settings(key, value)
  values ('auth_methods', '{"email": false, "apple": false, "google": false}')
  on conflict (key) do nothing;

-- 2. Vilka inloggningssätt appen visar (apple/google: senare, kräver butiksbygge) ------
create or replace function public.auth_methods()
 returns jsonb language sql stable security definer set search_path to 'public', 'extensions'
as $function$
  select coalesce((select jsonb_build_object(
           'email',  coalesce((value->>'email')::boolean, false),
           'apple',  coalesce((value->>'apple')::boolean, false),
           'google', coalesce((value->>'google')::boolean, false))
         from app_settings where key = 'auth_methods'),
         '{"email": false, "apple": false, "google": false}'::jsonb);
$function$;

-- 3. Hjälpfunktioner (stängda för klienter) -----------------------------------------
-- "n***@gmail.com"
create or replace function public.mask_email(p_email text)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case when p_email is null or position('@' in p_email) < 2 then null
              else left(p_email, 1) || '***' || substring(p_email from position('@' in p_email)) end;
$function$;

-- Flyttar allt från p_from till p_to (samma kund på två telefoner). Kortet hos varje
-- ställe blir summan av de två korten: hamnar den senaste inlösen på det ena kortets
-- stämplar räknas de andra stämplarna in via överskottet (carry_over).
-- Krockar: en sparad belöning per kort (p_from:s ångras — stämplarna finns kvar), ett
-- hjulsnurr per dag (en vinst behålls före en förlust) och högst en aktiv dubbelstämpel
-- per ställe (p_to:s behålls).
-- Svar: antal stämplar som låg på p_from:s kort (det kunden såg på telefonen).
create or replace function public.merge_users(p_from uuid, p_to uuid)
 returns int language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe   uuid;
  v_want   int;
  v_now    int;
  v_last   uuid;
  v_moved  int := 0;
  v_n      int;
  v_before jsonb := '{}'::jsonb;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return 0;
  end if;
  -- Kortens antal före sammanslagningen (per ställe där någon av dem har något)
  for v_cafe in select cafe_id from stamps where user_id in (p_from, p_to)
                union select cafe_id from redemptions where user_id in (p_from, p_to) loop
    v_n := public.stamps_since_last_redeem(p_from, v_cafe);
    v_moved := v_moved + v_n;
    v_before := v_before || jsonb_build_object(v_cafe::text, v_n + public.stamps_since_last_redeem(p_to, v_cafe));
  end loop;

  update redemptions set status = 'cancelled'
   where user_id = p_from and status = 'saved'
     and cafe_id in (select cafe_id from redemptions where user_id = p_to and status = 'saved');

  delete from wheel_spins f using wheel_spins t
   where f.user_id = p_from and t.user_id = p_to and f.spin_date = t.spin_date
     and (t.won or not f.won);
  delete from wheel_spins t using wheel_spins f
   where t.user_id = p_to and f.user_id = p_from and f.spin_date = t.spin_date;

  delete from stamp_bonuses f
   where f.user_id = p_from and f.used_at is null and f.expires_at > now()
     and exists (select 1 from stamp_bonuses t
                  where t.user_id = p_to and t.cafe_id = f.cafe_id and t.used_at is null and t.expires_at > now());

  update stamps set user_id = p_to where user_id = p_from;
  update redemptions set user_id = p_to where user_id = p_from;
  update wheel_spins set user_id = p_to where user_id = p_from;
  update stamp_bonuses set user_id = p_to where user_id = p_from;
  delete from users where id = p_from;

  -- Inga stämplar får försvinna: justera överskottet på den senaste inlösen
  for v_cafe in select (key)::uuid from jsonb_each(v_before) loop
    v_want := (v_before->>v_cafe::text)::int;
    v_now := public.stamps_since_last_redeem(p_to, v_cafe);
    if v_want > v_now then
      select id into v_last from redemptions
        where user_id = p_to and cafe_id = v_cafe and status = 'redeemed'
        order by redeemed_at desc nulls last limit 1;
      if v_last is not null then
        update redemptions set carry_over = coalesce(carry_over, 0) + (v_want - v_now) where id = v_last;
      end if;
    end if;
  end loop;
  return v_moved;
end $function$;

-- 4. Kundens RPC:er ---------------------------------------------------------------
-- Inloggad (auth.uid()): koppla den här telefonen till kontot.
-- Svar: { ok, device_id (kontonyckeln — spara den i telefonen), created, merged,
--         moved_stamps, already? }
-- Fel: not_signed_in, bad_device, other_account (telefonen hör redan till ett annat konto)
create or replace function public.account_link(p_device_id text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_acc   accounts%rowtype;
  v_dev   uuid;
  v_key   text;
  v_moved int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  if coalesce(length(p_device_id), 0) < 8 or length(p_device_id) > 100 then
    return jsonb_build_object('ok', false, 'error', 'bad_device');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tappass:account:' || v_uid::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('tappass:tap:' || p_device_id, 0));

  select id into v_dev from users where device_id = p_device_id;
  select * into v_acc from accounts where auth_uid = v_uid;

  if v_dev is not null and exists (select 1 from accounts where user_id = v_dev and auth_uid <> v_uid) then
    return jsonb_build_object('ok', false, 'error', 'other_account');
  end if;

  if v_acc.auth_uid is null then
    -- Nytt konto: telefonens id blir kontonyckeln
    if v_dev is null then
      insert into users(device_id) values (p_device_id) returning id into v_dev;
    end if;
    insert into accounts(auth_uid, user_id) values (v_uid, v_dev);
    return jsonb_build_object('ok', true, 'device_id', p_device_id, 'created', true, 'merged', false, 'moved_stamps', 0);
  end if;

  select device_id into v_key from users where id = v_acc.user_id;
  if v_dev = v_acc.user_id then
    return jsonb_build_object('ok', true, 'device_id', v_key, 'created', false, 'merged', false, 'moved_stamps', 0, 'already', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tappass:tap:' || v_key, 0));
  if v_dev is not null then
    v_moved := public.merge_users(v_dev, v_acc.user_id);
  end if;
  update accounts set last_link_at = now() where auth_uid = v_uid;
  return jsonb_build_object('ok', true, 'device_id', v_key, 'created', false, 'merged', v_dev is not null, 'moved_stamps', v_moved);
end $function$;

-- Är telefonen kopplad till ett konto? Telefonens id är nyckeln, som för korten.
-- { ok, linked, email (maskad), since }
create or replace function public.account_status(p_device_id text)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_acc   accounts%rowtype;
  v_email text;
begin
  select a.* into v_acc from accounts a join users u on u.id = a.user_id where u.device_id = p_device_id;
  if v_acc.auth_uid is null then
    return jsonb_build_object('ok', true, 'linked', false);
  end if;
  select email into v_email from auth.users where id = v_acc.auth_uid;
  return jsonb_build_object('ok', true, 'linked', true, 'email', public.mask_email(v_email), 'since', v_acc.created_at);
end $function$;

-- Inloggad: ny kontonyckel. Telefonen som anropar får den; alla andra telefoner har
-- kvar den gamla och är därmed utloggade (de ser ett tomt kort tills de loggar in igen).
-- { ok, device_id } eller { ok: false, error: not_signed_in | not_linked }
create or replace function public.account_rotate()
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_user uuid;
  v_key  text;
  v_new  text := 'k_' || replace(gen_random_uuid()::text, '-', '');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tappass:account:' || v_uid::text, 0));
  select a.user_id, u.device_id into v_user, v_key from accounts a join users u on u.id = a.user_id where a.auth_uid = v_uid;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_linked');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tappass:tap:' || v_key, 0));
  update users set device_id = v_new where id = v_user;
  update accounts set last_link_at = now() where auth_uid = v_uid;
  return jsonb_build_object('ok', true, 'device_id', v_new);
end $function$;

-- Inloggad: radera kontot. Inloggningen (e-posten) och kontot raderas, sparade
-- belöningar ångras och oanvända dubbelstämplar tas bort. Kundraden får en ny,
-- oåtkomlig nyckel: stämplarna försvinner ur appen på alla telefoner men finns kvar
-- i butikernas statistik utan koppling till någon person.
-- { ok, deleted } (deleted = false: inloggningen fanns men var inte kopplad)
create or replace function public.account_delete()
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_user uuid;
  v_key  text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tappass:account:' || v_uid::text, 0));
  select a.user_id, u.device_id into v_user, v_key from accounts a join users u on u.id = a.user_id where a.auth_uid = v_uid;
  if v_user is not null then
    perform pg_advisory_xact_lock(hashtextextended('tappass:tap:' || v_key, 0));
    update redemptions set status = 'cancelled' where user_id = v_user and status = 'saved';
    delete from stamp_bonuses where user_id = v_user and used_at is null;
    update users set device_id = 'raderad_' || replace(gen_random_uuid()::text, '-', '') where id = v_user;
    delete from accounts where auth_uid = v_uid;
  end if;
  delete from auth.users where id = v_uid;
  return jsonb_build_object('ok', true, 'deleted', v_user is not null);
end $function$;

-- 5. Behörigheter ------------------------------------------------------------------
revoke execute on function public.mask_email(text) from public, anon, authenticated;
revoke execute on function public.merge_users(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.account_link(text) from public, anon;
revoke execute on function public.account_rotate() from public, anon;
revoke execute on function public.account_delete() from public, anon;
grant execute on function public.account_link(text) to authenticated;
grant execute on function public.account_rotate() to authenticated;
grant execute on function public.account_delete() to authenticated;
grant execute on function public.auth_methods() to anon, authenticated;
grant execute on function public.account_status(text) to anon, authenticated;
