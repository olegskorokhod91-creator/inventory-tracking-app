-- Supply request fulfillment (post-M8): closes the real workflow gap where
-- a submitted request had no path forward. Three linked pieces:
--   1. Batching - everything a cleaner submits in one sitting becomes one
--      supply_request_batches row the admin can act on as a unit, with at
--      most one OPEN batch per property at a time (new requests append to
--      it rather than starting a competing list - product decision, not a
--      technical default).
--   2. "Mark ordered" - admin logs a purchase made outside the app as a
--      pending placeholder order (source='request_fulfillment',
--      order_number null), reusing the existing orders/packages/order_items
--      shape from M2 rather than inventing a parallel concept.
--   3. PDF reconciliation - a per-order Amazon "Final Details" invoice
--      fills in the placeholder (or creates an additional order, when
--      Amazon splits one purchase into several order numbers) via an
--      explicit admin-reviewed step, never silently.

-- The property's own registered Amazon-checkout PO string - an exact match
-- key, admin-configured. Deliberately distinct from orders.po_number (M3.5),
-- which is a free-text hint scraped from a CSV row and only ever used to
-- *suggest* a property match, never to assign one. Same English term, two
-- different tables, two different trust levels - do not conflate them.
alter table public.properties add column po_number text;

-- New value on an existing enum - safe to use later in this same
-- transaction (Postgres 12+), just not in the same command that adds it.
alter type public.order_source add value 'request_fulfillment';

create type public.supply_request_batch_status as enum ('open', 'closed');

create table public.supply_request_batches (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  -- Recomputed only by the trigger below, from its own items'
  -- ordered_order_id state - never set directly by application code, same
  -- "derived, not hand-maintained" principle as orders.requires_attention.
  status public.supply_request_batch_status not null default 'open',
  created_at timestamptz not null default now()
);

-- Enforces "at most one open batch per property" at the database level, not
-- just in the RPC below that tries to reuse an open batch - a partial
-- unique index is the actual guarantee, the RPC's find-or-reuse logic is
-- just what makes the common case not need one.
create unique index supply_request_batches_one_open_per_property
  on public.supply_request_batches (property_id)
  where status = 'open';

alter table public.supply_requests add column batch_id uuid references public.supply_request_batches (id);
create index supply_requests_batch_id_idx on public.supply_requests (batch_id);

-- Second resolution stage, in front of the existing resolved_by_order_id.
-- Three real states per request item now: open (both null) -> ordered
-- (this set, points at whichever pending/placeholder order a "mark
-- ordered" action produced) -> resolved (resolved_by_order_id set, meaning
-- an admin confirmed during PDF reconciliation that this specific item
-- actually showed up in a real order). resolved_by_order_id's existing
-- meaning and the M2.5 direct-manual-order-resolves-a-request path are
-- untouched.
alter table public.supply_requests add column ordered_order_id uuid references public.orders (id);

-- One batch can produce several real orders (Amazon splitting one purchase
-- into 2-3 order numbers) - deliberately not merged into one order record,
-- so this is a plain FK on the many side, not a join table.
alter table public.orders add column request_batch_id uuid references public.supply_request_batches (id);
create index orders_request_batch_id_idx on public.orders (request_batch_id);

-- Recomputes the owning batch's status after an admin marks item(s)
-- ordered. Only fires on ordered_order_id changing - new items are only
-- ever inserted into a batch that's already open (see
-- create_supply_request_batch below), so insert never needs to flip
-- status. security definer so it can write status regardless of who
-- triggered the update (no UPDATE policy exists on this table at all -
-- see below - this is the only writer, matching the
-- sync_order_requires_attention precedent from M5).
create function public.sync_supply_request_batch_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.supply_request_batches
  set status = case
    when exists (
      select 1 from public.supply_requests
      where batch_id = new.batch_id and ordered_order_id is null
    ) then 'open'::public.supply_request_batch_status
    else 'closed'::public.supply_request_batch_status
  end
  where id = new.batch_id;
  return new;
end;
$$;

create trigger sync_supply_request_batch_status
  after update of ordered_order_id on public.supply_requests
  for each row execute function public.sync_supply_request_batch_status();

-- Light per-upload audit record, same "one row per action" precedent as
-- csv_imports - written once at upload/extraction time (what was in the
-- PDF, what it matched to), then stamped with resulting_order_id once the
-- admin actually confirms the reconciliation. No status-machine enum here
-- on purpose: unlike the email pipeline, this table isn't what drives the
-- review screen's state (the extracted data round-trips through the
-- confirm form directly) - it exists purely so "who uploaded what, and
-- what did it become" stays answerable later.
create table public.pdf_invoice_imports (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references public.profiles (id),
  filename text not null,
  amazon_order_number text,
  po_number text,
  matched_property_id uuid references public.properties (id),
  resulting_order_id uuid references public.orders (id),
  created_at timestamptz not null default now()
);

alter table public.supply_request_batches enable row level security;
alter table public.pdf_invoice_imports enable row level security;

create policy "Admins can view all batches"
  on public.supply_request_batches for select
  using (public.is_admin());

create policy "Cleaners can view batches for assigned properties"
  on public.supply_request_batches for select
  using (
    exists (
      select 1 from public.cleaner_property_assignments a
      where a.property_id = supply_request_batches.property_id and a.user_id = auth.uid()
    )
  );

