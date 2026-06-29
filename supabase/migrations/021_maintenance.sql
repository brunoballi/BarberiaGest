-- ============================================================
-- VALHALLA — Mantenimiento / Orden semanal (idempotente)
-- Planilla semanal por barbero: zona + tareas (N° + descripción) con check
-- SÍ/NO y resultado APROBADO/NO APROBADO según % mínimo configurable.
-- Se puede ejecutar múltiples veces sin error.
-- ============================================================

-- ============================================================
-- SETTINGS por sucursal (default de aprobación)
-- ============================================================
create table if not exists maintenance_settings (
  branch_id        uuid        primary key references branches(id) on delete cascade,
  min_approval_pct integer     not null default 100,
  updated_at       timestamptz not null default now()
);

-- ============================================================
-- PLANTILLA — un bloque por barbero (zona) + sus tareas
-- ============================================================
create table if not exists maintenance_template_blocks (
  id         uuid        primary key default gen_random_uuid(),
  branch_id  uuid        not null references branches(id) on delete cascade,
  barber_id  uuid        not null references profiles(id) on delete cascade,
  zone_label text        not null default '',
  sort_order integer     not null default 0,
  created_at timestamptz not null default now(),
  unique (branch_id, barber_id)
);

create table if not exists maintenance_template_tasks (
  id          uuid        primary key default gen_random_uuid(),
  branch_id   uuid        not null references branches(id) on delete cascade,
  block_id    uuid        not null references maintenance_template_blocks(id) on delete cascade,
  item_number integer     not null default 1,
  description text        not null,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- PLANILLA SEMANAL — instancia atada a una semana (snapshot)
-- ============================================================
create table if not exists maintenance_sheets (
  id               uuid        primary key default gen_random_uuid(),
  branch_id        uuid        not null references branches(id) on delete cascade,
  week_id          uuid        not null references weeks(id) on delete cascade,
  min_approval_pct integer     not null default 100,
  created_by       uuid        references profiles(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (branch_id, week_id)
);

create table if not exists maintenance_sheet_items (
  id          uuid        primary key default gen_random_uuid(),
  branch_id   uuid        not null references branches(id) on delete cascade,
  sheet_id    uuid        not null references maintenance_sheets(id) on delete cascade,
  barber_id   uuid        not null references profiles(id) on delete cascade,
  zone_label  text        not null default '',
  item_number integer     not null default 1,
  description text        not null,
  done        boolean     not null default false,
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);

-- Índices de apoyo
create index if not exists idx_maint_template_tasks_block on maintenance_template_tasks(block_id);
create index if not exists idx_maint_sheet_items_sheet    on maintenance_sheet_items(sheet_id);
create index if not exists idx_maint_sheets_branch_week   on maintenance_sheets(branch_id, week_id);

-- ============================================================
-- ROW LEVEL SECURITY (espeja el patrón del schema base)
-- read: cualquier autenticado de la sucursal · write: admin de la sucursal
-- ============================================================
alter table maintenance_settings        enable row level security;
alter table maintenance_template_blocks  enable row level security;
alter table maintenance_template_tasks   enable row level security;
alter table maintenance_sheets           enable row level security;
alter table maintenance_sheet_items      enable row level security;

-- maintenance_settings
drop policy if exists "maint_settings_read"        on maintenance_settings;
drop policy if exists "maint_settings_admin_write" on maintenance_settings;
create policy "maint_settings_read"        on maintenance_settings for select to authenticated
  using (current_admin_has_branch(branch_id) or branch_id = current_user_branch());
create policy "maint_settings_admin_write" on maintenance_settings for all to authenticated
  using      (current_user_role() = 'admin' and current_admin_has_branch(branch_id))
  with check (current_user_role() = 'admin' and current_admin_has_branch(branch_id));

-- maintenance_template_blocks
drop policy if exists "maint_tpl_blocks_read"        on maintenance_template_blocks;
drop policy if exists "maint_tpl_blocks_admin_write" on maintenance_template_blocks;
create policy "maint_tpl_blocks_read"        on maintenance_template_blocks for select to authenticated
  using (current_admin_has_branch(branch_id) or branch_id = current_user_branch());
create policy "maint_tpl_blocks_admin_write" on maintenance_template_blocks for all to authenticated
  using      (current_user_role() = 'admin' and current_admin_has_branch(branch_id))
  with check (current_user_role() = 'admin' and current_admin_has_branch(branch_id));

-- maintenance_template_tasks
drop policy if exists "maint_tpl_tasks_read"        on maintenance_template_tasks;
drop policy if exists "maint_tpl_tasks_admin_write" on maintenance_template_tasks;
create policy "maint_tpl_tasks_read"        on maintenance_template_tasks for select to authenticated
  using (current_admin_has_branch(branch_id) or branch_id = current_user_branch());
create policy "maint_tpl_tasks_admin_write" on maintenance_template_tasks for all to authenticated
  using      (current_user_role() = 'admin' and current_admin_has_branch(branch_id))
  with check (current_user_role() = 'admin' and current_admin_has_branch(branch_id));

-- maintenance_sheets
drop policy if exists "maint_sheets_read"        on maintenance_sheets;
drop policy if exists "maint_sheets_admin_write" on maintenance_sheets;
create policy "maint_sheets_read"        on maintenance_sheets for select to authenticated
  using (current_admin_has_branch(branch_id) or branch_id = current_user_branch());
create policy "maint_sheets_admin_write" on maintenance_sheets for all to authenticated
  using      (current_user_role() = 'admin' and current_admin_has_branch(branch_id))
  with check (current_user_role() = 'admin' and current_admin_has_branch(branch_id));

-- maintenance_sheet_items
drop policy if exists "maint_sheet_items_read"        on maintenance_sheet_items;
drop policy if exists "maint_sheet_items_admin_write" on maintenance_sheet_items;
create policy "maint_sheet_items_read"        on maintenance_sheet_items for select to authenticated
  using (current_admin_has_branch(branch_id) or branch_id = current_user_branch());
create policy "maint_sheet_items_admin_write" on maintenance_sheet_items for all to authenticated
  using      (current_user_role() = 'admin' and current_admin_has_branch(branch_id))
  with check (current_user_role() = 'admin' and current_admin_has_branch(branch_id));
