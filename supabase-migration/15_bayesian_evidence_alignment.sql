-- Align student and teacher Bayesian evidence without changing stored data.
-- Safe to rerun: only function definitions and RPC privileges are updated.

create or replace function public.get_beta_binomial_evidence(
  p_student_id integer,
  p_subject_ids integer[] default null,
  p_target_pct numeric default 75,
  p_term text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_student_id integer := auth_student_id();
  v_subject_ids integer[];
  v_target numeric := coalesce(p_target_pct, 75);
  v_term text := normalize_term(p_term);
  v_result jsonb;
begin
  if not is_admin() and (v_caller_student_id is null or v_caller_student_id <> p_student_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_subject_ids is null then
    select coalesce(array_agg(distinct sse.subject_id), '{}'::integer[])
      into v_subject_ids
    from student_subject_enrollments sse
    where sse.student_id = p_student_id;
  else
    select coalesce(array_agg(distinct requested.subject_id), '{}'::integer[])
      into v_subject_ids
    from unnest(p_subject_ids) requested(subject_id)
    where requested.subject_id is not null;
  end if;

  if not is_admin() and exists (
    select 1
    from unnest(v_subject_ids) requested(subject_id)
    where not exists (
      select 1
      from student_subject_enrollments sse
      where sse.student_id = p_student_id
        and sse.subject_id = requested.subject_id
    )
  ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  with own_graded as (
    select
      (
        s.score::numeric
        / nullif(coalesce(nullif(s.max_score, 0), a.max_score), 0)
        * 100
      ) >= v_target as success_flag
    from activity_submissions s
    join activities a on a.id = s.activity_id
    where s.student_id = p_student_id
      and a.subject_id = any(v_subject_ids)
      and a.is_published is true
      and (v_term is null or normalize_term(a.term) = v_term)
      and s.is_graded is true
      and s.score is not null
      and coalesce(nullif(s.max_score, 0), a.max_score, 0) > 0
  ),
  own_missing as (
    select false as success_flag
    from activities a
    where a.subject_id = any(v_subject_ids)
      and a.is_published is true
      and (v_term is null or normalize_term(a.term) = v_term)
      and (a.due_date is null or a.due_date <= now())
      and coalesce(nullif(a.max_score, 0), 0) > 0
      and not exists (
        select 1
        from activity_submissions s
        where s.activity_id = a.id
          and s.student_id = p_student_id
      )
  ),
  own_evidence as (
    select success_flag, false as missing_flag from own_graded
    union all
    select success_flag, true as missing_flag from own_missing
  ),
  peer_graded as (
    select
      (
        s.score::numeric
        / nullif(coalesce(nullif(s.max_score, 0), a.max_score), 0)
        * 100
      ) >= v_target as success_flag
    from activity_submissions s
    join activities a on a.id = s.activity_id
    join students st on st.id = s.student_id
    join users u on u.id = st.user_id and u.is_active is true
    where s.student_id <> p_student_id
      and a.subject_id = any(v_subject_ids)
      and a.is_published is true
      and (v_term is null or normalize_term(a.term) = v_term)
      and s.is_graded is true
      and s.score is not null
      and coalesce(nullif(s.max_score, 0), a.max_score, 0) > 0
      and exists (
        select 1
        from student_subject_enrollments sse
        where sse.student_id = s.student_id
          and sse.subject_id = a.subject_id
      )
  ),
  peer_missing as (
    select false as success_flag
    from activities a
    cross join students st
    join users u on u.id = st.user_id and u.is_active is true
    where st.id <> p_student_id
      and a.subject_id = any(v_subject_ids)
      and a.is_published is true
      and (v_term is null or normalize_term(a.term) = v_term)
      and (a.due_date is null or a.due_date <= now())
      and coalesce(nullif(a.max_score, 0), 0) > 0
      and exists (
        select 1
        from student_subject_enrollments sse
        where sse.student_id = st.id
          and sse.subject_id = a.subject_id
      )
      and not exists (
        select 1
        from activity_submissions s
        where s.activity_id = a.id
          and s.student_id = st.id
      )
  ),
  peer_evidence as (
    select success_flag from peer_graded
    union all
    select success_flag from peer_missing
  )
  select jsonb_build_object(
    'my_successes', coalesce(count(*) filter (where success_flag and not missing_flag), 0),
    'my_failures', coalesce(count(*) filter (where not success_flag), 0),
    'my_graded_count', coalesce(count(*) filter (where not missing_flag), 0),
    'my_missing_count', coalesce(count(*) filter (where missing_flag), 0),
    'peer_successes', (select coalesce(count(*) filter (where success_flag), 0) from peer_evidence),
    'peer_failures', (select coalesce(count(*) filter (where not success_flag), 0) from peer_evidence)
  )
    into v_result
  from own_evidence;

  return v_result;
end;
$$;

revoke all on function public.get_beta_binomial_evidence(integer, integer[], numeric, text) from public, anon;
grant execute on function public.get_beta_binomial_evidence(integer, integer[], numeric, text) to authenticated;

create or replace function public._class_bayesian_evidence_counts(
  p_student_id integer,
  p_subject_id integer,
  p_section_id integer,
  p_term text,
  p_target numeric,
  p_teacher_id integer
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with eligible_students as (
    select s.id as student_id
    from students s
    join users u on u.id = s.user_id and u.is_active is true
    where exists (
      select 1
      from student_subject_enrollments sse
      where sse.student_id = s.id
        and sse.subject_id = p_subject_id
    )
      and (
        p_section_id is null
        or exists (
          select 1
          from student_section_assignments ssa
          where ssa.student_id = s.id
            and ssa.section_id = p_section_id
        )
      )
      and (
        is_admin()
        or exists (
          select 1
          from student_section_assignments ssa
          join sections sec on sec.id = ssa.section_id
          join teacher_class_assignments tca
            on tca.class_id = sec.class_id
           and tca.subject_id = p_subject_id
          where ssa.student_id = s.id
            and tca.teacher_id = p_teacher_id
            and (p_section_id is null or sec.id = p_section_id)
        )
      )
  ),
  graded_evidence as (
    select
      s.student_id,
      (
        s.score::numeric
        / nullif(coalesce(nullif(s.max_score, 0), a.max_score), 0)
        * 100
      ) >= p_target as success_flag
    from eligible_students cohort
    join activity_submissions s on s.student_id = cohort.student_id
    join activities a on a.id = s.activity_id
    where a.subject_id = p_subject_id
      and a.is_published is true
      and (p_term is null or normalize_term(a.term) = p_term)
      and s.is_graded is true
      and s.score is not null
      and coalesce(nullif(s.max_score, 0), a.max_score, 0) > 0
  ),
  missing_evidence as (
    select cohort.student_id, false as success_flag
    from eligible_students cohort
    cross join activities a
    where a.subject_id = p_subject_id
      and a.is_published is true
      and (p_term is null or normalize_term(a.term) = p_term)
      and (a.due_date is null or a.due_date <= now())
      and coalesce(nullif(a.max_score, 0), 0) > 0
      and not exists (
        select 1
        from activity_submissions s
        where s.activity_id = a.id
          and s.student_id = cohort.student_id
      )
  ),
  all_evidence as (
    select student_id, success_flag, false as missing_flag from graded_evidence
    union all
    select student_id, success_flag, true as missing_flag from missing_evidence
  ),
  own_counts as (
    select
      coalesce(count(*) filter (where success_flag and not missing_flag), 0) as my_successes,
      coalesce(count(*) filter (where not success_flag), 0) as my_failures,
      coalesce(count(*) filter (where not missing_flag), 0) as my_graded_count,
      coalesce(count(*) filter (where missing_flag), 0) as my_missing_count
    from all_evidence
    where student_id = p_student_id
  ),
  class_counts as (
    select
      coalesce(count(*) filter (where success_flag and not missing_flag), 0) as class_successes,
      coalesce(count(*) filter (where not success_flag), 0) as class_failures
    from all_evidence
  )
  select jsonb_build_object(
    'my_successes', own_counts.my_successes,
    'my_failures', own_counts.my_failures,
    'my_graded_count', own_counts.my_graded_count,
    'my_missing_count', own_counts.my_missing_count,
    'class_successes', class_counts.class_successes,
    'class_failures', class_counts.class_failures
  )
  from own_counts
  cross join class_counts;
$$;

revoke all on function public._class_bayesian_evidence_counts(integer, integer, integer, text, numeric, integer)
  from public, anon, authenticated;

create or replace function public.get_class_performance(
  p_subject_id integer,
  p_section_id integer default null,
  p_term text default null,
  p_target numeric default 75
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller_teacher_id integer := auth_teacher_id();
  v_term text := normalize_term(p_term);
  v_target numeric := coalesce(p_target, 75);
  v_result jsonb;
begin
  if not is_admin() and not teacher_can_access_subject(p_subject_id, p_section_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  with eligible_students as (
    select s.id, s.student_number, u.first_name, u.last_name, u.avatar_url
    from students s
    join users u on u.id = s.user_id and u.is_active is true
    where exists (
      select 1
      from student_subject_enrollments sse
      where sse.student_id = s.id
        and sse.subject_id = p_subject_id
    )
      and (
        p_section_id is null
        or exists (
          select 1
          from student_section_assignments ssa
          where ssa.student_id = s.id
            and ssa.section_id = p_section_id
        )
      )
      and (
        is_admin()
        or exists (
          select 1
          from student_section_assignments ssa
          join sections sec on sec.id = ssa.section_id
          join teacher_class_assignments tca
            on tca.class_id = sec.class_id
           and tca.subject_id = p_subject_id
          where ssa.student_id = s.id
            and tca.teacher_id = v_caller_teacher_id
            and (p_section_id is null or sec.id = p_section_id)
        )
      )
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'student_id', s.id,
      'name', s.first_name || ' ' || s.last_name,
      'student_number', s.student_number,
      'avatar_url', s.avatar_url,
      'subject_id', p_subject_id,
      'academic_earned', comp.academic_earned,
      'academic_possible', comp.academic_possible,
      'graded_count', comp.graded_count,
      'awaiting_count', comp.awaiting_count,
      'missing_count', comp.missing_count,
      'attendance_weighted', comp.attendance_weighted,
      'attendance_sessions', comp.attendance_sessions,
      'modules_read', comp.modules_read,
      'modules_total', comp.modules_total,
      'my_successes', (bayes.counts ->> 'my_successes')::integer,
      'my_failures', (bayes.counts ->> 'my_failures')::integer,
      'my_graded_count', (bayes.counts ->> 'my_graded_count')::integer,
      'my_missing_count', (bayes.counts ->> 'my_missing_count')::integer,
      'class_successes', (bayes.counts ->> 'class_successes')::integer,
      'class_failures', (bayes.counts ->> 'class_failures')::integer
    ) order by s.id
  ), '[]'::jsonb)
    into v_result
  from eligible_students s
  left join lateral (
    select *
    from jsonb_to_record(
      get_performance_components(s.id, array[p_subject_id], v_term) -> 0
    ) as component(
      academic_earned numeric,
      academic_possible numeric,
      graded_count integer,
      awaiting_count integer,
      missing_count integer,
      attendance_weighted numeric,
      attendance_sessions integer,
      modules_read integer,
      modules_total integer
    )
  ) comp on true
  cross join lateral (
    select public._class_bayesian_evidence_counts(
      s.id,
      p_subject_id,
      p_section_id,
      v_term,
      v_target,
      v_caller_teacher_id
    ) as counts
  ) bayes;

  return v_result;
end;
$$;

revoke all on function public.get_class_performance(integer, integer, text, numeric) from public, anon;
grant execute on function public.get_class_performance(integer, integer, text, numeric) to authenticated;

notify pgrst, 'reload schema';
