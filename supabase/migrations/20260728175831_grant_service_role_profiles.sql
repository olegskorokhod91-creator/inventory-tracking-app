-- Gap in the M0 profiles migration: service_role bypasses RLS by design
-- (it's Supabase's backend/admin role), but that's a separate mechanism from
-- the plain SQL GRANT needed to reach a table at all — the same requirement
-- RLS uncovered for `authenticated`. Discovered because a test fixture using
-- the service-role key to bootstrap an admin account hit a permission error.
grant select, insert, update, delete on public.profiles to service_role;
