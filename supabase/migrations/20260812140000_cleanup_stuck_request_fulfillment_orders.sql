-- One-time cleanup of request_fulfillment orders created before the
-- "mark ordered = done" simplification (see 20260812130000). Two cases:
--
-- 1. Already reconciled via a real PDF invoice (order_number is set) -
--    these are real, priced orders that were just never stamped done
--    because reconcile_pdf_invoice_order never touched package status
--    before now. Mark them done and resolve any still-open requests.
-- 2. Never reconciled (order_number still null - a bare placeholder from
--    the old two-step mark_supply_requests_ordered) - nothing real to
--    keep. Detach the underlying supply_requests (revert to Open, not
--    deleted - the cleaner's actual request is still valid) and delete
--    the dead placeholder order. packages/order_items cascade
--    automatically via existing FK ON DELETE CASCADE.

-- Case 1: mark done + resolve.
update public.packages
set status = 'confirmed_received', confirmed_source = 'admin_manual', confirmed_at = now()
where order_id in (
  select id from public.orders where source = 'request_fulfillment' and order_number is not null
)
and status not in ('confirmed_received', 'cancelled');

update public.supply_requests
set resolved_by_order_id = ordered_order_id, resolved_at = now()
where resolved_by_order_id is null
  and ordered_order_id in (
    select id from public.orders where source = 'request_fulfillment' and order_number is not null
  );

-- Case 2: detach + delete. Detaching (ordered_order_id -> null) fires
-- sync_supply_request_batch_status, which reopens the request's batch -
-- but if that property has since started a *newer* open batch (cleaner
-- submitted more requests after this placeholder was created), reopening
-- the old batch collides with supply_request_batches_one_open_per_property.
-- Reassign to the newer open batch instead in that case; otherwise it's
-- safe to just detach and let the old batch reopen itself.
--
-- Also nulls resolved_by_order_id/resolved_at where it points at one of
-- these never-reconciled placeholders too - a real leftover from this
-- session's earlier markRequestResolved stopgap (before it was fixed to
-- check for a real order_number), which could resolve an item against a
-- placeholder that was never actually invoiced. That was never truly
-- "resolved" - reverting to Open is the honest state.
do $$
declare
  r record;
  v_target_batch_id uuid;
begin
  for r in
    select sr.id as request_id, sr.property_id, sr.batch_id as old_batch_id
    from public.supply_requests sr
    where sr.ordered_order_id in (
      select id from public.orders where source = 'request_fulfillment' and order_number is null
    )
    or sr.resolved_by_order_id in (
      select id from public.orders where source = 'request_fulfillment' and order_number is null
    )
  loop
    select id into v_target_batch_id
    from public.supply_request_batches
    where property_id = r.property_id and status = 'open' and id <> r.old_batch_id;

    if v_target_batch_id is null then
      update public.supply_requests
      set ordered_order_id = null, resolved_by_order_id = null, resolved_at = null
      where id = r.request_id;
    else
      update public.supply_requests
      set ordered_order_id = null, resolved_by_order_id = null, resolved_at = null,
          batch_id = v_target_batch_id
      where id = r.request_id;
    end if;
  end loop;
end $$;

delete from public.orders
where source = 'request_fulfillment' and order_number is null;
