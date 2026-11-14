-- 7. Behörigheter -----------------------------------------------------------------------------
revoke execute on function public.card_of(uuid) from public, anon, authenticated;
revoke execute on function public.scope_places(uuid) from public, anon, authenticated;
revoke execute on function public.scope_cards(uuid) from public, anon, authenticated;
revoke execute on function public.stamps_set_place() from public, anon, authenticated;
revoke execute on function public.admin_chain_create(text, text, text, text, text, text, int, text, text) from public, anon, authenticated;
revoke execute on function public.admin_chain_add_store(text, text) from public, anon, authenticated;
revoke execute on function public.admin_chain_own_card(text, boolean) from public, anon, authenticated;
revoke execute on function public.admin_chain_remove_store(text) from public, anon, authenticated;
revoke execute on function public.admin_chain_status() from public, anon, authenticated;
grant execute on function public.merchant_chain(text) to anon, authenticated;
grant execute on function public.merchant_chain_overview(text) to anon, authenticated;
grant execute on function public.merchant_chain_view(text, text) to anon, authenticated;
grant execute on function public.tag_public_info(text) to anon, authenticated;
