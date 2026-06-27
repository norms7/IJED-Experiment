-- ============================================================================
-- IJED LMS — Helper functions + Row Level Security policies
-- Run AFTER 01_schema.sql
--
-- These helper functions translate auth.uid() (the logged-in Supabase Auth
-- user) into your existing integer ids. They are STABLE + SECURITY DEFINER
-- so they can be used inside RLS policies without recursive-RLS issues.
-- ============================================================================

-- ── auth_user_id(): the `users.id` row for the currently logged-in person ────
create or replace function auth_user_id()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select id from users where auth_uid = auth.uid();
$$;

-- ── auth_role(): 'admin' | 'teacher' | 'student' | null ──────────────────────
create or replace function auth_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.name
  from users u join roles r on r.id = u.role_id
  where u.auth_uid = auth.uid();
$$;

-- ── auth_teacher_id(): teachers.id for the current user, or null ─────────────
create or replace function auth_teacher_id()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select t.id from teachers t
  join users u on u.id = t.user_id
  where u.auth_uid = auth.uid();
$$;

-- ── auth_student_id(): students.id for the current user, or null ─────────────
create or replace function auth_student_id()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select s.id from students s
  join users u on u.id = s.user_id
  where u.auth_uid = auth.uid();
$$;

-- ── is_admin() shortcut ───────────────────────────────────────────────────────
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth_role() = 'admin';
$$;

-- ============================================================================
-- ENABLE RLS ON EVERY TABLE
-- ============================================================================
alter table roles                          enable row level security;
alter table users                          enable row level security;
alter table subjects                       enable row level security;
alter table classes                        enable row level security;
alter table sections                       enable row level security;
alter table teachers                       enable row level security;
alter table teacher_class_assignments      enable row level security;
alter table students                       enable row level security;
alter table student_section_assignments    enable row level security;
alter table student_subject_enrollments    enable row level security;
alter table modules                        enable row level security;
alter table activities                     enable row level security;
alter table activity_questions             enable row level security;
alter table activity_question_choices      enable row level security;
alter table activity_submissions           enable row level security;
alter table activity_answers               enable row level security;
alter table student_module_reads           enable row level security;
alter table notifications                  enable row level security;
alter table attendance_sessions            enable row level security;
alter table attendance_records             enable row level security;
alter table analytics_cache                enable row level security;

-- ============================================================================
-- roles — everyone logged in can read (needed for role lookups/dropdowns)
-- ============================================================================
create policy roles_select_all on roles for select
  using (auth.uid() is not null);
create policy roles_admin_write on roles for all
  using (is_admin()) with check (is_admin());

-- ============================================================================
-- users — admin sees all; everyone sees their own row
-- ============================================================================
create policy users_select_self_or_admin on users for select
  using (is_admin() or auth_uid = auth.uid());
create policy users_admin_write on users for insert
  with check (is_admin());
create policy users_admin_update on users for update
  using (is_admin() or auth_uid = auth.uid())
  with check (is_admin() or auth_uid = auth.uid());
create policy users_admin_delete on users for delete
  using (is_admin());

-- ============================================================================
-- subjects / classes — readable by all logged-in users, admin-only writes
-- ============================================================================
create policy subjects_select_all on subjects for select
  using (auth.uid() is not null);
create policy subjects_admin_write on subjects for all
  using (is_admin()) with check (is_admin());

create policy classes_select_all on classes for select
  using (auth.uid() is not null);
create policy classes_admin_write on classes for all
  using (is_admin()) with check (is_admin());

create policy sections_select_all on sections for select
  using (auth.uid() is not null);
create policy sections_admin_write on sections for all
  using (is_admin()) with check (is_admin());

-- ============================================================================
-- teachers — admin full access; teacher can read/update own profile
-- ============================================================================
create policy teachers_select on teachers for select
  using (is_admin() or user_id = auth_user_id());
create policy teachers_admin_write on teachers for insert
  with check (is_admin());
create policy teachers_update on teachers for update
  using (is_admin() or user_id = auth_user_id())
  with check (is_admin() or user_id = auth_user_id());
create policy teachers_admin_delete on teachers for delete
  using (is_admin());

-- ============================================================================
-- teacher_class_assignments — admin all; teacher reads own
-- ============================================================================
create policy tca_select on teacher_class_assignments for select
  using (is_admin() or teacher_id = auth_teacher_id());
create policy tca_admin_write on teacher_class_assignments for all
  using (is_admin()) with check (is_admin());

