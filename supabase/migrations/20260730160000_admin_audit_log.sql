-- Narrow audit log for the three admin hand-edit paths that had zero audit
-- trail: order field edits (retailer/property/order_number/order_date/
-- total_amount), package manual overrides (tracking/carrier/expected
-- delivery/status), and the refund toggle on order_items. Everything else
-- in the schema already has a real audit trail as a side effect of its
-- normal flow (imported_emails/csv_imports/unmatched_updates for the
-- pipeline, package_confirmations for cleaner reports) - this table exists
-- only to cover the gap, not to replace any of that.
--
-- Deliberately field-level (one row per changed column, old/new as text)
-- rather than one row per action with a jsonb diff - simplest thing that
-- answers "who changed X on this row, from what, to what, when" for a
-- billing dispute or package-history reconstruction, without needing a
-- jsonb-diffing query to read it back.

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles (id),
  table_name text not null,
  row_id uuid not null,
  field_name text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create index audit_log_row_idx on public.audit_log (table_name, row_id);

alter table public.audit_log enable row level security;

create policy "Admins can view audit log"
  on public.audit_log for select
  using (public.is_admin());

-- Only ever written by an admin action on their own behalf (actor_id must
-- be the caller) - same shape as package_confirmations' insert policy.
create policy "Admins can write audit log entries"
  on public.audit_log for insert
  with check (public.is_admin() and actor_id = auth.uid());

grant select, insert on public.audit_log to authenticated;
grant select, insert, update, delete on public.audit_log to service_role;
