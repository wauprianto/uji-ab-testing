-- ============================================================================
-- UJI — migration_001_add_test_types.sql
-- Jalankan ini kalau kamu SUDAH pernah run schema.sql sebelumnya (project
-- Supabase yang sudah live). Ini nambah tipe test baru tanpa hapus data.
-- ============================================================================

alter table public.experiments drop constraint if exists experiments_test_type_check;

alter table public.experiments add constraint experiments_test_type_check
  check (test_type in ('proportion', 'continuous', 'chisquare', 'anova', 'mannwhitney', 'bayesian'));
