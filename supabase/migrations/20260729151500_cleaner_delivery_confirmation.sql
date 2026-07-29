-- M5: cleaner delivery confirmation.
--
-- This is the milestone that finally writes to orders.requires_attention -
-- a dead column since M2 (nothing has ever set it). From here on, nothing
-- in the app sets it directly: a trigger recomputes it from package status
-- after every change, so it can never drift the way three independent
-- call-sites remembering to set it by hand eventually would.
--
-- Also the first cleaner-facing RLS on orders/order_items/packages - all
-- three have been admin-only since M2/M3. Cleaners get scoped SELECT
-- through cleaner_property_assignments (same join pattern properties has
-- used since M1), plus a narrow, trigger-enforced UPDATE on packages.

-- Distinct from package_status (shipping lifecycle) on purpose - these are
-- a different concern (the cleaner's confirmation result), not another
-- shipping state. Cramming both into package_status would overload one
-- enum with two unrelated axes of meaning.
create type public.confirmation_outcome as enum (
  'all_correct',
  'package_not_found',
  'items_missing',
  'incorrect_quantity',
  'wrong_item',
  'damaged',
  'received_not_put_away'
);

-- Completes the audit trail M4 started (confirmed_at/confirmed_source) -
-- who confirmed it, for the happy-path 'confirmed_received' transition
-- specifically. Kept separate from package_confirmations.reported_by below,
-- which records who submitted *any* confirmation outcome, not just this one.
alter table public.packages add column confirmed_by uuid references public.profiles (id);

-- One row per confirmation attempt (insert-only audit log, same pattern as
-- imported_emails/csv_imports/unmatched_updates) - not a mutable "current
-- state" field, so there's always a record of who reported what and when,
-- including problem outcomes that don't end in confirmed_received.
create table public.package_confirmations (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages (id) on delete cascade,
  reported_by uuid not null references public.profiles (id),
  outcome public.confirmation_outcome not null,
  note text,
  photo_path text,
  created_at timestamptz not null default now()
);

-- Per-item actual-received-quantity, captured regardless of outcome (not
-- just for quantity-flavored outcomes) - this is what lets the admin-side
-- confirmation history show actual-vs-expected per item, and what a
-- 'damaged'/'wrong_item' outcome's note field explains.
create table public.package_confirmation_items (
  package_confirmation_id uuid not null references public.package_confirmations (id) on delete cascade,
  order_item_id uuid not null references public.order_items (id),
  actual_quantity integer not null check (actual_quantity >= 0),
  item_note text,
  primary key (package_confirmation_id, order_item_id)
);

-- The actual answer to "how does requires_attention get set": nothing else
-- does, from here on. Recomputed from package state after every status
-- change, so the admin-facing flag can never fall out of sync with the
-- packages it's supposed to summarize - the same reason computed_status is
-- a view rather than a hand-maintained column, just implemented as a
-- trigger here since requires_attention has to stay a real stored column
-- (too many existing call sites - the billing report, /orders, order
-- detail - already select it directly as a plain orders column).
create function public.sync_order_requires_attention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders set
    requires_attention = exists (
      select 1 from public.packages p
      where p.order_id = new.order_id and p.status = 'requires_attention'
    )
  where id = new.order_id;
  return new;
end;
$$;

create trigger sync_order_requires_attention
  after insert or update of status on public.packages
  for each row execute function public.sync_order_requires_attention();

-- Cleaners get a narrow UPDATE via RLS below (scoped to assigned
-- properties), but RLS alone can't restrict *which* columns or *which*
-- status values within an otherwise-permitted row. This trigger closes
-- that gap precisely - the plan doc is explicit that cleaners must never
-- modify retailer/carrier-sourced status data, and enforcing that only in
-- the app UI (not the database) would make it bypassable by a direct API
-- call, defeating the point of doing this at the RLS/database level at
-- all. auth.uid() is null for service_role calls (the email pipeline's
-- apply_shipping_update runs as service_role, which has no "sub" claim) -
-- those and admins pass through unrestricted; only an authenticated
-- non-admin session (a cleaner) is actually constrained.
create function public.guard_cleaner_package_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.status not in ('confirmed_received', 'requires_attention') then
    raise exception 'Cleaners may only set package status to confirmed_received or requires_attention';
  end if;

  if new.order_id is distinct from old.order_id
    or new.tracking_number is distinct from old.tracking_number
    or new.carrier is distinct from old.carrier
    or new.expected_delivery_date is distinct from old.expected_delivery_date
    or new.delivered_at is distinct from old.delivered_at
    or new.delivered_source is distinct from old.delivered_source
  then
    raise exception 'Cleaners may only change status/confirmed_at/confirmed_source/confirmed_by on a package';
  end if;

  return new;
end;
$$;

create trigger guard_cleaner_package_update
  before update on public.packages
  for each row execute function public.guard_cleaner_package_update();

-- Single entry point for the cleaner app's confirmation flow (security
-- invoker, like every other multi-table write in this schema - RLS on the
-- tables it touches is the real gate, this is just the transactional
-- wrapper). Deliberately scoped to cleaners only: the package_confirmations
-- insert policy below requires reported_by = auth.uid() *and* an assigned-
-- property match, which an admin session won't satisfy (admins have their
-- own distinct manual-override path from M4, updatePackage - this RPC's
-- confirmed_source = 'cleaner_app' stamp would be a lie if an admin could
-- also call it).
create function public.confirm_package_delivery(
  p_package_id uuid,
  p_outcome public.confirmation_outcome,
  p_note text,
  p_photo_path text,
  p_items jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_confirmation_id uuid;
  v_item jsonb;
  v_new_status public.package_status;
begin
  v_new_status := case
    when p_outcome = 'all_correct' then 'confirmed_received'::public.package_status
    else 'requires_attention'::public.package_status
  end;

  insert into public.package_confirmations (package_id, reported_by, outcome, note, photo_path)
  values (p_package_id, auth.uid(), p_outcome, nullif(p_note, ''), p_photo_path)
  returning id into v_confirmation_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.package_confirmation_items (package_confirmation_id, order_item_id, actual_quantity, item_note)
    values (
      v_confirmation_id,
      (v_item ->> 'order_item_id')::uuid,
      (v_item ->> 'actual_quantity')::integer,
      nullif(v_item ->> 'item_note', '')
    );
  end loop;

  update public.packages set
    status = v_new_status,
    confirmed_at = case when v_new_status = 'confirmed_received' then now() else confirmed_at end,
    confirmed_source = case when v_new_status = 'confirmed_received' then 'cleaner_app'::public.confirmation_source else confirmed_source end,
    confirmed_by = case when v_new_status = 'confirmed_received' then auth.uid() else confirmed_by end
  where id = p_package_id;

  return v_confirmation_id;
end;
$$;

alter table public.package_confirmations enable row level security;
alter table public.package_confirmation_items enable row level security;

create policy "Admins can view all confirmations"
  on public.package_confirmations for select
  using (public.is_admin());

create policy "Cleaners can view confirmations for assigned properties"
  on public.package_confirmations for select
  using (
    exists (
      select 1 from public.packages p
      join public.orders o on o.id = p.order_id
      join public.cleaner_property_assignments a on a.property_id = o.property_id
      where p.id = package_confirmations.package_id and a.user_id = auth.uid()
    )
  );

create policy "Cleaners can create confirmations for assigned properties"
  on public.package_confirmations for insert
  with check (
    reported_by = auth.uid()
    and exists (
      select 1 from public.packages p
      join public.orders o on o.id = p.order_id
      join public.cleaner_property_assignments a on a.property_id = o.property_id
      where p.id = package_confirmations.package_id and a.user_id = auth.uid()
    )
  );

create policy "Admins can view all confirmation items"
  on public.package_confirmation_items for select
  using (public.is_admin());

create policy "Cleaners can view confirmation items for assigned properties"
  on public.package_confirmation_items for select
  using (
    exists (
      select 1 from public.package_confirmations pc
      join public.packages p on p.id = pc.package_id
      join public.orders o on o.id = p.order_id
      join public.cleaner_property_assignments a on a.property_id = o.property_id
      where pc.id = package_confirmation_items.package_confirmation_id and a.user_id = auth.uid()
    )
  );

create policy "Cleaners can add items to their own confirmations"
  on public.package_confirmation_items for insert
  with check (
    exists (
      select 1 from public.package_confirmations pc
      where pc.id = package_confirmation_items.package_confirmation_id and pc.reported_by = auth.uid()
    )
  );

-- First cleaner-facing SELECT policies on orders/order_items/packages -
-- all three have been admin-only since M2/M3. Additive (OR'd with the
-- existing admin policies, per-command), same cleaner_property_assignments
-- join properties has used since M1.
create policy "Cleaners can view orders for assigned properties"
  on public.orders for select
  using (
    exists (
      select 1 from public.cleaner_property_assignments a
      where a.property_id = orders.property_id and a.user_id = auth.uid()
    )
  );

create policy "Cleaners can view order items for assigned properties"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      join public.cleaner_property_assignments a on a.property_id = o.property_id
      where o.id = order_items.order_id and a.user_id = auth.uid()
    )
  );

