-- ════════════════════════════════════════════════════════════════════
-- TapPass v16: Bjud in en vän — kräver v15 (och v14:s merge_users)
-- Varje kund har en egen kod. En ny kund (högst 7 dagar sedan första användningen) anger
-- en väns kod. När den nya kunden stämplar på riktigt (source = 'tap') inom 7 dagar får
-- båda 2 stämplar var hos det stället. Inbjudan i sig ger inget.
--   cafes.invite_enabled   false = stället ger inga inbjudningsstämplar (TapPass, som wheel_enabled)
--   invite_codes           en kod per kund (telefon eller konto), 6 tecken utan 0/O/1/I/L
--   invites                en inbjudan per ny kund (friend_id är unik)
--   stamps_invite          trigger på riktiga stämplingar — tap_token är orörd, äldre appar
--                          får stämplarna också. Stämplarna har source = 'bonus' och räknas
--                          i panelens Kampanjstämplar (inte som besök eller i statistiken).
--   invite_status, invite_code, invite_redeem, invite_ack   appen
--   merchant_invite_stats                                   panelen
--   merge_users            som v14 + inbjudningarna följer med när telefoner slås ihop
-- Fusk: en kod per telefon/konto, inte sin egen, inte ömsesidigt, bara riktiga stämplingar,
-- högst 5 belönade inbjudningar per inbjudare och 30 dagar (vännen får ändå sina), en
-- raderad kunds kod fungerar inte. En trasig inbjudan stoppar aldrig en stämpling.
-- Kan köras flera gånger.
-- ════════════════════════════════════════════════════════════════════

do $$
declare
  v_merge text;
begin
  if to_regprocedure('public.birthday_status(text)') is null then
    raise exception 'Kör v15 först (supabase_migration_v15_fodelsedag.sql)';
  end if;
  select md5(prosrc) into v_merge from pg_proc where oid = 'public.merge_users(uuid,uuid)'::regprocedure;
  if v_merge not in ('74de8f93363c135898e5fa4fc19e6ba9', '78a673daa6c1cb7326ecfa41ecf08a06') then
    raise exception 'merge_users är inte v14-versionen (md5 %) — jämför med produktion först', v_merge;
  end if;
end $$;

-- 1. Schema ------------------------------------------------------------------------
alter table public.cafes add column if not exists invite_enabled boolean not null default true;

create table if not exists public.invite_codes (
  user_id    uuid primary key references public.users(id) on delete cascade,
  code       text not null unique check (code ~ '^[2-9A-HJKMNP-Z]{6}$'),
  created_at timestamptz not null default now()
);
alter table public.invite_codes enable row level security;
revoke all on public.invite_codes from anon, authenticated;

create table if not exists public.invites (
  id              uuid primary key default gen_random_uuid(),
  inviter_id      uuid not null references public.users(id) on delete cascade,
  friend_id       uuid not null unique references public.users(id) on delete cascade,
  code            text not null,
  status          text not null default 'pending' check (status in ('pending', 'rewarded', 'expired')),
  created_at      timestamptz not null default now(),
  window_until    timestamptz not null,
  cafe_id         uuid references public.cafes(id) on delete set null,
  rewarded_at     timestamptz,
  friend_stamps   int not null default 0,
  inviter_stamps  int not null default 0,
  inviter_seen_at timestamptz,
  constraint invites_not_self check (inviter_id <> friend_id)
);
create index if not exists invites_inviter_idx on public.invites (inviter_id, rewarded_at desc);
create index if not exists invites_cafe_idx on public.invites (cafe_id, rewarded_at desc);
alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;

-- 2. Hjälpfunktioner (stängda för klienter) -----------------------------------------
create or replace function public.gen_invite_code()
 returns text language plpgsql set search_path to 'public', 'extensions'
as $function$
declare
  v_abc   text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code  text;
  v_tries int := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_abc, 1 + floor(random() * length(v_abc))::int, 1);
    end loop;
    if not exists (select 1 from invite_codes where code = v_code) then
      return v_code;
    end if;
    v_tries := v_tries + 1;
    if v_tries > 50 then
      raise exception 'Could not generate unique invite code';
    end if;
  end loop;
end $function$;

