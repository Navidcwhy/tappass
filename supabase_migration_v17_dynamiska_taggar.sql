-- ════════════════════════════════════════════════════════════════════
-- TapPass v17: Dynamiska taggar (NTAG 424 DNA, SUN) — kräver v16
-- Dagens taggar är statiska (<slug>-01 som text eller adress): den som känner token kan
-- stämpla hemifrån via API:t. En NTAG 424 DNA skriver i stället en ny adress vid varje
-- läsning (Secure Unique NFC, NXP AN12196):
--   https://tappass.se/t/<token>?e=<32 hex>&c=<16 hex>
--   e = AES-128(nyckel 1, IV 0) av C7 ‖ UID (7 byte) ‖ läsräknare (3 byte, minst signifikant
--       först) ‖ fyllnad
--   c = byte 1, 3 … 15 av CMAC(Kses, tom indata), Kses = CMAC(nyckel 2, 3CC3 0001 0080 ‖ UID ‖
--       läsräknare)
-- Servern dekrypterar e, kontrollerar c och godkänner varje läsräknare en gång. Bara taggen
-- kan räkna fram nästa adress, så en kopierad länk ger ingenting.
--   tag_sdm             nycklar, UID och senaste läsräknare per tagg (RLS, ingen klientåtkomst)
--   aes_cmac, sdm_verify  kontrollen (stängda för klienter)
--   tap_token           tunn yttre funktion: läser e/c ur token ("<token>?e=…&c=…" — samma
--                       form som äldre appbyggen skickar när de läser en adresstagg),
--                       kontrollerar dem och anropar tap_token_core = v8-versionen, oförändrad
--                       (bytt namn och stängd för klienter)
--   admin_sdm_issue_keys / admin_sdm_enforce / admin_sdm_disable / admin_sdm_status
-- Taggar utan nycklar fungerar exakt som förut. En tagg med nycklar godtar både statiska
-- anrop och SUN tills admin_sdm_enforce körts — därefter bara SUN (annars sdm_required).
-- Inlösen (redeem_by_tap m.fl.) kontrollerar inte SUN: den som anropar hemifrån löser bara
-- in sin egen belöning.
-- Kan köras flera gånger.
-- ════════════════════════════════════════════════════════════════════

do $$
declare
  v_md5 text;
begin
  if to_regprocedure('public.invite_status(text)') is null then
    raise exception 'Kör v16 först (supabase_migration_v16_bjud_in.sql)';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    raise exception 'pgcrypto saknas';
  end if;
  -- AES-128 i databasen (RFC 4493: AES(K, 0) för testnyckeln)
  if encode(extensions.encrypt(decode(repeat('00', 16), 'hex'), decode('2b7e151628aed2a6abf7158809cf4f3c', 'hex'),
            'aes-ecb/pad:none'), 'hex') <> '7df76b0c1ab899b33e42f047b91b546f' then
    raise exception 'AES-128 ger fel resultat i den här databasen';
  end if;
  -- tap_token får bara bytas ut om den är v8-versionen (eller redan bytt namn av v17)
  if to_regprocedure('public.tap_token_core(text,text)') is null then
    select md5(prosrc) into v_md5 from pg_proc where oid = 'public.tap_token(text,text)'::regprocedure;
    if v_md5 is distinct from '7a39275742fc5e2b0fa612dffd19c368' then
      raise exception 'tap_token är inte v8-versionen (md5 %) — jämför med produktion först', v_md5;
    end if;
    alter function public.tap_token(text, text) rename to tap_token_core;
  else
    select md5(prosrc) into v_md5 from pg_proc where oid = 'public.tap_token_core(text,text)'::regprocedure;
    if v_md5 is distinct from '7a39275742fc5e2b0fa612dffd19c368' then
      raise exception 'tap_token_core är inte v8-versionen (md5 %)', v_md5;
    end if;
  end if;
end $$;

