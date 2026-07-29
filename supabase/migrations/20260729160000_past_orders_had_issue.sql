-- M6: Past Orders search/filter needs a way to find orders that *ever* had
-- a cleaner-reported problem, even after it was resolved. orders.requires_
-- attention can't answer that - it's trigger-recomputed to false the moment
-- every problem package is resolved (M5), which is exactly the state every
-- order is in by the time it reaches Past Orders (computed_status =
-- 'completed' already requires no package be stuck in requires_attention).
-- The only place this history survives is package_confirmations.outcome.
--
-- Appended as a new column on orders_with_status (CREATE OR REPLACE VIEW,
-- not DROP+CREATE) - additive to the end of the select list, so this is
-- safe unlike changes to o.* itself, and existing grants on the view carry
-- over automatically since the view object isn't being recreated from
-- scratch.
--
-- Derived, not stored: no new trigger, same reasoning already used for
-- computed_status and the Active Orders sub-label - this is only ever
-- needed for Past Orders display/filtering, so there's no call-site
-- pressure to make it a hand-maintained column the way requires_attention
-- (billing report, /orders, order detail) needed to be.
create or replace view public.orders_with_status
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
  end as computed_status,
  exists (
    select 1
    from public.packages p
    join public.package_confirmations pc on pc.package_id = p.id
    where p.order_id = o.id and pc.outcome <> 'all_correct'
  ) as had_issue
from public.orders o;