-- Ge 2 stämplar var hos stället (högst 5 belönade inbjudningar per inbjudare och 30 dagar)
create or replace function public.invite_grant(p_invite uuid, p_cafe uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_inv     invites%rowtype;
  v_key     text;
  v_capped  boolean;
  v_mine    int := 0;
begin
  select * into v_inv from invites where id = p_invite for update;
  if v_inv.id is null or v_inv.status <> 'pending' then
    return null;
  end if;
  insert into stamps(user_id, cafe_id, source) select v_inv.friend_id, p_cafe, 'bonus' from generate_series(1, 2);
  select device_id into v_key from users where id = v_inv.inviter_id;
  v_capped := (select count(*) from invites
                where inviter_id = v_inv.inviter_id and status = 'rewarded' and inviter_stamps > 0
                  and rewarded_at > now() - interval '30 days') >= 5;
  if not v_capped and v_key is not null and v_key not like 'raderad\_%' then
    insert into stamps(user_id, cafe_id, source) select v_inv.inviter_id, p_cafe, 'bonus' from generate_series(1, 2);
    v_mine := 2;
  end if;
  update invites set status = 'rewarded', cafe_id = p_cafe, rewarded_at = now(), friend_stamps = 2, inviter_stamps = v_mine
   where id = p_invite;
  return jsonb_build_object('cafe_id', p_cafe, 'friend_stamps', 2, 'inviter_stamps', v_mine);
end $function$;

-- Trigger: den nya kundens första riktiga stämpling inom 7 dagar ger stämplarna
create or replace function public.invite_on_stamp()
 returns trigger language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_inv invites%rowtype;
begin
  select * into v_inv from invites where friend_id = new.user_id and status = 'pending';
  if v_inv.id is null then
    return new;
  end if;
  if new.stamped_at > v_inv.window_until then
    update invites set status = 'expired' where id = v_inv.id;
    return new;
  end if;
  if exists (select 1 from cafes where id = new.cafe_id and active and invite_enabled) then
    perform public.invite_grant(v_inv.id, new.cafe_id);
  end if;
  return new;
exception when others then
  return new;   -- en inbjudan får aldrig stoppa en stämpling
end $function$;

drop trigger if exists stamps_invite on public.stamps;
create trigger stamps_invite after insert on public.stamps
  for each row when (new.source = 'tap') execute function public.invite_on_stamp();

-- 3. Appen -------------------------------------------------------------------------
-- { ok, code (null = ingen än), can_redeem, redeem_until, entered: { status, cafe_slug, cafe_name,
--   window_until, rewarded_at } | null, friends, rewarded, unseen: [{ cafe_slug, cafe_name, rewarded_at }] }
create or replace function public.invite_status(p_device_id text)
 returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_user    users%rowtype;
  v_code    text;
  v_entered jsonb;
  v_unseen  jsonb;
begin
  select * into v_user from users where device_id = p_device_id;
  if v_user.id is null then
    return jsonb_build_object('ok', true, 'code', null, 'can_redeem', true, 'redeem_until', null, 'entered', null,
                              'friends', 0, 'rewarded', 0, 'unseen', '[]'::jsonb);
  end if;
  select code into v_code from invite_codes where user_id = v_user.id;
  select jsonb_build_object('status', i.status, 'cafe_slug', c.slug, 'cafe_name', c.name,
                            'window_until', i.window_until, 'rewarded_at', i.rewarded_at)
    into v_entered
    from invites i left join cafes c on c.id = i.cafe_id where i.friend_id = v_user.id;
  select coalesce(jsonb_agg(jsonb_build_object('cafe_slug', c.slug, 'cafe_name', c.name, 'rewarded_at', i.rewarded_at)
                            order by i.rewarded_at), '[]'::jsonb)
    into v_unseen
    from invites i join cafes c on c.id = i.cafe_id
   where i.inviter_id = v_user.id and i.status = 'rewarded' and i.inviter_stamps > 0 and i.inviter_seen_at is null;
  return jsonb_build_object('ok', true, 'code', v_code,
    'can_redeem', v_entered is null and v_user.created_at > now() - interval '7 days',
    'redeem_until', v_user.created_at + interval '7 days',
    'entered', v_entered,
    'friends', (select count(*) from invites where inviter_id = v_user.id and status <> 'expired'),
    'rewarded', (select count(*) from invites where inviter_id = v_user.id and status = 'rewarded' and inviter_stamps > 0),
    'unseen', v_unseen);
end $function$;

-- Kundens kod (skapas första gången, liksom kundraden om telefonen aldrig stämplat)
create or replace function public.invite_code(p_device_id text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_user uuid;
begin
  if coalesce(length(p_device_id), 0) < 8 or length(p_device_id) > 100 then
    return jsonb_build_object('ok', false, 'error', 'bad_device');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tappass:tap:' || p_device_id, 0));
  insert into users(device_id) values (p_device_id) on conflict (device_id) do nothing;
  select id into v_user from users where device_id = p_device_id;
  insert into invite_codes(user_id, code) values (v_user, public.gen_invite_code()) on conflict (user_id) do nothing;
  return public.invite_status(p_device_id);
end $function$;

-- En ny kund anger en väns kod.
-- { ok, status: pending (+ until) | rewarded (+ cafe_slug, cafe_name) } eller
-- { ok: false, error: unknown_code | own_code | already_used | too_late | mutual | bad_device }
create or replace function public.invite_redeem(p_device_id text, p_code text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_clean   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_user    users%rowtype;
  v_inviter uuid;
  v_key     text;
  v_id      uuid;
  v_until   timestamptz;
  v_first   uuid;
  v_cafe    cafes%rowtype;
begin
  if coalesce(length(p_device_id), 0) < 8 or length(p_device_id) > 100 then
    return jsonb_build_object('ok', false, 'error', 'bad_device');
  end if;
  if v_clean !~ '^[2-9A-HJKMNP-Z]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'unknown_code');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tappass:tap:' || p_device_id, 0));
  select ic.user_id, u.device_id into v_inviter, v_key from invite_codes ic join users u on u.id = ic.user_id where ic.code = v_clean;
  if v_inviter is null or v_key like 'raderad\_%' then
    return jsonb_build_object('ok', false, 'error', 'unknown_code');
  end if;
  insert into users(device_id) values (p_device_id) on conflict (device_id) do nothing;
  select * into v_user from users where device_id = p_device_id;
  if v_user.id = v_inviter then
    return jsonb_build_object('ok', false, 'error', 'own_code');
  end if;
  if exists (select 1 from invites where friend_id = v_user.id) then
    return jsonb_build_object('ok', false, 'error', 'already_used');
  end if;
  if v_user.created_at <= now() - interval '7 days' then
    return jsonb_build_object('ok', false, 'error', 'too_late');
  end if;
  if exists (select 1 from invites where friend_id = v_inviter and inviter_id = v_user.id) then
    return jsonb_build_object('ok', false, 'error', 'mutual');
  end if;
  v_until := v_user.created_at + interval '7 days';
  insert into invites(inviter_id, friend_id, code, window_until) values (v_inviter, v_user.id, v_clean, v_until)
    returning id into v_id;
  -- Redan stämplat på riktigt inom de 7 dagarna? Belöna direkt hos det första stället.
  select s.cafe_id into v_first from stamps s join cafes c on c.id = s.cafe_id
   where s.user_id = v_user.id and s.source = 'tap' and s.stamped_at <= v_until and c.active and c.invite_enabled
   order by s.stamped_at limit 1;
  if v_first is not null then
    perform public.invite_grant(v_id, v_first);
    select * into v_cafe from cafes where id = v_first;
    return jsonb_build_object('ok', true, 'status', 'rewarded', 'cafe_slug', v_cafe.slug, 'cafe_name', v_cafe.name);
  end if;
  return jsonb_build_object('ok', true, 'status', 'pending', 'until', v_until);
end $function$;

-- Inbjudaren har sett att vännerna stämplat (meddelandet visas en gång)
create or replace function public.invite_ack(p_device_id text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_n int;
begin
  update invites set inviter_seen_at = now()
   where inviter_id = (select id from users where device_id = p_device_id)
     and status = 'rewarded' and inviter_seen_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'acked', v_n);
end $function$;

-- 4. Panelen -----------------------------------------------------------------------
-- { ok, friends_30d, friends_total, stamps_30d } — nya kunder som kom via en inbjudan och
-- stämplade först hos er, och stämplarna det gav (vännen + den som bjöd in)
create or replace function public.merchant_invite_stats(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_cafe_id uuid := public.merchant_session_cafe(p_token);
begin
  if v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_session');
  end if;
  return jsonb_build_object('ok', true,
    'friends_30d', (select count(*) from invites where cafe_id = v_cafe_id and status = 'rewarded' and rewarded_at > now() - interval '30 days'),
    'friends_total', (select count(*) from invites where cafe_id = v_cafe_id and status = 'rewarded'),
    'stamps_30d', (select coalesce(sum(friend_stamps + inviter_stamps), 0) from invites
                    where cafe_id = v_cafe_id and status = 'rewarded' and rewarded_at > now() - interval '30 days'));
end $function$;

-- 5. Konto: inbjudningarna följer med när telefoner slås ihop (som v14 + inbjudningar) ----
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

  -- Inbjudningar (v16): mellan de två telefonerna försvinner de (samma person); som ny
  -- kund behålls kontots om båda har en; som inbjudare följer alla med; kontots kod behålls.
  delete from invites where (inviter_id = p_from and friend_id = p_to) or (inviter_id = p_to and friend_id = p_from);
  delete from invites where friend_id = p_from and exists (select 1 from invites where friend_id = p_to);
  update invites set friend_id = p_to where friend_id = p_from;
  update invites set inviter_id = p_to where inviter_id = p_from;
  if not exists (select 1 from invite_codes where user_id = p_to) then
    update invite_codes set user_id = p_to where user_id = p_from;
  end if;

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

-- 6. Behörigheter ------------------------------------------------------------------
revoke execute on function public.gen_invite_code() from public, anon, authenticated;
revoke execute on function public.invite_grant(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.invite_on_stamp() from public, anon, authenticated;
revoke execute on function public.merge_users(uuid, uuid) from public, anon, authenticated;
grant execute on function public.invite_status(text) to anon, authenticated;
grant execute on function public.invite_code(text) to anon, authenticated;
grant execute on function public.invite_redeem(text, text) to anon, authenticated;
grant execute on function public.invite_ack(text) to anon, authenticated;
grant execute on function public.merchant_invite_stats(text) to anon, authenticated;