-- 1. Schema ------------------------------------------------------------------------
create table if not exists public.tag_sdm (
  tag_id      uuid primary key references public.tags(id) on delete cascade,
  meta_key    bytea not null check (length(meta_key) = 16),    -- nyckel 1: SDMMetaRead (dekrypterar e)
  file_key    bytea not null check (length(file_key) = 16),    -- nyckel 2: SDMFileRead (räknar c)
  master_key  bytea not null check (length(master_key) = 16),  -- nyckel 0: behövs bara för att programmera om
  uid         bytea check (uid is null or length(uid) = 7),     -- binds vid första godkända läsningen
  counter     integer check (counter is null or counter between 0 and 16777215),  -- senast godkända
  enforced    boolean not null default false,                  -- true = statiska anrop nekas
  keys_at     timestamptz not null default now(),
  first_at    timestamptz,
  last_at     timestamptz,
  enforced_at timestamptz
);
alter table public.tag_sdm enable row level security;
revoke all on public.tag_sdm from anon, authenticated;

-- 2. AES-CMAC (RFC 4493) och SUN-kontrollen ------------------------------------------
-- 16 byte ↔ 128 bitar (för XOR och skift)
create or replace function public.sdm_bits(p_block bytea)
 returns bit(128) language sql immutable strict set search_path to 'public'
as $function$
  select ('x' || encode(p_block, 'hex'))::bit(128)
$function$;

create or replace function public.sdm_bytes(p_bits bit)
 returns bytea language sql immutable strict set search_path to 'public'
as $function$
  select decode(
    lpad(to_hex(substring(p_bits from 1 for 32)::int), 8, '0') ||
    lpad(to_hex(substring(p_bits from 33 for 32)::int), 8, '0') ||
    lpad(to_hex(substring(p_bits from 65 for 32)::int), 8, '0') ||
    lpad(to_hex(substring(p_bits from 97 for 32)::int), 8, '0'), 'hex')
$function$;

-- AES-128 av ett block
create or replace function public.sdm_aes(p_key bytea, p_block bytea)
 returns bytea language sql immutable strict set search_path to 'public', 'extensions'
as $function$
  select substring(encrypt(p_block, p_key, 'aes-ecb/pad:none') from 1 for 16)
$function$;

create or replace function public.aes_cmac(p_key bytea, p_msg bytea)
 returns bytea language plpgsql immutable set search_path to 'public', 'extensions'
as $function$
declare
  v_rb   constant bit(128) := ('x' || repeat('0', 30) || '87')::bit(128);
  v_len  int := coalesce(length(p_msg), 0);
  v_n    int := greatest(1, (coalesce(length(p_msg), 0) + 15) / 16);
  v_l    bit(128);
  v_k1   bit(128);
  v_k2   bit(128);
  v_x    bit(128) := repeat('0', 128)::bit(128);
  v_last bytea;