-- ============================================================================
-- students — admin full; student reads/updates own; teacher reads students
-- in their assigned classes
-- ============================================================================
create policy students_select on students for select
  using (
    is_admin()
    or user_id = auth_user_id()
    or (
      auth_role() = 'teacher' and exists (
        select 1
        from student_section_assignments ssa
        join sections sec on sec.id = ssa.section_id
        join teacher_class_assignments tca on tca.class_id = sec.class_id
        where ssa.student_id = students.id
          and tca.teacher_id = auth_teacher_id()
      )
    )
  );
create policy students_admin_write on students for insert
  with check (is_admin());
create policy students_update on students for update
  using (is_admin() or user_id = auth_user_id())
  with check (is_admin() or user_id = auth_user_id());
create policy students_admin_delete on students for delete
  using (is_admin());

-- ============================================================================
-- student_section_assignments — admin all; student reads own; teacher reads
-- assignments for their classes
-- ============================================================================
create policy ssa_select on student_section_assignments for select
  using (
    is_admin()
    or student_id = auth_student_id()
    or (
      auth_role() = 'teacher' and exists (
        select 1 from sections sec
        join teacher_class_assignments tca on tca.class_id = sec.class_id
        where sec.id = student_section_assignments.section_id
          and tca.teacher_id = auth_teacher_id()
      )
    )
  );
create policy ssa_admin_write on student_section_assignments for all
  using (is_admin()) with check (is_admin());

-- ============================================================================
-- student_subject_enrollments — admin all; student reads own; teacher reads
-- enrollments for subjects they teach
-- ============================================================================
create policy sse_select on student_subject_enrollments for select
  using (
    is_admin()
    or student_id = auth_student_id()
    or (
      auth_role() = 'teacher' and exists (
        select 1 from teacher_class_assignments tca
        where tca.subject_id = student_subject_enrollments.subject_id
          and tca.teacher_id = auth_teacher_id()
      )
    )
  );
create policy sse_admin_write on student_subject_enrollments for all
  using (is_admin()) with check (is_admin());

-- ============================================================================
-- modules — published modules visible to enrolled students + assigned
-- teachers; admin sees all; teacher manages their own
-- ============================================================================
create policy modules_select on modules for select
  using (
    is_admin()
    or teacher_id = auth_teacher_id()
    or (
      is_published and auth_role() = 'student' and exists (
        select 1 from student_subject_enrollments sse
        where sse.subject_id = modules.subject_id
          and sse.student_id = auth_student_id()
      )
    )
  );
create policy modules_teacher_insert on modules for insert
  with check (is_admin() or teacher_id = auth_teacher_id());
create policy modules_teacher_update on modules for update
  using (is_admin() or teacher_id = auth_teacher_id())
  with check (is_admin() or teacher_id = auth_teacher_id());
create policy modules_teacher_delete on modules for delete
  using (is_admin() or teacher_id = auth_teacher_id());

-- ============================================================================
-- activities — same shape as modules, scoped through module
-- ============================================================================
create policy activities_select on activities for select
  using (
    is_admin()
    or teacher_id = auth_teacher_id()
    or (
      is_published and auth_role() = 'student' and exists (
        select 1 from student_subject_enrollments sse
        where sse.subject_id = activities.subject_id
          and sse.student_id = auth_student_id()
      )
    )
  );
create policy activities_teacher_insert on activities for insert
  with check (is_admin() or teacher_id = auth_teacher_id());
create policy activities_teacher_update on activities for update
  using (is_admin() or teacher_id = auth_teacher_id())
  with check (is_admin() or teacher_id = auth_teacher_id());
create policy activities_teacher_delete on activities for delete
  using (is_admin() or teacher_id = auth_teacher_id());

-- ============================================================================
-- activity_questions / activity_question_choices — visible if parent activity
-- is visible; students NEVER see correct_answer (handled by a view, see below)
-- ============================================================================
create policy questions_select on activity_questions for select
  using (
    exists (
      select 1 from activities a
      where a.id = activity_questions.activity_id
        and (
          is_admin()
          or a.teacher_id = auth_teacher_id()
          or (a.is_published and auth_role() = 'student')
        )
    )
  );
create policy questions_teacher_write on activity_questions for all
  using (
    is_admin() or exists (
      select 1 from activities a
      where a.id = activity_questions.activity_id and a.teacher_id = auth_teacher_id()
    )
  )
  with check (
    is_admin() or exists (
      select 1 from activities a
      where a.id = activity_questions.activity_id and a.teacher_id = auth_teacher_id()
    )
  );

create policy choices_select on activity_question_choices for select
  using (
    exists (
      select 1 from activity_questions q join activities a on a.id = q.activity_id
      where q.id = activity_question_choices.question_id
        and (
          is_admin()
          or a.teacher_id = auth_teacher_id()
          or (a.is_published and auth_role() = 'student')
        )
    )
  );
