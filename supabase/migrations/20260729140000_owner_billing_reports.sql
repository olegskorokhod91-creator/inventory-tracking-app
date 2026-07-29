-- M3.5: owner billing reports.
--
-- Owners bill for supplies purchased on their behalf across one or more
-- properties. This migration adds the owner relationship and the two data
-- points the billing report needs that nothing upstream captures today:
-- a cancelled-order signal (from CSV) and a refunded-item signal (manual,
-- since no pipeline source for it exists yet).

create table public.owners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text,
  contact_phone text,
  created_at timestamptz not null default now()
);

-- One owner -> many properties. No uniqueness constraint needed on the FK
-- side for that; it's just an ordinary nullable reference.
alter table public.properties add column owner_id uuid references public.owners (id);

-- Raw passthrough from the Amazon Business CSV's "Order Status" column
-- (Closed / Pending / Pending Fulfillment / Cancelled / Payment Confirmed),
-- same treatment as po_number: authoritative hint captured by the CSV
-- pipeline, never interpreted into an app-level enum. The billing report
-- uses this to exclude cancelled orders entirely (not just their now-zeroed
-- total_amount) from spend, order count, and item count. Email extraction
-- doesn't populate this - out of scope here, same as po_number originally.
alter table public.orders add column retailer_order_status text;

-- No refund signal exists anywhere in the Amazon Business export (checked
-- against a real sample: no "Refunded" status, no negative item totals -
-- what looked like mismatches turned out to be split-payment installments,
-- not refunds). Refunds get marked manually, per item, by an admin on the
-- order detail screen - a whole order is never all-or-nothing here since a
-- single item out of a multi-item order is the common real case.
alter table public.order_items add column is_refunded boolean not null default false;

-- orders_with_status does `select o.*` (M2) - Postgres fixes that into a
-- concrete column list at view-creation time. Adding retailer_order_status
-- to orders shifts computed_status's position in that list, which
-- `create or replace view` rejects (same issue M3's po_number column hit) -
-- needs a full drop+recreate. Grants are lost on drop, reissued below.
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

alter table public.owners enable row level security;

-- Same access rule as all pricing/spend data: admin-only, cleaners never
-- see owners at all.
create policy "Admins can view owners"
  on public.owners for select
  using (public.is_admin());
create policy "Admins can insert owners"
  on public.owners for insert
  with check (public.is_admin());
create policy "Admins can update owners"
  on public.owners for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy: same reasoning as properties - owners are referenced by
-- properties.owner_id, hard-deleting one would orphan/cascade unexpectedly.

grant select, insert, update on public.owners to authenticated;
grant select, insert, update, delete on public.owners to service_role;

-- order_items had no update policy before this - M2/M3 only ever inserted
-- or wholesale-replaced items, never updated one in place. The refund
-- toggle needs it (admin-only, same as every other pricing mutation).
create policy "Admins can update order items"
  on public.order_items for update
  using (public.is_admin())
  with check (public.is_admin());

grant update on public.order_items to authenticated;
grant update on public.order_items to service_role;

-- upsert_order_from_pipeline needs to accept retailer_order_status. Adding a
-- parameter changes the function's identity for Postgres's overload
-- resolution (it's keyed on argument types, not defaults), so `create or
-- replace` here would leave the old 7-arg version stranded as a separate
-- overload rather than actually replacing it - drop it explicitly first.
-- Overwrite semantics for the new field mirror po_number exactly: it's raw
-- CSV header data, same authority level, same fill-vs-overwrite rules.
drop function public.upsert_order_from_pipeline(public.order_source, uuid, text, date, numeric, text, jsonb);

create function public.upsert_order_from_pipeline(
  p_source public.order_source,
  p_retailer_id uuid,
  p_order_number text,
  p_order_date date,
  p_total_amount numeric,
  p_po_number text,
  p_items jsonb default null,
  p_retailer_order_status text default null
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
    insert into public.orders (retailer_id, order_number, order_date, total_amount, po_number, retailer_order_status, source)
    values (p_retailer_id, p_order_number, p_order_date, p_total_amount, p_po_number, p_retailer_order_status, p_source)
    returning id into v_order_id;

    insert into public.packages (order_id, status)
    values (v_order_id, 'expected');

    v_existing_source := p_source;
  elsif v_existing_source = 'manual' or p_source = 'email' then
    update public.orders set
      order_date = coalesce(order_date, p_order_date),
      total_amount = coalesce(total_amount, p_total_amount),
      po_number = coalesce(po_number, p_po_number),
      retailer_order_status = coalesce(retailer_order_status, p_retailer_order_status)
    where id = v_order_id;
  else
    -- p_source = 'csv', existing source is 'email' or 'csv': CSV overwrites.
    update public.orders set
      order_date = coalesce(p_order_date, order_date),
      total_amount = coalesce(p_total_amount, total_amount),
      po_number = coalesce(p_po_number, po_number),
      retailer_order_status = coalesce(p_retailer_order_status, retailer_order_status)
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

grant execute on function public.upsert_order_from_pipeline(public.order_source, uuid, text, date, numeric, text, jsonb, text) to authenticated;
grant execute on function public.upsert_order_from_pipeline(public.order_source, uuid, text, date, numeric, text, jsonb, text) to service_role;
