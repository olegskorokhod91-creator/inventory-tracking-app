-- Product-owner-directed simplification: an order is done the instant an
-- admin marks it ordered (or manually creates it, or reconciles a PDF
-- invoice for it) - no tracking, no email/CSV pipeline, no cleaner
-- delivery confirmation of any kind, for any order, ever again.
--
-- Mechanism: orders_with_status.computed_status (the sole Active/Past
-- Orders gate, unchanged since 20260728184623_create_orders_schema.sql)
-- already flips an order to 'completed' the instant every one of its
-- packages has status in ('confirmed_received', 'cancelled'). Rather than
-- rewrite that view, RLS, Past Orders, or the order detail page, every
-- order-creation/finalization RPC below now stamps its package(s) as
-- 'confirmed_received' / confirmed_source = 'admin_manual' immediately,
-- automatically, in the same transaction - the exact same status/source
-- combination the existing M4 admin manual-override already uses for "a
-- phone/in-person report" (see updatePackage in orders/actions.ts). This
-- is purely an internal shortcut: nobody clicks "confirm" anywhere, there
-- is no confirmation UI for this path, it just happens the instant the
-- admin submits.

-- mark_supply_requests_ordered: adding a parameter changes the function's
-- signature, so drop the old 3-arg version explicitly before recreating
-- (same idiom as create_manual_order's own prior signature change).
drop function if exists public.mark_supply_requests_ordered(uuid, uuid[], uuid);

-- p_item_prices is a {request_id: unit_price} jsonb map, values optional -
-- the admin can type a price per item right on /requests instead of ever
-- touching PDF reconciliation. A request with no entry (or a blank value)
-- prices its item at null, same as today's placeholder behavior - the
-- billing report already treats a null unit_price as $0, not as excluded.
create function public.mark_supply_requests_ordered(
  p_batch_id uuid,
  p_request_ids uuid[],
  p_retailer_id uuid,
  p_item_prices jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_property_id uuid;
  v_order_id uuid;
  v_package_id uuid;
  v_order_item_id uuid;
  r record;
begin
  select property_id into v_property_id from public.supply_request_batches where id = p_batch_id;
  if v_property_id is null then
    raise exception 'Unknown batch %', p_batch_id;
  end if;

  insert into public.orders (retailer_id, property_id, request_batch_id, order_date, source, created_by)
  values (p_retailer_id, v_property_id, p_batch_id, current_date, 'request_fulfillment', auth.uid())
  returning id into v_order_id;

  -- Born already done - see migration header. No intermediate 'expected'
  -- state for this flow anymore.
  insert into public.packages (order_id, status, confirmed_source, confirmed_at)
  values (v_order_id, 'confirmed_received', 'admin_manual', now())
  returning id into v_package_id;

  for r in
    select id, item_name, quantity
    from public.supply_requests
    where id = any (p_request_ids) and batch_id = p_batch_id and ordered_order_id is null
  loop
    insert into public.order_items (order_id, name, expected_quantity, unit_price)
    values (
      v_order_id, r.item_name, coalesce(r.quantity, 1),
      nullif(p_item_prices ->> r.id::text, '')::numeric
    )
    returning id into v_order_item_id;

    insert into public.package_items (package_id, order_item_id, expected_quantity)
    values (v_package_id, v_order_item_id, coalesce(r.quantity, 1));

    -- Fully resolved immediately, not just "ordered" - there's no
    -- separate resolve step left in this flow.
    update public.supply_requests
    set ordered_order_id = v_order_id, resolved_by_order_id = v_order_id, resolved_at = now()
    where id = r.id;
  end loop;

  return v_order_id;
end;
$$;

grant execute on function public.mark_supply_requests_ordered(uuid, uuid[], uuid, jsonb) to authenticated;
grant execute on function public.mark_supply_requests_ordered(uuid, uuid[], uuid, jsonb) to service_role;

-- reconcile_pdf_invoice_order: same signature, only the body changes
-- (CREATE OR REPLACE is safe). Every package touched by this call (whether
-- reused from a placeholder or newly created for an extra shipment) is
-- stamped done at the end, same as above - covers the "type a price"
-- path's optional PDF-upload alternative, and permanently fixes the
-- "stuck at Awaiting shipment forever" bug this exact function used to
-- cause (see 20260812120000_fix_untracked_package_matching.sql for the
-- matching-side half of that same bug).
create or replace function public.reconcile_pdf_invoice_order(
  p_existing_order_id uuid,
  p_property_id uuid,
  p_retailer_id uuid,
  p_order_number text,
  p_order_date date,
  p_total_amount numeric,
  p_request_batch_id uuid,
  p_shipments jsonb,
  p_resolved_request_ids uuid[],
  p_pdf_import_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_order_id uuid;
  v_shipment jsonb;
  v_item jsonb;
  v_package_id uuid;
  v_order_item_id uuid;
  v_reuse_package_id uuid;
  v_first boolean := true;
begin
  if p_existing_order_id is not null then
    v_order_id := p_existing_order_id;

    update public.orders set
      property_id = p_property_id,
      retailer_id = p_retailer_id,
      order_number = p_order_number,
      order_date = p_order_date,
      total_amount = p_total_amount,
      request_batch_id = p_request_batch_id
    where id = v_order_id;

    delete from public.package_items
    where order_item_id in (select id from public.order_items where order_id = v_order_id);
    delete from public.order_items where order_id = v_order_id;

    select id into v_reuse_package_id
    from public.packages where order_id = v_order_id
    order by created_at limit 1;
  else
    insert into public.orders (
      property_id, retailer_id, order_number, order_date, total_amount,
      request_batch_id, source, created_by
    ) values (
      p_property_id, p_retailer_id, p_order_number, p_order_date, p_total_amount,
      p_request_batch_id, 'request_fulfillment', auth.uid()
    ) returning id into v_order_id;
  end if;

  for v_shipment in select * from jsonb_array_elements(p_shipments)
  loop
    if v_first and v_reuse_package_id is not null then
      v_package_id := v_reuse_package_id;
    else
      insert into public.packages (order_id, status)
      values (v_order_id, 'expected')
      returning id into v_package_id;
    end if;
    v_first := false;

    for v_item in select * from jsonb_array_elements(v_shipment -> 'items')
    loop
      insert into public.order_items (order_id, name, expected_quantity, unit_price)
      values (
        v_order_id,
        v_item ->> 'name',
        (v_item ->> 'expected_quantity')::integer,
        nullif(v_item ->> 'unit_price', '')::numeric
      )
      returning id into v_order_item_id;

      insert into public.package_items (package_id, order_item_id, expected_quantity)
      values (v_package_id, v_order_item_id, (v_item ->> 'expected_quantity')::integer);
    end loop;
  end loop;

  update public.packages
  set status = 'confirmed_received', confirmed_source = 'admin_manual', confirmed_at = now()
  where order_id = v_order_id and status not in ('confirmed_received', 'cancelled');

  if array_length(p_resolved_request_ids, 1) > 0 then
    update public.supply_requests
    set resolved_by_order_id = v_order_id, resolved_at = now()
    where id = any (p_resolved_request_ids) and resolved_by_order_id is null;
  end if;

  if p_pdf_import_id is not null then
    update public.pdf_invoice_imports set resulting_order_id = v_order_id where id = p_pdf_import_id;
  end if;

  return v_order_id;
end;
$$;

-- create_manual_order: same signature, body-only change - born done, same
-- as the two RPCs above. Covers /orders/new (kept, simplified the same
-- way, per explicit product-owner direction).
create or replace function public.create_manual_order(
  p_retailer_id uuid,
  p_property_id uuid,
  p_order_number text,
  p_order_date date,
  p_total_amount numeric,
  p_items jsonb,
  p_resolved_request_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_order_id uuid;
  v_package_id uuid;
  v_item jsonb;
  v_order_item_id uuid;
begin
  insert into public.orders (retailer_id, property_id, order_number, order_date, total_amount, source, created_by)
  values (p_retailer_id, p_property_id, p_order_number, p_order_date, p_total_amount, 'manual', auth.uid())
  returning id into v_order_id;

  insert into public.packages (order_id, status, confirmed_source, confirmed_at)
  values (v_order_id, 'confirmed_received', 'admin_manual', now())
  returning id into v_package_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (order_id, name, expected_quantity, unit_price)
    values (
      v_order_id,
      v_item ->> 'name',
      (v_item ->> 'expected_quantity')::integer,
      nullif(v_item ->> 'unit_price', '')::numeric
    )
    returning id into v_order_item_id;

    insert into public.package_items (package_id, order_item_id, expected_quantity)
    values (v_package_id, v_order_item_id, (v_item ->> 'expected_quantity')::integer);
  end loop;

  if array_length(p_resolved_request_ids, 1) > 0 then
    update public.supply_requests
    set resolved_by_order_id = v_order_id, resolved_at = now()
    where id = any (p_resolved_request_ids) and property_id = p_property_id and resolved_by_order_id is null;
  end if;

  return v_order_id;
end;
$$;