create policy choices_teacher_write on activity_question_choices for all
  using (
    is_admin() or exists (
      select 1 from activity_questions q join activities a on a.id = q.activity_id
      where q.id = activity_question_choices.question_id and a.teacher_id = auth_teacher_id()
    )
  )
  with check (
    is_admin() or exists (
      select 1 from activity_questions q join activities a on a.id = q.activity_id
      where q.id = activity_question_choices.question_id and a.teacher_id = auth_teacher_id()
    )
  );

-- IMPORTANT: correct_answer must never reach students directly via
-- supabase.from('activity_questions').select('*'). Use the
-- `student_safe_questions` view (created in 03) for student-facing reads.

-- ============================================================================
-- activity_submissions — student sees own; teacher sees submissions for
-- their activities; admin sees all. INSERT/UPDATE go through RPCs only
-- (submit_activity / manual_grade_submission) — no direct client writes.
-- ============================================================================
create policy submissions_select on activity_submissions for select
  using (
    is_admin()
    or student_id = auth_student_id()
    or exists (
      select 1 from activities a
      where a.id = activity_submissions.activity_id and a.teacher_id = auth_teacher_id()
    )
  );
-- No insert/update/delete policies for students or teachers — all writes
-- happen via SECURITY DEFINER RPC functions (see 03_functions.sql) so that
-- auto-grading, past-due checks, and notifications stay server-enforced.
create policy submissions_admin_write on activity_submissions for all
  using (is_admin()) with check (is_admin());

create policy answers_select on activity_answers for select
  using (
    is_admin()
    or exists (
      select 1 from activity_submissions s
      where s.id = activity_answers.submission_id and s.student_id = auth_student_id()
    )
    or exists (
      select 1 from activity_submissions s join activities a on a.id = s.activity_id
      where s.id = activity_answers.submission_id and a.teacher_id = auth_teacher_id()
    )
  );
create policy answers_admin_write on activity_answers for all
  using (is_admin()) with check (is_admin());

-- ============================================================================
-- student_module_reads — student manages own; teacher/admin can read theirs
-- ============================================================================
create policy smr_select on student_module_reads for select
  using (
    is_admin()
    or student_id = auth_student_id()
    or exists (
      select 1 from modules m where m.id = student_module_reads.module_id
        and m.teacher_id = auth_teacher_id()
    )
  );
create policy smr_student_write on student_module_reads for all
  using (is_admin() or student_id = auth_student_id())
  with check (is_admin() or student_id = auth_student_id());

-- ============================================================================
-- notifications — each user sees only their own; writes via RPC only
-- ============================================================================
create policy notifications_select on notifications for select
  using (target_user_id = auth_user_id());
create policy notifications_update_own on notifications for update
  using (target_user_id = auth_user_id())
  with check (target_user_id = auth_user_id());
create policy notifications_admin_write on notifications for insert
  with check (is_admin());
create policy notifications_admin_delete on notifications for delete
  using (target_user_id = auth_user_id() or is_admin());

-- ============================================================================
-- attendance_sessions / attendance_records — teacher manages their classes;
-- student reads own attendance; admin sees all
-- ============================================================================
create policy att_sessions_select on attendance_sessions for select
  using (
    is_admin()
    or teacher_id = auth_teacher_id()
    or exists (
      select 1 from attendance_records r
      where r.session_id = attendance_sessions.id and r.student_id = auth_student_id()
    )
  );
create policy att_sessions_teacher_write on attendance_sessions for all
  using (is_admin() or teacher_id = auth_teacher_id())
  with check (is_admin() or teacher_id = auth_teacher_id());

create policy att_records_select on attendance_records for select
  using (
    is_admin()
    or student_id = auth_student_id()
    or exists (
      select 1 from attendance_sessions s
      where s.id = attendance_records.session_id and s.teacher_id = auth_teacher_id()
    )
  );
create policy att_records_teacher_write on attendance_records for all
  using (
    is_admin() or exists (
      select 1 from attendance_sessions s
      where s.id = attendance_records.session_id and s.teacher_id = auth_teacher_id()
    )
  )
  with check (
    is_admin() or exists (
      select 1 from attendance_sessions s
      where s.id = attendance_records.session_id and s.teacher_id = auth_teacher_id()
    )
  );

-- ============================================================================
-- analytics_cache — student owns their own cache rows only
-- ============================================================================
create policy analytics_cache_select on analytics_cache for select
  using (is_admin() or student_id = auth_student_id());
create policy analytics_cache_write on analytics_cache for all
  using (is_admin() or student_id = auth_student_id())
  with check (is_admin() or student_id = auth_student_id());
