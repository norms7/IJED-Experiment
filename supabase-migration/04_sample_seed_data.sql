-- ============================================================================
-- IJED LMS — Sample seed data for testing the Supabase-only experiment
-- Run AFTER 01_schema.sql, 02_rls_policies.sql, 03_functions.sql
--
-- This creates `users` PROFILE rows only (auth_uid stays null for now).
-- You still need to create the matching Supabase Auth accounts — see
-- "ACCOUNTS TO CREATE" below. The on_auth_user_created trigger will then
-- auto-link each Auth account to its profile row by matching email.
-- ============================================================================

do $$
declare
  v_admin_id        integer;
  v_teacher1_user_id integer; v_teacher1_id integer;
  v_teacher2_user_id integer; v_teacher2_id integer;
  v_student_user_id  integer; v_student_id   integer;
  v_student_ids      integer[] := '{}';

  v_class_id   integer;
  v_section_id integer;

  v_subj_math    integer;
  v_subj_science integer;
  v_subj_english integer;

  v_mod_math1 integer; v_mod_sci1 integer;

  v_act_quiz   integer;  -- auto-graded multiple choice
  v_act_essay  integer;  -- manual grading

  v_q1 integer; v_q2 integer; v_q3 integer;

  v_session_id integer;

  v_role_admin   integer;
  v_role_teacher integer;
  v_role_student integer;

  v_names text[] := array['Ana Reyes','Ben Tan','Carla Lim','Dario Cruz','Elena Bautista'];
  v_emails text[] := array[
    'student1@ijed.test','student2@ijed.test','student3@ijed.test',
    'student4@ijed.test','student5@ijed.test'
  ];
  i integer;
  name_parts text[];
