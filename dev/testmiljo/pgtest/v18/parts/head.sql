-- ============================================================================================
-- TapPass v18: kedjekort och huvudkonto
-- ============================================================================================
-- En kedja = en rad i cafes med is_chain = true (huvudkontot). Den äger kortet: namn, färg,
-- belöning, mindre belöningar, födelsedagspresent, inbjudningar och hjulet. Ställena är vanliga
-- rader i cafes med chain_id = kedjan och har egna taggar, inloggningar, profiler (adress,
-- öppettider, logga), väntetid och lugna timmar.
--
-- * Stämplar hos alla ställen räknas på samma kort: stamps.cafe_id = kedjan, stamps.place_id =
--   stället (för vanliga ställen är båda samma rad). Kundernas funktioner (load_wallet,
--   save_reward, current_saved_code, födelsedag, nivåer …) arbetar som förut på kortet.
-- * Belöningen löses in på vilket ställe som helst: redeem_by_tap och merchant_redeem_by_code
--   godtar kedjans alla ställen. Var den löstes in sparas i redemptions.place_id.
-- * Varje ställe ser bara sina egna siffror: panelens funktioner räknar på place_id
--   (scope_places). Huvudkontot ser hela kedjan, och merchant_chain_overview ger en rad per
--   ställe. merchant_chain_view ger huvudkontot en visning av ett ställe (12 timmar).
-- * Egen belöning för ett ställe: TapPass sätter own_card (admin_chain_own_card). Då räknas
--   ställets nya stämplar på ställets eget kort; huvudkontot ser fortfarande stället.
-- * Administration (stängd för klienter, innehåller inga hemligheter): admin_chain_create,
--   admin_chain_add_store, admin_chain_own_card, admin_chain_remove_store, admin_chain_status.
--   Huvudkontots inloggning skapas som förut med admin_issue_pin i SQL Editor (aldrig via AI).
--
-- Vanliga ställen påverkas inte: alla deras siffror och svar är desamma (testat i PGlite mot
-- produktionens funktioner), med tre nya fält i cafes-raden och place i "Senast inlösta".
-- Körs efter v17. Allt nedan går att köra igen.

-- 0. Vakt: produktionen ska ha exakt v17-läget för funktionerna som skrivs om (md5 av koden utan
--    blanksteg; tag_public_info har annan indragning i produktionen än i v4-filen) ----------------
do $$
declare
  v_expected jsonb := '__GUARD__';
  v_bad text;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'cafes' and column_name = 'is_chain') then
    return;  -- v18 har redan körts
  end if;
  select string_agg(e.key, ', ') into v_bad
    from jsonb_each_text(v_expected) e
    left join pg_proc p on p.proname = e.key and p.pronamespace = 'public'::regnamespace
   where p.oid is null or md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) <> e.value;
  if v_bad is not null then
    raise exception 'v18: produktionen har inte v17-läget för %. Hämta pg_get_functiondef och jämför.', v_bad;
  end if;
end $$;

