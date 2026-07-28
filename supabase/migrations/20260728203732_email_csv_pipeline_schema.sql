-- M3: email + CSV import pipeline schema.
--
-- Core idea: every path that touches an order (email confirmation, shipping
-- update, CSV row, manual entry) resolves through the same upsert keyed on
-- (retailer_id, order_number). property_id is the literal definition of
-- "needs review" - it's the one thing no automated pipeline ever sets, only
-- an admin, on the review screen.

-- property_id and created_by are no longer knowable at creation time for
-- pipeline-created orders - null property_id IS the review-queue criterion.
alter table public.orders alter column property_id drop not null;
alter table public.orders alter column created_by drop not null;

-- Amazon Business's free-text "PO Number" field - a human-typed hint (often
-- messy: "Sandbar" / "SANDBAR" / "The House at Sandbar" for the same
-- property) used only to *suggest* a property match on the review screen,
-- never to assign one automatically.
alter table public.orders add column po_number text;

-- orders_with_status (from M2) does `select o.*, ...` - Postgres expands
-- that `*` into a fixed column list at view-creation time, so the new
-- po_number column above wouldn't actually reach anything querying this
-- view until it's recreated. `create or replace` can't do it here: po_number
-- lands where `computed_status` used to sit in the expanded column list,
-- which Postgres treats as an invalid rename - needs a full drop+recreate
-- instead. Same select/security_invoker as M2, just re-expanded against the
-- current column list. Grants are lost on drop, so they're reissued below.
drop view public.orders_with_status;

create view public.orders_with_status
with (security_invoker = true) as
select
  o.*,
  case
    when not exists (
      select 1 from public.packages p
      where p.order_id = o.id
        and p.status not in ('confirmed_received', 'cancelled')
    ) then 'completed'
    else 'active'
  end as computed_status
from public.orders o;

grant select on public.orders_with_status to authenticated;
grant select on public.orders_with_status to service_role;

alter type public.order_source add value 'csv';

-- Tracks every email the IMAP poller has seen, both for idempotency (skip
-- message_ids already processed) and as the audit trail the plan doc calls
-- for.
create type public.email_parsed_type as enum ('order_confirmation', 'shipping_update', 'unknown');
create type public.email_match_status as enum ('pending', 'created_order', 'updated_order', 'unmatched', 'error');

create table public.imported_emails (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,
  sender text not null,
  subject text,
  received_at timestamptz not null,
  raw_storage_path text,
  parsed_type public.email_parsed_type,
  match_status public.email_match_status not null default 'pending',
  created_order_id uuid references public.orders (id),
  created_at timestamptz not null default now()
);

