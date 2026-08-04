-- Lets a cleaner fan the same item list out to several properties in one
-- action ("she's at House on Pine but needs toilet paper at 5 other houses
-- too") - real user feedback. Batches stay strictly one-per-property (that
-- assumption runs through the whole fulfillment/reconciliation design, each
-- property has its own Amazon PO), so this is just the existing find-or-
-- create-open-batch logic run once per selected property in one
-- transaction, not a new batch concept. Changing the parameter type is a
-- signature change - drop before recreate, matching the M2.5 precedent for
-- exactly this situation.

drop function if exists public.create_supply_request_batch(uuid, jsonb);

create function public.create_supply_request_batch(
  p_property_ids uuid[],
  p_items jsonb
)
returns uuid[]
language plpgsql
set search_path = public
as $$
declare
  v_property_id uuid;
  v_batch_id uuid;
  v_batch_ids uuid[] := '{}';
  v_item jsonb;
begin
  foreach v_property_id in array p_property_ids
  loop
    select id into v_batch_id
    from public.supply_request_batches
    where property_id = v_property_id and status = 'open';

    if v_batch_id is null then
      insert into public.supply_request_batches (property_id, created_by)
      values (v_property_id, auth.uid())
      returning id into v_batch_id;
    end if;

    for v_item in select * from jsonb_array_elements(p_items)
    loop
      insert into public.supply_requests (batch_id, property_id, created_by, item_name, quantity, note)
      values (
        v_batch_id,
        v_property_id,
        auth.uid(),
        v_item ->> 'item_name',
        nullif(v_item ->> 'quantity', '')::integer,
        nullif(v_item ->> 'note', '')
      );
    end loop;

    v_batch_ids := array_append(v_batch_ids, v_batch_id);
    v_batch_id := null;
  end loop;

  return v_batch_ids;
end;
$$;

grant execute on function public.create_supply_request_batch(uuid[], jsonb) to authenticated;
grant execute on function public.create_supply_request_batch(uuid[], jsonb) to service_role;
