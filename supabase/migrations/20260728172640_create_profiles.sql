-- Profiles: one row per auth.users row, holding app-level role.
-- This is the M0 "RLS skeleton" — the pattern proved here (role-gated access,
-- enforced in Postgres, not app code) is what later protects properties/orders.

create type public.user_role as enum ('admin', 'cleaner');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  role public.user_role not null default 'cleaner',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Checks whether the calling user is an admin, without going through RLS on
-- profiles itself. A plain "exists (select ... from profiles where role =
-- 'admin')" inside a profiles policy causes Postgres to detect infinite
-- recursion (that select re-triggers the same policy). Owned by a superuser
-- (the migration role), so as `security definer` it bypasses RLS entirely.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Admins can read every profile (needed later for user/cleaner management).
create policy "Admins can view all profiles"
  on public.profiles for select
  using (public.is_admin());

-- Everyone can read their own profile (so the app can show "logged in as X").
create policy "Users can view own profile"
  on public.profiles for select
  using (id = auth.uid());

-- Admins can update any profile (e.g. change role, deactivate a cleaner).
create policy "Admins can update all profiles"
  on public.profiles for update
  using (public.is_admin());

-- Users can update their own profile, but not their own role (prevents a
-- cleaner from promoting themselves to admin via a direct API call).
create policy "Users can update own profile except role"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));

-- Supabase no longer auto-exposes new public-schema tables to the Data API
-- roles (see supabase/config.toml `auto_expose_new_tables`) — RLS policies
-- alone aren't enough, the role also needs a plain SQL GRANT to reach the
-- table at all. No insert grant: profile rows are only ever created via the
-- handle_new_user trigger below, which runs as security definer.
grant select, update on public.profiles to authenticated;

-- Auto-create a profile row whenever a new auth user signs up.
-- The very first user to ever sign up becomes admin (bootstrap case, since
-- no admin exists yet to assign roles); everyone after that defaults to cleaner.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', new.email),
    case
      when (select count(*) from public.profiles) = 0 then 'admin'
      else 'cleaner'
    end::public.user_role
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
