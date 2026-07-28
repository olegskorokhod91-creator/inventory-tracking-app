-- Properties + cleaner-property assignments (M1).
-- The RLS policies here are the actual point of this milestone: cleaners must
-- only ever see properties they're assigned to, enforced in Postgres.

create type public.property_status as enum ('active', 'inactive');

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  status public.property_status not null default 'active',
  notes text,
  created_at timestamptz not null default now()
);

create table public.cleaner_property_assignments (
  property_id uuid not null references public.properties (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (property_id, user_id)
);

create index cleaner_property_assignments_user_id_idx
  on public.cleaner_property_assignments (user_id);

alter table public.properties enable row level security;
alter table public.cleaner_property_assignments enable row level security;

-- properties: admins see/manage everything; cleaners see only assigned ones,
-- read-only (no insert/update/delete policy for cleaners at all).
create policy "Admins can view all properties"
  on public.properties for select
  using (public.is_admin());

create policy "Cleaners can view assigned properties"
  on public.properties for select
  using (
    exists (
      select 1 from public.cleaner_property_assignments a
      where a.property_id = properties.id and a.user_id = auth.uid()
    )
  );

create policy "Admins can insert properties"
  on public.properties for insert
  with check (public.is_admin());

create policy "Admins can update properties"
  on public.properties for update
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy: properties are deactivated via status, never hard-deleted
-- (avoids cascading data loss once orders reference them in M2+).

-- cleaner_property_assignments: admins manage everything; cleaners can see
-- their own assignment rows (properties RLS above is what actually drives
-- the "My Properties" screen, this is just for completeness/audit).
create policy "Admins can view all assignments"
  on public.cleaner_property_assignments for select
  using (public.is_admin());

create policy "Cleaners can view own assignments"
  on public.cleaner_property_assignments for select
  using (user_id = auth.uid());

create policy "Admins can insert assignments"
  on public.cleaner_property_assignments for insert
  with check (public.is_admin());

create policy "Admins can delete assignments"
  on public.cleaner_property_assignments for delete
  using (public.is_admin());

-- Same lesson as the profiles migration: RLS policies alone don't reach the
-- table without an explicit GRANT to the Data API roles. service_role
-- bypasses RLS by design, but still needs the plain SQL grant to reach the
-- table at all.
grant select, insert, update on public.properties to authenticated;
grant select, insert, delete on public.cleaner_property_assignments to authenticated;
grant select, insert, update, delete on public.properties to service_role;
grant select, insert, update, delete on public.cleaner_property_assignments to service_role;
