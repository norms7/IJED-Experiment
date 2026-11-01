-- ============================================================================
-- IJED LMS — immutable administrative audit history
-- Run after 10_activity_late_submissions.sql.
-- ============================================================================

alter table public.sections
  add column if not exists room text,
  add column if not exists adviser_id integer references public.teachers(id);

alter table public.teacher_class_assignments
  add column if not exists section_id integer references public.sections(id);

create index if not exists teacher_class_assignments_section_id_idx
  on public.teacher_class_assignments (section_id);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id integer references public.users(id) on delete set null,
  actor_auth_uid uuid,
  actor_name text not null,
  action text not null check (action in (
    'CREATE', 'UPDATE', 'DEACTIVATE', 'REACTIVATE', 'DELETE',
    'ASSIGN', 'UNASSIGN', 'ENROLL', 'UNENROLL', 'TRANSFER'
  )),
  area text not null check (area in (
    'Users', 'Teachers', 'Students', 'Sections', 'Subjects'
  )),
  table_name text not null,
  record_id text,
  record_label text,
  summary text not null,
  changed_fields jsonb not null default '{}'::jsonb
    check (jsonb_typeof(changed_fields) = 'object'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);
create index if not exists audit_logs_action_created_at_idx
  on public.audit_logs (action, created_at desc);
create index if not exists audit_logs_area_created_at_idx
  on public.audit_logs (area, created_at desc);
create index if not exists audit_logs_actor_auth_uid_created_at_idx
  on public.audit_logs (actor_auth_uid, created_at desc);

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from public, anon, authenticated, service_role;
grant select on public.audit_logs to authenticated;
grant select, insert on public.audit_logs to service_role;
revoke all on sequence public.audit_logs_id_seq from public, anon, authenticated, service_role;
grant usage, select on sequence public.audit_logs_id_seq to service_role;

drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select on public.audit_logs
  for select to authenticated using (public.is_admin());

create or replace function public._audit_changed_fields(
  p_old jsonb,
  p_new jsonb,
  p_fields text[],
  p_redacted text[] default array[]::text[]
) returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_field text;
  v_old_value jsonb;
  v_new_value jsonb;
  v_result jsonb := '{}'::jsonb;
