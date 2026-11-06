-- Separate a student's current section/semester from transferred academic history.

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
  from public.student_section_assignments section_assignment
  join public.teacher_class_assignments teacher_assignment
    on teacher_assignment.section_id = section_assignment.section_id
  join public.subjects subject on subject.id = teacher_assignment.subject_id
  join public.student_subject_enrollments enrollment
    on enrollment.student_id = section_assignment.student_id
   and enrollment.subject_id = subject.id
  where section_assignment.student_id = public.auth_student_id();
$$;

revoke all on function public.get_student_active_subjects() from public, anon;
grant execute on function public.get_student_active_subjects() to authenticated;

drop function if exists public.get_student_dashboard_stats();
create or replace function public.get_student_dashboard_stats(p_semester text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id integer := public.auth_student_id();
  v_semester text;
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

  v_semester := case lower(trim(coalesce(p_semester, '')))
    when '1' then '1st'
    when '1st' then '1st'
    when 'first' then '1st'
    when '1st semester' then '1st'
    when 'first semester' then '1st'
    when 'semester 1' then '1st'
    when '2' then '2nd'
    when '2nd' then '2nd'
    when 'second' then '2nd'
    when '2nd semester' then '2nd'
    when 'second semester' then '2nd'
    when 'semester 2' then '2nd'
    else null
  end;
  if v_semester is null then
    select case lower(trim(coalesce(current_semester, '')))
      when '2' then '2nd'
      when '2nd' then '2nd'
      when 'second' then '2nd'
      when '2nd semester' then '2nd'
      when 'second semester' then '2nd'
      when 'semester 2' then '2nd'
      else '1st'
    end
    into v_semester
    from public.students
    where id = v_student_id;
  end if;

  select count(distinct active.subject_id)
    into v_subject_count
    from public.get_student_active_subjects() active
    where case lower(trim(coalesce(active.semester, '')))
      when '1' then '1st'
      when '1st' then '1st'
      when 'first' then '1st'
      when '1st semester' then '1st'
      when 'first semester' then '1st'
      when 'semester 1' then '1st'
      when '2' then '2nd'
      when '2nd' then '2nd'
      when 'second' then '2nd'
      when '2nd semester' then '2nd'
      when 'second semester' then '2nd'
      when 'semester 2' then '2nd'
      else case when nullif(trim(coalesce(active.semester, '')), '') is null then '1st' end
    end = v_semester;

  select coalesce(array_agg(distinct module.id), '{}')
    into v_module_ids
    from public.modules module
    join public.student_section_assignments section_assignment
      on section_assignment.student_id = v_student_id
     and section_assignment.section_id = module.section_id
    join public.get_student_active_subjects() active
      on active.subject_id = module.subject_id
    where module.is_published = true
      and case lower(trim(coalesce(active.semester, '')))
        when '1' then '1st'
        when '1st' then '1st'
        when 'first' then '1st'
        when '1st semester' then '1st'
        when 'first semester' then '1st'
        when 'semester 1' then '1st'
        when '2' then '2nd'
        when '2nd' then '2nd'
        when 'second' then '2nd'
        when '2nd semester' then '2nd'
        when 'second semester' then '2nd'
        when 'semester 2' then '2nd'
        else case when nullif(trim(coalesce(active.semester, '')), '') is null then '1st' end
      end = v_semester;

  select count(*) into v_modules_read
    from public.student_module_reads
    where student_id = v_student_id and module_id = any(v_module_ids);

  select coalesce(array_agg(activity.id), '{}')
    into v_activity_ids
    from public.activities activity
    where activity.module_id = any(v_module_ids)
      and activity.is_published = true;

  select count(*) into v_activities_done
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
    'enrolled_subjects', coalesce(v_subject_count, 0),
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

revoke all on function public.get_student_dashboard_stats(text) from public, anon;
grant execute on function public.get_student_dashboard_stats(text) to authenticated;

create or replace function public.student_can_submit_module(p_module_id integer)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.modules module
    join public.student_subject_enrollments enrollment
      on enrollment.subject_id = module.subject_id
     and enrollment.student_id = public.auth_student_id()
    join public.student_section_assignments assignment
      on assignment.student_id = enrollment.student_id
     and assignment.section_id = module.section_id
    where module.id = p_module_id
      and module.section_id is not null
      and module.is_published = true
  );
