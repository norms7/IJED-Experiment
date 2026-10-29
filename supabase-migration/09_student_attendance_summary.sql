-- Repair the student attendance RPC. Older deployments return a table shape
-- that no longer matches the query and raise "structure of query does not
-- match function result type". Return the view's expected JSON shape instead.
drop function if exists public.get_student_attendance_summary(integer);

create function public.get_student_attendance_summary(p_student_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not is_admin()
     and (auth_student_id() is null or auth_student_id() <> p_student_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  with attendance_rows as (
    select *
    from public._student_attendance_rows(p_student_id)
  ),
  term_totals as (
    select
      subject_id,
      subject_name,
      class_id,
      class_name,
      coalesce(term, 'Unspecified') as term,
      count(*) filter (where status = 'present')::integer as present,
      count(*) filter (where status = 'absent')::integer as absent,
      count(*) filter (where status = 'late')::integer as late,
      count(*) filter (where status = 'excused')::integer as excused,
      count(*)::integer as total
    from attendance_rows
    group by subject_id, subject_name, class_id, class_name, coalesce(term, 'Unspecified')
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
        'subject_id', s.subject_id,
        'subject_name', s.subject_name,
        'class_name', s.class_name,
        'terms', (
          select jsonb_agg(
            jsonb_build_object(
              'term', t.term,
              'present', t.present,
              'absent', t.absent,
              'late', t.late,
              'excused', t.excused,
              'total', t.total
            )
            order by t.term
          )
          from term_totals t
          where t.subject_id is not distinct from s.subject_id
            and t.class_id = s.class_id
        ),
        'totals', jsonb_build_object(
          'present', s.present,
          'absent', s.absent,
          'late', s.late,
          'excused', s.excused,
          'total', s.total
        )
      )
      order by s.subject_name, s.class_name
    ),
    '[]'::jsonb
  )
  into v_result
  from subject_totals s;

  return v_result;
end;
$$;

revoke all on function public.get_student_attendance_summary(integer) from public, anon;
grant execute on function public.get_student_attendance_summary(integer) to authenticated;
