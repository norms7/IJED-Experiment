-- Run in the Supabase SQL Editor after migrations 01-08. All fixtures and
-- generated notifications are rolled back when this script completes.
begin;

do $$
begin
  if to_regprocedure('public.get_beta_binomial_evidence(integer,integer[],numeric,character varying)') is not null
     or to_regprocedure('public.get_score_vs_class_average(integer,integer[],character varying)') is not null
     or to_regprocedure('public.get_student_attendance_calendar(integer,integer,integer,integer,character varying)') is not null then
    raise exception 'Legacy varchar overloads remain and make PostgREST RPC resolution ambiguous';
  end if;
  if to_regprocedure('public.get_beta_binomial_evidence(integer,integer[],numeric,text)') is null
     or to_regprocedure('public.get_score_vs_class_average(integer,integer[],text)') is null
     or to_regprocedure('public.get_student_attendance_calendar(integer,integer,integer,integer,text)') is null then
    raise exception 'Canonical text RPC signatures are missing';
  end if;
  raise notice 'PASS analytics RPCs have one canonical term signature';
end;
$$;

create temporary table performance_test_ids (
  student_one integer,
  student_two integer,
  student_three integer,
  teacher_id integer,
  notification_teacher_id integer,
  subject_id integer,
  other_subject_id integer,
  section_id integer,
  class_id integer,
  module_ids integer[],
  activity_ids integer[]
) on commit drop;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'perf-test-admin@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'perf-test-teacher-unassigned@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'perf-test-student-one@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'perf-test-student-two@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'perf-test-student-three@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '80000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'perf-test-teacher-assigned@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

do $$
declare
  v_admin_user integer;
  v_teacher_user integer;
  v_notification_teacher_user integer;
  v_student_user_ids integer[];
  v_teacher_id integer;
  v_notification_teacher_id integer;
  v_student_ids integer[];
  v_class_id integer;
  v_section_id integer;
  v_subject_id integer;
  v_other_subject_id integer;
  v_modules integer[];
  v_activities integer[];
  v_session_id integer;
  v_statuses text[] := array[
    'present','present','present','present','present','present','present',
    'late','late','absent','excused','excused'
  ];
  i integer;