$$;

revoke all on function public.student_can_submit_module(integer) from public, anon;
grant execute on function public.student_can_submit_module(integer) to authenticated;

create or replace function public.student_can_access_module(p_module_id integer)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.modules module
    join public.student_subject_enrollments enrollment
      on enrollment.subject_id = module.subject_id
     and enrollment.student_id = public.auth_student_id()
    where module.id = p_module_id
      and module.section_id is not null
      and (
        exists (
          select 1
          from public.student_section_assignments assignment
          where assignment.student_id = enrollment.student_id
            and assignment.section_id = module.section_id
        )
        or exists (
          select 1
          from public.audit_logs transfer
          where transfer.action = 'TRANSFER'
            and transfer.table_name = 'student_section_assignments'
            and transfer.record_id = enrollment.student_id::text
            and transfer.metadata ->> 'source' = 'transfer_students_to_section_with_semester'
            and transfer.changed_fields #>> '{section_id,old}' = module.section_id::text
        )
      )
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
      public.auth_role() = 'student'
      and public.student_can_access_module(id)
      and (
        is_published
        or exists (
          select 1
          from public.activities activity
          join public.activity_submissions submission
            on submission.activity_id = activity.id
          where activity.module_id = modules.id
            and submission.student_id = public.auth_student_id()
        )
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
        or exists (
          select 1
          from public.activity_submissions submission
          where submission.activity_id = activities.id
            and submission.student_id = public.auth_student_id()
        )
      )
    )
  );

drop policy if exists questions_select on public.activity_questions;
create policy questions_select on public.activity_questions for select
  using (
    exists (
      select 1
      from public.activities activity
      where activity.id = activity_questions.activity_id
        and (
          public.is_admin()
          or activity.teacher_id = public.auth_teacher_id()
          or (
            public.auth_role() = 'student'
            and public.student_can_access_module(activity.module_id)
            and (
              activity.is_published
              or exists (
                select 1
                from public.activity_submissions submission
                where submission.activity_id = activity.id
                  and submission.student_id = public.auth_student_id()
              )
            )
          )
        )
    )
  );

drop policy if exists choices_select on public.activity_question_choices;
create policy choices_select on public.activity_question_choices for select
  using (
    exists (
      select 1
      from public.activity_questions question
      join public.activities activity on activity.id = question.activity_id
      where question.id = activity_question_choices.question_id
        and (
          public.is_admin()
          or activity.teacher_id = public.auth_teacher_id()
          or (
            public.auth_role() = 'student'
            and public.student_can_access_module(activity.module_id)
            and (
              activity.is_published
              or exists (
                select 1
                from public.activity_submissions submission
                where submission.activity_id = activity.id
                  and submission.student_id = public.auth_student_id()
              )
            )
          )
        )
    )
  );