create policy "Cleaners can view packages for assigned properties"
  on public.packages for select
  using (
    exists (
      select 1 from public.orders o
      join public.cleaner_property_assignments a on a.property_id = o.property_id
      where o.id = packages.order_id and a.user_id = auth.uid()
    )
  );

-- Scoped UPDATE for cleaners (the guard trigger above restricts what
-- within the row they can actually change) - orders/order_items/packages
-- already grant select/update to `authenticated` in bulk from M2/M3, so no
-- new GRANTs are needed for those three, only the RLS policies.
create policy "Cleaners can update packages for assigned properties"
  on public.packages for update
  using (
    exists (
      select 1 from public.orders o
      join public.cleaner_property_assignments a on a.property_id = o.property_id
      where o.id = packages.order_id and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.orders o
      join public.cleaner_property_assignments a on a.property_id = o.property_id
      where o.id = packages.order_id and a.user_id = auth.uid()
    )
  );

grant select, insert on public.package_confirmations to authenticated;
grant select, insert, update, delete on public.package_confirmations to service_role;
grant select, insert on public.package_confirmation_items to authenticated;
grant select, insert, update, delete on public.package_confirmation_items to service_role;
grant execute on function public.confirm_package_delivery(uuid, public.confirmation_outcome, text, text, jsonb) to authenticated;
grant execute on function public.confirm_package_delivery(uuid, public.confirmation_outcome, text, text, jsonb) to service_role;

