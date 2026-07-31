-- Admins currently had no delete path on supply_requests at all - the
-- previous migration only let a cleaner remove their own still-untouched
-- (Open) request. Real user feedback: an admin needs to be able to cancel
-- an Ordered request too (e.g. it was marked ordered by mistake). Resolved
-- requests are deliberately excluded - those are tied to a real, reconciled
-- order and are the closest thing this app has to settled history, not a
-- draft to quietly discard. Removing the request row never touches the
-- underlying placeholder order/order_item it may point to - that's a
-- separate, already-built admin action (Remove on the order detail page).

create policy "Admins can delete unresolved requests"
  on public.supply_requests for delete
  using (public.is_admin() and resolved_by_order_id is null);
