-- Limit semester attendance to the student's enrolled subjects and the
-- classes assigned to their active or audited former sections.

create or replace function public.get_my_attendance_by_semester(p_semester text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_id integer := public.auth_student_id();
  v_semester text;
  v_last_transfer timestamptz;
  v_result jsonb;
begin
  if v_student_id is null then
    raise exception 'Student account required' using errcode = '42501';
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
    raise exception 'Semester must be 1st or 2nd' using errcode = '22023';
  end if;

  select max(transfer.created_at)
    into v_last_transfer
  from public.audit_logs transfer
  where transfer.action = 'TRANSFER'
    and transfer.table_name = 'student_section_assignments'
    and transfer.record_id = v_student_id::text
    and transfer.metadata ->> 'source' = 'transfer_students_to_section_with_semester';

  with attendance_rows as (
    select
      session.subject_id,
      subject.name::text as subject_name,
      session.class_id,
      class.name::text as class_name,
      coalesce(public.normalize_term(session.term), 'Unspecified') as term,
      lower(trim(record.status))::text as status
    from public.attendance_records record
    join public.attendance_sessions session on session.id = record.session_id
    join public.classes class on class.id = session.class_id
    join public.subjects subject on subject.id = session.subject_id
    join public.student_subject_enrollments enrollment
      on enrollment.student_id = v_student_id
     and enrollment.subject_id = session.subject_id
    where record.student_id = v_student_id
      and session.has_class = true
      and case lower(trim(coalesce(subject.semester::text, '')))
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
        else '1st'
      end = v_semester
      and (
        exists (
          select 1
          from public.student_section_assignments active_assignment
          join public.teacher_class_assignments active_subject
            on active_subject.section_id = active_assignment.section_id
           and active_subject.class_id = session.class_id
           and active_subject.subject_id = session.subject_id
          where active_assignment.student_id = v_student_id
            and (
              v_last_transfer is null
              or session.created_at >= v_last_transfer
            )
        )
        or exists (
          select 1
          from public.audit_logs transfer
          join public.sections former_section
            on former_section.id =
              case
                when transfer.changed_fields #>> '{section_id,old}' ~ '^[0-9]+$'
                  then (transfer.changed_fields #>> '{section_id,old}')::integer
              end
          join public.teacher_class_assignments former_subject
            on former_subject.section_id = former_section.id
           and former_subject.class_id = session.class_id
           and former_subject.subject_id = session.subject_id
          where transfer.action = 'TRANSFER'
            and transfer.table_name = 'student_section_assignments'
            and transfer.record_id = v_student_id::text
            and transfer.metadata ->> 'source' = 'transfer_students_to_section_with_semester'
            and session.created_at < transfer.created_at
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
          where term.subject_id = summary.subject_id
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

revoke all on function public.get_my_attendance_by_semester(text) from public, anon;
grant execute on function public.get_my_attendance_by_semester(text) to authenticated;

notify pgrst, 'reload schema';
