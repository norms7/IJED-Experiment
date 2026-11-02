-- Keep learning materials and their activities scoped to a specific section.
-- Apply after 11_audit_logs.sql.

alter table public.modules
  add column if not exists section_id integer references public.sections(id);

create index if not exists modules_section_subject_published_idx
  on public.modules (section_id, subject_id, is_published);

-- Backfill only modules that resolve to exactly one teacher assignment.
-- Ambiguous legacy content remains unassigned and is intentionally hidden
-- from students until a teacher re-creates it for the correct section.
with matched_modules as (
  select
    m.id as module_id,
    min(tca.section_id) as section_id,
    min(tca.class_id) as class_id
  from public.modules m
  join public.teacher_class_assignments tca
    on tca.subject_id = m.subject_id
   and tca.section_id is not null
   and (m.teacher_id is null or tca.teacher_id = m.teacher_id)
   and (m.class_id is null or tca.class_id = m.class_id)
  where m.section_id is null
  group by m.id
  having count(distinct tca.section_id) = 1
)
update public.modules m
set section_id = matched.section_id,
    class_id = coalesce(m.class_id, matched.class_id)
from matched_modules matched
where m.id = matched.module_id;

create or replace function public.student_can_access_module(p_module_id integer)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.modules m
    join public.student_subject_enrollments sse
      on sse.subject_id = m.subject_id
     and sse.student_id = public.auth_student_id()
    join public.student_section_assignments ssa
      on ssa.section_id = m.section_id
     and ssa.student_id = sse.student_id
    where m.id = p_module_id
      and m.section_id is not null
      and m.is_published = true
  );
$$;

revoke all on function public.student_can_access_module(integer) from public, anon;
grant execute on function public.student_can_access_module(integer) to authenticated;

drop policy if exists modules_select on public.modules;
create policy modules_select on public.modules for select
  using (
    public.is_admin()
    or teacher_id = public.auth_teacher_id()
    or (
      is_published
      and public.auth_role() = 'student'
      and public.student_can_access_module(id)
    )
  );

drop policy if exists modules_teacher_insert on public.modules;
create policy modules_teacher_insert on public.modules for insert
  with check (
    public.is_admin()
    or (
      teacher_id = public.auth_teacher_id()
      and section_id is not null
      and exists (
        select 1
        from public.teacher_class_assignments tca
        where tca.teacher_id = public.auth_teacher_id()
          and tca.section_id = modules.section_id
          and tca.class_id = modules.class_id
          and tca.subject_id = modules.subject_id
      )
    )
  );

drop policy if exists modules_teacher_update on public.modules;
create policy modules_teacher_update on public.modules for update
  using (public.is_admin() or teacher_id = public.auth_teacher_id())
  with check (
    public.is_admin()
    or (
      teacher_id = public.auth_teacher_id()
      and section_id is not null
      and exists (
        select 1
        from public.teacher_class_assignments tca
        where tca.teacher_id = public.auth_teacher_id()
          and tca.section_id = modules.section_id
          and tca.class_id = modules.class_id
          and tca.subject_id = modules.subject_id
      )
    )
  );

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select
  using (
    public.is_admin()
    or teacher_id = public.auth_teacher_id()
    or (
      is_published
      and public.auth_role() = 'student'
      and exists (
        select 1
        from public.modules m
        where m.id = activities.module_id
          and public.student_can_access_module(m.id)
      )
    )
  );

drop policy if exists activities_teacher_insert on public.activities;
create policy activities_teacher_insert on public.activities for insert
  with check (
    public.is_admin()
    or (
      teacher_id = public.auth_teacher_id()
      and exists (
        select 1
        from public.modules m
        where m.id = activities.module_id
          and m.teacher_id = public.auth_teacher_id()
          and m.subject_id = activities.subject_id
          and m.section_id is not null
      )
    )
  );

