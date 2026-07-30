-- M8 hardening pass: a hosted Supabase project's own project-creation
-- bootstrap (not our migrations) grants anon/authenticated/service_role
-- broad default privileges on every table/sequence/routine in schema
-- public, plus explicit ALL-privilege grants on every object we've defined -
-- discovered via `supabase db diff --linked` against this project, which
-- otherwise came back completely clean (identical tables, columns,
-- RLS-enabled flags, policies, and triggers - only grants differed). This is
-- standard Supabase platform behavior, not a project-specific
-- misconfiguration: Supabase's documented model is "grants are broad, RLS is
-- the real gate."
--
-- Verified this doesn't currently expose anything: every RLS policy in this
-- schema is scoped by auth.uid()/is_admin(), both of which evaluate against
-- a null JWT for anon (no session) - no policy anywhere permits that. Only 3
-- tables have any DELETE policy at all (cleaner_property_assignments,
-- order_items, package_items), all is_admin()-gated; every other table has
-- none, so DELETE is blocked outright regardless of grant. Of the functions
-- anon could newly call, all but 3 (is_admin, handle_new_user,
-- sync_order_requires_attention) are security invoker, so their internal
-- writes still route through the same RLS and would affect zero rows for
-- anon; the 3 security definer exceptions are narrow and don't expose an
-- arbitrary write path.
--
-- Tightening anyway: relying on "RLS happens to cover the gap" as the only
-- safety net is worse than it needs to be. A future migration that forgets
-- one RLS policy (has happened before - M5's retailers/package_items were
-- missed on the first pass) fails loudly here (permission denied) the same
-- way it already does locally, instead of silently exposing data to the
-- public anon key the way hosted's default posture currently would.
--
-- Backward-compatible: only revokes from anon, which the app never uses for
-- real data (every query runs as authenticated post-login, or service_role
-- for backend jobs) - authenticated/service_role's existing grants are all
-- explicit statements from prior migrations and are untouched here. This
-- migration only strips (a) anon's current access and (b) the *default*
-- privilege that would auto-grant access to *future* objects - it does not
-- revoke anything authenticated or service_role already has.

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on routines from anon, authenticated, service_role;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all routines in schema public from anon;
