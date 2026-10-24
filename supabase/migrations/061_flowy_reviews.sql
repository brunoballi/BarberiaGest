-- ============================================================
-- 061: RESEÑAS PARA FLOWY — popup al admin (una por cliente) y a cada
-- barbero (una por barbero), con envío a la web de Flowy.
-- ============================================================
-- Modelo:
--  - "El cliente" es esta instalación completa (puede tener varias
--    sucursales). Alcanza con que CUALQUIER admin haga una reseña
--    kind='admin' para dejar de pedirla en todo el sistema.
--  - Cada barbero (o admin con is_barber) deja como máximo UNA reseña
--    kind='barber' (índice único por submitted_by). Si todavía no la
--    hizo y tocó "ahora no", se guarda un snoozed_until en
--    flowy_review_prompts para reintentar más adelante.
--  - El envío real a la web de Flowy es un webhook externo (todavía sin
--    URL definida). La fila se guarda SIEMPRE en esta tabla al
--    instante; sync_status indica si además se pudo mandar. Si el
--    webhook no está configurado o falla, queda 'pending'/'failed' y
--    se puede reintentar después desde /admin/resenas sin perder nada.
-- ============================================================

do $$ begin
  create type flowy_review_kind as enum ('admin', 'barber');
exception when duplicate_object then null; end $$;

do $$ begin
  create type flowy_review_sync_status as enum ('pending', 'sent', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists flowy_reviews (
  id            uuid                      primary key default gen_random_uuid(),
  branch_id     uuid                      not null references branches(id) on delete cascade,
  kind          flowy_review_kind         not null,
  submitted_by  uuid                      references profiles(id) on delete set null,
  reviewer_name text                      not null,
  rating        smallint                  not null check (rating between 1 and 5),
  comment       text,
  photo_url     text,
  sync_status   flowy_review_sync_status  not null default 'pending',
  sync_error    text,
  sent_at       timestamptz,
  created_at    timestamptz               not null default now()
);

create index if not exists idx_flowy_reviews_branch       on flowy_reviews(branch_id, kind);
create index if not exists idx_flowy_reviews_submitted_by on flowy_reviews(submitted_by);
create index if not exists idx_flowy_reviews_sync_status  on flowy_reviews(sync_status) where sync_status <> 'sent';

-- Un barbero deja una sola reseña "de barbero": la que ya mandó no se repite.
-- (No aplica a kind='admin': ahí puede haber una por sucursal/corte a futuro.)
create unique index if not exists flowy_reviews_one_per_barber
  on flowy_reviews (submitted_by) where kind = 'barber';

alter table flowy_reviews enable row level security;
-- ENDURECIDO (2026-10-19): anon no toca estas tablas (antes solo lo frenaba la RLS).
revoke all on flowy_reviews from anon;

-- Admins: ven y administran todas (no se acota por sucursal, igual que el
-- resto de las tablas de alcance "todo el negocio" en este sistema).
drop policy if exists "flowy_reviews_admin_all" on flowy_reviews;
create policy "flowy_reviews_admin_all" on flowy_reviews for all to authenticated
  using ((select auth_role()) = 'admin'::user_role)
  with check ((select auth_role()) = 'admin'::user_role);

-- Barberos: pueden crear y leer únicamente su propia reseña.
drop policy if exists "flowy_reviews_barber_insert" on flowy_reviews;
-- ENDURECIDO (2026-10-19): ademas de ser el autor, la fila tiene que ser una resena de BARBERO sin
-- estado de envio inventado. Sin esto, un barbero llamando directo a la API podia insertar
-- kind='admin' (que apaga el pedido para TODO el negocio) o dejarla marcada como 'sent'.
create policy "flowy_reviews_barber_insert" on flowy_reviews for insert to authenticated
  with check (
    submitted_by = (select auth.uid())
    and kind = 'barber'
    and sync_status = 'pending'
    and sent_at is null
    and sync_error is null
  );

drop policy if exists "flowy_reviews_barber_read_own" on flowy_reviews;
create policy "flowy_reviews_barber_read_own" on flowy_reviews for select to authenticated
  using (submitted_by = (select auth.uid()));

-- ============================================================
-- Snooze del popup de barbero ("Ahora no" -> reintentar más adelante)
-- ============================================================
create table if not exists flowy_review_prompts (
  profile_id    uuid        primary key references profiles(id) on delete cascade,
  snoozed_until timestamptz,
  updated_at    timestamptz not null default now()
);

alter table flowy_review_prompts enable row level security;
revoke all on flowy_review_prompts from anon;

drop policy if exists "flowy_review_prompts_self" on flowy_review_prompts;
create policy "flowy_review_prompts_self" on flowy_review_prompts for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists "flowy_review_prompts_admin_read" on flowy_review_prompts;
create policy "flowy_review_prompts_admin_read" on flowy_review_prompts for select to authenticated
  using ((select auth_role()) = 'admin'::user_role);

-- ============================================================
-- Storage: fotos de la reseña (negocio/persona). Bucket público de solo
-- lectura: la URL se manda tal cual en el payload a la web de Flowy.
-- ============================================================
-- ENDURECIDO (2026-10-19): tope de 10 MB y solo imagenes (el cliente no comprime las fotos del celular).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flowy-reviews', 'flowy-reviews', true, 10 * 1024 * 1024,
        array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "flowy_reviews_photo_insert" on storage.objects;
create policy "flowy_reviews_photo_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'flowy-reviews');

drop policy if exists "flowy_reviews_photo_read" on storage.objects;
create policy "flowy_reviews_photo_read" on storage.objects for select to authenticated, anon
  using (bucket_id = 'flowy-reviews');
