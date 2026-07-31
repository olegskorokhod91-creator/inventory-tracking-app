-- sync_supply_request_batch_status only fires on ordered_order_id
-- *changing* (see the previous migration) - deleting a supply_requests row
-- outright never touches that column, so a batch emptied out by removing
-- its last request sits around forever still marked 'open' with zero
-- children (harmless functionally - the next submission just reuses that
-- same batch id - but it inflated the nav badge count for no real reason).
-- Same "delete the now-empty shell" treatment as orders losing their last
-- item. Scoped tightly: only a batch that's *already* empty can be
-- deleted this way, by an admin or a cleaner assigned to its property -
-- mirrors exactly who's already allowed to delete the request that would
-- empty it in the first place.

create policy "Admins or assigned cleaners can delete empty batches"
  on public.supply_request_batches for delete
  using (
    not exists (
      select 1 from public.supply_requests where batch_id = supply_request_batches.id
    )
    and (
      public.is_admin()
      or exists (
        select 1 from public.cleaner_property_assignments a
        where a.property_id = supply_request_batches.property_id and a.user_id = auth.uid()
      )
    )
  );

-- RLS policy and table grant are both required, always (established
-- pattern, hit repeatedly across this project) - the policy alone doesn't
-- reach the table without this.
grant delete on public.supply_request_batches to authenticated;