begin
  select id into v_admin_user from users where auth_uid = '80000000-0000-4000-8000-000000000001';
  if v_admin_user is null then
    insert into users (auth_uid, email, first_name, last_name, role_id)
    values (
      '80000000-0000-4000-8000-000000000001',
      'perf-test-admin@example.invalid', 'Performance', 'Admin',
      (select id from roles where name = 'admin')
    ) returning id into v_admin_user;
  end if;

  insert into users (auth_uid, email, first_name, last_name, role_id)
  values (
    '80000000-0000-4000-8000-000000000002',
    'perf-test-teacher-unassigned@example.invalid', 'Performance', 'Unassigned Teacher',
    (select id from roles where name = 'teacher')
  ) returning id into v_teacher_user;

  insert into users (auth_uid, email, first_name, last_name, role_id)
  values (
    '80000000-0000-4000-8000-000000000006',
    'perf-test-teacher-assigned@example.invalid', 'Performance', 'Assigned Teacher',
    (select id from roles where name = 'teacher')
  ) returning id into v_notification_teacher_user;

  insert into users (auth_uid, email, first_name, last_name, role_id)
  values
    ('80000000-0000-4000-8000-000000000003', 'perf-test-student-one@example.invalid', 'Test', 'One', (select id from roles where name = 'student')),
    ('80000000-0000-4000-8000-000000000004', 'perf-test-student-two@example.invalid', 'Test', 'Two', (select id from roles where name = 'student')),
    ('80000000-0000-4000-8000-000000000005', 'perf-test-student-three@example.invalid', 'Test', 'Three', (select id from roles where name = 'student'));

  select array_agg(id order by id) into v_student_user_ids
  from users
  where auth_uid in (
    '80000000-0000-4000-8000-000000000003',
    '80000000-0000-4000-8000-000000000004',
    '80000000-0000-4000-8000-000000000005'
  );

  insert into teachers (user_id) values (v_teacher_user) returning id into v_teacher_id;
  insert into teachers (user_id) values (v_notification_teacher_user) returning id into v_notification_teacher_id;
  insert into students (user_id, student_number)
  select user_id, 'PERF-' || row_number() over (order by user_id)
  from unnest(v_student_user_ids) with ordinality as student_users(user_id, ordinal)
  order by ordinal;

  select array_agg(id order by user_id) into v_student_ids
  from students where user_id = any(v_student_user_ids);

  insert into classes (name, grade_level, school_year) values ('Performance Test Class', '11', 'TEST')
  returning id into v_class_id;
  insert into sections (name, class_id) values ('Performance Test Section', v_class_id)
  returning id into v_section_id;
  insert into subjects (name, description) values ('Performance Test Subject', 'transactional fixture')
  returning id into v_subject_id;
  insert into subjects (name, description) values ('Unassigned Performance Test Subject', 'authorization fixture')
  returning id into v_other_subject_id;
  insert into teacher_class_assignments (teacher_id, class_id, subject_id)
  values
    (v_teacher_id, v_class_id, v_other_subject_id),
    (v_notification_teacher_id, v_class_id, v_subject_id);

  insert into student_section_assignments (student_id, section_id)
  select student_id, v_section_id
  from unnest(v_student_ids) as assigned_students(student_id);
  insert into student_subject_enrollments (student_id, subject_id)
  select student_id, v_subject_id
  from unnest(v_student_ids) as enrolled_students(student_id);

  insert into modules (title, class_id, subject_id, teacher_id, term, is_published)
  select 'Performance Test Module ' || module_number, v_class_id, v_subject_id, v_teacher_id, '1st Term', true
  from generate_series(1, 10) as module_series(module_number);
  select array_agg(id order by id) into v_modules
  from modules where subject_id = v_subject_id and title like 'Performance Test Module %';
  insert into student_module_reads (student_id, module_id)
  select v_student_ids[1], module_id
  from unnest(v_modules[1:6]) as read_modules(module_id);

  insert into activities (title, activity_type, module_id, subject_id, teacher_id, term, max_score, due_date, is_published)
  values
    ('Performance Test Graded Activity', 'quiz', v_modules[1], v_subject_id, v_teacher_id, '1st Term', 80, now() - interval '1 day', true),
    ('Performance Test Missing Activity', 'quiz', v_modules[1], v_subject_id, v_teacher_id, 'first', 20, now() - interval '1 day', true);
  select array_agg(id order by array_position(
      array['Performance Test Graded Activity', 'Performance Test Missing Activity'], title
    )) into v_activities
  from activities
  where title in ('Performance Test Graded Activity', 'Performance Test Missing Activity');

  insert into activity_submissions (activity_id, student_id, score, max_score, is_graded)
  values
    (v_activities[1], v_student_ids[1], 58, null, true),
    (v_activities[1], v_student_ids[2], 76, 80, true),
    (v_activities[1], v_student_ids[3], 59, 80, true);

  for i in 1..array_length(v_statuses, 1) loop
    insert into attendance_sessions (teacher_id, class_id, subject_id, term, session_date, has_class)
    values (v_teacher_id, v_class_id, v_subject_id, '1st Term', current_date - (20 - i), true)
    returning id into v_session_id;
    insert into attendance_records (session_id, student_id, status)
    values (v_session_id, v_student_ids[1], v_statuses[i]);
  end loop;

  insert into performance_test_ids
  values (v_student_ids[1], v_student_ids[2], v_student_ids[3], v_teacher_id, v_notification_teacher_id,
          v_subject_id, v_other_subject_id, v_section_id, v_class_id, v_modules, v_activities);
end;
$$;

  grant select on performance_test_ids to authenticated;
  set local role authenticated;
set local "request.jwt.claims" = '{"sub":"80000000-0000-4000-8000-000000000003","role":"authenticated"}';

do $$
declare
  v_ids performance_test_ids%rowtype;
  v_components jsonb;
  v_row jsonb;
  v_evidence jsonb;
  v_chart_data jsonb;
  v_chart_row jsonb;
  v_leaderboard_data jsonb;
  v_denied boolean;
