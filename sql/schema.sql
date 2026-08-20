-- ============================================================================
-- UJI — schema.sql
-- Jalankan ini di Supabase SQL Editor (Project > SQL Editor > New query)
-- ============================================================================

create table if not exists public.experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  hypothesis text,
  test_type text not null check (test_type in ('proportion', 'continuous', 'chisquare', 'anova', 'mannwhitney', 'bayesian')),
  input jsonb not null,       -- raw inputs used (counts, or summary stats)
  result jsonb not null,      -- computed output (p-value, ci, significant, dst.)
  created_at timestamptz not null default now()
);

alter table public.experiments enable row level security;

-- users can only ever see, insert, update, delete their OWN experiments
create policy "select own experiments"
  on public.experiments for select
  using (auth.uid() = user_id);

create policy "insert own experiments"
  on public.experiments for insert
  with check (auth.uid() = user_id);

create policy "update own experiments"
  on public.experiments for update
  using (auth.uid() = user_id);

create policy "delete own experiments"
  on public.experiments for delete
  using (auth.uid() = user_id);

create index if not exists experiments_user_id_idx on public.experiments(user_id);
create index if not exists experiments_created_at_idx on public.experiments(created_at desc);