-- Where a shipping-update email lands when neither order_number nor
-- tracking_number matches anything - "never silently apply a low-confidence
-- match" means this queue, not a guess.
create table public.unmatched_updates (
  id uuid primary key default gen_random_uuid(),
  imported_email_id uuid not null references public.imported_emails (id),
  reason text not null,
  extracted_order_number text,
  extracted_tracking_number text,
  extracted_carrier text,
  extracted_status public.package_status,
  resolved_order_id uuid references public.orders (id),
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Light audit record per upload, matching the plan doc's audit-trail
-- requirement.
create table public.csv_imports (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references public.profiles (id),
  filename text not null,
  row_count integer not null,
  order_count integer not null,
  created_at timestamptz not null default now()
);

alter table public.imported_emails enable row level security;
alter table public.unmatched_updates enable row level security;
alter table public.csv_imports enable row level security;

create policy "Admins can view imported emails"
  on public.imported_emails for select
  using (public.is_admin());

create policy "Admins can view unmatched updates"
  on public.unmatched_updates for select
  using (public.is_admin());
create policy "Admins can resolve unmatched updates"
  on public.unmatched_updates for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can view csv imports"
  on public.csv_imports for select
  using (public.is_admin());
create policy "Admins can create csv imports"
  on public.csv_imports for insert
  with check (public.is_admin());

-- Packages had no update policy before M3 - M2's manual-entry flow never
-- updated a package after creation. apply_shipping_update (below) needs
-- this, both for the cron (service_role, bypasses RLS anyway) and for an
-- admin manually resolving an unmatched update from the UI.
create policy "Admins can update packages"
  on public.packages for update
  using (public.is_admin())
  with check (public.is_admin());

-- order_items/package_items had no delete policy before M3 - M2's
-- manual-entry flow never deleted items after creation. The pipeline's
-- resync-on-reimport logic does (wipe and reinsert), for any non-manual
-- order, so both a DELETE RLS policy and a plain GRANT DELETE are needed
-- (a GRANT alone isn't enough without RLS permitting it, and RLS alone
-- isn't reachable without the GRANT - same two-part lesson as everywhere
-- else in this schema).
create policy "Admins can delete order items"
  on public.order_items for delete
  using (public.is_admin());
create policy "Admins can delete package items"
  on public.package_items for delete
  using (public.is_admin());

grant delete on public.order_items to authenticated;
grant delete on public.package_items to authenticated;

grant select, insert, update on public.imported_emails to authenticated;
grant select, insert, update, delete on public.imported_emails to service_role;
grant select, update on public.unmatched_updates to authenticated;
grant select, insert, update, delete on public.unmatched_updates to service_role;
grant select, insert on public.csv_imports to authenticated;
grant select, insert, update, delete on public.csv_imports to service_role;
grant update on public.packages to authenticated;
grant update on public.packages to service_role;

-- Shared upsert for order-creating pipelines (email confirmations, CSV rows).
-- Never touches property_id - that's exclusively an admin action. Fill/
-- overwrite semantics per source, decided explicitly rather than left
-- ambiguous:
--   - existing order source = 'manual' -> fill nulls only, from either
--     pipeline, never overwrite a human's own entry.
--   - existing order source = 'email' or 'csv', incoming source = 'email'
--     -> fill nulls only (email never overwrites CSV, which is considered
--     more authoritative for header fields).
--   - existing order source = 'email' or 'csv', incoming source = 'csv'
--     -> CSV overwrites the header fields it supplies.
-- Items: replaced wholesale on every call where the existing order's source
-- isn't 'manual' (idempotent re-import/correction); untouched if it is.
create function public.upsert_order_from_pipeline(
  p_source public.order_source,
  p_retailer_id uuid,
  p_order_number text,
  p_order_date date,
  p_total_amount numeric,
  p_po_number text,
  p_items jsonb default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_order_id uuid;
  v_existing_source public.order_source;
  v_package_id uuid;
  v_item jsonb;
  v_order_item_id uuid;
begin
  select id, source into v_order_id, v_existing_source
  from public.orders
  where retailer_id = p_retailer_id and order_number = p_order_number;

  if v_order_id is null then
    insert into public.orders (retailer_id, order_number, order_date, total_amount, po_number, source)
    values (p_retailer_id, p_order_number, p_order_date, p_total_amount, p_po_number, p_source)
    returning id into v_order_id;

    insert into public.packages (order_id, status)
    values (v_order_id, 'expected');

    v_existing_source := p_source;
  elsif v_existing_source = 'manual' or p_source = 'email' then
    update public.orders set
      order_date = coalesce(order_date, p_order_date),
      total_amount = coalesce(total_amount, p_total_amount),
      po_number = coalesce(po_number, p_po_number)
    where id = v_order_id;
  else
    -- p_source = 'csv', existing source is 'email' or 'csv': CSV overwrites.
    update public.orders set
      order_date = coalesce(p_order_date, order_date),
      total_amount = coalesce(p_total_amount, total_amount),
      po_number = coalesce(p_po_number, po_number)
    where id = v_order_id;
  end if;

  if p_items is not null and jsonb_array_length(p_items) > 0 and v_existing_source is distinct from 'manual' then
    delete from public.package_items
    where order_item_id in (select id from public.order_items where order_id = v_order_id);
    delete from public.order_items where order_id = v_order_id;

    select id into v_package_id from public.packages where order_id = v_order_id limit 1;

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
  end if;

  return v_order_id;
end;
$$;

-- Shipping/tracking updates only ever update an existing order's package,
-- never create one - a status email for an order we don't have yet is a
-- genuine gap, not something to paper over by creating a bare-bones order.
-- Returns the matched package id, or null if neither key matched (caller is
-- responsible for filing an unmatched_updates row in that case).
create function public.apply_shipping_update(
  p_order_number text,
  p_tracking_number text,
  p_carrier text,
  p_status public.package_status,
  p_expected_delivery_date date
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_package_id uuid;
begin
  if p_order_number is not null then
    select p.id into v_package_id
    from public.packages p
    join public.orders o on o.id = p.order_id
    where o.order_number = p_order_number
    limit 1;
  end if;

  if v_package_id is null and p_tracking_number is not null then
    select id into v_package_id
    from public.packages
    where tracking_number = p_tracking_number
    limit 1;
  end if;

  if v_package_id is not null then
    update public.packages set
      tracking_number = coalesce(p_tracking_number, tracking_number),
      carrier = coalesce(p_carrier, carrier),
      status = coalesce(p_status, status),
      expected_delivery_date = coalesce(p_expected_delivery_date, expected_delivery_date),
      delivered_source = 'retailer_email',
      delivered_at = case when p_status = 'delivered' then now() else delivered_at end
    where id = v_package_id;
  end if;

  return v_package_id;
end;
$$;

grant execute on function public.upsert_order_from_pipeline(public.order_source, uuid, text, date, numeric, text, jsonb) to authenticated;
grant execute on function public.upsert_order_from_pipeline(public.order_source, uuid, text, date, numeric, text, jsonb) to service_role;
grant execute on function public.apply_shipping_update(text, text, text, public.package_status, date) to authenticated;
grant execute on function public.apply_shipping_update(text, text, text, public.package_status, date) to service_role;