begin
  foreach v_field in array p_fields loop
    v_old_value := p_old -> v_field;
    v_new_value := p_new -> v_field;
    if v_old_value is distinct from v_new_value then
      if v_field = any(p_redacted) then
        v_result := v_result || jsonb_build_object(
          v_field,
          jsonb_build_object(
            'old', case when v_old_value is null or v_old_value = 'null'::jsonb
              then 'null'::jsonb else to_jsonb('[redacted]'::text) end,
            'new', case when v_new_value is null or v_new_value = 'null'::jsonb
              then 'null'::jsonb else to_jsonb('[redacted]'::text) end,
            'redacted', true
          )
        );
      else
        v_result := v_result || jsonb_build_object(
          v_field,
          jsonb_build_object('old', v_old_value, 'new', v_new_value)
        );
      end if;
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function public.write_admin_audit_event(
  p_action text,
  p_table_name text,
  p_record_id text,
  p_record_label text,
  p_summary text,
  p_changed_fields jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id integer;
  v_actor_name text;
  v_id bigint;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select u.id, concat_ws(' ', u.first_name, u.last_name)
    into v_actor_id, v_actor_name
    from public.users u
    where u.auth_uid = auth.uid();

  if v_actor_id is null then
    raise exception 'Administrator profile not found' using errcode = '42501';
  end if;

  insert into public.audit_logs (
    actor_user_id, actor_auth_uid, actor_name, action, area, table_name,
    record_id, record_label, summary, changed_fields, metadata
  ) values (
    v_actor_id, auth.uid(), coalesce(nullif(v_actor_name, ''), 'Administrator'),
    p_action, case
      when p_table_name = 'users' then 'Users'
      when p_table_name in ('teachers', 'teacher_class_assignments') then 'Teachers'
      when p_table_name in ('students', 'student_section_assignments', 'student_subject_enrollments') then 'Students'
      when p_table_name in ('sections', 'classes') then 'Sections'
      when p_table_name = 'subjects' then 'Subjects'
      else 'Users'
    end,
    p_table_name, p_record_id, p_record_label, p_summary,
    coalesce(p_changed_fields, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.capture_admin_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_row jsonb;
  v_record_id text;
  v_record_label text;
  v_actor_label text;
  v_action text;
  v_area text;
  v_fields text[];
  v_redacted text[] := array[]::text[];
  v_changed_fields jsonb;
  v_summary text;
  v_person_id integer;
begin
  if coalesce(current_setting('app.audit_log_suppressed', true), 'false') = 'true' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if auth.uid() is null or not public.is_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_row := case when tg_op = 'DELETE' then v_old else v_new end;
  v_record_id := coalesce(v_row ->> 'id', v_row ->> 'user_id');

  case tg_table_name
    when 'users' then
      v_area := 'Users';
      v_fields := array['first_name', 'last_name', 'role_id', 'is_active', 'email'];
      v_redacted := array['email'];
      v_record_label := concat_ws(' ', v_row ->> 'first_name', v_row ->> 'last_name');
    when 'teachers' then
      v_area := 'Teachers';
      v_fields := array['specialization', 'employee_id', 'contact_number'];
      v_redacted := array['employee_id', 'contact_number'];
      select concat_ws(' ', u.first_name, u.last_name)
        into v_record_label from public.users u where u.id = (v_row ->> 'user_id')::integer;
    when 'students' then
      v_area := 'Students';
      v_fields := array['student_number', 'contact_number', 'guardian_name', 'guardian_contact'];
      v_redacted := v_fields;
      select concat_ws(' ', u.first_name, u.last_name)
        into v_record_label from public.users u where u.id = (v_row ->> 'user_id')::integer;
    when 'teacher_class_assignments' then
      v_area := 'Teachers';
      v_fields := array['teacher_id', 'class_id', 'section_id', 'subject_id', 'schedule'];
      select concat_ws(' ', u.first_name, u.last_name)
        into v_record_label
        from public.teachers t join public.users u on u.id = t.user_id
        where t.id = (v_row ->> 'teacher_id')::integer;
    when 'student_section_assignments', 'student_subject_enrollments' then
      v_area := 'Students';
      v_fields := case when tg_table_name = 'student_section_assignments'
        then array['student_id', 'section_id']
        else array['student_id', 'subject_id'] end;
      select concat_ws(' ', u.first_name, u.last_name)
        into v_record_label
        from public.students s join public.users u on u.id = s.user_id
        where s.id = (v_row ->> 'student_id')::integer;
    when 'sections' then
      v_area := 'Sections';
      v_fields := array['name', 'class_id', 'room', 'adviser_id'];
      v_record_label := v_row ->> 'name';
    when 'classes' then
      v_area := 'Sections';
      v_fields := array['name', 'grade_level', 'school_year', 'is_active'];
      v_record_label := v_row ->> 'name';
    when 'subjects' then
      v_area := 'Subjects';
      v_fields := array['name'];
      v_record_label := v_row ->> 'name';
    else
      return case when tg_op = 'DELETE' then old else new end;
  end case;

  v_changed_fields := public._audit_changed_fields(v_old, v_new, v_fields, v_redacted);
  if tg_op = 'UPDATE' and v_changed_fields = '{}'::jsonb then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_action := 'CREATE';
  elsif tg_op = 'DELETE' then
    v_action := 'DELETE';
  elsif tg_table_name = 'users'
      and (v_old ->> 'is_active') is distinct from (v_new ->> 'is_active') then
    v_action := case when (v_new ->> 'is_active')::boolean then 'REACTIVATE' else 'DEACTIVATE' end;
  elsif tg_table_name = 'teacher_class_assignments' and tg_op = 'INSERT' then
    v_action := 'ASSIGN';
  elsif tg_table_name = 'student_section_assignments' and tg_op = 'INSERT' then
    v_action := 'ASSIGN';
  elsif tg_table_name = 'student_subject_enrollments' and tg_op = 'INSERT' then
    v_action := 'ENROLL';
  else
    v_action := 'UPDATE';
  end if;

  if tg_table_name = 'teacher_class_assignments' and tg_op = 'DELETE' then
    v_action := 'UNASSIGN';
  elsif tg_table_name = 'student_section_assignments' and tg_op = 'DELETE' then
    v_action := 'UNASSIGN';
  elsif tg_table_name = 'student_subject_enrollments' and tg_op = 'DELETE' then
    v_action := 'UNENROLL';
  elsif tg_table_name = 'student_section_assignments' and tg_op = 'UPDATE' then
    v_action := 'TRANSFER';
  end if;

  v_summary := case v_action
    when 'CREATE' then 'Created'
    when 'UPDATE' then 'Updated'
    when 'DEACTIVATE' then 'Deactivated'
    when 'REACTIVATE' then 'Reactivated'
    when 'DELETE' then 'Deleted'
    when 'ASSIGN' then 'Assigned'
    when 'UNASSIGN' then 'Unassigned'
    when 'ENROLL' then 'Enrolled'
    when 'UNENROLL' then 'Unenrolled'
    when 'TRANSFER' then 'Transferred'
  end || ' ' || lower(v_area) ||
       case when nullif(v_record_label, '') is null then '' else ': ' || v_record_label end;

  perform public.write_admin_audit_event(
    v_action, tg_table_name, v_record_id,
    coalesce(nullif(v_record_label, ''), 'Record #' || coalesce(v_record_id, '?')),
    v_summary, v_changed_fields,
    jsonb_build_object('source', 'database_trigger')
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'users', 'teachers', 'students', 'teacher_class_assignments',
    'student_section_assignments', 'student_subject_enrollments',
    'sections', 'classes', 'subjects'
  ] loop
    execute format('drop trigger if exists audit_admin_changes on public.%I', v_table);
    execute format(
      'create trigger audit_admin_changes after insert or update or delete on public.%I '
      'for each row execute function public.capture_admin_audit_log()',
      v_table
    );
  end loop;
end;
$$;

create or replace function public.create_admin_section(
  p_name text,
  p_class_name text,
  p_grade_level text,
  p_school_year text,
  p_room text,
  p_adviser_id integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_class public.classes%rowtype;
  v_section public.sections%rowtype;
  v_fields jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_grade_level), '') is null then
    raise exception 'Section name and grade level are required' using errcode = '22023';
  end if;

  perform set_config('app.audit_log_suppressed', 'true', true);
  insert into public.classes (name, grade_level, school_year, is_active)
    values (coalesce(nullif(trim(p_class_name), ''), trim(p_name)),
      trim(p_grade_level), nullif(trim(p_school_year), ''), true)
    returning * into v_class;
  insert into public.sections (name, class_id, room, adviser_id)
    values (trim(p_name), v_class.id, nullif(trim(p_room), ''), p_adviser_id)
    returning * into v_section;
  perform set_config('app.audit_log_suppressed', 'false', true);

  v_fields := public._audit_changed_fields(
    '{}'::jsonb,
    jsonb_build_object(
      'name', v_section.name, 'grade_level', v_class.grade_level,
      'school_year', v_class.school_year, 'room', v_section.room,
      'adviser_id', v_section.adviser_id, 'class_name', v_class.name
    ),
    array['name', 'grade_level', 'school_year', 'room', 'adviser_id', 'class_name']
  );
  perform public.write_admin_audit_event(
    'CREATE', 'sections', v_section.id::text, v_section.name,
    'Created section: ' || v_section.name, v_fields,
    jsonb_build_object('source', 'admin_section_rpc')
  );
  return to_jsonb(v_section);
end;
$$;

create or replace function public.update_admin_section(
  p_section_id integer,
  p_name text,
  p_grade_level text,
  p_school_year text,
  p_room text,
  p_adviser_id integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_section public.sections%rowtype;
  v_section public.sections%rowtype;
  v_old_class public.classes%rowtype;
  v_class public.classes%rowtype;
  v_old_values jsonb;
  v_new_values jsonb;
  v_fields jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_grade_level), '') is null then
    raise exception 'Section name and grade level are required' using errcode = '22023';
  end if;

  select * into v_old_section from public.sections where id = p_section_id for update;
  if not found then
    raise exception 'Section not found' using errcode = 'P0002';
  end if;
  if v_old_section.class_id is not null then
    select * into v_old_class from public.classes where id = v_old_section.class_id for update;
  end if;

  perform set_config('app.audit_log_suppressed', 'true', true);
  if v_old_section.class_id is not null then
    update public.classes
      set name = trim(p_name), grade_level = trim(p_grade_level),
          school_year = nullif(trim(p_school_year), '')
      where id = v_old_section.class_id
      returning * into v_class;
  else
    raise exception 'Section has no backing class' using errcode = '23503';
  end if;
  update public.sections
    set name = trim(p_name), room = nullif(trim(p_room), ''), adviser_id = p_adviser_id
    where id = p_section_id
    returning * into v_section;
  perform set_config('app.audit_log_suppressed', 'false', true);

  v_old_values := jsonb_build_object(
    'name', v_old_section.name, 'grade_level', v_old_class.grade_level,
    'school_year', v_old_class.school_year, 'room', v_old_section.room,
    'adviser_id', v_old_section.adviser_id, 'class_name', v_old_class.name
  );
  v_new_values := jsonb_build_object(
    'name', v_section.name, 'grade_level', v_class.grade_level,
    'school_year', v_class.school_year, 'room', v_section.room,
    'adviser_id', v_section.adviser_id, 'class_name', v_class.name
  );
  v_fields := public._audit_changed_fields(
    v_old_values, v_new_values,
    array['name', 'grade_level', 'school_year', 'room', 'adviser_id', 'class_name']
  );

  if v_fields <> '{}'::jsonb then
    perform public.write_admin_audit_event(
      'UPDATE', 'sections', v_section.id::text, v_section.name,
      'Updated section: ' || v_section.name, v_fields,
      jsonb_build_object('source', 'admin_section_rpc')
    );
  end if;
  return to_jsonb(v_section);
end;
$$;

create or replace function public.get_admin_audit_logs(
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default null,
  p_action text default null,
  p_area text default null,
  p_from_date date default null,
  p_to_date date default null
) returns setof public.audit_logs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return query
    select a.*
    from public.audit_logs a
    where (nullif(trim(p_search), '') is null or
      position(lower(trim(p_search)) in lower(concat_ws(
        ' ', a.summary, a.actor_name, a.area, a.action, a.table_name,
        a.record_label, a.record_id
      ))) > 0)
      and (nullif(p_action, '') is null or a.action = p_action)
      and (nullif(p_area, '') is null or a.area = p_area)
      and (p_from_date is null or a.created_at >=
        p_from_date::timestamp at time zone current_setting('TimeZone'))
      and (p_to_date is null or a.created_at <
        (p_to_date + 1)::timestamp at time zone current_setting('TimeZone'))
    order by a.created_at desc, a.id desc
    limit greatest(1, least(coalesce(p_limit, 50), 500))
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.get_admin_audit_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stats jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'total_activities', count(*),
    'today_activities', count(*) filter (where created_at::date = current_date),
    'admins_with_activities', count(distinct actor_auth_uid)
  ) into v_stats
  from public.audit_logs;
  return v_stats;
