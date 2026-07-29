-- M4: package status admin override + multi-package shipment matching.
--
-- Two additions to the packages table, and a rewrite of apply_shipping_update
-- (M3) to actually exercise the package_items/multi-package design that's
-- existed since M2 but was never triggered - every order has only ever had
-- exactly one package, and a second tracking number for the same order
-- number would have silently overwritten the first one's tracking data.

-- Distinguishes a package confirmed_received via the (future, M5) cleaner
-- app from one an admin marked manually (e.g. a phone-reported confirmation)
-- - same idea as delivered_source, which already exists for the delivered
-- transition. 'cleaner_app' isn't producible yet (M5 hasn't been built),
-- but the column exists now so M5 doesn't need another migration just to
-- start writing it.
create type public.confirmation_source as enum ('cleaner_app', 'admin_manual');

alter table public.packages add column confirmed_at timestamptz;
alter table public.packages add column confirmed_source public.confirmation_source;

-- Same signature as M3's version, so no grant/policy changes needed -
-- CREATE OR REPLACE is safe here (only the body changes, not the parameter
-- list, unlike M3.5's upsert_order_from_pipeline which added a parameter).
--
-- New matching behavior, additive to M3's exact-key rule:
--   - tracking number given, matches an existing package on the resolved
--     order -> update it (idempotent re-processing of the same email).
--   - tracking number given, no match, but the order has an untracked
--     package -> claim it (fills in tracking on the common single-package
--     case, identical to M3's old behavior).
--   - tracking number given, every existing package on the order already
--     has a *different* tracking number -> this is genuinely a second box,
--     not a duplicate email or a correction - create a new package rather
--     than overwrite one and lose the first box's tracking data.
--   - no tracking number given -> only safe to apply blindly when the
--     order has exactly one package (today's only real case). More than
--     one package and none untracked means there's no way to know which
--     box this status update is about - same "never auto-apply a
--     low-confidence match" rule as everywhere else in this pipeline, so
--     this returns null and the caller routes it to unmatched_updates
--     instead of guessing.
--
-- Also fixes a latent bug while rewriting this: the old version stamped
-- delivered_source = 'retailer_email' on every call regardless of whether
-- p_status was actually 'delivered' this time. Now gated the same way
-- delivered_at already was, and confirmed_at/confirmed_source follow the
-- identical pattern for the confirmed_received transition.
create or replace function public.apply_shipping_update(
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
  v_order_id uuid;
  v_package_id uuid;
  v_package_count integer;
begin
  if p_order_number is not null then
    select id into v_order_id from public.orders where order_number = p_order_number limit 1;
  end if;

  if v_order_id is not null then
    if p_tracking_number is not null then
      select id into v_package_id
      from public.packages
      where order_id = v_order_id and tracking_number = p_tracking_number
      limit 1;

      if v_package_id is null then
        select id into v_package_id
        from public.packages
        where order_id = v_order_id and tracking_number is null
        order by created_at
        limit 1;
      end if;

      if v_package_id is null then
        insert into public.packages (order_id, status)
        values (v_order_id, 'expected')
        returning id into v_package_id;
      end if;
    else
      select count(*) into v_package_count from public.packages where order_id = v_order_id;

      if v_package_count = 1 then
        select id into v_package_id from public.packages where order_id = v_order_id limit 1;
      else
        select id into v_package_id
        from public.packages
        where order_id = v_order_id and tracking_number is null
        order by created_at
        limit 1;
        -- Still null here means >1 package, all already tracked, and this
        -- update carries no tracking number to disambiguate - fall through
        -- to unmatched_updates rather than guess which box it's about.
      end if;
    end if;
  end if;

  -- order_number didn't resolve to a known order at all - fall back to a
  -- bare tracking-number match across all packages (M3's original fallback).
  if v_package_id is null and p_tracking_number is not null then
    select id into v_package_id from public.packages where tracking_number = p_tracking_number limit 1;
  end if;

  if v_package_id is not null then
    update public.packages set
      tracking_number = coalesce(p_tracking_number, tracking_number),
      carrier = coalesce(p_carrier, carrier),
      status = coalesce(p_status, status),
      expected_delivery_date = coalesce(p_expected_delivery_date, expected_delivery_date),
      delivered_source = case when p_status = 'delivered' then 'retailer_email' else delivered_source end,
      delivered_at = case when p_status = 'delivered' then now() else delivered_at end
    where id = v_package_id;
  end if;

  return v_package_id;
end;
$$;
