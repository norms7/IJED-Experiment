-- Return the signed-in student's attendance summary without relying on the
-- recursive attendance table policies or the legacy RPC's return signature.
create or replace function public.get_my_attendance_summary(p_student_id integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_student_id integer := coalesce(p_student_id, auth_student_id());
  v_result jsonb;
begin
  if v_student_id is null then
    raise exception 'Student account required' using errcode = '42501';
  end if;
  if not is_admin()
     and (auth_student_id() is null or auth_student_id() <> v_student_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  with attendance_rows as (
    select
      ats.subject_id,
      coalesce(sub.name::text, 'General / Homeroom') as subject_name,
      ats.class_id,
      cls.name::text as class_name,
      coalesce(normalize_term(ats.term), 'Unspecified') as term,
      lower(trim(ar.status))::text as status
    from public.attendance_records ar
    join public.attendance_sessions ats on ats.id = ar.session_id
    join public.classes cls on cls.id = ats.class_id
    left join public.subjects sub on sub.id = ats.subject_id
    where ar.student_id = v_student_id
      and ats.has_class = true
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

revoke all on function public.get_my_attendance_summary(integer) from public, anon;
grant execute on function public.get_my_attendance_summary(integer) to authenticated;

-- Keep the parameterized RPC compatible for any older frontend clients.
drop function if exists public.get_student_attendance_summary(integer);

create function public.get_student_attendance_summary(p_student_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin()
     and (auth_student_id() is null or auth_student_id() <> p_student_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if auth_student_id() is null then
    raise exception 'Student account required' using errcode = '42501';
  end if;

  return public.get_my_attendance_summary(p_student_id);
end;
$$;

revoke all on function public.get_student_attendance_summary(integer) from public, anon;
grant execute on function public.get_student_attendance_summary(integer) to authenticated;
