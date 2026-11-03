-- 14_bayesian_inference_consistency.sql
-- Safe forward migration for the Bayesian evidence fix.
-- This migration is intentionally idempotent and does not touch resource rows;
-- it only redefines the evidence RPC so that existing deployments converge on
-- the same logic as a fresh installation.

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
  v_my_successes integer := 0;
  v_my_failures integer := 0;
  v_peer_successes integer := 0;
  v_peer_failures integer := 0;
begin
  if not is_admin() and (v_caller_student_id is null or v_caller_student_id <> p_student_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if p_subject_ids is not null then
    v_subject_ids := p_subject_ids;
  else
    select coalesce(array_agg(subject_id), '{}')
      into v_subject_ids
    from student_subject_enrollments
    where student_id = p_student_id;
  end if;

  if v_subject_ids = '{}' then
    return jsonb_build_object(
      'my_successes', 0,
      'my_failures', 0,
      'peer_successes', 0,
      'peer_failures', 0
    );
  end if;

  with own_evidence as (
    select
      case when (s.score::numeric / nullif(coalesce(nullif(s.max_score, 0), a.max_score), 0) * 100) >= v_target then 1 else 0 end as success_flag
    from activity_submissions s
    join activities a on a.id = s.activity_id
    where s.student_id = p_student_id
      and a.subject_id = any(v_subject_ids)
      and a.is_published = true
      and (v_term is null or normalize_term(a.term) = v_term)
      and s.is_graded = true
      and s.score is not null
      and coalesce(nullif(s.max_score, 0), a.max_score) > 0

    union all

    select 0 as success_flag
    from activities a
    where a.subject_id = any(v_subject_ids)
      and a.is_published = true
      and (v_term is null or normalize_term(a.term) = v_term)
      and (a.due_date is null or a.due_date <= now())
      and coalesce(nullif(a.max_score, 0), 0) > 0
      and not exists (
        select 1
        from activity_submissions s
        where s.activity_id = a.id and s.student_id = p_student_id
      )
  )
  select
    coalesce(sum(case when success_flag = 1 then 1 else 0 end), 0),
    coalesce(sum(case when success_flag = 0 then 1 else 0 end), 0)
    into v_my_successes, v_my_failures
  from own_evidence;

  with peer_evidence as (
    select
      case when (s2.score::numeric / nullif(coalesce(nullif(s2.max_score, 0), a2.max_score), 0) * 100) >= v_target then 1 else 0 end as success_flag
    from activity_submissions s2
    join activities a2 on a2.id = s2.activity_id
    join students st2 on st2.id = s2.student_id
    join users u2 on u2.id = st2.user_id
    where s2.student_id <> p_student_id
      and a2.subject_id = any(v_subject_ids)
      and a2.is_published = true
      and (v_term is null or normalize_term(a2.term) = v_term)
      and s2.is_graded = true
      and s2.score is not null
      and coalesce(nullif(s2.max_score, 0), a2.max_score) > 0
      and u2.is_active = true

    union all

    select 0 as success_flag
    from activities a2
    join student_subject_enrollments sse2 on sse2.subject_id = a2.subject_id
    join students st2 on st2.id = sse2.student_id
    join users u2 on u2.id = st2.user_id
    where st2.id <> p_student_id
      and a2.subject_id = any(v_subject_ids)
      and a2.is_published = true
      and (v_term is null or normalize_term(a2.term) = v_term)
      and (a2.due_date is null or a2.due_date <= now())
      and coalesce(nullif(a2.max_score, 0), 0) > 0
      and u2.is_active = true
      and not exists (
        select 1
        from activity_submissions s3
        where s3.activity_id = a2.id and s3.student_id = st2.id
      )
  )
  select
    coalesce(sum(case when success_flag = 1 then 1 else 0 end), 0),
    coalesce(sum(case when success_flag = 0 then 1 else 0 end), 0)
    into v_peer_successes, v_peer_failures
  from peer_evidence;

  return jsonb_build_object(
    'my_successes', coalesce(v_my_successes, 0),
    'my_failures', coalesce(v_my_failures, 0),
    'peer_successes', coalesce(v_peer_successes, 0),
    'peer_failures', coalesce(v_peer_failures, 0)
  );
end;
$$;

revoke all on function public.get_beta_binomial_evidence(integer, integer[], numeric, text) from public, anon;
grant execute on function public.get_beta_binomial_evidence(integer, integer[], numeric, text) to authenticated;
