-- ============================================================
-- VALHALLA BARBERSHOP — audit_log (recupera schema drift)
-- La tabla de auditoría, su función trigger y los triggers existían
-- en el proyecto original pero NO estaban en ninguna migración.
-- Se recrean aquí (idempotente) para que 005_fk_indexes (índices) y
-- 006_rls_initplan (policy audit_log_admin_read) puedan referenciarla.
-- ============================================================

create table if not exists audit_log (
  id         uuid        primary key default gen_random_uuid(),
  table_name text        not null,
  record_id  uuid        not null,
  action     text        not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  old_data   jsonb,
  new_data   jsonb,
  diff       jsonb
);

alter table audit_log enable row level security;

-- Función de auditoría (SECURITY DEFINER): registra INSERT/UPDATE/DELETE
create or replace function public.audit_log_trigger()
  returns trigger
  language plpgsql
  security definer
as $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_diff jsonb := '{}'::jsonb;
  v_key text;
begin
  if TG_OP = 'INSERT' then
    v_new := to_jsonb(NEW);
    insert into audit_log (table_name, record_id, action, changed_by, new_data)
    values (TG_TABLE_NAME, NEW.id, 'INSERT', auth.uid(), v_new);
    return NEW;
  elsif TG_OP = 'UPDATE' then
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    for v_key in select jsonb_object_keys(v_new) loop
      if v_new -> v_key is distinct from v_old -> v_key then
        v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      end if;
    end loop;
    if v_diff <> '{}'::jsonb then
      insert into audit_log (table_name, record_id, action, changed_by, old_data, new_data, diff)
      values (TG_TABLE_NAME, NEW.id, 'UPDATE', auth.uid(), v_old, v_new, v_diff);
    end if;
    return NEW;
  elsif TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD);
    insert into audit_log (table_name, record_id, action, changed_by, old_data)
    values (TG_TABLE_NAME, OLD.id, 'DELETE', auth.uid(), v_old);
    return OLD;
  end if;
  return NULL;
end;
$function$;

-- Triggers de auditoría sobre las tablas sensibles
drop trigger if exists trg_audit_settlements on public.settlements;
create trigger trg_audit_settlements
  after insert or update or delete on public.settlements
  for each row execute function audit_log_trigger();

drop trigger if exists trg_audit_transactions on public.transactions;
create trigger trg_audit_transactions
  after insert or update or delete on public.transactions
  for each row execute function audit_log_trigger();

drop trigger if exists trg_audit_expenses on public.expenses;
create trigger trg_audit_expenses
  after insert or update or delete on public.expenses
  for each row execute function audit_log_trigger();