end;
$$;

create or replace function public.enroll_student_subjects(
  p_student_id integer,
  p_subject_ids integer[]
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_subjects integer[];
  v_new_subjects integer[];
  v_student_name text;
  v_changes jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select concat_ws(' ', u.first_name, u.last_name)
    into v_student_name
    from public.students s join public.users u on u.id = s.user_id
    where s.id = p_student_id;
  if not found then
    raise exception 'Student not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(subject_id order by subject_id), array[]::integer[])
    into v_old_subjects
    from public.student_subject_enrollments
    where student_id = p_student_id;

  perform set_config('app.audit_log_suppressed', 'true', true);
  delete from public.student_subject_enrollments where student_id = p_student_id;
  insert into public.student_subject_enrollments (student_id, subject_id)
    select p_student_id, sid from unnest(p_subject_ids) as sid;
  perform set_config('app.audit_log_suppressed', 'false', true);

  select coalesce(array_agg(subject_id order by subject_id), array[]::integer[])
    into v_new_subjects
    from public.student_subject_enrollments
    where student_id = p_student_id;

  if v_old_subjects is distinct from v_new_subjects then
    v_changes := public._audit_changed_fields(
      jsonb_build_object('subjects', v_old_subjects),
      jsonb_build_object('subjects', v_new_subjects),
      array['subjects']
    );
    perform public.write_admin_audit_event(
      case when cardinality(v_new_subjects) = 0 then 'UNENROLL' else 'ENROLL' end,
      'student_subject_enrollments', p_student_id::text, v_student_name,
      'Updated subject enrollment for student: ' || v_student_name,
      v_changes, jsonb_build_object('source', 'enroll_student_subjects')
    );
  end if;

  return jsonb_build_object(
    'message',
    'Student enrolled in ' || coalesce(array_length(p_subject_ids, 1), 0) || ' subject(s) successfully.'
  );
end;
$$;

revoke all on function public._audit_changed_fields(jsonb, jsonb, text[], text[]) from public, anon, authenticated;
revoke all on function public.write_admin_audit_event(text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.capture_admin_audit_log() from public, anon, authenticated;
revoke all on function public.create_admin_section(text, text, text, text, text, integer) from public, anon;
revoke all on function public.update_admin_section(integer, text, text, text, text, integer) from public, anon;
revoke all on function public.get_admin_audit_logs(integer, integer, text, text, text, date, date) from public, anon;
revoke all on function public.get_admin_audit_stats() from public, anon;
grant execute on function public.create_admin_section(text, text, text, text, text, integer) to authenticated;
grant execute on function public.update_admin_section(integer, text, text, text, text, integer) to authenticated;
grant execute on function public.get_admin_audit_logs(integer, integer, text, text, text, date, date) to authenticated;
grant execute on function public.get_admin_audit_stats() to authenticated;
revoke all on function public.enroll_student_subjects(integer, integer[]) from public, anon;
grant execute on function public.enroll_student_subjects(integer, integer[]) to authenticated;

notify pgrst, 'reload schema';
