-- Second gap caught by testing as an actual cleaner (same root cause as the
-- retailers policy just added): package_items has been admin-only since M2,
-- so the confirmation screen's "expected items for this package" query
-- silently returned zero rows for a cleaner - not an error, just an empty
-- result, which is a bad failure mode for a page whose whole job is
-- showing the cleaner what to check off.
create policy "Cleaners can view package items for assigned properties"
  on public.package_items for select
  using (
    exists (
      select 1 from public.packages p
      join public.orders o on o.id = p.order_id
      join public.cleaner_property_assignments a on a.property_id = o.property_id
      where p.id = package_items.package_id and a.user_id = auth.uid()
    )
  );