-- Storage: this app has had no Storage integration at all until now
-- (imported_emails.raw_storage_path has sat unpopulated since M3 for
-- exactly this reason). Private bucket - photos are only ever reached via
-- a signed URL generated server-side after the RLS check below passes,
-- never a public URL. file_size_limit/allowed_mime_types are enforced by
-- the Storage API itself at upload time, not just documented here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'confirmation-photos',
  'confirmation-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- Uploaded paths are always "{package_id}/{filename}" (enforced by the app,
-- never by user input directly) - the uuid regex guard avoids a cast
-- exception aborting an unrelated query if some other bucket's path or a
-- malformed one is ever scanned against this policy.
create policy "Cleaners can upload confirmation photos for assigned properties"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'confirmation-photos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.packages p
      join public.orders o on o.id = p.order_id
      join public.cleaner_property_assignments a on a.property_id = o.property_id
      where p.id = (storage.foldername(name))[1]::uuid and a.user_id = auth.uid()
    )
  );

create policy "Cleaners can view confirmation photos for assigned properties"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'confirmation-photos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.packages p
      join public.orders o on o.id = p.order_id
      join public.cleaner_property_assignments a on a.property_id = o.property_id
      where p.id = (storage.foldername(name))[1]::uuid and a.user_id = auth.uid()
    )
  );

create policy "Admins can view all confirmation photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'confirmation-photos' and public.is_admin());