begin
  select * into v_ids from performance_test_ids;

  v_components := get_performance_components(v_ids.student_one, array[v_ids.subject_id], '1st');
  v_row := v_components->0;
  if (v_row->>'academic_earned')::numeric <> 58
     or (v_row->>'academic_possible')::numeric <> 100
     or (v_row->>'missing_count')::integer <> 1
     or (v_row->>'attendance_weighted')::numeric <> 8
     or (v_row->>'attendance_sessions')::integer <> 10
     or (v_row->>'modules_read')::integer <> 6
     or (v_row->>'modules_total')::integer <> 10 then
    raise exception 'Hand-calculated component assertion failed: %', v_row;
  end if;
  raise notice 'PASS components match earned=58/100, attendance=8/10, modules=6/10';

  if get_performance_components(v_ids.student_one, array[v_ids.subject_id], '1st')
     is distinct from get_performance_components(v_ids.student_one, array[v_ids.subject_id], '1st Term')
     or get_performance_components(v_ids.student_one, array[v_ids.subject_id], '1st')
     is distinct from get_performance_components(v_ids.student_one, array[v_ids.subject_id], 'first') then
    raise exception 'Term aliases did not produce identical component results';
  end if;
  raise notice 'PASS normalized term variants return identical results';

  v_leaderboard_data := get_engagement_leaderboard(v_ids.student_one, array[v_ids.subject_id], '1st');
  if jsonb_array_length(v_leaderboard_data->'leaderboard') <> 3
     or (v_leaderboard_data->>'my_rank')::integer <> 1
     or not exists (
       select 1
       from jsonb_array_elements(v_leaderboard_data->'leaderboard') entry
       where entry->>'name' = 'Test One'
         and (entry->>'is_me')::boolean = true
     ) then
    raise exception 'Engagement leaderboard did not return ranked top students and current student: %',
      v_leaderboard_data;
  end if;
  raise notice 'PASS engagement leaderboard is ranked, filtered, and includes the current student';

  v_chart_data := get_score_vs_class_average(v_ids.student_one, array[v_ids.subject_id], '1st');
  select value into v_chart_row
  from jsonb_array_elements(v_chart_data->'data')
  where value->>'activity_name' = 'Performance Test Graded Activity';
  if v_chart_row is null
     or (v_chart_row->>'my_score_pct')::numeric <> 72.5
     or v_chart_row->>'status' <> 'graded' then
    raise exception 'Graded student score did not fall back to the activity max score: %', v_chart_row;
  end if;
  raise notice 'PASS score-vs-class chart uses activity max score when submission max_score is null';

  v_evidence := get_beta_binomial_evidence(v_ids.student_one, array[v_ids.subject_id], 75, '1st');
  if (v_evidence->>'my_failures')::integer <> 2 then
    raise exception 'Past-due missing activity was not counted as a Bayesian failure: %', v_evidence;
  end if;
  if (v_evidence->>'peer_successes')::integer <> 1
     or (v_evidence->>'peer_failures')::integer <> 3 then
    raise exception 'Caller was not excluded or peer evidence unexpected: %', v_evidence;
  end if;
  raise notice 'PASS missing work counts as a failure and caller is excluded from peers';

  v_denied := false;
  begin
    perform get_performance_components(v_ids.student_two, array[v_ids.subject_id], '1st');
  exception when sqlstate '42501' then v_denied := true;
  end;
  if not v_denied then raise exception 'Cross-student component RPC did not raise 42501'; end if;

  v_denied := false;
  begin
    perform get_attendance_score(v_ids.student_two, array[v_ids.subject_id], '1st');
  exception when sqlstate '42501' then v_denied := true;
  end;
  if not v_denied then raise exception 'Cross-student attendance RPC did not raise 42501'; end if;

  v_denied := false;
  begin
    perform get_beta_binomial_evidence(v_ids.student_two, array[v_ids.subject_id], 75, '1st');
  exception when sqlstate '42501' then v_denied := true;
  end;
  if not v_denied then raise exception 'Cross-student Beta evidence RPC did not raise 42501'; end if;

  v_denied := false;
  begin
    perform get_score_vs_class_average(v_ids.student_two, array[v_ids.subject_id], '1st');
  exception when sqlstate '42501' then v_denied := true;
  end;
  if not v_denied then raise exception 'Cross-student class average RPC did not raise 42501'; end if;

  v_denied := false;
  begin
    perform get_engagement_percentile(v_ids.student_two, array[v_ids.subject_id], '1st');
  exception when sqlstate '42501' then v_denied := true;
  end;
  if not v_denied then raise exception 'Cross-student engagement RPC did not raise 42501'; end if;

  v_denied := false;
  begin
    perform get_engagement_leaderboard(v_ids.student_two, array[v_ids.subject_id], '1st');
  exception when sqlstate '42501' then v_denied := true;
  end;
  if not v_denied then raise exception 'Cross-student leaderboard RPC did not raise 42501'; end if;

  v_denied := false;
  begin
    perform get_engagement_leaderboard(v_ids.student_one, array[v_ids.other_subject_id], '1st');
  exception when sqlstate '42501' then v_denied := true;
  end;
  if not v_denied then raise exception 'Leaderboard accepted a subject the student is not enrolled in'; end if;

  v_denied := false;
  begin
    perform get_student_attendance_calendar(v_ids.student_two, v_ids.subject_id, null, null, '1st');
  exception when sqlstate '42501' then v_denied := true;
  end;
  if not v_denied then raise exception 'Cross-student calendar RPC did not raise 42501'; end if;

  v_denied := false;
  begin
    perform _student_attendance_rows(v_ids.student_two);
  exception when sqlstate '42501' then v_denied := true;
  end;
  if not v_denied then raise exception 'Direct attendance-row helper was not denied'; end if;
  raise notice 'PASS student cross-record calls, including direct helper, are denied with 42501';

  v_denied := false;
  begin
    perform get_class_performance(v_ids.subject_id, v_ids.section_id, '1st', 75);
  exception when sqlstate '42501' then v_denied := true;
  end;
  if not v_denied then raise exception 'Student was able to call class performance RPC'; end if;
  raise notice 'PASS class report RPC denies student caller';

  perform set_config('request.jwt.claims',
    '{"sub":"80000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  v_denied := false;
  begin
    perform get_class_performance(v_ids.subject_id, v_ids.section_id, '1st', 75);
  exception when sqlstate '42501' then v_denied := true;
  end;
  if not v_denied then raise exception 'Unassigned teacher was able to call class performance RPC'; end if;
  raise notice 'PASS unassigned teacher is denied class performance RPC';
end;
$$;

reset role;
set local "request.jwt.claims" = '{"sub":"80000000-0000-4000-8000-000000000006","role":"authenticated"}';

do $$
declare
  v_before_logs integer;
  v_after_logs integer;
  v_before_notifications integer;
  v_after_notifications integer;
begin
  select count(*) into v_before_logs
  from performance_notification_log
  where kind = 'backlog'
    and student_id in (
      select unnest(array[student_one, student_two, student_three])
      from performance_test_ids
    );
  select count(*) into v_before_notifications
  from notifications
  where notification_type = 'backlog_activity'
    and target_user_id in (
      select s.user_id from students s
      where s.id in (
        select unnest(array[student_one, student_two, student_three])
        from performance_test_ids
      )
    );
  perform generate_performance_notifications();
  select count(*) into v_after_logs
  from performance_notification_log
  where kind = 'backlog'
    and student_id in (
      select unnest(array[student_one, student_two, student_three])
      from performance_test_ids
    );
  select count(*) into v_after_notifications
  from notifications
  where notification_type = 'backlog_activity'
    and target_user_id in (
      select s.user_id from students s
      where s.id in (
        select unnest(array[student_one, student_two, student_three])
        from performance_test_ids
      )
    );
  if v_after_logs <> v_before_logs + 3 or v_after_notifications <> v_before_notifications + 3 then
    raise exception 'Expected three fixture backlog notifications on first run; logs %, notifications %',
      v_after_logs - v_before_logs, v_after_notifications - v_before_notifications;
  end if;

  perform generate_performance_notifications();
  if (select count(*) from performance_notification_log
      where kind = 'backlog'
    and student_id in (
      select unnest(array[student_one, student_two, student_three])
      from performance_test_ids
    )) <> v_after_logs
     or (select count(*) from notifications
     where notification_type = 'backlog_activity'
       and target_user_id in (
         select s.user_id from students s
         where s.id in (
           select unnest(array[student_one, student_two, student_three])
           from performance_test_ids
         )
       )) <> v_after_notifications then
    raise exception 'Repeated notification generation created duplicate records';
  end if;
  raise notice 'PASS notifications are deduplicated across repeated generator calls';
end;
$$;

reset role;
rollback;