drop policy if exists activity_files_select on storage.objects;
create policy activity_files_select on storage.objects for select
  using (
    bucket_id = 'Activity-files'
    and (
      (
        (storage.foldername(name))[1] = 'activities'
        and exists (
          select 1
          from public.activities activity
          where activity.id::text = (storage.foldername(name))[2]
            and (
              public.is_admin()
              or activity.teacher_id = public.auth_teacher_id()
              or (
                public.auth_role() = 'student'
                and public.student_can_access_module(activity.module_id)
                and (
                  activity.is_published
                  or exists (
                    select 1
                    from public.activity_submissions submission
                    where submission.activity_id = activity.id
                      and submission.student_id = public.auth_student_id()
                  )
                )
              )
            )
        )
      )
      or (
        (storage.foldername(name))[1] = 'submissions'
        and (storage.foldername(name))[3] is not null
        and exists (
          select 1
          from public.activities activity
          where activity.id::text = (storage.foldername(name))[2]
            and (
              public.is_admin()
              or activity.teacher_id = public.auth_teacher_id()
              or (
                (storage.foldername(name))[3] = public.auth_student_id()::text
                and public.auth_role() = 'student'
                and public.student_can_access_module(activity.module_id)
              )
            )
        )
      )
    )
  );

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
       or not public.student_can_submit_module(new.module_id) then
      raise exception 'This module is archived and read-only, or is not assigned to your section.'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'activity_submissions' then
    if new.student_id <> v_student_id then
      raise exception 'You may only submit work for your own account.'
        using errcode = '42501';
    end if;
    select activity.module_id into v_module_id
      from public.activities activity
      where activity.id = new.activity_id;
    if v_module_id is null or not public.student_can_submit_module(v_module_id) then
      raise exception 'This activity is archived and read-only, or is not assigned to your section.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.get_student_archive_context()