drop policy if exists activities_teacher_update on public.activities;
create policy activities_teacher_update on public.activities for update
  using (public.is_admin() or teacher_id = public.auth_teacher_id())
  with check (
    public.is_admin()
    or (
      teacher_id = public.auth_teacher_id()
      and exists (
        select 1
        from public.modules m
        where m.id = activities.module_id
          and m.teacher_id = public.auth_teacher_id()
          and m.subject_id = activities.subject_id
          and m.section_id is not null
      )
    )
  );

drop policy if exists questions_select on public.activity_questions;
create policy questions_select on public.activity_questions for select
  using (
    exists (
      select 1
      from public.activities a
      where a.id = activity_questions.activity_id
        and (
          public.is_admin()
          or a.teacher_id = public.auth_teacher_id()
          or (
            a.is_published
            and public.auth_role() = 'student'
            and public.student_can_access_module(a.module_id)
          )
        )
    )
  );

drop policy if exists choices_select on public.activity_question_choices;
create policy choices_select on public.activity_question_choices for select
  using (
    exists (
      select 1
      from public.activity_questions q
      join public.activities a on a.id = q.activity_id
      where q.id = activity_question_choices.question_id
        and (
          public.is_admin()
          or a.teacher_id = public.auth_teacher_id()
          or (
            a.is_published
            and public.auth_role() = 'student'
            and public.student_can_access_module(a.module_id)
          )
        )
    )
  );

create or replace view public.student_safe_questions
with (security_invoker = true)
as
select
  q.id,
  q.activity_id,
  q."order",
  q.question_text,
  q.question_type,
  q.points,
  case when exists (
    select 1
    from public.activity_submissions s
    where s.activity_id = q.activity_id
      and s.student_id = public.auth_student_id()
  ) then q.correct_answer else null end as correct_answer
from public.activity_questions q;

create or replace function public.enforce_student_content_section()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id integer := public.auth_student_id();
  v_module_id integer;
begin
  if v_student_id is null then
    return new;
  end if;

  if tg_table_name = 'student_module_reads' then
    if new.student_id <> v_student_id
       or not public.student_can_access_module(new.module_id) then
      raise exception 'This module is not assigned to your section.'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'activity_submissions' then
    if new.student_id <> v_student_id then
      raise exception 'You may only submit work for your own account.'
        using errcode = '42501';
    end if;
    select a.module_id into v_module_id
    from public.activities a
    where a.id = new.activity_id;
    if v_module_id is null or not public.student_can_access_module(v_module_id) then
      raise exception 'This activity is not assigned to your section.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists student_module_reads_section_guard on public.student_module_reads;
create trigger student_module_reads_section_guard
  before insert or update on public.student_module_reads
  for each row execute function public.enforce_student_content_section();

drop trigger if exists activity_submissions_section_guard on public.activity_submissions;
create trigger activity_submissions_section_guard
  before insert or update on public.activity_submissions
  for each row execute function public.enforce_student_content_section();

drop policy if exists activity_files_select on storage.objects;
create policy activity_files_select on storage.objects for select
  using (
    bucket_id = 'Activity-files'
    and (
      (
        (storage.foldername(name))[1] = 'activities'
        and exists (
          select 1
          from public.activities a
          where a.id::text = (storage.foldername(name))[2]
            and (
              public.is_admin()
              or a.teacher_id = public.auth_teacher_id()
              or (
                a.is_published
                and public.auth_role() = 'student'
                and public.student_can_access_module(a.module_id)
              )
            )
        )
      )
      or (
        (storage.foldername(name))[1] = 'submissions'
        and (storage.foldername(name))[3] is not null
        and exists (
          select 1
          from public.activities a
          where a.id::text = (storage.foldername(name))[2]
            and (
              public.is_admin()
              or a.teacher_id = public.auth_teacher_id()
              or (
                (storage.foldername(name))[3] = public.auth_student_id()::text
                and public.auth_role() = 'student'
                and public.student_can_access_module(a.module_id)
              )
            )
        )
      )
    )
  );