begin
  select id into v_role_admin   from roles where name = 'admin';
  select id into v_role_teacher from roles where name = 'teacher';
  select id into v_role_student from roles where name = 'student';

  -- ── Admin ────────────────────────────────────────────────────────────────
  insert into users (email, first_name, last_name, role_id, is_active)
  values ('admin@ijed.test', 'Grace', 'Villanueva', v_role_admin, true)
  returning id into v_admin_id;

  -- ── Subjects ─────────────────────────────────────────────────────────────
  insert into subjects (name, description) values
    ('Mathematics 7', 'Grade 7 Mathematics — Numbers and Algebra')
    returning id into v_subj_math;
  insert into subjects (name, description) values
    ('Science 7', 'Grade 7 Science — Living and Non-Living Things')
    returning id into v_subj_science;
  insert into subjects (name, description) values
    ('English 7', 'Grade 7 English — Reading and Composition')
    returning id into v_subj_english;

  -- ── Class + Section ──────────────────────────────────────────────────────
  insert into classes (name, grade_level, school_year, is_active)
  values ('Grade 7 - Faith', '7', '2025-2026', true)
  returning id into v_class_id;

  insert into sections (name, class_id) values ('Section A', v_class_id)
  returning id into v_section_id;

  -- ── Teacher 1: Maria Santos (Math + Science) ────────────────────────────
  insert into users (email, first_name, last_name, role_id, is_active)
  values ('teacher1@ijed.test', 'Maria', 'Santos', v_role_teacher, true)
  returning id into v_teacher1_user_id;

  insert into teachers (user_id, employee_id, specialization, contact_number)
  values (v_teacher1_user_id, 'EMP-2026-001', 'Mathematics & Science', '09171234567')
  returning id into v_teacher1_id;

  insert into teacher_class_assignments (teacher_id, class_id, subject_id, schedule)
  values
    (v_teacher1_id, v_class_id, v_subj_math, 'MWF 8:00-9:00'),
    (v_teacher1_id, v_class_id, v_subj_science, 'TTh 9:00-10:30');

  -- ── Teacher 2: Juan Cruz (English) ──────────────────────────────────────
  insert into users (email, first_name, last_name, role_id, is_active)
  values ('teacher2@ijed.test', 'Juan', 'Cruz', v_role_teacher, true)
  returning id into v_teacher2_user_id;

  insert into teachers (user_id, employee_id, specialization, contact_number)
  values (v_teacher2_user_id, 'EMP-2026-002', 'English', '09181234567')
  returning id into v_teacher2_id;

  insert into teacher_class_assignments (teacher_id, class_id, subject_id, schedule)
  values (v_teacher2_id, v_class_id, v_subj_english, 'MWF 10:00-11:00');

  -- ── 5 Students, all in Section A, all enrolled in all 3 subjects ────────
  for i in 1..5 loop
    name_parts := string_to_array(v_names[i], ' ');
    insert into users (email, first_name, last_name, role_id, is_active)
    values (v_emails[i], name_parts[1], name_parts[2], v_role_student, true)
    returning id into v_student_user_id;

    insert into students (user_id, student_number, contact_number, guardian_name, guardian_contact)
    values (
      v_student_user_id, 'STU-2026-' || lpad(i::text, 3, '0'),
      '0917000' || lpad(i::text, 4, '0'),
      'Guardian of ' || v_names[i], '0918000' || lpad(i::text, 4, '0')
    )
    returning id into v_student_id;

    insert into student_section_assignments (student_id, section_id) values (v_student_id, v_section_id);
    insert into student_subject_enrollments (student_id, subject_id) values
      (v_student_id, v_subj_math), (v_student_id, v_subj_science), (v_student_id, v_subj_english);

    v_student_ids := array_append(v_student_ids, v_student_id);
  end loop;

  -- ── Modules (Teacher 1) ──────────────────────────────────────────────────
  insert into modules (title, description, class_id, subject_id, teacher_id, "order", term, is_published)
  values ('Module 1: Integers', 'Introduction to positive and negative integers.',
          v_class_id, v_subj_math, v_teacher1_id, 1, '1st', true)
  returning id into v_mod_math1;

  insert into modules (title, description, class_id, subject_id, teacher_id, "order", term, is_published)
  values ('Module 1: Cells', 'The basic unit of life.',
          v_class_id, v_subj_science, v_teacher1_id, 1, '1st', true)
  returning id into v_mod_sci1;

  -- ── Activity 1: Auto-graded multiple-choice quiz (Math) ─────────────────
  insert into activities (title, description, instructions, activity_type, format_type,
                          grading_mode, module_id, subject_id, teacher_id, max_score,
                          start_date, due_date, is_published)
  values ('Integers Quiz 1', 'Quick check on integer operations.',
          'Choose the best answer for each item.', 'quiz', 'multiple_choice', 'auto',
          v_mod_math1, v_subj_math, v_teacher1_id, 3,
          now() - interval '2 days', now() + interval '5 days', true)
  returning id into v_act_quiz;

  insert into activity_questions (activity_id, "order", question_text, question_type, points, correct_answer)
  values (v_act_quiz, 1, 'What is (-5) + 8?', 'multiple_choice', 1, '1')
  returning id into v_q1;
  insert into activity_question_choices (question_id, "order", choice_text) values
    (v_q1, 0, '-13'), (v_q1, 1, '3'), (v_q1, 2, '13'), (v_q1, 3, '-3');

  insert into activity_questions (activity_id, "order", question_text, question_type, points, correct_answer)
  values (v_act_quiz, 2, 'What is (-4) x (-3)?', 'multiple_choice', 1, '2')
  returning id into v_q2;
  insert into activity_question_choices (question_id, "order", choice_text) values
    (v_q2, 0, '-12'), (v_q2, 1, '-7'), (v_q2, 2, '12'), (v_q2, 3, '7');

  insert into activity_questions (activity_id, "order", question_text, question_type, points, correct_answer)
  values (v_act_quiz, 3, 'What is 9 - 15?', 'multiple_choice', 1, '0')
  returning id into v_q3;
  insert into activity_question_choices (question_id, "order", choice_text) values
    (v_q3, 0, '-6'), (v_q3, 1, '6'), (v_q3, 2, '24'), (v_q3, 3, '-24');

  -- ── Activity 2: Manual-graded essay (Science) ───────────────────────────
  insert into activities (title, description, instructions, activity_type, format_type,
                          grading_mode, module_id, subject_id, teacher_id, max_score,
                          start_date, due_date, is_published)
  values ('Cell Theory Reflection', 'Short reflection on what you learned about cells.',
          'Write 3-5 sentences.', 'assignment', 'freeform', 'manual',
          v_mod_sci1, v_subj_science, v_teacher1_id, 10,
          now() - interval '1 day', now() + interval '7 days', true)
  returning id into v_act_essay;

  insert into activity_questions (activity_id, "order", question_text, question_type, points)
  values (v_act_essay, 1, 'What did you learn about cells this week?', 'essay', 10);

  -- ── Attendance: one session, mixed statuses ─────────────────────────────
  insert into attendance_sessions (teacher_id, class_id, subject_id, term, session_date, has_class, notes)
  values (v_teacher1_id, v_class_id, v_subj_math, '1st', current_date - 1, true, 'Regular session')
  returning id into v_session_id;

  insert into attendance_records (session_id, student_id, status) values
    (v_session_id, v_student_ids[1], 'present'),
    (v_session_id, v_student_ids[2], 'present'),
    (v_session_id, v_student_ids[3], 'late'),
    (v_session_id, v_student_ids[4], 'absent'),
    (v_session_id, v_student_ids[5], 'present');

  raise notice 'Seed complete. admin_id=%, teacher1_id=%, teacher2_id=%, student_ids=%',
    v_admin_id, v_teacher1_id, v_teacher2_id, v_student_ids;
end $$;
