-- Break the activities -> activity_submissions -> activities RLS cycle.
-- SECURITY DEFINER keeps these checks inside the function owner's policy
-- context instead of recursively evaluating the submissions policy.

create or replace function public.student_has_activity_submission(p_activity_id integer)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.activity_submissions submission
    where submission.activity_id = p_activity_id
      and submission.student_id = public.auth_student_id()
  );
$$;

revoke all on function public.student_has_activity_submission(integer) from public, anon;
grant execute on function public.student_has_activity_submission(integer) to authenticated;

create or replace function public.student_has_module_submission(p_module_id integer)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.activities activity
    join public.activity_submissions submission
      on submission.activity_id = activity.id
     and submission.student_id = public.auth_student_id()
    where activity.module_id = p_module_id
  );
$$;

revoke all on function public.student_has_module_submission(integer) from public, anon;
grant execute on function public.student_has_module_submission(integer) to authenticated;

drop policy if exists modules_select on public.modules;
create policy modules_select on public.modules for select
  using (
    public.is_admin()
    or teacher_id = public.auth_teacher_id()
    or (
      public.auth_role() = 'student'
      and public.student_can_access_module(id)
      and (
        is_published
        or public.student_has_module_submission(modules.id)
      )
    )
  );

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select
  using (
    public.is_admin()
    or teacher_id = public.auth_teacher_id()
    or (
      public.auth_role() = 'student'
      and public.student_can_access_module(module_id)
      and (
        is_published
        or public.student_has_activity_submission(activities.id)
      )
    )
  );

notify pgrst, 'reload schema';
