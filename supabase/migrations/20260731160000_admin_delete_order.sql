-- orders never had a DELETE policy or grant at all before now - M2's
-- manual-entry flow never deleted an order after creation, so it never
-- came up. Needed now: deleting an order's last item (or an already-empty
-- order via the standalone cleanup action) deletes the order itself.
-- Admin-only, matching every other write policy on this table.

create policy "Admins can delete orders"
  on public.orders for delete
  using (public.is_admin());

grant delete on public.orders to authenticated;
