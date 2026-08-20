alter table public.experiments drop constraint if exists experiments_test_type_check;

alter table public.experiments add constraint experiments_test_type_check
  check (test_type in ('proportion', 'continuous', 'chisquare', 'anova', 'mannwhitney', 'bayesian'));
