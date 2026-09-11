-- Add missing term column needed by the teacher activity form
-- This fixes inserts like: activities.insert({ ..., term: '1st', ... })

alter table public.activities
  add column if not exists term varchar(20);

create index if not exists ix_activities_term
  on public.activities (term);
