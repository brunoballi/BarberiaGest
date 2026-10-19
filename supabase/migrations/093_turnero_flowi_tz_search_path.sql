-- 093 - Aplicada a Valhalla el 2026-10-19. flowi_tz() sin search_path fijo (aviso del linter de Supabase).
-- En una base nueva ya viene con search_path desde la 069.
alter function public.flowi_tz() set search_path to 'public';
