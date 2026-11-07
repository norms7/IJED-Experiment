-- Keep every subject explicitly enrolled for the current student available
-- to the existing semester filter. Module and activity queries remain scoped
-- to the student's active section.

create or replace function public.get_student_active_subjects()
returns table (
  subject_id integer,
  subject_name text,
  semester text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct subject.id, subject.name::text, subject.semester::text
  from public.student_subject_enrollments enrollment
  join public.subjects subject on subject.id = enrollment.subject_id
  where enrollment.student_id = public.auth_student_id();
$$;

revoke all on function public.get_student_active_subjects() from public, anon;
grant execute on function public.get_student_active_subjects() to authenticated;

notify pgrst, 'reload schema';