drop policy if exists activity_files_insert on storage.objects;
create policy activity_files_insert on storage.objects for insert
  with check (
    bucket_id = 'Activity-files'
    and (
      (
        (storage.foldername(name))[1] = 'activities'
        and exists (
          select 1
          from public.activities a
          where a.id::text = (storage.foldername(name))[2]
            and (
              public.is_admin()
              or a.teacher_id = public.auth_teacher_id()
            )
        )
      )
      or (
        (storage.foldername(name))[1] = 'submissions'
        and (storage.foldername(name))[3] = public.auth_student_id()::text
        and public.auth_role() = 'student'
        and exists (
          select 1
          from public.activities a
          where a.id::text = (storage.foldername(name))[2]
            and a.is_published
            and (a.start_date is null or now() >= a.start_date)
            and (
              a.due_date is null
              or now() <= a.due_date
              or a.allow_late_submission
            )
            and public.student_can_access_module(a.module_id)
            and not exists (
              select 1
              from public.activity_submissions s
              where s.activity_id = a.id
                and s.student_id = public.auth_student_id()
            )
        )
      )
    )
  );

drop policy if exists activity_files_delete on storage.objects;
create policy activity_files_delete on storage.objects for delete
  using (
    bucket_id = 'Activity-files'
    and (
      (
        (storage.foldername(name))[1] = 'activities'
        and exists (
          select 1
          from public.activities a
          where a.id::text = (storage.foldername(name))[2]
            and (
              public.is_admin()
              or a.teacher_id = public.auth_teacher_id()
            )
        )
      )
      or (
        (storage.foldername(name))[1] = 'submissions'
        and (storage.foldername(name))[3] = public.auth_student_id()::text
        and public.auth_role() = 'student'
        and exists (
          select 1
          from public.activities a
          where a.id::text = (storage.foldername(name))[2]
            and public.student_can_access_module(a.module_id)
        )
      )
    )
  );

create or replace function public.get_student_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id integer := public.auth_student_id();
  v_subject_count integer;
  v_module_ids integer[];
  v_activity_ids integer[];
  v_modules_read integer;
  v_activities_done integer;
  v_avg_score numeric;
begin
  if v_student_id is null then
    raise exception 'Not a student account' using errcode = '42501';
  end if;

  select count(distinct subject_id)
    into v_subject_count
  from public.student_subject_enrollments
  where student_id = v_student_id;

  select coalesce(array_agg(m.id), '{}')
    into v_module_ids
  from public.modules m
  join public.student_subject_enrollments sse
    on sse.student_id = v_student_id and sse.subject_id = m.subject_id
  join public.student_section_assignments ssa
    on ssa.student_id = v_student_id and ssa.section_id = m.section_id
  where m.is_published = true;

  select count(*)
    into v_modules_read
  from public.student_module_reads
  where student_id = v_student_id and module_id = any(v_module_ids);

  select coalesce(array_agg(a.id), '{}')
    into v_activity_ids
  from public.activities a
  where a.module_id = any(v_module_ids) and a.is_published = true;

  select count(*)
    into v_activities_done
  from public.activity_submissions
  where student_id = v_student_id and activity_id = any(v_activity_ids);

  select round(avg(score::numeric / max_score * 100), 1)
    into v_avg_score
  from public.activity_submissions
  where student_id = v_student_id
    and activity_id = any(v_activity_ids)
    and is_graded = true
    and score is not null
    and max_score > 0;

  return jsonb_build_object(
    'enrolled_subjects', v_subject_count,
    'modules', jsonb_build_object(
      'done', coalesce(v_modules_read, 0),
      'total', coalesce(cardinality(v_module_ids), 0)
    ),
    'activities', jsonb_build_object(
      'done', coalesce(v_activities_done, 0),
      'total', coalesce(cardinality(v_activity_ids), 0)
    ),
    'average_score', coalesce(v_avg_score, 0.0)
  );
end;
$$;

revoke all on function public.get_student_dashboard_stats() from public, anon;
grant execute on function public.get_student_dashboard_stats() to authenticated;
