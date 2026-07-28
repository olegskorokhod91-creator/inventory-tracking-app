-- Orders, order_items, packages, package_items (M2).
-- Non-negotiable rule this schema exists to protect: package status is the
-- source of truth, order status is a derived rollup (computed in the view
-- below, never a stored column), and requires_attention is a separate sticky
-- flag on orders that later milestones set/clear explicitly. Everything here
-- is admin-only — cleaners see zero pricing/order data in Phase 1.

create table public.retailers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  domain text,
  created_at timestamptz not null default now()
);

insert into public.retailers (name, domain) values
  ('Amazon', 'amazon.com'),
  ('Walmart', 'walmart.com'),
  ('Home Depot', 'homedepot.com'),
  ('Costco', 'costco.com');

create type public.order_source as enum ('manual', 'email', 'screenshot', 'pdf');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  retailer_id uuid not null references public.retailers (id),
  property_id uuid not null references public.properties (id),
  order_number text,
  order_date date not null,
  total_amount numeric(10, 2) check (total_amount >= 0),
  requires_attention boolean not null default false,
  source public.order_source not null default 'manual',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  name text not null,
  expected_quantity integer not null default 1 check (expected_quantity > 0),
  unit_price numeric(10, 2) check (unit_price >= 0),
  created_at timestamptz not null default now()
);

-- Full documented lifecycle even though M2 only ever produces 'expected' -
-- lets the rollup view below be complete and correct now, rather than
-- rewritten piecemeal as M4/M5 land.
create type public.package_status as enum (
  'expected',
  'shipped',
  'out_for_delivery',
  'delivered',
  'delayed',
  'cancelled',
  'confirmed_received',
  'requires_attention'
);

create type public.delivered_source as enum ('retailer_email', 'carrier_api', 'manual');

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  tracking_number text,
  carrier text,
  status public.package_status not null default 'expected',
  expected_delivery_date date,
  delivered_at timestamptz,
  delivered_source public.delivered_source,
  confidence_score numeric(3, 2),
  created_at timestamptz not null default now()
);

-- An order_item's quantity can eventually be split across multiple packages
-- (core requirement, not yet exercised until M4's shipment matching).
create table public.package_items (
  package_id uuid not null references public.packages (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  expected_quantity integer not null check (expected_quantity > 0),
  primary key (package_id, order_item_id)
);

-- Derived order status: computed at query time from package state, never
-- stored, so it can't drift from the packages that define it.
-- security_invoker means it enforces RLS as the querying user, not the view
-- owner - without this a plain view would silently bypass the RLS below.
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

-- Atomic order creation: a single function call is one transaction, so a
-- failure partway through (e.g. a bad item) rolls back everything instead of
-- leaving an order without its required package. Runs as the caller
-- (security invoker, the default) so the RLS insert policies below still
-- gate who can actually create an order - a cleaner calling this would fail
-- on the very first insert.
create function public.create_manual_order(
  p_retailer_id uuid,
  p_property_id uuid,
  p_order_number text,
  p_order_date date,
  p_total_amount numeric,
  p_items jsonb
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

  return v_order_id;
end;
$$;

alter table public.retailers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.packages enable row level security;
alter table public.package_items enable row level security;

create policy "Admins can view retailers"
  on public.retailers for select
  using (public.is_admin());

create policy "Admins can view orders"
  on public.orders for select
  using (public.is_admin());
create policy "Admins can insert orders"
  on public.orders for insert
  with check (public.is_admin());
create policy "Admins can update orders"
  on public.orders for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can view order items"
  on public.order_items for select
  using (public.is_admin());
create policy "Admins can insert order items"
  on public.order_items for insert
  with check (public.is_admin());

create policy "Admins can view packages"
  on public.packages for select
  using (public.is_admin());
create policy "Admins can insert packages"
  on public.packages for insert
  with check (public.is_admin());

create policy "Admins can view package items"
  on public.package_items for select
  using (public.is_admin());
create policy "Admins can insert package items"
  on public.package_items for insert
  with check (public.is_admin());

-- Same requirement M0/M1 surfaced: RLS policies alone don't reach a table
-- without a plain SQL GRANT to the Data API roles.
grant select on public.retailers to authenticated;
grant select, insert, update on public.orders to authenticated;
grant select, insert on public.order_items to authenticated;
grant select, insert on public.packages to authenticated;
grant select, insert on public.package_items to authenticated;
grant select on public.orders_with_status to authenticated;
grant execute on function public.create_manual_order(uuid, uuid, text, date, numeric, jsonb) to authenticated;

grant select, insert, update, delete on public.retailers to service_role;
grant select, insert, update, delete on public.orders to service_role;
grant select, insert, update, delete on public.order_items to service_role;
grant select, insert, update, delete on public.packages to service_role;
grant select, insert, update, delete on public.package_items to service_role;
grant select on public.orders_with_status to service_role;
grant execute on function public.create_manual_order(uuid, uuid, text, date, numeric, jsonb) to service_role;
