-- ============================================================================
-- IJED LMS — Business logic functions (RPC)
-- Run AFTER 02_rls_policies.sql
--
-- These replace your FastAPI service-layer / endpoint logic. Call from the
-- frontend with: await supabase.rpc('function_name', { p_arg: value })
-- All are SECURITY DEFINER so they can write across tables despite RLS,
-- but each one re-checks permissions internally (mirrors what your FastAPI
-- Depends() guards used to do).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Auth bridge — auto-link a new Supabase Auth user to an existing `users`
--    row by matching email. Fires when someone signs in for the first time
--    after you migrate their account into Supabase Auth.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update users
  set auth_uid = new.id
  where email = new.email and auth_uid is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- 1. Student-safe question view (strips correct_answer before it ever
--    reaches the client — equivalent to _strip_correct_answers() in Python)
-- ----------------------------------------------------------------------------
create or replace view student_safe_questions as
select id, activity_id, "order", question_text, question_type, points
from activity_questions;

-- ----------------------------------------------------------------------------
-- 2. notify() / notify_many() — internal helpers used by the RPCs below.
--    Supabase Realtime (subscribe to `notifications` table) replaces the
--    old custom SSE push — no extra code needed for "live" delivery.
-- ----------------------------------------------------------------------------
create or replace function _notify(
  p_target_user_id integer,
  p_actor_user_id integer,
  p_type text,
  p_title text,
  p_message text,
  p_link_type text default null,
  p_link_id integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications
    (target_user_id, actor_user_id, notification_type, title, message, link_type, link_id)
  values
    (p_target_user_id, p_actor_user_id, p_type, p_title, p_message, p_link_type, p_link_id);
end;
$$;

create or replace function _notify_many(
  p_target_user_ids integer[],
  p_actor_user_id integer,
  p_type text,
  p_title text,
  p_message text,
  p_link_type text default null,
  p_link_id integer default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare uid integer;
begin
  foreach uid in array p_target_user_ids loop
    perform _notify(uid, p_actor_user_id, p_type, p_title, p_message, p_link_type, p_link_id);
  end loop;
end;
$$;

create or replace function _admin_user_ids()
returns integer[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(u.id), '{}')
  from users u join roles r on r.id = u.role_id
  where r.name = 'admin' and u.is_active = true;
$$;

-- ----------------------------------------------------------------------------
-- 3. submit_activity() — student submits answers.
--    Mirrors student_activities.py: submit_activity() 1:1, including the
--    grade-letter table and auto/partial/manual grading branches.
-- ----------------------------------------------------------------------------
create or replace function submit_activity(
  p_activity_id integer,
  p_answers jsonb   -- [{ "question_id": 1, "answer_value": "0" }, ...]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id     integer := auth_student_id();
  v_activity       activities%rowtype;
  v_submission_id  integer;
  v_total_earned   integer := 0;
  v_all_auto       boolean := true;
  v_ans            jsonb;
  v_question       activity_questions%rowtype;
  v_is_correct     boolean;
  v_pts            integer;
  v_pct            numeric;
  v_grade          text;
  v_score          integer;
  v_is_graded      boolean;
  v_remarks        text;
  v_teacher_user_id integer;
  v_student_name   text;
begin
  if v_student_id is null then
    raise exception 'Not a student account' using errcode = '42501';
  end if;

  select * into v_activity from activities where id = p_activity_id and is_published = true;
  if v_activity.id is null then
    raise exception 'Activity not found' using errcode = 'P0002';
  end if;

  -- enrollment check (student must be enrolled in the activity's subject,
  -- mirrors the class-membership check in the Python version)
  if not exists (
    select 1 from student_subject_enrollments sse
    where sse.student_id = v_student_id and sse.subject_id = v_activity.subject_id
  ) then
    raise exception 'Not enrolled in this activity''s subject' using errcode = '42501';
  end if;

  -- past-due check
  if v_activity.due_date is not null and now() > v_activity.due_date then
    raise exception 'This activity is past its due date. No late submissions are accepted.'
      using errcode = '42501';
  end if;

  -- duplicate check
  if exists (
    select 1 from activity_submissions
    where activity_id = p_activity_id and student_id = v_student_id
  ) then
    raise exception 'You have already submitted this activity.' using errcode = '23505';
  end if;

  insert into activity_submissions (activity_id, student_id, max_score, submitted_at)
  values (p_activity_id, v_student_id, v_activity.max_score, now())
  returning id into v_submission_id;

  for v_ans in select * from jsonb_array_elements(p_answers) loop
    select * into v_question from activity_questions
      where id = (v_ans->>'question_id')::integer and activity_id = p_activity_id;
    if v_question.id is null then continue; end if;

    v_is_correct := null;
    v_pts := null;

    if v_question.question_type = 'multiple_choice' then
      v_is_correct := trim(v_ans->>'answer_value') = trim(v_question.correct_answer);
      v_pts := case when v_is_correct then v_question.points else 0 end;

    elsif v_question.question_type = 'checkbox' then
      begin
        v_is_correct := (
          select array(select jsonb_array_elements_text(v_question.correct_answer::jsonb) order by 1)
        ) = (
          select array(select jsonb_array_elements_text((v_ans->>'answer_value')::jsonb) order by 1)
        );
      exception when others then
        v_is_correct := false;
      end;
      v_pts := case when v_is_correct then v_question.points else 0 end;

    elsif v_question.question_type in ('fill_blank', 'enumeration') then
      v_is_correct := lower(trim(v_ans->>'answer_value')) = lower(trim(v_question.correct_answer));
      v_pts := case when v_is_correct then v_question.points else 0 end;

    else
      -- essay / freeform → manual grading
      v_is_correct := null;
      v_pts := null;
      v_all_auto := false;
    end if;

    insert into activity_answers (submission_id, question_id, answer_value, is_correct, points_earned)
    values (v_submission_id, (v_ans->>'question_id')::integer, v_ans->>'answer_value', v_is_correct, v_pts);

    if v_pts is not null then
      v_total_earned := v_total_earned + v_pts;
    end if;
  end loop;

  -- grade-letter scale (identical thresholds to the Python version)
  if v_activity.grading_mode = 'auto' then
    if v_all_auto then
      v_score := v_total_earned;
      v_is_graded := true;
      v_pct := case when v_activity.max_score > 0
                 then least((v_total_earned::numeric / v_activity.max_score * 100), 100.0)
                 else 0 end;
      v_grade := case
        when v_pct >= 100 then '1.00' when v_pct >= 97 then '1.25' when v_pct >= 94 then '1.50'
        when v_pct >= 91 then '1.75' when v_pct >= 88 then '2.00' when v_pct >= 85 then '2.25'
        when v_pct >= 82 then '2.50' when v_pct >= 79 then '2.75' when v_pct >= 75 then '3.00'
        else '5.00' end;
      v_remarks := 'Auto-graded';
    else
      v_score := v_total_earned;
      v_is_graded := false;
      v_grade := null;
      v_remarks := 'Partial auto-grade — awaiting teacher review';
    end if;
  else
    v_score := null;
    v_is_graded := false;
    v_grade := null;
    v_remarks := null;
  end if;

  update activity_submissions
  set score = v_score, is_graded = v_is_graded, grade = v_grade, remarks = v_remarks
  where id = v_submission_id;

  -- notify teacher + admins (mirrors NotificationService calls)
  select (first_name || ' ' || last_name) into v_student_name
  from users u join students s on s.user_id = u.id where s.id = v_student_id;

  select t.user_id into v_teacher_user_id
  from teachers t where t.id = v_activity.teacher_id;
  if v_teacher_user_id is null and v_activity.subject_id is not null then
    select t.user_id into v_teacher_user_id
    from teachers t join teacher_class_assignments tca on tca.teacher_id = t.id
    where tca.subject_id = v_activity.subject_id limit 1;
  end if;

  if v_teacher_user_id is not null then
    perform _notify(v_teacher_user_id, (select user_id from students where id = v_student_id),
      'submission_received', 'New Submission',
      v_student_name || ' submitted ''' || v_activity.title || '''.', 'activity', v_activity.id);
  end if;

  perform _notify_many(_admin_user_ids(), (select user_id from students where id = v_student_id),
    'submission_received', 'New Submission',
    v_student_name || ' submitted ''' || v_activity.title || '''.', 'activity', v_activity.id);

  return jsonb_build_object(
    'id', v_submission_id,
    'activity_id', p_activity_id,
    'student_id', v_student_id,
    'score', v_score,
    'max_score', v_activity.max_score,
    'grade', v_grade,
    'remarks', v_remarks,
    'is_graded', v_is_graded,
    'grading_mode', v_activity.grading_mode
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. manual_grade_submission() — teacher grades a submission.
--    Mirrors teacher_activities.py: manual_grade() 1:1.
-- ----------------------------------------------------------------------------
create or replace function manual_grade_submission(
  p_activity_id integer,
  p_submission_id integer,
  p_score integer,
  p_grade text default null,
  p_remarks text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher_id integer := auth_teacher_id();
  v_activity   activities%rowtype;
  v_submission activity_submissions%rowtype;
  v_pct        numeric;
  v_final_grade text;
  v_student_user_id integer;
  v_student_name text;
  v_score_str  text;
begin
  if v_teacher_id is null then
    raise exception 'Not a teacher account' using errcode = '42501';
  end if;

  select * into v_activity from activities
    where id = p_activity_id and teacher_id = v_teacher_id;
  if v_activity.id is null then
    raise exception 'Activity not found' using errcode = 'P0002';
  end if;

  select * into v_submission from activity_submissions
    where id = p_submission_id and activity_id = p_activity_id;
  if v_submission.id is null then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;

  v_final_grade := p_grade;
  if v_final_grade is null and v_activity.max_score is not null and v_activity.max_score > 0 then
    v_pct := (p_score::numeric / v_activity.max_score * 100);
    v_final_grade := case
      when v_pct >= 100 then '1.00' when v_pct >= 97 then '1.25' when v_pct >= 94 then '1.50'
      when v_pct >= 91 then '1.75' when v_pct >= 88 then '2.00' when v_pct >= 85 then '2.25'
      when v_pct >= 82 then '2.50' when v_pct >= 79 then '2.75' when v_pct >= 75 then '3.00'
      else '5.00' end;
  end if;

  update activity_submissions
  set score = p_score, max_score = v_activity.max_score, grade = v_final_grade,
      remarks = p_remarks, is_graded = true
  where id = p_submission_id;

  select u.id, (u.first_name || ' ' || u.last_name)
    into v_student_user_id, v_student_name
  from users u join students s on s.user_id = u.id
  where s.id = v_submission.student_id;

  v_score_str := p_score || coalesce('/' || v_activity.max_score, '');

  perform _notify(v_student_user_id, (select user_id from teachers where id = v_teacher_id),
    'activity_graded', 'Activity Graded',
    'Your submission for ''' || v_activity.title || ''' has been graded: ' || v_score_str || '.',
    'activity', v_activity.id);

  perform _notify_many(_admin_user_ids(), (select user_id from teachers where id = v_teacher_id),
    'activity_graded', 'Activity Graded',
    'Teacher graded ''' || v_activity.title || ''' for ' || v_student_name || ': ' || v_score_str || '.',
    'activity', v_activity.id);

  -- invalidate this student's analytics cache so they see fresh stats
  delete from analytics_cache where student_id = v_submission.student_id;

  return jsonb_build_object(
    'id', p_submission_id, 'score', p_score, 'max_score', v_activity.max_score,
    'grade', v_final_grade, 'remarks', p_remarks, 'is_graded', true
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. enroll_student_subjects() / unenroll_student_subject() — admin only.
--    Mirrors students.py: enroll_student_subjects() (replace-all semantics).
-- ----------------------------------------------------------------------------
create or replace function enroll_student_subjects(
  p_student_id integer,
  p_subject_ids integer[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if not is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if not exists (select 1 from students where id = p_student_id) then
    raise exception 'Student not found' using errcode = 'P0002';
  end if;

  delete from student_subject_enrollments where student_id = p_student_id;

  insert into student_subject_enrollments (student_id, subject_id)
  select p_student_id, sid from unnest(p_subject_ids) as sid;

  v_count := array_length(p_subject_ids, 1);
  return jsonb_build_object('message',
    'Student enrolled in ' || coalesce(v_count, 0) || ' subject(s) successfully.');
end;
$$;

create or replace function unenroll_student_subject(
  p_student_id integer,
  p_subject_id integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  delete from student_subject_enrollments
    where student_id = p_student_id and subject_id = p_subject_id;
  if not found then
    raise exception 'Enrollment not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('message', 'Unenrolled successfully.');
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. mark_module_read() — student.
--    Mirrors student_dashboard.py: mark_module_read() upsert semantics.
-- ----------------------------------------------------------------------------
create or replace function mark_module_read(p_module_id integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id integer := auth_student_id();
  v_first timestamptz;
  v_last  timestamptz;
  v_message text;
begin
  if v_student_id is null then
    raise exception 'Not a student account' using errcode = '42501';
  end if;
  if not exists (select 1 from modules where id = p_module_id and is_published = true) then
    raise exception 'Module not found' using errcode = 'P0002';
  end if;

  insert into student_module_reads (student_id, module_id)
  values (v_student_id, p_module_id)
  on conflict (student_id, module_id)
  do update set last_read_at = now()
  returning first_read_at, last_read_at into v_first, v_last;

  v_message := case when v_first = v_last then 'Module marked as read' else 'Module read timestamp updated' end;

  return jsonb_build_object(
    'message', v_message, 'module_id', p_module_id, 'student_id', v_student_id,
    'first_read_at', v_first, 'last_read_at', v_last
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. create_attendance_session() — teacher creates a session + bulk records.
--    Mirrors attendance.py: create_session().
-- ----------------------------------------------------------------------------
create or replace function create_attendance_session(
  p_class_id integer,
  p_subject_id integer,
  p_term text,
  p_session_date date,
  p_has_class boolean,
  p_notes text,
  p_records jsonb  -- [{ "student_id": 1, "status": "present", "remarks": null }, ...]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_teacher_id integer := auth_teacher_id();
  v_session_id integer;
  v_rec jsonb;
begin
  if v_teacher_id is null then
    raise exception 'Not a teacher account' using errcode = '42501';
  end if;
  if not exists (
    select 1 from teacher_class_assignments
    where teacher_id = v_teacher_id and class_id = p_class_id
  ) then
    raise exception 'Not assigned to this class' using errcode = '42501';
  end if;
  if exists (
    select 1 from attendance_sessions
    where class_id = p_class_id and subject_id = p_subject_id and session_date = p_session_date
  ) then
    raise exception 'Session already exists for %', p_session_date using errcode = '23505';
  end if;

  insert into attendance_sessions (teacher_id, class_id, subject_id, term, session_date, has_class, notes)
  values (v_teacher_id, p_class_id, p_subject_id, p_term, p_session_date, p_has_class, p_notes)
  returning id into v_session_id;

  if p_has_class then
    for v_rec in select * from jsonb_array_elements(p_records) loop
      insert into attendance_records (session_id, student_id, status, remarks)
      values (v_session_id, (v_rec->>'student_id')::integer, v_rec->>'status', v_rec->>'remarks');
    end loop;
  end if;

  return jsonb_build_object('id', v_session_id, 'session_date', p_session_date, 'has_class', p_has_class);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. get_dashboard_stats() — admin overview.
--    Mirrors dashboard_service.py: get_dashboard_stats().
-- ----------------------------------------------------------------------------
create or replace function get_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admins integer; v_teachers integer; v_students integer;
  v_classes integer; v_modules integer; v_activities integer;
  v_recent jsonb;
begin
  if not is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select count(*) into v_admins   from users u join roles r on r.id = u.role_id where r.name = 'admin' and u.is_active;
  select count(*) into v_teachers from users u join roles r on r.id = u.role_id where r.name = 'teacher' and u.is_active;
  select count(*) into v_students from users u join roles r on r.id = u.role_id where r.name = 'student' and u.is_active;
  select count(*) into v_classes  from classes where is_active = true;
  select count(*) into v_modules  from modules;
  select count(*) into v_activities from activities;

  select coalesce(jsonb_agg(row), '[]') into v_recent from (
    select id, email, first_name, last_name, created_at from users
    order by created_at desc limit 5
  ) row;

  return jsonb_build_object(
    'total_users', v_admins + v_teachers + v_students,
    'total_admins', v_admins, 'total_teachers', v_teachers, 'total_students', v_students,
    'total_classes', v_classes, 'total_modules', v_modules, 'total_activities', v_activities,
    'recent_users', v_recent
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. get_student_dashboard_stats() — student overview.
--    Mirrors student_dashboard.py: get_student_dashboard().
-- ----------------------------------------------------------------------------
create or replace function get_student_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id integer := auth_student_id();
  v_subject_ids integer[];
  v_module_ids integer[];
  v_activity_ids integer[];
  v_modules_read integer;
  v_activities_done integer;
  v_avg_score numeric;
begin
  if v_student_id is null then
    raise exception 'Not a student account' using errcode = '42501';
  end if;

  select coalesce(array_agg(subject_id), '{}') into v_subject_ids
  from student_subject_enrollments where student_id = v_student_id;

  if v_subject_ids = '{}' then
    return jsonb_build_object('enrolled_subjects', 0,
      'modules', jsonb_build_object('done', 0, 'total', 0),
      'activities', jsonb_build_object('done', 0, 'total', 0), 'average_score', 0.0);
  end if;

  select coalesce(array_agg(id), '{}') into v_module_ids
  from modules where subject_id = any(v_subject_ids) and is_published = true;

  if v_module_ids = '{}' then
    return jsonb_build_object('enrolled_subjects', array_length(v_subject_ids, 1),
      'modules', jsonb_build_object('done', 0, 'total', 0),
      'activities', jsonb_build_object('done', 0, 'total', 0), 'average_score', 0.0);
  end if;

  select count(*) into v_modules_read
  from student_module_reads where student_id = v_student_id and module_id = any(v_module_ids);

  select coalesce(array_agg(id), '{}') into v_activity_ids
  from activities where module_id = any(v_module_ids) and is_published = true;

  if v_activity_ids = '{}' then
    return jsonb_build_object('enrolled_subjects', array_length(v_subject_ids, 1),
      'modules', jsonb_build_object('done', v_modules_read, 'total', array_length(v_module_ids, 1)),
      'activities', jsonb_build_object('done', 0, 'total', 0), 'average_score', 0.0);
  end if;

  select count(*) into v_activities_done
  from activity_submissions where student_id = v_student_id and activity_id = any(v_activity_ids);

  select round(avg(score::numeric / max_score * 100), 1) into v_avg_score
  from activity_submissions
  where student_id = v_student_id and activity_id = any(v_activity_ids)
    and is_graded = true and score is not null and max_score is not null and max_score > 0;

  return jsonb_build_object(
    'enrolled_subjects', array_length(v_subject_ids, 1),
    'modules', jsonb_build_object('done', v_modules_read, 'total', array_length(v_module_ids, 1)),
    'activities', jsonb_build_object('done', v_activities_done, 'total', array_length(v_activity_ids, 1)),
    'average_score', coalesce(v_avg_score, 0.0)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. analytics_cache_get() / analytics_cache_set() — used by the frontend
--     analytics engine (see MIGRATION_GUIDE.md, Phase 2) so the JS-side port
--     of analytics_service.py can cache the same way the Python version did.
-- ----------------------------------------------------------------------------
create or replace function analytics_cache_get(p_cache_key text, p_ttl_seconds integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id integer := auth_student_id();
  v_payload text; v_computed_at timestamptz;
begin
  if v_student_id is null then return null; end if;
  select payload, computed_at into v_payload, v_computed_at
  from analytics_cache where student_id = v_student_id and cache_key = p_cache_key;
  if v_payload is null then return null; end if;
  if now() - v_computed_at > (p_ttl_seconds || ' seconds')::interval then return null; end if;
  return v_payload::jsonb;
end;
$$;

create or replace function analytics_cache_set(p_cache_key text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_student_id integer := auth_student_id();
begin
  if v_student_id is null then return; end if;
  insert into analytics_cache (student_id, cache_key, payload, computed_at)
  values (v_student_id, p_cache_key, p_payload::text, now())
  on conflict (student_id, cache_key)
  do update set payload = p_payload::text, computed_at = now();
end;
$$;

create or replace function invalidate_student_analytics_cache(p_student_id integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (is_admin() or auth_teacher_id() is not null) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  delete from analytics_cache where student_id = p_student_id;
end;
$$;
