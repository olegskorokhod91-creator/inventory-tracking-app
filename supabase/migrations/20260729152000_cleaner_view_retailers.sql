-- Follow-up to M5: cleaners had no SELECT policy on retailers at all
-- (admin-only since M2), so the confirmations list/detail screens'
-- `orders.retailers(name)` embed silently returned null for a cleaner
-- session - not an error, RLS just excludes the joined row, so the
-- retailer name quietly disappeared from their view. Caught by actually
-- testing as a cleaner rather than assuming the embed would work the same
-- way it does for admins.
create policy "Cleaners can view retailers"
  on public.retailers for select
  using (
    exists (
      select 1 from public.cleaner_property_assignments a
      where a.user_id = auth.uid()
    )
  );
