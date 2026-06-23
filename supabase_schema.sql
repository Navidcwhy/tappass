-- ═══════════════════════════════════════════════════════════════════════
-- TapPass schema — kör hela denna fil i Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. TABELLER ──────────────────────────────────────────────────────

create table if not exists cafes (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,
  type            text not null,
  area            text not null,
  symbol          text not null,             -- lucide icon name: coffee, croissant, utensils, leaf, icecream
  ink_color       text not null,             -- #RRGGBB
  soft_color      text not null,
  deep_color      text not null,
  reward_text     text not null,
  reward_short    text not null,
  stamps_needed   int  not null check (stamps_needed > 0),
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

create table if not exists tags (
  id              uuid primary key default gen_random_uuid(),
  cafe_id         uuid not null references cafes(id) on delete cascade,
  token           text unique not null,      -- e.g. "miyabi-01" — what's in the NFC tag URL
  label           text,                      -- human-readable: "Disken", "Backup"
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists tags_token_idx on tags(token);

create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  device_id       text unique not null,      -- generated client-side, stored locally
  created_at      timestamptz not null default now()
);
create index if not exists users_device_id_idx on users(device_id);

create table if not exists stamps (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  cafe_id         uuid not null references cafes(id) on delete cascade,
  tag_id          uuid references tags(id) on delete set null,
  stamped_at      timestamptz not null default now()
);
create index if not exists stamps_user_cafe_idx on stamps(user_id, cafe_id, stamped_at desc);
create index if not exists stamps_cafe_time_idx on stamps(cafe_id, stamped_at desc);

create table if not exists redemptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  cafe_id         uuid not null references cafes(id) on delete cascade,
  saved_at        timestamptz,                                  -- when user pressed "Spara"
  redeemed_at     timestamptz,                                  -- when staff confirmed
  status          text not null default 'saved' check (status in ('saved','redeemed','cancelled'))
);
create index if not exists redemptions_user_cafe_idx on redemptions(user_id, cafe_id, status);

-- ─── 2. ATOMIC STAMP RPC ──────────────────────────────────────────────
-- This handles the full stamping logic safely in one transaction:
--   - resolve token → cafe + tag
--   - get-or-create user by device_id
--   - check for pending redemption (status='saved') — block if exists
--   - count stamps since last redemption
--   - insert stamp
--   - return updated card state for the app to render

