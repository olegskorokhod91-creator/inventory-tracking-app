-- Supply requests (M2.5): cleaners flag what a property needs, admins
-- manually decide which order resolves which request - no automatic
-- text-matching, ever. No inventory tracking, no reference/products table -
-- item_name is free text, autocomplete comes from a distinct-value query
-- over this same table.

create table public.supply_requests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  item_name text not null,
  quantity integer check (quantity > 0),
  note text,
  created_at timestamptz not null default now(),
  resolved_by_order_id uuid references public.orders (id),
  resolved_at timestamptz
);

create index supply_requests_property_id_idx on public.supply_requests (property_id);

-- Autocomplete needs to be global (per product decision), but a cleaner's
-- own RLS-scoped query can only ever see rows for their assigned
-- properties. This function deliberately bypasses RLS (security definer,
-- same pattern as is_admin()) but returns *only* item_name - no property,
-- quantity, or note - to keep the exposure to exactly what autocomplete
-- needs and nothing else.
create function public.get_supply_request_item_names()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct item_name from public.supply_requests order by item_name;
$$;

alter table public.supply_requests enable row level security;

-- Cleaners: same "assigned properties only" pattern as the properties table
-- in M1. They can see open AND resolved requests (avoids duplicate asks,
-- lets them see what's already been handled) but never edit/delete after
-- submitting - the add-flow's own review-before-submit is the safeguard.
create policy "Cleaners can view requests for assigned properties"
  on public.supply_requests for select
  using (
    exists (
      select 1 from public.cleaner_property_assignments a
      where a.property_id = supply_requests.property_id and a.user_id = auth.uid()
    )
  );

create policy "Cleaners can create requests for assigned properties"
  on public.supply_requests for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.cleaner_property_assignments a
      where a.property_id = supply_requests.property_id and a.user_id = auth.uid()
    )
  );

create policy "Admins can view all requests"
  on public.supply_requests for select
  using (public.is_admin());

-- Only the create_manual_order RPC below actually updates this (setting
-- resolved_by_order_id) - resolution has no standalone path in this
-- milestone - but RLS gates by role regardless of which code calls it.
create policy "Admins can update requests"
  on public.supply_requests for update
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update on public.supply_requests to authenticated;
grant select, insert, update, delete on public.supply_requests to service_role;
grant execute on function public.get_supply_request_item_names() to authenticated;
grant execute on function public.get_supply_request_item_names() to service_role;

-- Extends M2's create_manual_order to also resolve the checked requests in
-- the same transaction as order creation - a partial failure can't leave an
-- order created but the checklist half-applied. Adding a parameter changes
-- the function's signature (Postgres identifies functions by name+arg
-- types), so `create or replace` alone would leave the old 6-arg version
-- around as a separate overload - drop it explicitly first.
drop function if exists public.create_manual_order(uuid, uuid, text, date, numeric, jsonb);

create function public.create_manual_order(
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

  insert into public.packages (order_id, status)
  values (v_order_id, 'expected')
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
    where id = any (p_resolved_request_ids)
      and property_id = p_property_id
      and resolved_by_order_id is null;
  end if;

  return v_order_id;
end;
$$;

grant execute on function public.create_manual_order(uuid, uuid, text, date, numeric, jsonb, uuid[]) to authenticated;
grant execute on function public.create_manual_order(uuid, uuid, text, date, numeric, jsonb, uuid[]) to service_role;