returns table (
  section_id integer,
  section_name text,
  class_name text,
  subject_id integer,
  subject_name text,
  semester text,
  archived_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    section.id,
    section.name::text,
    class.name::text,
    subject.id,
    subject.name::text,
    subject.semester::text,
    max(transfer.created_at)
  from public.audit_logs transfer
  join public.sections section
    on section.id =
      case
        when transfer.changed_fields #>> '{section_id,old}' ~ '^[0-9]+$'
          then (transfer.changed_fields #>> '{section_id,old}')::integer
      end
  join public.classes class on class.id = section.class_id
  join public.teacher_class_assignments assignment
    on assignment.section_id = section.id
  join public.subjects subject on subject.id = assignment.subject_id
  join public.student_subject_enrollments enrollment
    on enrollment.student_id = public.auth_student_id()
   and enrollment.subject_id = subject.id
  where transfer.action = 'TRANSFER'
    and transfer.table_name = 'student_section_assignments'
    and transfer.record_id = public.auth_student_id()::text
    and transfer.metadata ->> 'source' = 'transfer_students_to_section_with_semester'
  group by section.id, section.name, class.name, subject.id, subject.name,
    subject.semester;
$$;

revoke all on function public.get_student_archive_context() from public, anon;
grant execute on function public.get_student_archive_context() to authenticated;

create or replace function public.get_my_attendance_history(p_archived boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id integer := public.auth_student_id();
  v_current_semester text;
  v_last_transfer timestamptz;
  v_result jsonb;
begin
  if v_student_id is null then
    raise exception 'Student account required' using errcode = '42501';
  end if;

  select case lower(trim(current_semester))
      when '1' then '1st'
      when '1st' then '1st'
      when 'first' then '1st'
      when '1st semester' then '1st'
      when 'first semester' then '1st'
      when 'semester 1' then '1st'
      when '2' then '2nd'
      when '2nd' then '2nd'
      when 'second' then '2nd'
      when '2nd semester' then '2nd'
      when 'second semester' then '2nd'
      when 'semester 2' then '2nd'
      else null
    end
    into v_current_semester
    from public.students
    where id = v_student_id;

  if v_current_semester is null then
    select case lower(trim(coalesce(active.semester, '')))
        when '1' then '1st'
        when '1st' then '1st'
        when 'first' then '1st'
        when '1st semester' then '1st'
        when 'first semester' then '1st'
        when 'semester 1' then '1st'
        when '2' then '2nd'
        when '2nd' then '2nd'
        when 'second' then '2nd'
        when '2nd semester' then '2nd'
        when 'second semester' then '2nd'
        when 'semester 2' then '2nd'
      end
      into v_current_semester
      from public.get_student_active_subjects() active
      where lower(trim(coalesce(active.semester, ''))) in (
        '1', '1st', 'first', '1st semester', 'first semester', 'semester 1',
        '2', '2nd', 'second', '2nd semester', 'second semester', 'semester 2'
      )
      order by case lower(trim(coalesce(active.semester, '')))
        when '1' then 0
        when '1st' then 0
        when 'first' then 0
        when '1st semester' then 0
        when 'first semester' then 0
        when 'semester 1' then 0
        else 1
      end
      limit 1;
  end if;
  v_current_semester := coalesce(v_current_semester, '1st');

  select max(created_at)
    into v_last_transfer
    from public.audit_logs
    where action = 'TRANSFER'
      and table_name = 'student_section_assignments'
      and record_id = v_student_id::text
      and metadata ->> 'source' = 'transfer_students_to_section_with_semester';

  with attendance_rows as (
    select
      session.subject_id,
      coalesce(subject.name::text, 'General / Homeroom') as subject_name,
      session.class_id,
      class.name::text as class_name,
      coalesce(public.normalize_term(session.term), 'Unspecified') as term,
      lower(trim(record.status))::text as status
    from public.attendance_records record
    join public.attendance_sessions session on session.id = record.session_id
    join public.classes class on class.id = session.class_id
    left join public.subjects subject on subject.id = session.subject_id
    where record.student_id = v_student_id
      and session.has_class = true
      and (
        (p_archived and v_last_transfer is not null and session.created_at < v_last_transfer)
        or (
          not p_archived
          and (v_last_transfer is null or session.created_at >= v_last_transfer)
          and (
            subject.semester is null
            or case lower(trim(subject.semester::text))
              when '1' then '1st'
              when '1st' then '1st'
              when 'first' then '1st'
              when '1st semester' then '1st'
              when 'first semester' then '1st'
              when 'semester 1' then '1st'
              when '2' then '2nd'
              when '2nd' then '2nd'
              when 'second' then '2nd'
              when '2nd semester' then '2nd'
              when 'second semester' then '2nd'
              when 'semester 2' then '2nd'
              else null
            end = case
              when v_current_semester in ('1', '1st', 'first', '1st semester', 'first semester', 'semester 1') then '1st'
              when v_current_semester in ('2', '2nd', 'second', '2nd semester', 'second semester', 'semester 2') then '2nd'
              else null
            end
          )
        )
      )
  ),
  term_totals as (
    select
      subject_id,
      subject_name,
      class_id,
      class_name,
      term,
      count(*) filter (where status = 'present')::integer as present,
      count(*) filter (where status = 'absent')::integer as absent,
      count(*) filter (where status = 'late')::integer as late,
      count(*) filter (where status = 'excused')::integer as excused,
      count(*)::integer as total
    from attendance_rows
    group by subject_id, subject_name, class_id, class_name, term
  ),
  subject_totals as (
    select
      subject_id,
      subject_name,
      class_id,
      class_name,
      sum(present)::integer as present,
      sum(absent)::integer as absent,
      sum(late)::integer as late,
      sum(excused)::integer as excused,
      sum(total)::integer as total
    from term_totals
    group by subject_id, subject_name, class_id, class_name
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'subject_id', summary.subject_id,
        'subject_name', summary.subject_name,
        'class_name', summary.class_name,
        'terms', (
          select jsonb_agg(
            jsonb_build_object(
              'term', term.term,
              'present', term.present,
              'absent', term.absent,
              'late', term.late,
              'excused', term.excused,
              'total', term.total
            )
            order by term.term
          )
          from term_totals term
          where term.subject_id is not distinct from summary.subject_id
            and term.class_id = summary.class_id
        ),
        'totals', jsonb_build_object(
          'present', summary.present,
          'absent', summary.absent,
          'late', summary.late,
          'excused', summary.excused,
          'total', summary.total
        )
      )
      order by summary.subject_name, summary.class_name
    ),
    '[]'::jsonb
  )
  into v_result
  from subject_totals summary;

  return v_result;
end;
$$;

revoke all on function public.get_my_attendance_history(boolean) from public, anon;
grant execute on function public.get_my_attendance_history(boolean) to authenticated;