create or replace function tap_token(
  p_device_id text,
  p_token     text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id   uuid;
  v_cafe      cafes%rowtype;
  v_tag       tags%rowtype;
  v_pending   redemptions%rowtype;
  v_last_red  timestamptz;
  v_count     int;
  v_complete  boolean;
begin
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
    return jsonb_build_object(
      'ok', false,
      'error', 'pending_reward',
      'cafe', row_to_json(v_cafe)
    );
  end if;

  -- Count stamps since last redeemed redemption (or since beginning)
  select coalesce(max(redeemed_at), 'epoch'::timestamptz) into v_last_red
    from redemptions where user_id = v_user_id and cafe_id = v_cafe.id and status = 'redeemed';

  -- Insert the new stamp
  insert into stamps(user_id, cafe_id, tag_id) values (v_user_id, v_cafe.id, v_tag.id);

  -- Re-count after insert
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

-- ─── 3. SAVE REWARD (pending) ─────────────────────────────────────────
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
begin
  select id into v_user_id from users where device_id = p_device_id;
  select id into v_cafe_id from cafes where slug = p_cafe_slug;
  if v_user_id is null or v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  insert into redemptions(user_id, cafe_id, saved_at, status)
    values (v_user_id, v_cafe_id, now(), 'saved');
  return jsonb_build_object('ok', true);
end $$;

-- ─── 4. REDEEM (mark as redeemed by staff) ────────────────────────────
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
begin
  select id into v_user_id from users where device_id = p_device_id;
  select id into v_cafe_id from cafes where slug = p_cafe_slug;
  if v_user_id is null or v_cafe_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Find pending (saved) redemption first, else create one (user redeemed directly)
  select id into v_red_id from redemptions
    where user_id = v_user_id and cafe_id = v_cafe_id and status = 'saved'
    limit 1;
  if v_red_id is null then
    insert into redemptions(user_id, cafe_id, saved_at, redeemed_at, status)
      values (v_user_id, v_cafe_id, now(), now(), 'redeemed');
  else
    update redemptions set status = 'redeemed', redeemed_at = now() where id = v_red_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ─── 5. LOAD WALLET (all cards for a device) ──────────────────────────
create or replace function load_wallet(p_device_id text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_result  jsonb;
begin
  select id into v_user_id from users where device_id = p_device_id;
  if v_user_id is null then
    return '[]'::jsonb;
  end if;

  -- For every cafe the user has interacted with, count stamps since last redemption
  -- and check for pending reward
  select coalesce(jsonb_agg(card), '[]'::jsonb) into v_result
  from (
    select jsonb_build_object(
      'cafe', row_to_json(c),
      'stamps', (
        select count(*) from stamps s
        where s.user_id = v_user_id and s.cafe_id = c.id
          and s.stamped_at > coalesce(
            (select max(redeemed_at) from redemptions where user_id = v_user_id and cafe_id = c.id and status = 'redeemed'),
            'epoch'::timestamptz
          )
      ),
      'pending', exists(
        select 1 from redemptions r
        where r.user_id = v_user_id and r.cafe_id = c.id and r.status = 'saved'
      )
    ) as card
    from cafes c
    where exists(select 1 from stamps s where s.user_id = v_user_id and s.cafe_id = c.id)
      and c.active = true
  ) sub;

  return v_result;
end $$;

-- ─── 6. ROW LEVEL SECURITY ────────────────────────────────────────────
-- Anyone (anon key) can READ cafes/tags. All writes go through SECURITY DEFINER RPCs above.

alter table cafes        enable row level security;
alter table tags         enable row level security;
alter table users        enable row level security;
alter table stamps       enable row level security;
alter table redemptions  enable row level security;

drop policy if exists "cafes_read" on cafes;
create policy "cafes_read" on cafes for select using (active = true);

drop policy if exists "tags_read" on tags;
create policy "tags_read" on tags for select using (active = true);

-- Users, stamps, redemptions: no direct access from anon. Only via RPC.
-- (No policies = locked down. RPCs run as security definer so they bypass this.)

-- ─── 7. ALLOW RPC EXECUTION FROM ANON ─────────────────────────────────
grant execute on function tap_token(text, text) to anon, authenticated;
grant execute on function save_reward(text, text) to anon, authenticated;
grant execute on function redeem_reward(text, text) to anon, authenticated;
grant execute on function load_wallet(text) to anon, authenticated;

-- ─── 8. SEED DATA ─────────────────────────────────────────────────────

-- Miyabi (your first paying café)
insert into cafes (slug, name, type, area, symbol, ink_color, soft_color, deep_color, reward_text, reward_short, stamps_needed)
values ('miyabi', 'Miyabi', 'Sushi-restaurang', 'Lidingö', 'utensils', '#1B5A66', '#DEE9EA', '#0C2A30', 'En 5-bitars sushi på huset', 'Gratis 5-bitars sushi', 6)
on conflict (slug) do nothing;

insert into tags (cafe_id, token, label)
select id, 'miyabi-01', 'Disken' from cafes where slug = 'miyabi'
on conflict (token) do nothing;

-- Demo café for testing the simulate row in the app
insert into cafes (slug, name, type, area, symbol, ink_color, soft_color, deep_color, reward_text, reward_short, stamps_needed)
values ('bryggan', 'Bryggans Bageri', 'Bageri', 'Södermalm', 'croissant', '#5D6B36', '#EDEEDB', '#262E18', 'En kanelbulle på huset', 'Gratis kanelbulle', 8)
on conflict (slug) do nothing;

insert into tags (cafe_id, token, label)
select id, 'bryggan-01', 'Disken' from cafes where slug = 'bryggan'
on conflict (token) do nothing;
