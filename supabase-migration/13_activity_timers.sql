begin;

alter table public.activities
  add column if not exists timer_minutes integer
    check (timer_minutes between 1 and 1440);

commit;