-- Cleaners create batches only via create_supply_request_batch below (that
-- function runs as invoker, so this policy is the real gate) - no update
-- policy at all: status is trigger-only, and nothing else on this table is
-- ever hand-edited.
create policy "Cleaners can create batches for assigned properties"
  on public.supply_request_batches for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.cleaner_property_assignments a
      where a.property_id = supply_request_batches.property_id and a.user_id = auth.uid()
    )
  );

create policy "Admins can view pdf invoice imports"
  on public.pdf_invoice_imports for select
  using (public.is_admin());
create policy "Admins can create pdf invoice imports"
  on public.pdf_invoice_imports for insert
  with check (public.is_admin());
create policy "Admins can update pdf invoice imports"
  on public.pdf_invoice_imports for update
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert on public.supply_request_batches to authenticated;
grant select, insert, update, delete on public.supply_request_batches to service_role;
grant select, insert, update on public.pdf_invoice_imports to authenticated;
grant select, insert, update, delete on public.pdf_invoice_imports to service_role;

-- Replaces the plain insert createSupplyRequests used to do directly.
-- Finds the property's open batch and appends to it; only creates a new
-- one if none is open. Deliberately a plain SELECT, not SELECT ... FOR
-- UPDATE: Postgres requires a row to satisfy an UPDATE policy (not just
-- SELECT) to be lockable, and this table has none on purpose (status is
-- trigger-only) - a locking select would make the very row it needs to
-- find invisible. The partial unique index above is the real backstop for
-- the rare concurrent-first-submission race: worst case one of two
-- simultaneous inserts fails outright rather than silently creating two
-- open batches, which is the failure mode that actually matters to avoid.
create function public.create_supply_request_batch(
  p_property_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_item jsonb;
begin
  select id into v_batch_id
  from public.supply_request_batches
  where property_id = p_property_id and status = 'open';

  if v_batch_id is null then
    insert into public.supply_request_batches (property_id, created_by)
    values (p_property_id, auth.uid())
    returning id into v_batch_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.supply_requests (batch_id, property_id, created_by, item_name, quantity, note)
    values (
      v_batch_id,
      p_property_id,
      auth.uid(),
      v_item ->> 'item_name',
      nullif(v_item ->> 'quantity', '')::integer,
      nullif(v_item ->> 'note', '')
    );
  end loop;

  return v_batch_id;
end;
$$;

grant execute on function public.create_supply_request_batch(uuid, jsonb) to authenticated;
grant execute on function public.create_supply_request_batch(uuid, jsonb) to service_role;

-- Admin "mark ordered" action (whole batch, or a chosen subset of its still-
-- open items). Creates exactly one placeholder order per call - a second
-- pass marking the remaining items later creates a second placeholder,
-- which is exactly how a batch ends up linked to more than one order even
-- before PDF reconciliation ever happens. Items not in p_request_ids (or
-- already ordered) are left untouched.
create function public.mark_supply_requests_ordered(
  p_batch_id uuid,
  p_request_ids uuid[],
  p_retailer_id uuid
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

  -- orders.order_date is not-null, so the placeholder needs *something* -
  -- today's date (when this was logged as bought) is the honest placeholder
  -- value, and gets overwritten with the real order-placed date once PDF
  -- reconciliation runs.
  insert into public.orders (retailer_id, property_id, request_batch_id, order_date, source, created_by)
  values (p_retailer_id, v_property_id, p_batch_id, current_date, 'request_fulfillment', auth.uid())
  returning id into v_order_id;

  insert into public.packages (order_id, status)
  values (v_order_id, 'expected')
  returning id into v_package_id;

  for r in
    select id, item_name, quantity
    from public.supply_requests
    where id = any (p_request_ids) and batch_id = p_batch_id and ordered_order_id is null
  loop
    insert into public.order_items (order_id, name, expected_quantity)
    values (v_order_id, r.item_name, coalesce(r.quantity, 1))
    returning id into v_order_item_id;

    insert into public.package_items (package_id, order_item_id, expected_quantity)
    values (v_package_id, v_order_item_id, coalesce(r.quantity, 1));

    update public.supply_requests set ordered_order_id = v_order_id where id = r.id;
  end loop;

  return v_order_id;
end;
$$;

grant execute on function public.mark_supply_requests_ordered(uuid, uuid[], uuid) to authenticated;
grant execute on function public.mark_supply_requests_ordered(uuid, uuid[], uuid) to service_role;

-- PDF reconciliation. p_existing_order_id is the placeholder being consumed
-- (null means: no usable placeholder, insert a fresh order instead - either
-- because this batch's placeholder was already consumed by an earlier PDF
-- from the same split purchase, or because there was no request behind
-- this purchase at all). Item list is wholesale-replaced on the placeholder
-- path (same idiom as upsert_order_from_pipeline for non-manual orders) -
-- a deliberate, scoped exception to items being immutable after creation
-- everywhere else, since this is the one point where the "items" on record
-- are still an invented placeholder, not real data. Packages are reused/
-- extended, never deleted (no DELETE policy exists on packages, and none is
-- needed - the placeholder's single package is always still 'expected', so
-- the first shipment section can just take over that row).
create function public.reconcile_pdf_invoice_order(
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

grant execute on function public.reconcile_pdf_invoice_order(uuid, uuid, uuid, text, date, numeric, uuid, jsonb, uuid[], uuid) to authenticated;
grant execute on function public.reconcile_pdf_invoice_order(uuid, uuid, uuid, text, date, numeric, uuid, jsonb, uuid[], uuid) to service_role;
