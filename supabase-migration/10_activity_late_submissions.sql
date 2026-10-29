begin;

alter table activities
  add column if not exists allow_late_submission boolean not null default false,
  add column if not exists late_penalty_points integer not null default 0
    check (late_penalty_points between 0 and 1000);

alter table activity_submissions
  add column if not exists is_late boolean not null default false,
  add column if not exists late_penalty_points integer not null default 0
    check (late_penalty_points between 0 and 1000);

create or replace function submit_activity(
  p_activity_id integer,
  p_answers jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id integer := auth_student_id();
  v_activity activities%rowtype;
  v_submission_id integer;
  v_total_earned integer := 0;
  v_max_score integer;
  v_all_auto boolean := true;
  v_ans jsonb;
  v_question activity_questions%rowtype;
  v_is_correct boolean;
  v_pts integer;
  v_pct numeric;
  v_grade text;
  v_score integer;
  v_is_graded boolean;
  v_remarks text;
  v_teacher_user_id integer;
  v_student_name text;
  v_is_late boolean := false;
begin
  if v_student_id is null then
    raise exception 'Not a student account' using errcode = '42501';
  end if;

  select * into v_activity
  from activities
  where id = p_activity_id and is_published = true;
  if v_activity.id is null then
    raise exception 'Activity not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from student_subject_enrollments sse
    where sse.student_id = v_student_id and sse.subject_id = v_activity.subject_id
  ) then
    raise exception 'Not enrolled in this activity''s subject' using errcode = '42501';
  end if;

  if v_activity.start_date is not null and now() < v_activity.start_date then
    raise exception 'This activity is not open yet.' using errcode = '42501';
  end if;

  v_is_late := v_activity.due_date is not null and now() > v_activity.due_date;
  if v_is_late and not v_activity.allow_late_submission then
    raise exception 'This activity is past its due date. No late submissions are accepted.'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from activity_submissions
    where activity_id = p_activity_id and student_id = v_student_id
  ) then
    raise exception 'You have already submitted this activity.' using errcode = '23505';
  end if;

  select coalesce(nullif(sum(points), 0), v_activity.max_score, 0)::integer
    into v_max_score
  from activity_questions
  where activity_id = p_activity_id;
  update activities set max_score = v_max_score where id = p_activity_id;

  insert into activity_submissions (
    activity_id, student_id, max_score, submitted_at, is_late, late_penalty_points
  )
  values (
    p_activity_id, v_student_id, v_max_score, now(), v_is_late,
    case when v_is_late then v_activity.late_penalty_points else 0 end
  )
  returning id into v_submission_id;

  for v_ans in select * from jsonb_array_elements(p_answers) loop
    select * into v_question
    from activity_questions
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

  if v_activity.grading_mode = 'auto' then
    if v_all_auto then
      v_score := greatest(
        0,
        v_total_earned - case when v_is_late then v_activity.late_penalty_points else 0 end
      );
      v_is_graded := true;
      v_pct := case when v_max_score > 0
        then least((v_score::numeric / v_max_score * 100), 100.0)
        else 0 end;
      v_grade := case
        when v_pct >= 100 then '1.00' when v_pct >= 97 then '1.25' when v_pct >= 94 then '1.50'
        when v_pct >= 91 then '1.75' when v_pct >= 88 then '2.00' when v_pct >= 85 then '2.25'
        when v_pct >= 82 then '2.50' when v_pct >= 79 then '2.75' when v_pct >= 75 then '3.00'
        else '5.00' end;
      v_remarks := 'Auto-graded';
      if v_is_late and v_activity.late_penalty_points > 0 then
        v_remarks := v_remarks || ' Late penalty: ' || v_activity.late_penalty_points || ' points deducted.';
      end if;
    else
      v_score := v_total_earned;
      v_is_graded := false;
      v_grade := null;
      v_remarks := 'Partial auto-grade — awaiting teacher review';
      if v_is_late and v_activity.late_penalty_points > 0 then
        v_remarks := v_remarks || ' Late penalty of ' || v_activity.late_penalty_points || ' points will apply after grading.';
      end if;
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

  select (first_name || ' ' || last_name) into v_student_name
  from users u join students s on s.user_id = u.id
  where s.id = v_student_id;

  select t.user_id into v_teacher_user_id
  from teachers t where t.id = v_activity.teacher_id;
  if v_teacher_user_id is null and v_activity.subject_id is not null then
    select t.user_id into v_teacher_user_id
    from teachers t
    join teacher_class_assignments tca on tca.teacher_id = t.id
    where tca.subject_id = v_activity.subject_id
    limit 1;
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
    'id', v_submission_id, 'activity_id', p_activity_id, 'student_id', v_student_id,
    'score', v_score, 'max_score', v_max_score, 'grade', v_grade,
    'remarks', v_remarks, 'is_graded', v_is_graded, 'grading_mode', v_activity.grading_mode
  );
end;
$$;

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
  v_activity activities%rowtype;
  v_submission activity_submissions%rowtype;
  v_pct numeric;
  v_final_grade text;
  v_score integer;
  v_student_user_id integer;
  v_student_name text;
  v_score_str text;
  v_remarks text;
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

  v_score := greatest(
    0,
    p_score - case when v_submission.is_late then v_submission.late_penalty_points else 0 end
  );
  v_final_grade := p_grade;
  if v_final_grade is null and v_activity.max_score is not null and v_activity.max_score > 0 then
    v_pct := v_score::numeric / v_activity.max_score * 100;
    v_final_grade := case
      when v_pct >= 100 then '1.00' when v_pct >= 97 then '1.25' when v_pct >= 94 then '1.50'
      when v_pct >= 91 then '1.75' when v_pct >= 88 then '2.00' when v_pct >= 85 then '2.25'
      when v_pct >= 82 then '2.50' when v_pct >= 79 then '2.75' when v_pct >= 75 then '3.00'
      else '5.00' end;
  end if;

  v_remarks := p_remarks;
  if v_submission.is_late and v_submission.late_penalty_points > 0 then
    v_remarks := concat_ws(' ', nullif(trim(p_remarks), ''),
      'Late penalty:', v_submission.late_penalty_points, 'points deducted.');
  end if;
  update activity_submissions
  set score = v_score, max_score = v_activity.max_score, grade = v_final_grade,
      remarks = v_remarks, is_graded = true
  where id = p_submission_id;

  select u.id, (u.first_name || ' ' || u.last_name)
    into v_student_user_id, v_student_name
  from users u join students s on s.user_id = u.id
  where s.id = v_submission.student_id;
  v_score_str := v_score || coalesce('/' || v_activity.max_score, '');

  perform _notify(v_student_user_id, (select user_id from teachers where id = v_teacher_id),
    'activity_graded', 'Activity Graded',
    'Your submission for ''' || v_activity.title || ''' has been graded: ' || v_score_str || '.',
    'activity', v_activity.id);
  perform _notify_many(_admin_user_ids(), (select user_id from teachers where id = v_teacher_id),
    'activity_graded', 'Activity Graded',
    'Teacher graded ''' || v_activity.title || ''' for ' || v_student_name || ': ' || v_score_str || '.',
    'activity', v_activity.id);

  delete from analytics_cache where student_id = v_submission.student_id;
  return jsonb_build_object(
    'id', p_submission_id, 'score', v_score, 'max_score', v_activity.max_score,
    'grade', v_final_grade, 'remarks', v_remarks, 'is_graded', true
  );
end;
$$;

commit;
