-- Lets a cleaner remove their own supply request item if they added it by
-- mistake - real user feedback after testing the fulfillment flow. Scoped
-- narrowly: only their own rows (created_by = auth.uid()), and only while
-- still genuinely untouched (not yet marked ordered, not yet resolved) -
-- once an admin has acted on it in any way, it's no longer just a draft
-- mistake to quietly remove.

create policy "Cleaners can delete their own open requests"
  on public.supply_requests for delete
  using (
    created_by = auth.uid()
    and ordered_order_id is null
    and resolved_by_order_id is null
  );

grant delete on public.supply_requests to authenticated;
