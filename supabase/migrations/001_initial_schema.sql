-- ============================================================
-- VALHALLA BARBERSHOP — Initial Schema (idempotente)
-- Proyecto Supabase: kzctstbdudxoknjobamo
-- Se puede ejecutar múltiples veces sin error.
-- ============================================================

-- ============================================================
-- ENUMS (idempotentes via DO block)
-- ============================================================
do $$ begin
  create type user_role as enum ('admin', 'barber');
exception when duplicate_object then null; end $$;

do $$ begin
  create type compensation_type as enum ('percentage', 'salary', 'box_rental');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('cash', 'transfer', 'card');
exception when duplicate_object then null; end $$;

do $$ begin
  create type week_status as enum ('open', 'closed', 'paid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type settlement_status as enum ('draft', 'confirmed', 'paid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type advance_status as enum ('pending', 'deducted', 'cancelled');
exception when duplicate_object then null; end $$;

-- ============================================================
-- BRANCHES
-- ============================================================
create table if not exists branches (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  address    text,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- PROFILES (extends auth.users 1-to-1)
-- ============================================================
create table if not exists profiles (
  id                uuid              primary key references auth.users(id) on delete cascade,
  branch_id         uuid              not null references branches(id),
  full_name         text              not null,
  role              user_role         not null default 'barber',
  compensation_type compensation_type not null default 'percentage',
  commission_rate   numeric(4,3),
  base_salary_rate  numeric(12,2),
  presentismo_rate  numeric(12,2),
  objetivo_rate     numeric(12,2),
  objetivo_min_cuts integer,
  box_rental_amount numeric(12,2),
  is_active         boolean           not null default true,
  created_at        timestamptz       not null default now()
);

-- ============================================================
-- SERVICE CATALOG
-- ============================================================
create table if not exists service_catalog (
  id         uuid          primary key default gen_random_uuid(),
  branch_id  uuid          not null references branches(id),
  name       text          not null,
  base_price numeric(12,2) not null default 0,
  is_active  boolean       not null default true,
  created_at timestamptz   not null default now()
);

-- ============================================================
-- WEEKS
-- ============================================================
create table if not exists weeks (
  id          uuid        primary key default gen_random_uuid(),
  branch_id   uuid        not null references branches(id),
  week_number integer     not null,
  start_date  date        not null,
  end_date    date        not null,
  status      week_status not null default 'open',
  closed_at   timestamptz,
  closed_by   uuid        references auth.users(id),
  created_at  timestamptz not null default now(),
  constraint weeks_branch_week_unique unique (branch_id, week_number),
  constraint weeks_dates_check check (end_date >= start_date)
);

-- ============================================================
-- TRANSACTIONS
-- ============================================================
create table if not exists transactions (
  id                       uuid           primary key default gen_random_uuid(),
  branch_id                uuid           not null references branches(id),
  barber_id                uuid           not null references profiles(id),
  service_id               uuid           references service_catalog(id),
  week_id                  uuid           not null references weeks(id),
  transaction_date         date           not null,
  amount                   numeric(12,2)  not null check (amount > 0),
  payment_method           payment_method not null,
  branch_share             numeric(12,2)  not null,
  barber_share             numeric(12,2)  not null,
  commission_rate_snapshot numeric(4,3)   not null,
  barber_already_collected numeric(12,2)  not null default 0,
  is_manual_override       boolean        not null default false,
  override_notes           text,
  created_by               uuid           not null references auth.users(id),
  created_at               timestamptz    not null default now(),
  updated_at               timestamptz    not null default now()
);

-- ============================================================
-- SETTLEMENTS
-- ============================================================
create table if not exists settlements (
  id                     uuid              primary key default gen_random_uuid(),
  week_id                uuid              not null references weeks(id),
  barber_id              uuid              not null references profiles(id),
  branch_id              uuid              not null references branches(id),
  total_cuts             integer           not null default 0,
  gross_amount           numeric(12,2)     not null default 0,
  barber_gross           numeric(12,2)     not null default 0,
  bonus_presentismo      numeric(12,2)     not null default 0,
  bonus_objetivo         numeric(12,2)     not null default 0,
  total_earned           numeric(12,2)     not null default 0,
  already_collected      numeric(12,2)     not null default 0,
  advances_deducted      numeric(12,2)     not null default 0,
  total_deductions       numeric(12,2)     not null default 0,
  net_payable            numeric(12,2)     not null default 0,
  cash_amount            numeric(12,2)     not null default 0,
  transfer_amount        numeric(12,2)     not null default 0,
  card_amount            numeric(12,2)     not null default 0,
  base_salary_rate_snap  numeric(12,2),
  presentismo_rate_snap  numeric(12,2),
  objetivo_rate_snap     numeric(12,2),
  objetivo_min_cuts_snap integer,
  objetivo_met           boolean,
  presentismo_met        boolean,
  status                 settlement_status not null default 'draft',
  confirmed_at           timestamptz,
  paid_at                timestamptz,
  created_at             timestamptz       not null default now(),
  updated_at             timestamptz       not null default now(),
  constraint settlements_week_barber_unique unique (week_id, barber_id)
);

-- ============================================================
-- ADVANCES
-- ============================================================
create table if not exists advances (
  id            uuid           primary key default gen_random_uuid(),
  barber_id     uuid           not null references profiles(id),
  branch_id     uuid           not null references branches(id),
  week_id       uuid           references weeks(id),
  amount        numeric(12,2)  not null check (amount > 0),
  advance_date  date           not null,
  reason        text,
  status        advance_status not null default 'pending',
  deducted_in   uuid           references settlements(id),
  registered_by uuid           not null references auth.users(id),
  created_at    timestamptz    not null default now()
);

-- ============================================================
-- EXPENSES
-- ============================================================
create table if not exists expenses (
  id            uuid          primary key default gen_random_uuid(),
  branch_id     uuid          not null references branches(id),
  week_id       uuid          references weeks(id),
  concept       text          not null,
  expense_date  date          not null,
  amount        numeric(12,2) not null check (amount > 0),
  category      text,
  paid_by       uuid          references auth.users(id),
  notes         text,
  registered_by uuid          not null references auth.users(id),
  created_at    timestamptz   not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_profiles_branch        on profiles(branch_id);
create index if not exists idx_service_catalog_branch on service_catalog(branch_id);
create index if not exists idx_weeks_branch_status    on weeks(branch_id, status);
create index if not exists idx_transactions_week      on transactions(week_id);
create index if not exists idx_transactions_barber    on transactions(barber_id);
create index if not exists idx_transactions_date      on transactions(transaction_date);
create index if not exists idx_settlements_week       on settlements(week_id);
create index if not exists idx_settlements_barber     on settlements(barber_id);
create index if not exists idx_advances_barber        on advances(barber_id);
create index if not exists idx_advances_branch_status on advances(branch_id, status);
create index if not exists idx_expenses_branch        on expenses(branch_id);
create index if not exists idx_expenses_week          on expenses(week_id);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_transactions_updated_at on transactions;
create trigger trg_transactions_updated_at
  before update on transactions
  for each row execute function set_updated_at();

drop trigger if exists trg_settlements_updated_at on settlements;
create trigger trg_settlements_updated_at
  before update on settlements
  for each row execute function set_updated_at();

-- ============================================================
-- HELPER FUNCTIONS (SECURITY DEFINER para evitar recursión RLS)
-- ============================================================
create or replace function current_user_role()
returns user_role language sql security definer stable as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function current_user_branch()
returns uuid language sql security definer stable as $$
  select branch_id from profiles where id = auth.uid()
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table branches        enable row level security;
alter table profiles        enable row level security;
alter table service_catalog enable row level security;
alter table weeks           enable row level security;
alter table transactions    enable row level security;
alter table settlements     enable row level security;
alter table advances        enable row level security;
alter table expenses        enable row level security;

-- branches
drop policy if exists "branches_read"         on branches;
drop policy if exists "branches_admin_write"  on branches;
create policy "branches_read"        on branches for select to authenticated using (true);
create policy "branches_admin_write" on branches for all    to authenticated
  using      (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

-- profiles
drop policy if exists "profiles_read_own"       on profiles;
drop policy if exists "profiles_read_branch"    on profiles;
drop policy if exists "profiles_update_own"     on profiles;
drop policy if exists "profiles_admin_update"   on profiles;
create policy "profiles_read_own"     on profiles for select to authenticated using (id = auth.uid());
create policy "profiles_read_branch"  on profiles for select to authenticated
  using (current_user_role() = 'admin' and branch_id = current_user_branch());
create policy "profiles_update_own"   on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_admin_update" on profiles for update to authenticated
  using      (current_user_role() = 'admin' and branch_id = current_user_branch())
  with check (current_user_role() = 'admin' and branch_id = current_user_branch());

-- service_catalog
drop policy if exists "service_catalog_read"         on service_catalog;
drop policy if exists "service_catalog_admin_write"  on service_catalog;
create policy "service_catalog_read"        on service_catalog for select to authenticated using (true);
create policy "service_catalog_admin_write" on service_catalog for all    to authenticated
  using      (current_user_role() = 'admin' and branch_id = current_user_branch())
  with check (current_user_role() = 'admin' and branch_id = current_user_branch());

-- weeks
drop policy if exists "weeks_read"         on weeks;
drop policy if exists "weeks_admin_write"  on weeks;
create policy "weeks_read"        on weeks for select to authenticated
  using (branch_id = current_user_branch());
create policy "weeks_admin_write" on weeks for all    to authenticated
  using      (current_user_role() = 'admin' and branch_id = current_user_branch())
  with check (current_user_role() = 'admin' and branch_id = current_user_branch());

-- transactions
drop policy if exists "transactions_barber_read"    on transactions;
drop policy if exists "transactions_admin_read"     on transactions;
drop policy if exists "transactions_barber_insert"  on transactions;
drop policy if exists "transactions_admin_update"   on transactions;
create policy "transactions_barber_read"   on transactions for select to authenticated using (barber_id = auth.uid());
create policy "transactions_admin_read"    on transactions for select to authenticated
  using (current_user_role() = 'admin' and branch_id = current_user_branch());
create policy "transactions_barber_insert" on transactions for insert to authenticated
  with check (barber_id = auth.uid());
create policy "transactions_admin_update"  on transactions for update to authenticated
  using      (current_user_role() = 'admin' and branch_id = current_user_branch())
  with check (current_user_role() = 'admin' and branch_id = current_user_branch());

-- settlements
drop policy if exists "settlements_barber_read"   on settlements;
drop policy if exists "settlements_admin_read"    on settlements;
drop policy if exists "settlements_admin_update"  on settlements;
create policy "settlements_barber_read"  on settlements for select to authenticated using (barber_id = auth.uid());
create policy "settlements_admin_read"   on settlements for select to authenticated
  using (current_user_role() = 'admin' and branch_id = current_user_branch());
create policy "settlements_admin_update" on settlements for update to authenticated
  using      (current_user_role() = 'admin' and branch_id = current_user_branch())
  with check (current_user_role() = 'admin' and branch_id = current_user_branch());

-- advances
drop policy if exists "advances_barber_read"  on advances;
drop policy if exists "advances_admin_all"    on advances;
create policy "advances_barber_read" on advances for select to authenticated using (barber_id = auth.uid());
create policy "advances_admin_all"   on advances for all    to authenticated
  using      (current_user_role() = 'admin' and branch_id = current_user_branch())
  with check (current_user_role() = 'admin' and branch_id = current_user_branch());

-- expenses
drop policy if exists "expenses_admin_all" on expenses;
create policy "expenses_admin_all" on expenses for all to authenticated
  using      (current_user_role() = 'admin' and branch_id = current_user_branch())
  with check (current_user_role() = 'admin' and branch_id = current_user_branch());

-- ============================================================
-- CALCULATE_SETTLEMENT RPC
-- ============================================================
create or replace function calculate_settlement(p_week_id uuid, p_barber_id uuid)
returns uuid language plpgsql security definer as $$
declare
  v_barber            profiles%rowtype;
  v_existing          settlements%rowtype;
  v_settlement_id     uuid;
  v_total_cuts        integer;
  v_gross_amount      numeric;
  v_barber_gross      numeric;
  v_already_collected numeric;
  v_cash_amount       numeric;
  v_transfer_amount   numeric;
  v_card_amount       numeric;
  v_bonus_presentismo numeric := 0;
  v_bonus_objetivo    numeric := 0;
  v_total_earned      numeric;
  v_advances_deducted numeric;
  v_total_deductions  numeric;
  v_net_payable       numeric;
  v_objetivo_met      boolean := false;
  v_presentismo_met   boolean;
begin
  select * into v_barber from profiles where id = p_barber_id;
  if not found then
    raise exception 'Barbero % no encontrado', p_barber_id;
  end if;

  -- Preservar presentismo_met si ya fue seteado manualmente
  select presentismo_met into v_presentismo_met
  from settlements
  where week_id = p_week_id and barber_id = p_barber_id;

  -- Agregar transacciones
  select
    coalesce(count(*), 0),
    coalesce(sum(amount), 0),
    coalesce(sum(barber_share), 0),
    coalesce(sum(barber_already_collected), 0),
    coalesce(sum(case when payment_method = 'cash'     then amount else 0 end), 0),
    coalesce(sum(case when payment_method = 'transfer' then amount else 0 end), 0),
    coalesce(sum(case when payment_method = 'card'     then amount else 0 end), 0)
  into
    v_total_cuts, v_gross_amount, v_barber_gross, v_already_collected,
    v_cash_amount, v_transfer_amount, v_card_amount
  from transactions
  where week_id = p_week_id and barber_id = p_barber_id;

  -- Calcular según modelo de compensación
  if v_barber.compensation_type = 'salary' then
    v_barber_gross := coalesce(v_barber.base_salary_rate, 0);
    v_objetivo_met := v_total_cuts >= coalesce(v_barber.objetivo_min_cuts, 2147483647);
    if coalesce(v_presentismo_met, false) then
      v_bonus_presentismo := coalesce(v_barber.presentismo_rate, 0);
    end if;
    if v_objetivo_met then
      v_bonus_objetivo := coalesce(v_barber.objetivo_rate, 0);
    end if;
  elsif v_barber.compensation_type = 'box_rental' then
    v_barber_gross := 0;
  end if;

  v_total_earned     := v_barber_gross + v_bonus_presentismo + v_bonus_objetivo;

  select coalesce(sum(amount), 0) into v_advances_deducted
  from advances
  where barber_id = p_barber_id and branch_id = v_barber.branch_id and status = 'pending';

  v_total_deductions := v_already_collected + v_advances_deducted;
  v_net_payable      := v_total_earned - v_total_deductions;

  insert into settlements (
    week_id, barber_id, branch_id,
    total_cuts, gross_amount, barber_gross,
    bonus_presentismo, bonus_objetivo, total_earned,
    already_collected, advances_deducted, total_deductions, net_payable,
    cash_amount, transfer_amount, card_amount,
    base_salary_rate_snap, presentismo_rate_snap, objetivo_rate_snap, objetivo_min_cuts_snap,
    objetivo_met, presentismo_met, status, updated_at
  ) values (
    p_week_id, p_barber_id, v_barber.branch_id,
    v_total_cuts, v_gross_amount, v_barber_gross,
    v_bonus_presentismo, v_bonus_objetivo, v_total_earned,
    v_already_collected, v_advances_deducted, v_total_deductions, v_net_payable,
    v_cash_amount, v_transfer_amount, v_card_amount,
    v_barber.base_salary_rate, v_barber.presentismo_rate,
    v_barber.objetivo_rate, v_barber.objetivo_min_cuts,
    v_objetivo_met, v_presentismo_met, 'draft', now()
  )
  on conflict (week_id, barber_id) do update set
    total_cuts             = excluded.total_cuts,
    gross_amount           = excluded.gross_amount,
    barber_gross           = excluded.barber_gross,
    bonus_presentismo      = excluded.bonus_presentismo,
    bonus_objetivo         = excluded.bonus_objetivo,
    total_earned           = excluded.total_earned,
    already_collected      = excluded.already_collected,
    advances_deducted      = excluded.advances_deducted,
    total_deductions       = excluded.total_deductions,
    net_payable            = excluded.net_payable,
    cash_amount            = excluded.cash_amount,
    transfer_amount        = excluded.transfer_amount,
    card_amount            = excluded.card_amount,
    base_salary_rate_snap  = excluded.base_salary_rate_snap,
    presentismo_rate_snap  = excluded.presentismo_rate_snap,
    objetivo_rate_snap     = excluded.objetivo_rate_snap,
    objetivo_min_cuts_snap = excluded.objetivo_min_cuts_snap,
    objetivo_met           = excluded.objetivo_met,
    presentismo_met        = coalesce(settlements.presentismo_met, excluded.presentismo_met),
    updated_at             = now()
  returning id into v_settlement_id;

  return v_settlement_id;
end;
$$;

-- ============================================================
-- SEED: sucursal por defecto (solo si no existe ninguna)
-- ============================================================
insert into branches (name, address)
select 'Valhalla — Central', 'Dirección principal'
where not exists (select 1 from branches);
