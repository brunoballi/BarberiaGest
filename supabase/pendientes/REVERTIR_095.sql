-- Revierte la 095: vuelve a dejar que los usuarios de la sucursal (barberos incluidos)
-- lean los clientes de turnos y que get_barber_agenda devuelva el teléfono.
-- Solo para emergencias: reabre el acceso de los barberos a los teléfonos.

drop policy if exists "appointment_clients_read" on appointment_clients;
create policy "appointment_clients_read" on appointment_clients
  for select to authenticated
  using (current_admin_has_branch(branch_id) or branch_id = current_user_branch());

create or replace function public.get_admin_agenda(p_branch_id uuid, p_date date)
returns table (
  id uuid, barber_id uuid, barber_name text, client_name text, client_phone text,
  starts_at timestamptz, ends_at timestamptz, status appointment_status,
  source appointment_source, reference text, notes text, total_price numeric,
  services jsonb
)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not coalesce(current_admin_has_branch(p_branch_id) or p_branch_id = current_user_branch(), false) then
    raise exception 'Sin acceso a esta sucursal';
  end if;
  return query
    select a.id, a.barber_id, p.full_name, c.full_name, c.phone,
      a.starts_at, a.ends_at, a.status, a.source, a.reference, a.notes,
      coalesce(sum(s.price), 0),
      coalesce(jsonb_agg(jsonb_build_object('service_id', s.service_id, 'name', s.service_name,
        'price', s.price, 'duration_min', s.duration_min) order by s.created_at), '[]'::jsonb)
    from appointments a
    join profiles p on p.id = a.barber_id
    join appointment_clients c on c.id = a.client_id
    left join appointment_services s on s.appointment_id = a.id
   where a.branch_id = p_branch_id
     and (a.starts_at at time zone 'America/Argentina/Buenos_Aires')::date = p_date
   group by a.id, a.barber_id, p.full_name, c.full_name, c.phone,
            a.starts_at, a.ends_at, a.status, a.source, a.reference, a.notes
   order by a.starts_at;
end;
$function$;

drop function if exists public.get_barber_agenda(date);
create function public.get_barber_agenda(p_date date)
returns table (
  id uuid, client_name text, client_phone text, starts_at timestamptz, ends_at timestamptz,
  status appointment_status, source appointment_source, reference text, notes text,
  total_price numeric, services jsonb, transaction_id uuid
)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_barber uuid := auth.uid();
begin
  if not exists (select 1 from profiles where profiles.id = v_barber and (profiles.role = 'barber' or profiles.is_barber)) then
    raise exception 'Solo barberos pueden ver su propia agenda';
  end if;
  return query
    select a.id, c.full_name, c.phone, a.starts_at, a.ends_at, a.status, a.source, a.reference, a.notes,
      coalesce(sum(s.price), 0),
      coalesce(jsonb_agg(jsonb_build_object('service_id', s.service_id, 'name', s.service_name,
        'price', s.price, 'duration_min', s.duration_min) order by s.created_at), '[]'::jsonb),
      a.transaction_id
    from appointments a
    join appointment_clients c on c.id = a.client_id
    left join appointment_services s on s.appointment_id = a.id
   where a.barber_id = v_barber
     and (a.starts_at at time zone 'America/Argentina/Buenos_Aires')::date = p_date
   group by a.id, c.full_name, c.phone, a.starts_at, a.ends_at, a.status, a.source, a.reference, a.notes, a.transaction_id
   order by a.starts_at;
end;
$function$;

revoke execute on function public.get_barber_agenda(date) from public, anon;
grant  execute on function public.get_barber_agenda(date) to authenticated, service_role;
