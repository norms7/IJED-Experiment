-- Preserve subject history while moving the active section and semester forward.
alter table public.subjects
  add column if not exists semester varchar(20);

alter table public.students
  add column if not exists current_semester varchar(20);

create or replace function public.transfer_students_to_section_with_semester(
  p_student_ids integer[],
  p_from_section_id integer,
  p_to_section_id integer,
  p_semester text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student_ids integer[];
  v_semester text;
  v_from_name text;
  v_to_name text;
  v_selected_count integer;
  v_moved_count integer;
  v_subjects_added integer;
  v_student_id integer;
  v_student_name text;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
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
  if p_from_section_id is null or p_to_section_id is null
     or p_from_section_id = p_to_section_id then
    raise exception 'Choose two different sections' using errcode = '22023';
  end if;

  select name into v_from_name from public.sections where id = p_from_section_id;
  if not found then
    raise exception 'Source section not found' using errcode = 'P0002';
  end if;
  select name into v_to_name from public.sections where id = p_to_section_id;
  if not found then
    raise exception 'Destination section not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct selected.student_id), array[]::integer[])
    into v_student_ids
    from unnest(coalesce(p_student_ids, array[]::integer[])) as selected(student_id)
    where selected.student_id is not null;
  v_selected_count := cardinality(v_student_ids);
  if v_selected_count = 0 then
    raise exception 'Select at least one student to transfer' using errcode = '22023';
  end if;

  perform 1
    from public.student_section_assignments assignment
    where assignment.section_id = p_from_section_id
      and assignment.student_id = any(v_student_ids)
    for update;

  select count(distinct assignment.student_id)
    into v_moved_count
    from public.student_section_assignments assignment
    where assignment.section_id = p_from_section_id
      and assignment.student_id = any(v_student_ids);
  if v_moved_count <> v_selected_count then
    raise exception 'One or more selected students are no longer in the source section'
      using errcode = '22023';
  end if;

  perform set_config('app.audit_log_suppressed', 'true', true);
  delete from public.student_section_assignments
    where student_id = any(v_student_ids);
  insert into public.student_section_assignments (student_id, section_id)
    select selected.student_id, p_to_section_id
    from unnest(v_student_ids) as selected(student_id);

  update public.students
    set current_semester = v_semester
    where id = any(v_student_ids);

  with inserted_enrollments as (
    insert into public.student_subject_enrollments (student_id, subject_id)
      select selected.student_id, assignment.subject_id
      from unnest(v_student_ids) as selected(student_id)
      cross join public.teacher_class_assignments assignment
      join public.subjects subject on subject.id = assignment.subject_id
      where assignment.section_id = p_from_section_id
        or (
          assignment.section_id = p_to_section_id
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
          else case
            when nullif(trim(coalesce(subject.semester::text, '')), '') is null then '1st'
            else null
          end
          end = v_semester
        )
      on conflict (student_id, subject_id) do nothing
      returning student_id
  )
  select count(*) into v_subjects_added from inserted_enrollments;
  perform set_config('app.audit_log_suppressed', 'false', true);

  foreach v_student_id in array v_student_ids loop
    select concat_ws(' ', users.first_name, users.last_name)
      into v_student_name
      from public.students student
      join public.users users on users.id = student.user_id
      where student.id = v_student_id;
    perform public.write_admin_audit_event(
      'TRANSFER',
      'student_section_assignments',
      v_student_id::text,
      coalesce(nullif(v_student_name, ''), 'Student #' || v_student_id::text),
      format('Transferred student from %s to %s for %s Semester',
        v_from_name, v_to_name, v_semester),
      jsonb_build_object(
        'section_id', jsonb_build_object('old', p_from_section_id, 'new', p_to_section_id),
        'current_semester', jsonb_build_object('new', v_semester)
      ),
      jsonb_build_object('source', 'transfer_students_to_section_with_semester')
    );
  end loop;

  return jsonb_build_object(
    'students_selected', v_selected_count,
    'subjects_added', v_subjects_added,
    'semester', v_semester
  );
end;
$$;

-- A transferred student keeps access to content in previous sections. The
-- transfer audit record is the trusted history because the active assignment
-- is replaced during transfer.
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
      and module.is_published = true
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

-- Repair transfers made before this migration was rerun: restore enrollments
-- for subjects assigned to each student's previous section, using its audit record.
do $$
begin
  perform set_config('app.audit_log_suppressed', 'true', true);
  insert into public.student_subject_enrollments (student_id, subject_id)
    select distinct
      case when audit.record_id ~ '^[0-9]+$' then audit.record_id::integer end,
      assignment.subject_id
    from public.audit_logs audit
    join public.teacher_class_assignments assignment
      on assignment.section_id =
        case
          when audit.changed_fields #>> '{section_id,old}' ~ '^[0-9]+$'
            then (audit.changed_fields #>> '{section_id,old}')::integer
        end
    where audit.action = 'TRANSFER'
      and audit.table_name = 'student_section_assignments'
      and audit.metadata ->> 'source' = 'transfer_students_to_section_with_semester'
      and audit.record_id ~ '^[0-9]+$'
    on conflict (student_id, subject_id) do nothing;
  perform set_config('app.audit_log_suppressed', 'false', true);
end;
$$;

revoke all on function public.transfer_students_to_section_with_semester(integer[], integer, integer, text)
  from public, anon;
grant execute on function public.transfer_students_to_section_with_semester(integer[], integer, integer, text)
  to authenticated;

notify pgrst, 'reload schema';
