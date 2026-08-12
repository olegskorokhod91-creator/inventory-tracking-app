-- Real bug found via a live order: an order reconciled from a PDF invoice
-- with two shipment groups gets two packages up front, both 'expected'
-- with no tracking number (PDF invoices never carry tracking - only email
-- updates do). When a status-update email arrives with no tracking number
-- and the order has more than one package, apply_shipping_update fell back
-- to "the oldest package with tracking_number is null" - but applying a
-- no-tracking update never fills in a tracking number, so that same
-- package kept matching "untracked" forever, even after being marked
-- delivered. Two separate real "Delivered" emails for this order both
-- silently landed on the same package; the second package was never
-- touched by anything and stayed stuck at 'expected'.
--
-- Fix: the fallback now requires the candidate to still be genuinely
-- untouched (status = 'expected', not just tracking_number is null) - a
-- package that already received *any* update, tracked or not, no longer
-- qualifies. If more than one package still qualifies, that's genuinely
-- ambiguous (can't tell which box a no-tracking update is about) and this
-- returns null same as any other unmatched case, rather than guessing.
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
  v_untouched_count integer;
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
        select count(*) into v_untouched_count
        from public.packages
        where order_id = v_order_id and tracking_number is null and status = 'expected';

        if v_untouched_count = 1 then
          select id into v_package_id
          from public.packages
          where order_id = v_order_id and tracking_number is null and status = 'expected'
          limit 1;
        end if;
        -- 0 or >1 genuinely-untouched packages means this no-tracking
        -- update can't be confidently attributed to one box - falls
        -- through to unmatched_updates rather than guess.
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
