-- 1. Schema ----------------------------------------------------------------------------------
alter table public.cafes add column if not exists is_chain boolean not null default false;
alter table public.cafes add column if not exists chain_id uuid references public.cafes(id) on delete restrict;
alter table public.cafes add column if not exists own_card boolean not null default false;
alter table public.cafes drop constraint if exists cafes_chain_check;
alter table public.cafes add constraint cafes_chain_check check (
      not (is_chain and chain_id is not null)
  and (chain_id is not null or not own_card)
  and chain_id is distinct from id);
create index if not exists cafes_chain_idx on public.cafes (chain_id) where chain_id is not null;

-- Var stämpeln gjordes (stället). Sätts av triggern stamps_place; befintliga = kortets ställe.
alter table public.stamps add column if not exists place_id uuid references public.cafes(id);
update public.stamps set place_id = cafe_id where place_id is null;
alter table public.stamps alter column place_id set not null;
create index if not exists stamps_place_idx on public.stamps (place_id, stamped_at desc);

-- Var belöningen, presenten och inbjudningen löstes in eller belönades.
alter table public.redemptions add column if not exists place_id uuid references public.cafes(id) on delete set null;
update public.redemptions set place_id = cafe_id where place_id is null and status = 'redeemed';
create index if not exists redemptions_place_idx on public.redemptions (place_id, redeemed_at desc) where place_id is not null;
alter table public.birthday_gifts add column if not exists place_id uuid references public.cafes(id) on delete set null;
update public.birthday_gifts set place_id = cafe_id where place_id is null and status = 'redeemed';
alter table public.invites add column if not exists place_id uuid references public.cafes(id) on delete set null;
update public.invites set place_id = cafe_id where place_id is null and cafe_id is not null;
-- Vinn tillbaka: vilket ställe (eller huvudkontot) som skickade dubbelstämpeln.
alter table public.stamp_bonuses add column if not exists place_id uuid references public.cafes(id) on delete set null;
update public.stamp_bonuses set place_id = cafe_id where place_id is null and origin = 'winback';

-- Huvudkontots visning av ett ställe: försvinner med huvudkontots egen session.
alter table public.merchant_sessions add column if not exists via_session text
  references public.merchant_sessions(token_hash) on delete cascade;