begin
  if p_key is null or length(p_key) <> 16 then
    return null;
  end if;
  -- Undernycklar: L = AES(K, 0), K1 = 2·L, K2 = 2·K1 i GF(2^128)
  v_l := public.sdm_bits(public.sdm_aes(p_key, decode(repeat('00', 16), 'hex')));
  v_k1 := v_l << 1;
  if substring(v_l from 1 for 1) = B'1' then v_k1 := v_k1 # v_rb; end if;
  v_k2 := v_k1 << 1;
  if substring(v_k1 from 1 for 1) = B'1' then v_k2 := v_k2 # v_rb; end if;
  for i in 1 .. v_n - 1 loop
    v_x := public.sdm_bits(public.sdm_aes(p_key, public.sdm_bytes(
             v_x # public.sdm_bits(substring(p_msg from (i - 1) * 16 + 1 for 16)))));
  end loop;
  v_last := substring(coalesce(p_msg, ''::bytea) from (v_n - 1) * 16 + 1 for 16);
  if v_len > 0 and v_len % 16 = 0 then
    v_x := v_x # public.sdm_bits(v_last) # v_k1;          -- helt sista block
  else
    v_last := v_last || decode('80', 'hex');               -- 10…0-utfyllnad
    v_last := v_last || decode(repeat('00', 16 - length(v_last)), 'hex');
    v_x := v_x # public.sdm_bits(v_last) # v_k2;
  end if;
  return public.sdm_aes(p_key, public.sdm_bytes(v_x));
end $function$;

-- SUN från en NTAG 424 DNA (NXP AN12196, krypterad PICC-data + CMAC över tom indata,
-- SDMMACInputOffset = SDMMACOffset). Ger { ok, uid, counter } eller { ok: false }.
create or replace function public.sdm_verify(p_meta_key bytea, p_file_key bytea, p_e bytea, p_c bytea)
 returns jsonb language plpgsql immutable set search_path to 'public', 'extensions'
as $function$
declare
  v_plain bytea;
  v_uid   bytea;
  v_ctr   bytea;
  v_mac   bytea;
  v_short bytea := ''::bytea;
begin
  if p_meta_key is null or p_file_key is null or length(p_meta_key) <> 16 or length(p_file_key) <> 16
     or p_e is null or p_c is null or length(p_e) <> 16 or length(p_c) <> 8 then
    return jsonb_build_object('ok', false);
  end if;
  v_plain := substring(decrypt(p_e, p_meta_key, 'aes-ecb/pad:none') from 1 for 16);
  -- C7: UID (7 byte) och läsräknaren speglas
  if get_byte(v_plain, 0) <> 199 then
    return jsonb_build_object('ok', false);
  end if;
  v_uid := substring(v_plain from 2 for 7);
  v_ctr := substring(v_plain from 9 for 3);
  v_mac := public.aes_cmac(public.aes_cmac(p_file_key, decode('3cc300010080', 'hex') || v_uid || v_ctr), ''::bytea);
  for i in 0 .. 7 loop
    v_short := v_short || substring(v_mac from 2 * i + 2 for 1);
  end loop;
  if v_short <> p_c then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'uid', encode(v_uid, 'hex'),
    'counter', get_byte(v_ctr, 0) + get_byte(v_ctr, 1) * 256 + get_byte(v_ctr, 2) * 65536);
end $function$;

-- 3. Stämpling -----------------------------------------------------------------------
-- Token kan bära SUN: "miyabi-01?e=…&c=…" (versaler/gemener spelar ingen roll; p= godtas
-- som e=). Äldre appbyggen skickar just den formen när de läser en adresstagg.
create or replace function public.tap_token(p_device_id text, p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_raw   text := lower(btrim(coalesce(p_token, '')));
  v_token text;
  v_query text := '';
  v_e     text;
  v_c     text;
  v_tag   uuid;
  v_sdm   tag_sdm%rowtype;
  v_check jsonb;
  v_uid   bytea;
  v_ctr   int;
begin
  if coalesce(length(p_device_id), 0) < 8 then
    return jsonb_build_object('ok', false, 'error', 'bad_device');
  end if;
  if position('?' in v_raw) > 0 then
    v_query := substr(v_raw, position('?' in v_raw) + 1);
    v_raw := left(v_raw, position('?' in v_raw) - 1);
  end if;
  v_token := regexp_replace(v_raw, '^.*/', '');   -- hela adressen → sista ledet
  v_e := substring(v_query from '(?:^|&)[ep]=([0-9a-f]{32})(?=&|$)');
  v_c := substring(v_query from '(?:^|&)c=([0-9a-f]{16})(?=&|$)');

  select id into v_tag from tags where token = v_token and active = true;
  if v_tag is not null then
    select * into v_sdm from tag_sdm where tag_id = v_tag;
    if found then
      if v_e is null or v_c is null then
        if v_sdm.enforced then
          return jsonb_build_object('ok', false, 'error', 'sdm_required');
        end if;
      else
        -- Radlås: samma läsning godkänns bara en gång, även vid samtidiga anrop
        select * into v_sdm from tag_sdm where tag_id = v_tag for update;
        v_check := public.sdm_verify(v_sdm.meta_key, v_sdm.file_key, decode(v_e, 'hex'), decode(v_c, 'hex'));
        if not coalesce((v_check->>'ok')::boolean, false) then
          return jsonb_build_object('ok', false, 'error', 'sdm_invalid');
        end if;
        v_uid := decode(v_check->>'uid', 'hex');
        v_ctr := (v_check->>'counter')::int;
        if v_sdm.uid is not null and v_sdm.uid <> v_uid then
          return jsonb_build_object('ok', false, 'error', 'sdm_invalid');
        end if;
        if v_sdm.counter is not null and v_ctr <= v_sdm.counter then
          return jsonb_build_object('ok', false, 'error', 'replay');
        end if;
        update tag_sdm set uid = v_uid, counter = v_ctr, first_at = coalesce(first_at, now()), last_at = now()
          where tag_id = v_tag;
      end if;
    end if;
  end if;

  -- v8-versionen, oförändrad. Ett undantag där ångrar även räknaren ovan (samma transaktion).
  return public.tap_token_core(p_device_id, v_token);
end $function$;

-- 4. Administration (SQL Editor) ---------------------------------------------------
-- Nycklar för en dynamisk tagg. Körs BARA i SQL Editor av TapPass — aldrig via AI/MCP:
-- nycklarna visas en gång och hamnar annars i chattloggar.
--   select * from public.admin_sdm_issue_keys('miyabi-01');
-- Ger nycklarna och inställningarna att programmera taggen med (README-v17-ntag424.md).
-- Taggen godtar sedan både den gamla statiska stämpeln och den nya tills admin_sdm_enforce
-- körs. En tagg som redan godkänt en läsning får nya nycklar bara med p_replace => true
-- (taggen måste då programmeras om eller bytas).
create or replace function public.admin_sdm_issue_keys(p_token text, p_replace boolean default false)
 returns table(steg int, installning text, varde text)
 language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_tag    tags%rowtype;
  v_old    tag_sdm%rowtype;
  v_k0     bytea := gen_random_bytes(16);
  v_k1     bytea := gen_random_bytes(16);
  v_k2     bytea := gen_random_bytes(16);
  v_prefix text;
  v_uri    text;
  v_picc   int;
  v_mac    int;
  v_ndef   bytea;
begin
  select * into v_tag from tags where token = lower(btrim(coalesce(p_token, '')));
  if not found then
    raise exception 'Okänd tagg: %', p_token;
  end if;
  select * into v_old from tag_sdm where tag_id = v_tag.id for update;
  if found and v_old.first_at is not null and not coalesce(p_replace, false) then
    raise exception 'Taggen % har redan godkänt läsningar. Nya nycklar kräver att taggen programmeras om eller byts — kör igen med p_replace => true.', v_tag.token;
  end if;
  insert into tag_sdm (tag_id, meta_key, file_key, master_key) values (v_tag.id, v_k1, v_k2, v_k0)
  on conflict (tag_id) do update set
    meta_key = excluded.meta_key, file_key = excluded.file_key, master_key = excluded.master_key,
    uid = null, counter = null, enforced = false, keys_at = now(), first_at = null, last_at = null,
    enforced_at = null;

  -- NDEF: NLEN (2 byte) ‖ D1 01 <längd> 55 04 ‖ adressen utan "https://" (prefixkod 04)
  v_prefix := 'tappass.se/t/' || v_tag.token || '?e=';
  v_uri    := v_prefix || repeat('0', 32) || '&c=' || repeat('0', 16);
  v_picc   := 7 + length(v_prefix);
  v_mac    := v_picc + 32 + 3;
  v_ndef   := decode(lpad(to_hex(5 + length(v_uri)), 4, '0') || 'd101' || lpad(to_hex(1 + length(v_uri)), 2, '0') || '5504', 'hex')
              || convert_to(v_uri, 'UTF8');
  return query values
    (1,  'Tagg', v_tag.token),
    (2,  'Adress (URI-record, prefix https://)', 'https://' || v_uri),
    (3,  'Nyckel 0 – huvudnyckel (AppMasterKey)', encode(v_k0, 'hex')),
    (4,  'Nyckel 1 – SDMMetaRead (krypterar e)', encode(v_k1, 'hex')),
    (5,  'Nyckel 2 – SDMFileRead (räknar c)', encode(v_k2, 'hex')),
    (6,  'SDM', 'på · UID-spegling på · läsräknare på · ASCII'),
    (7,  'SDM-åtkomst MetaRead / FileRead / CtrRet', '1 / 2 / F'),
    (8,  'PICCDataOffset', v_picc || ' (0x' || lpad(to_hex(v_picc), 6, '0') || ')'),
    (9,  'SDMMACInputOffset', v_mac || ' (0x' || lpad(to_hex(v_mac), 6, '0') || ') – samma som SDMMACOffset'),
    (10, 'SDMMACOffset', v_mac || ' (0x' || lpad(to_hex(v_mac), 6, '0') || ')'),
    (11, 'NDEF-filens åtkomst', 'läsa fritt (E) · skriva och ändra inställningar med nyckel 0'),
    (12, 'NDEF-filens innehåll (hex)', encode(v_ndef, 'hex'));
end $function$;

-- Bara dynamiska läsningar godtas för taggen (den gamla statiska stämpeln slutar fungera).
-- Kräver att den nya taggen redan godkänts en gång. Innehåller inga hemligheter.
create or replace function public.admin_sdm_enforce(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_tag tags%rowtype;
  v_sdm tag_sdm%rowtype;
begin
  select * into v_tag from tags where token = lower(btrim(coalesce(p_token, '')));
  if not found then
    raise exception 'Okänd tagg: %', p_token;
  end if;
  select * into v_sdm from tag_sdm where tag_id = v_tag.id for update;
  if not found then
    raise exception 'Taggen % saknar nycklar — kör admin_sdm_issue_keys först', v_tag.token;
  end if;
  if v_sdm.first_at is null then
    raise exception 'Ingen läsning av den nya taggen % har godkänts än — läs av den med appen först', v_tag.token;
  end if;
  update tag_sdm set enforced = true, enforced_at = coalesce(enforced_at, now()) where tag_id = v_tag.id;
  return jsonb_build_object('ok', true, 'token', v_tag.token, 'enforced', true,
    'first_at', v_sdm.first_at, 'last_at', v_sdm.last_at, 'counter', v_sdm.counter);
end $function$;

-- Nödläge: tillbaka till statisk stämpel (nycklarna tas bort; e och c ignoreras därefter).
create or replace function public.admin_sdm_disable(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare
  v_tag tags%rowtype;
begin
  select * into v_tag from tags where token = lower(btrim(coalesce(p_token, '')));
  if not found then
    raise exception 'Okänd tagg: %', p_token;
  end if;
  delete from tag_sdm where tag_id = v_tag.id;
  return jsonb_build_object('ok', true, 'token', v_tag.token, 'removed', found);
end $function$;

-- Läget för alla taggar — utan nycklar.
create or replace function public.admin_sdm_status()
 returns table(tagg text, butik text, aktiv boolean, nycklar boolean, bara_dynamisk boolean,
               uid_bunden boolean, raknare int, nycklar_skapade timestamptz, forsta_lasning timestamptz,
               senaste_lasning timestamptz, bara_dynamisk_sedan timestamptz)
 language sql stable security definer set search_path to 'public'
as $function$
  select t.token, c.name, t.active, s.tag_id is not null, coalesce(s.enforced, false), s.uid is not null,
         s.counter, s.keys_at, s.first_at, s.last_at, s.enforced_at
    from tags t
    join cafes c on c.id = t.cafe_id
    left join tag_sdm s on s.tag_id = t.id
   order by c.name, t.token
$function$;

-- 5. Behörigheter ------------------------------------------------------------------
revoke execute on function public.tap_token_core(text, text) from public, anon, authenticated;
revoke execute on function public.sdm_bits(bytea) from public, anon, authenticated;
revoke execute on function public.sdm_bytes(bit) from public, anon, authenticated;
revoke execute on function public.sdm_aes(bytea, bytea) from public, anon, authenticated;
revoke execute on function public.aes_cmac(bytea, bytea) from public, anon, authenticated;
revoke execute on function public.sdm_verify(bytea, bytea, bytea, bytea) from public, anon, authenticated;
revoke execute on function public.admin_sdm_issue_keys(text, boolean) from public, anon, authenticated;
revoke execute on function public.admin_sdm_enforce(text) from public, anon, authenticated;
revoke execute on function public.admin_sdm_disable(text) from public, anon, authenticated;
revoke execute on function public.admin_sdm_status() from public, anon, authenticated;
grant execute on function public.tap_token(text, text) to anon, authenticated;

-- 6. Självtest mot NXP:s exempel (AN12196, nycklar 00…00) ------------------------------
do $$
declare
  v jsonb := public.sdm_verify(decode(repeat('00', 16), 'hex'), decode(repeat('00', 16), 'hex'),
                               decode('ef963ff7828658a599f3041510671e88', 'hex'), decode('94eed9ee65337086', 'hex'));
begin
  if v is distinct from '{"ok": true, "uid": "04de5f1eacc040", "counter": 61}'::jsonb then
    raise exception 'SUN-kontrollen stämmer inte med NXP:s exempel: %', v;
  end if;
  if (public.sdm_verify(decode(repeat('00', 16), 'hex'), decode(repeat('00', 16), 'hex'),
        decode('ef963ff7828658a599f3041510671e88', 'hex'), decode('94eed9ee65337087', 'hex'))->>'ok')::boolean then
    raise exception 'SUN-kontrollen godtar en felaktig kod';
  end if;
end $$;
