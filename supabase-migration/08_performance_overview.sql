-- ============================================================================
-- IJED Performance Overview — shared calculations and notifications
-- ----------------------------------------------------------------------------
-- This migration keeps the analytics contract stable while consolidating the
-- audited calculations required by the thesis objectives and the live DB fixes.
-- It is idempotent and intentionally scoped to new SQL only.
-- ============================================================================

create or replace function public.normalize_term(p_term text)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when p_term is null then null
    when lower(trim(p_term)) ~ '^(1st|first|1)(\s+(term|quarter))?$' then '1st'
    when lower(trim(p_term)) ~ '^(2nd|second|2)(\s+(term|quarter))?$' then '2nd'
    when lower(trim(p_term)) ~ '^(3rd|third|3)(\s+(term|quarter))?$' then '3rd'
    when lower(trim(p_term)) ~ '^(4th|fourth|4)(\s+(term|quarter))?$' then '4th'
    else nullif(lower(trim(p_term)), '')
  end;
$$;

revoke all on function public.normalize_term(text) from public, anon;
grant execute on function public.normalize_term(text) to authenticated;

-- Normalize legacy RPC signatures before defining the canonical text variants.
-- PostgREST cannot resolve named JSON arguments when text and varchar overloads
-- coexist, even though PostgreSQL can implicitly cast between the two types.
drop function if exists public.get_beta_binomial_evidence(integer, integer[], numeric, character varying);
drop function if exists public.get_score_vs_class_average(integer, integer[], character varying);
drop function if exists public.get_student_attendance_calendar(integer, integer, integer, integer, character varying);

create or replace function public.teacher_can_access_subject(p_subject_id integer, p_section_id integer default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from teacher_class_assignments tca
    where tca.teacher_id = auth_teacher_id()
      and tca.subject_id = p_subject_id
      and (
        p_section_id is null
        or exists (
          select 1
          from sections sec
          where sec.id = p_section_id
            and sec.class_id = tca.class_id
        )
      )
  );
$$;

revoke all on function public.teacher_can_access_subject(integer, integer) from public, anon, authenticated;

-- PostgreSQL cannot replace a TABLE-returning function when its OUT columns
-- change. This helper is internal and its execute privileges are reapplied below.
drop function if exists public._student_attendance_rows(integer);

create or replace function public._student_attendance_rows(p_student_id integer)
returns table (
  subject_id integer,
  subject_name text,
  class_id integer,
  class_name text,
  term text,
  session_date date,
  status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() and (auth_student_id() is null or auth_student_id() <> p_student_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return query
    select
      ats.subject_id,
      coalesce(sub.name, 'General / Homeroom') as subject_name,
      ats.class_id,
      cls.name as class_name,
      normalize_term(ats.term) as term,
      ats.session_date,
      lower(trim(ar.status)) as status
    from attendance_records ar
    join attendance_sessions ats on ats.id = ar.session_id
    join classes cls on cls.id = ats.class_id
    left join subjects sub on sub.id = ats.subject_id
    where ar.student_id = p_student_id
      and ats.has_class = true;
end;
$$;

revoke all on function public._student_attendance_rows(integer) from public, anon, authenticated;

create or replace function public.get_attendance_score(
  p_student_id integer,
  p_subject_ids integer[],
  p_term text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normalized_term text := normalize_term(p_term);
  v_total_sessions integer;
  v_weighted_attendance numeric;
begin
  if not is_admin() and (auth_student_id() is null or auth_student_id() <> p_student_id) then
    raise exception 'Can only read your own attendance score' using errcode = '42501';
  end if;

  select count(*)::integer,
         coalesce(sum(case
           when lower(trim(ar.status)) = 'present' then 1
           when lower(trim(ar.status)) = 'late' then 0.5
           else 0
         end), 0)
    into v_total_sessions, v_weighted_attendance
  from attendance_records ar
  join attendance_sessions asess on asess.id = ar.session_id
  where ar.student_id = p_student_id
    and asess.subject_id = any(coalesce(p_subject_ids, '{}'::integer[]))
    and asess.has_class = true
    and (lower(trim(ar.status)) in ('present','late','absent'))
    and (
      v_normalized_term is null
      or normalize_term(asess.term) = v_normalized_term
    );

  return jsonb_build_object(
    'total_sessions', v_total_sessions,
    'attendance_pct', case
      when v_total_sessions > 0 then round((v_weighted_attendance / v_total_sessions) * 100, 1)
      else null
    end
  );
end;
$$;

revoke all on function public.get_attendance_score(integer, integer[], text) from public, anon;
grant execute on function public.get_attendance_score(integer, integer[], text) to authenticated;

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

  -- Student own graded work, plus past-due published unsubmitted work as failures.
  select coalesce(sum(case when x.kind = 'success' then 1 else 0 end),0),
         coalesce(sum(case when x.kind = 'failure' then 1 else 0 end),0)
    into v_my_successes, v_my_failures
  from (
    select case when (s.score::numeric / nullif(s.max_score,0) * 100) >= v_target then 'success' else 'failure' end as kind
    from activity_submissions s
    join activities a on a.id = s.activity_id
    where s.student_id = p_student_id
      and a.subject_id = any(v_subject_ids)
      and a.is_published = true
      and (v_term is null or normalize_term(a.term) = v_term)
      and s.is_graded = true
      and s.score is not null
      and s.max_score > 0

    union all

    select 'failure' as kind
    from activities a
    where a.is_published = true
      and a.subject_id = any(v_subject_ids)
      and a.max_score > 0
      and (v_term is null or normalize_term(a.term) = v_term)
      and a.due_date is not null and a.due_date <= now()
      and not exists (
        select 1
        from activity_submissions s
        where s.activity_id = a.id
          and s.student_id = p_student_id
      )
  ) x;

  -- Active peers in the same subject(s), excluding the caller.
  select coalesce(sum(case when x.kind = 'success' then 1 else 0 end),0),
         coalesce(sum(case when x.kind = 'failure' then 1 else 0 end),0)
    into v_peer_successes, v_peer_failures
  from (
    select case when (s2.score::numeric / nullif(s2.max_score,0) * 100) >= v_target then 'success' else 'failure' end as kind
    from activity_submissions s2
    join activities a2 on a2.id = s2.activity_id
    join student_subject_enrollments sse2 on sse2.student_id = s2.student_id and sse2.subject_id = a2.subject_id
    join students st on st.id = s2.student_id
    join users u on u.id = st.user_id
    where s2.student_id <> p_student_id
      and u.is_active = true
      and a2.subject_id = any(v_subject_ids)
      and a2.is_published = true
      and (v_term is null or normalize_term(a2.term) = v_term)
      and s2.is_graded = true
      and s2.score is not null
      and s2.max_score > 0

    union all

    select 'failure' as kind
    from activities a2
    join student_subject_enrollments sse2 on sse2.subject_id = a2.subject_id
    join students st on st.id = sse2.student_id
    join users u on u.id = st.user_id
    where st.id <> p_student_id
      and u.is_active = true
      and a2.subject_id = any(v_subject_ids)
      and a2.is_published = true
      and a2.max_score > 0
      and (v_term is null or normalize_term(a2.term) = v_term)
      and a2.due_date is not null and a2.due_date <= now()
      and not exists (
        select 1
        from activity_submissions s3
        where s3.activity_id = a2.id
          and s3.student_id = sse2.student_id
      )
  ) x;

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

create or replace function public.get_score_vs_class_average(
  p_student_id integer,
  p_subject_ids integer[] default null,
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
  v_term text := normalize_term(p_term);
  v_result jsonb;
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
    return jsonb_build_object('data', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'activity_id', a.id,
      'activity_name', a.title,
      'my_score_pct', mine.pct,
      'class_avg_pct', round(peer.avg_pct, 1),
      'diff_pct', case when mine.pct is null then null else round(mine.pct - peer.avg_pct, 1) end,
      'status', case
        when mine.pct is not null then 'graded'
        when exists (
          select 1
          from activity_submissions s2
          where s2.activity_id = a.id and s2.student_id = p_student_id
            and s2.is_graded = false
        ) then 'awaiting_grade'
        when a.due_date is null or a.due_date <= now() then 'missing'
        else 'missing'
      end
    )
    order by a.due_date nulls last, a.created_at
  ), '[]'::jsonb)
    into v_result
  from activities a
  left join lateral (
    select round((s.score::numeric / nullif(coalesce(nullif(s.max_score, 0), a.max_score), 0)) * 100, 1) as pct
    from activity_submissions s
    where s.activity_id = a.id
      and s.student_id = p_student_id
      and s.is_graded = true
      and s.score is not null
      and coalesce(nullif(s.max_score, 0), a.max_score) > 0
    limit 1
  ) mine on true
  cross join lateral (
    select avg((s2.score::numeric / nullif(coalesce(nullif(s2.max_score, 0), a.max_score), 0)) * 100) as avg_pct
    from activity_submissions s2
    join student_subject_enrollments sse2 on sse2.student_id = s2.student_id and sse2.subject_id = a.subject_id
    join students st on st.id = s2.student_id
    join users u on u.id = st.user_id
    where s2.activity_id = a.id
      and s2.is_graded = true
      and s2.score is not null
      and coalesce(nullif(s2.max_score, 0), a.max_score) > 0
      and u.is_active = true
  ) peer
  where a.subject_id = any(v_subject_ids)
    and a.is_published = true
    and (v_term is null or normalize_term(a.term) = v_term)
    and peer.avg_pct is not null;

  return jsonb_build_object('data', v_result);
end;
$$;

revoke all on function public.get_score_vs_class_average(integer, integer[], text) from public, anon;
grant execute on function public.get_score_vs_class_average(integer, integer[], text) to authenticated;

create or replace function public.get_engagement_percentile(
  p_student_id integer,
  p_subject_ids integer[] default null,
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
  v_term text := normalize_term(p_term);
  v_peer_count integer;
  v_my_engagement numeric;
  v_below integer;
  v_equal integer;
  v_result jsonb;
begin
  if not is_admin() and (v_caller_student_id is null or v_caller_student_id <> p_student_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  with peer_pool as (
    select distinct ssa2.student_id
    from student_section_assignments ssa1
    join student_section_assignments ssa2 on ssa2.section_id = ssa1.section_id
    join students st on st.id = ssa2.student_id
    join users u on u.id = st.user_id
    where ssa1.student_id = p_student_id
      and u.is_active = true
      and ssa2.student_id <> p_student_id
  ),
  scored as (
    select
      pool.student_id,
      (
        select case
          when attendance_pct is not null and module_pct is not null then (
            attendance_pct * 0.4 + module_pct * 0.6
          ) / 1.0
          when attendance_pct is not null then attendance_pct
          when module_pct is not null then module_pct
          else null
        end
        from (
          select
            case
              when count(*) filter (where lower(trim(status)) in ('present','late','absent')) > 0 then
                round(
                  (
                    count(*) filter (where lower(trim(status)) = 'present')
                    + count(*) filter (where lower(trim(status)) = 'late') * 0.5
                  )::numeric
                  / count(*) filter (where lower(trim(status)) in ('present','late','absent')) * 100,
                  2
                )
              else null
            end as attendance_pct,
            case
              when count(distinct m.id) > 0 then
                round(
                  count(distinct smr.module_id)::numeric / count(distinct m.id) * 100,
                  2
                )
              else null
            end as module_pct
          from student_subject_enrollments sse
          left join modules m on m.subject_id = sse.subject_id and m.is_published = true
          left join student_module_reads smr on smr.module_id = m.id and smr.student_id = sse.student_id
          left join attendance_records ar on ar.student_id = sse.student_id
          left join attendance_sessions ats on ats.id = ar.session_id
          where sse.student_id = pool.student_id
            and (p_subject_ids is null or sse.subject_id = any(p_subject_ids))
            and (v_term is null or normalize_term(m.term) = v_term or normalize_term(ats.term) = v_term)
        ) x
      ) as engagement_score,
      (
        select case
          when count(*) filter (where lower(trim(status)) in ('present','late','absent')) > 0 then
            round(
              (
                count(*) filter (where lower(trim(status)) = 'present')
                + count(*) filter (where lower(trim(status)) = 'late') * 0.5
              )::numeric
              / count(*) filter (where lower(trim(status)) in ('present','late','absent')) * 100,
              2
            )
          else null
        end
        from attendance_records ar
        join attendance_sessions ats on ats.id = ar.session_id
        where ar.student_id = pool.student_id
          and ats.has_class = true
          and (p_subject_ids is null or ats.subject_id = any(p_subject_ids))
          and (v_term is null or normalize_term(ats.term) = v_term)
      ) as attendance_pct,
      (
        select case
          when count(distinct m.id) > 0 then
            round(count(distinct smr.module_id)::numeric / count(distinct m.id) * 100, 2)
          else null
        end
        from student_subject_enrollments sse
        join modules m on m.subject_id = sse.subject_id and m.is_published = true
        left join student_module_reads smr on smr.module_id = m.id and smr.student_id = pool.student_id
        where sse.student_id = pool.student_id
          and (p_subject_ids is null or sse.subject_id = any(p_subject_ids))
          and (v_term is null or normalize_term(m.term) = v_term)
      ) as module_pct
    from peer_pool pool
    union all
    select p_student_id,
           (
             select case
               when attendance_pct is not null and module_pct is not null then (
                 attendance_pct * 0.4 + module_pct * 0.6
               ) / 1.0
               when attendance_pct is not null then attendance_pct
               when module_pct is not null then module_pct
               else null
             end
             from (
               select
                 case
                   when count(*) filter (where lower(trim(status)) in ('present','late','absent')) > 0 then
                     round(
                       (
                         count(*) filter (where lower(trim(status)) = 'present')
                         + count(*) filter (where lower(trim(status)) = 'late') * 0.5
                       )::numeric
                       / count(*) filter (where lower(trim(status)) in ('present','late','absent')) * 100, 2
                     )
                   else null
                 end as attendance_pct,
                 case
                   when count(distinct m.id) > 0 then
                     round(count(distinct smr.module_id)::numeric / count(distinct m.id) * 100, 2)
                   else null
                 end as module_pct
               from student_subject_enrollments sse
               left join modules m on m.subject_id = sse.subject_id and m.is_published = true
               left join student_module_reads smr on smr.module_id = m.id and smr.student_id = p_student_id
               left join attendance_records ar on ar.student_id = sse.student_id
               left join attendance_sessions ats on ats.id = ar.session_id
               where sse.student_id = p_student_id
                 and (p_subject_ids is null or sse.subject_id = any(p_subject_ids))
                 and (v_term is null or normalize_term(m.term) = v_term or normalize_term(ats.term) = v_term)
             ) x
           ) as engagement_score,
           (
             select case
               when count(*) filter (where lower(trim(status)) in ('present','late','absent')) > 0 then
                 round(
                   (
                     count(*) filter (where lower(trim(status)) = 'present')
                     + count(*) filter (where lower(trim(status)) = 'late') * 0.5
                   )::numeric
                   / count(*) filter (where lower(trim(status)) in ('present','late','absent')) * 100,
                   2
                 )
               else null
             end
             from attendance_records ar
             join attendance_sessions ats on ats.id = ar.session_id
             where ar.student_id = p_student_id
               and ats.has_class = true
               and (p_subject_ids is null or ats.subject_id = any(p_subject_ids))
               and (v_term is null or normalize_term(ats.term) = v_term)
           ) as attendance_pct,
           (
             select case
               when count(distinct m.id) > 0 then
                 round(count(distinct smr.module_id)::numeric / count(distinct m.id) * 100, 2)
               else null
             end
             from student_subject_enrollments sse
             join modules m on m.subject_id = sse.subject_id and m.is_published = true
             left join student_module_reads smr on smr.module_id = m.id and smr.student_id = p_student_id
             where sse.student_id = p_student_id
               and (p_subject_ids is null or sse.subject_id = any(p_subject_ids))
               and (v_term is null or normalize_term(m.term) = v_term)
           ) as module_pct
  )
  select into v_result
    jsonb_build_object(
      'percentile', case
        when count(*) filter (where student_id <> p_student_id) = 0 then null
        else round(
          100.0 * (
            count(*) filter (
              where student_id <> p_student_id and engagement_score < (select engagement_score from scored where student_id = p_student_id)
            )
            + 0.5 * count(*) filter (
              where student_id <> p_student_id and engagement_score = (select engagement_score from scored where student_id = p_student_id)
            )
          ) / count(*) filter (where student_id <> p_student_id)
        )
      end,
      'engagement_score', (select engagement_score from scored where student_id = p_student_id),
      'my_attendance_rate', (select attendance_pct from scored where student_id = p_student_id),
      'my_module_completion', (select module_pct from scored where student_id = p_student_id),
      'peer_count', (select count(*) from scored where student_id <> p_student_id)
    )
  from scored;

  return v_result;
end;
$$;

revoke all on function public.get_engagement_percentile(integer, integer[], text) from public, anon;
grant execute on function public.get_engagement_percentile(integer, integer[], text) to authenticated;

create or replace function public.get_engagement_leaderboard(
  p_student_id integer,
  p_subject_ids integer[] default null,
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
  v_term text := normalize_term(p_term);
  v_result jsonb;
begin
  if not is_admin() and (v_caller_student_id is null or v_caller_student_id <> p_student_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  if not is_admin()
     and p_subject_ids is not null
     and exists (
       select 1
       from unnest(p_subject_ids) requested(subject_id)
       where not exists (
         select 1
         from student_subject_enrollments sse
         where sse.student_id = p_student_id
           and sse.subject_id = requested.subject_id
       )
     ) then
    raise exception 'Not authorized for requested subject filter' using errcode = '42501';
  end if;

  with cohort as (
    select distinct ssa2.student_id
    from student_section_assignments ssa1
    join student_section_assignments ssa2 on ssa2.section_id = ssa1.section_id
    join students st on st.id = ssa2.student_id
    join users u on u.id = st.user_id and u.is_active = true
    where ssa1.student_id = p_student_id
    union
    select s.id
    from students s
    join users u on u.id = s.user_id and u.is_active = true
    where s.id = p_student_id
  ),
  components as (
    select
      c.student_id,
      concat_ws(' ', nullif(trim(u.first_name), ''), nullif(trim(u.last_name), '')) as display_name,
      nullif(trim(u.avatar_url), '') as avatar_url,
      attendance.attendance_rate,
      modules.module_completion,
      case
        when attendance.attendance_rate is not null and modules.module_completion is not null
          then round(attendance.attendance_rate * 0.4 + modules.module_completion * 0.6, 2)
        else coalesce(attendance.attendance_rate, modules.module_completion)
      end as engagement_score
    from cohort c
    join students s on s.id = c.student_id
    join users u on u.id = s.user_id
    left join lateral (
      select case
        when count(*) filter (where lower(trim(ar.status)) in ('present', 'late', 'absent')) > 0 then
          round(
            (
              count(*) filter (where lower(trim(ar.status)) = 'present')
              + count(*) filter (where lower(trim(ar.status)) = 'late') * 0.5
            )::numeric
            / count(*) filter (where lower(trim(ar.status)) in ('present', 'late', 'absent')) * 100,
            2
          )
        else null
      end as attendance_rate
      from attendance_records ar
      join attendance_sessions ats on ats.id = ar.session_id
      where ar.student_id = c.student_id
        and ats.has_class = true
        and (p_subject_ids is null or ats.subject_id = any(p_subject_ids))
        and (v_term is null or normalize_term(ats.term) = v_term)
    ) attendance on true
    left join lateral (
      select case
        when count(distinct m.id) > 0 then
          round(count(distinct smr.module_id)::numeric / count(distinct m.id) * 100, 2)
        else null
      end as module_completion
      from student_subject_enrollments sse
      join modules m on m.subject_id = sse.subject_id and m.is_published = true
      left join student_module_reads smr
        on smr.module_id = m.id and smr.student_id = c.student_id
      where sse.student_id = c.student_id
        and (p_subject_ids is null or sse.subject_id = any(p_subject_ids))
        and (v_term is null or normalize_term(m.term) = v_term)
    ) modules on true
  ),
  ranked as (
    select
      components.*,
      rank() over (order by engagement_score desc) as place,
      (student_id = p_student_id) as is_me
    from components
    where engagement_score is not null
  )
  select jsonb_build_object(
    'percentile', case
      when (select engagement_score from ranked where is_me) is null
        or count(*) filter (where not is_me) = 0 then null
      else round(
        100.0 * (
          count(*) filter (
            where not is_me
              and engagement_score < (select engagement_score from ranked where is_me)
          )
          + 0.5 * count(*) filter (
            where not is_me
              and engagement_score = (select engagement_score from ranked where is_me)
          )
        ) / count(*) filter (where not is_me)
      )
    end,
    'peer_count', count(*) filter (where not is_me),
    'my_rank', (select place from ranked where is_me),
    'engagement_score', (select engagement_score from ranked where is_me),
    'my_attendance_rate', (select attendance_rate from ranked where is_me),
    'my_module_completion', (select module_completion from ranked where is_me),
    'leaderboard', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'rank', place,
          'name', display_name,
          'avatar_url', avatar_url,
          'engagement_score', engagement_score,
          'attendance_rate', attendance_rate,
          'module_completion', module_completion,
          'is_me', is_me
        )
        order by place, display_name
      )
      from ranked
      where place <= 5 or is_me
    ), '[]'::jsonb)
  )
  into v_result
  from ranked;
  return v_result;
end;
$$;

revoke all on function public.get_engagement_leaderboard(integer, integer[], text) from public, anon;
grant execute on function public.get_engagement_leaderboard(integer, integer[], text) to authenticated;

create or replace function public.get_student_attendance_calendar(
  p_student_id integer,
  p_subject_id integer default null,
  p_year integer default null,
  p_month integer default null,
  p_term text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_normalized_term text := normalize_term(p_term);
  v_calendar jsonb;
  v_summary jsonb;
begin
  if not is_admin() and (auth_student_id() is null or auth_student_id() <> p_student_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(to_char(session_date, 'YYYY-MM-DD'), status), '{}'::jsonb)
    into v_calendar
  from (
    select
      ar.student_id,
      ats.session_date,
      lower(trim(ar.status)) as status,
      ats.subject_id,
      ats.term
    from attendance_records ar
    join attendance_sessions ats on ats.id = ar.session_id
    where ar.student_id = p_student_id
      and ats.has_class = true
      and (p_subject_id is null or ats.subject_id = p_subject_id)
      and (p_year is null or extract(year from ats.session_date) = p_year)
      and (p_month is null or extract(month from ats.session_date) = p_month)
      and (v_normalized_term is null or normalize_term(ats.term) = v_normalized_term)
  ) rows;

  select jsonb_build_object(
    'present', count(*) filter (where status = 'present'),
    'absent', count(*) filter (where status = 'absent'),
    'late', count(*) filter (where status = 'late'),
    'excused', count(*) filter (where status = 'excused')
  )
    into v_summary
  from (
    select lower(trim(ar.status)) as status
    from attendance_records ar
    join attendance_sessions ats on ats.id = ar.session_id
    where ar.student_id = p_student_id
      and ats.has_class = true
      and (p_subject_id is null or ats.subject_id = p_subject_id)
      and (p_year is null or extract(year from ats.session_date) = p_year)
      and (p_month is null or extract(month from ats.session_date) = p_month)
      and (v_normalized_term is null or normalize_term(ats.term) = v_normalized_term)
  ) rows;

  return jsonb_build_object('calendar', v_calendar, 'summary', v_summary);
end;
$$;

revoke all on function public.get_student_attendance_calendar(integer, integer, integer, integer, text) from public, anon;
grant execute on function public.get_student_attendance_calendar(integer, integer, integer, integer, text) to authenticated;

create or replace function public.get_performance_components(
  p_student_id integer,
  p_subject_ids integer[],
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
  v_term text := normalize_term(p_term);
  v_result jsonb;
begin
  if not is_admin()
     and (v_caller_student_id is null or v_caller_student_id <> p_student_id)
     and (
       auth_teacher_id() is null
       or coalesce(cardinality(p_subject_ids), 0) = 0
       or exists (
         select 1
         from unnest(p_subject_ids) requested(subject_id)
         where not exists (
           select 1
           from student_subject_enrollments sse
           join student_section_assignments ssa on ssa.student_id = sse.student_id
           join sections sec on sec.id = ssa.section_id
           join teacher_class_assignments tca
             on tca.class_id = sec.class_id and tca.subject_id = sse.subject_id
           where sse.student_id = p_student_id
             and sse.subject_id = requested.subject_id
             and tca.teacher_id = auth_teacher_id()
         )
       )
     ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'subject_id', sid,
      'subject_name', name,
      'academic_earned', academic_earned,
      'academic_possible', academic_possible,
      'graded_count', graded_count,
      'awaiting_count', awaiting_count,
      'missing_count', missing_count,
      'attendance_weighted', attendance_weighted,
      'attendance_sessions', attendance_sessions,
      'modules_read', modules_read,
      'modules_total', modules_total
    )
  ), '[]'::jsonb)
    into v_result
  from (
    select
      s.id as sid,
      s.name,
      coalesce(graded.earned, 0)::numeric as academic_earned,
      (coalesce(graded.possible, 0) + coalesce(missing.missing_possible, 0))::numeric as academic_possible,
      coalesce(graded.graded_count, 0)::integer as graded_count,
      coalesce(awaiting.awaiting_count, 0)::integer as awaiting_count,
      coalesce(missing.missing_count, 0)::integer as missing_count,
      coalesce(
        (
          select sum(case when lower(trim(ar.status)) = 'present' then 1 when lower(trim(ar.status)) = 'late' then 0.5 else 0 end)
          from attendance_records ar
          join attendance_sessions ats on ats.id = ar.session_id
          where ar.student_id = p_student_id and ats.subject_id = s.id and ats.has_class = true
            and (v_term is null or normalize_term(ats.term) = v_term)
        ), 0
      )::numeric as attendance_weighted,
      coalesce(
        (
          select count(*)
          from attendance_records ar
          join attendance_sessions ats on ats.id = ar.session_id
          where ar.student_id = p_student_id and ats.subject_id = s.id and ats.has_class = true
            and lower(trim(ar.status)) in ('present','late','absent')
            and (v_term is null or normalize_term(ats.term) = v_term)
        ), 0
      )::integer as attendance_sessions,
      coalesce(
        (
          select count(distinct m.id)
          from student_module_reads smr
          join modules m on m.id = smr.module_id
          where smr.student_id = p_student_id and m.subject_id = s.id and m.is_published = true
            and (v_term is null or normalize_term(m.term) = v_term)
        ), 0
      )::integer as modules_read,
      coalesce(
        (
          select count(*)
          from modules m
          where m.subject_id = s.id and m.is_published = true
            and (v_term is null or normalize_term(m.term) = v_term)
        ), 0
      )::integer as modules_total
    from subjects s
    left join lateral (
      select
        coalesce(sum(coalesce(sub.score, 0)), 0) as earned,
        coalesce(sum(coalesce(nullif(sub.max_score, 0), a.max_score, 0)), 0) as possible,
        count(*) as graded_count
      from activity_submissions sub
      join activities a on a.id = sub.activity_id
      where sub.student_id = p_student_id
        and a.subject_id = s.id
        and a.is_published = true
        and sub.is_graded = true
        and sub.score is not null
        and coalesce(nullif(sub.max_score, 0), a.max_score, 0) > 0
        and (v_term is null or normalize_term(a.term) = v_term)
    ) graded on true
    left join lateral (
      select count(*) as missing_count, coalesce(sum(a3.max_score), 0) as missing_possible
      from activities a3
      where a3.subject_id = s.id
        and a3.is_published = true
        and a3.max_score > 0
        and (v_term is null or normalize_term(a3.term) = v_term)
        and (a3.due_date is null or a3.due_date <= now())
        and not exists (
          select 1
          from activity_submissions s4
          where s4.activity_id = a3.id and s4.student_id = p_student_id
        )
    ) missing on true
    left join lateral (
      select count(*) as awaiting_count
      from activity_submissions s5
      join activities a5 on a5.id = s5.activity_id
      where a5.subject_id = s.id
        and a5.is_published = true
        and a5.max_score > 0
        and (v_term is null or normalize_term(a5.term) = v_term)
        and s5.student_id = p_student_id
        and s5.is_graded = false
    ) awaiting on true
    where s.id = any(p_subject_ids)
  ) x;

  return v_result;
end;
$$;

revoke all on function public.get_performance_components(integer, integer[], text) from public, anon;
grant execute on function public.get_performance_components(integer, integer[], text) to authenticated;

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
  v_caller_student_id integer := auth_student_id();
  v_caller_teacher_id integer := auth_teacher_id();
  v_term text := normalize_term(p_term);
  v_target numeric := coalesce(p_target, 75);
  v_result jsonb;
begin
  if not is_admin() and not teacher_can_access_subject(p_subject_id, p_section_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'student_id', s.id,
      'name', u.first_name || ' ' || u.last_name,
      'student_number', s.student_number,
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
      'my_successes', stat.my_successes,
      'my_failures', stat.my_failures,
      'class_successes', stat.class_successes,
      'class_failures', stat.class_failures
    ) order by s.id
  ), '[]'::jsonb)
    into v_result
  from students s
  join users u on u.id = s.user_id
  left join lateral (
    select *
    from jsonb_to_record(
      get_performance_components(s.id, array[p_subject_id], v_term)->0
    ) as comp(
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
  left join lateral (
    select
      (
        select count(*)
        from (
          select 1
          from activity_submissions s2
          join activities a2 on a2.id = s2.activity_id
          where s2.student_id = s.id and a2.subject_id = p_subject_id and a2.is_published = true
            and (v_term is null or normalize_term(a2.term) = v_term)
            and s2.is_graded = true and s2.score is not null
            and coalesce(nullif(s2.max_score,0), a2.max_score, 0) > 0
            and ((s2.score::numeric / nullif(coalesce(nullif(s2.max_score,0), a2.max_score),0)) * 100) >= v_target
        ) x
      ) as my_successes,
      (
        select count(*)
        from (
          select 1
          from activity_submissions s2
          join activities a2 on a2.id = s2.activity_id
          where s2.student_id = s.id and a2.subject_id = p_subject_id and a2.is_published = true
            and (v_term is null or normalize_term(a2.term) = v_term)
            and s2.is_graded = true and s2.score is not null
            and coalesce(nullif(s2.max_score,0), a2.max_score, 0) > 0
            and ((s2.score::numeric / nullif(coalesce(nullif(s2.max_score,0), a2.max_score),0)) * 100) < v_target
          union all
          select 1
          from activities a3
          where a3.subject_id = p_subject_id and a3.is_published = true and a3.max_score > 0
            and (v_term is null or normalize_term(a3.term) = v_term)
            and (a3.due_date is null or a3.due_date <= now())
            and not exists (
              select 1 from activity_submissions s4 where s4.activity_id = a3.id and s4.student_id = s.id
            )
        ) x
      ) as my_failures,
      (
        select count(*)
        from (
          select 1
          from activity_submissions s5
          join activities a5 on a5.id = s5.activity_id
          join student_subject_enrollments sse on sse.student_id = s5.student_id and sse.subject_id = a5.subject_id
          join students st2 on st2.id = s5.student_id
          join users u2 on u2.id = st2.user_id
          where a5.subject_id = p_subject_id and a5.is_published = true and u2.is_active = true
            and (v_term is null or normalize_term(a5.term) = v_term)
            and s5.is_graded = true and s5.score is not null
            and coalesce(nullif(s5.max_score,0), a5.max_score, 0) > 0
            and ((s5.score::numeric / nullif(coalesce(nullif(s5.max_score,0), a5.max_score),0)) * 100) >= v_target
            and (p_section_id is null or exists (
              select 1 from student_section_assignments ssa
              where ssa.student_id = s5.student_id and ssa.section_id = p_section_id
            ))
            and (is_admin() or exists (
              select 1
              from student_section_assignments ssa
              join sections sec on sec.id = ssa.section_id
              join teacher_class_assignments tca on tca.class_id = sec.class_id
              where ssa.student_id = s5.student_id
                and tca.teacher_id = v_caller_teacher_id and tca.subject_id = p_subject_id
            ))
        ) x
      ) as class_successes,
      (
        select count(*)
        from (
          select 1
          from activity_submissions s7
          join activities a7 on a7.id = s7.activity_id
          join student_subject_enrollments sse3 on sse3.student_id = s7.student_id and sse3.subject_id = a7.subject_id
          join students st4 on st4.id = s7.student_id
          join users u4 on u4.id = st4.user_id
          where a7.subject_id = p_subject_id and a7.is_published = true and u4.is_active = true
            and (v_term is null or normalize_term(a7.term) = v_term)
            and s7.is_graded = true and s7.score is not null
            and coalesce(nullif(s7.max_score,0), a7.max_score, 0) > 0
            and ((s7.score::numeric / nullif(coalesce(nullif(s7.max_score,0), a7.max_score),0)) * 100) < v_target
            and (p_section_id is null or exists (
              select 1 from student_section_assignments ssa
              where ssa.student_id = s7.student_id and ssa.section_id = p_section_id
            ))
            and (is_admin() or exists (
              select 1
              from student_section_assignments ssa
              join sections sec on sec.id = ssa.section_id
              join teacher_class_assignments tca on tca.class_id = sec.class_id
              where ssa.student_id = s7.student_id
                and tca.teacher_id = v_caller_teacher_id and tca.subject_id = p_subject_id
            ))
          union all
          select 1
          from activities a8
          join student_subject_enrollments sse4 on sse4.subject_id = a8.subject_id
          join students st5 on st5.id = sse4.student_id
          join users u5 on u5.id = st5.user_id
          where a8.subject_id = p_subject_id and a8.is_published = true and u5.is_active = true
            and a8.max_score > 0 and (v_term is null or normalize_term(a8.term) = v_term)
            and (a8.due_date is null or a8.due_date <= now())
            and (p_section_id is null or exists (
              select 1 from student_section_assignments ssa
              where ssa.student_id = sse4.student_id and ssa.section_id = p_section_id
            ))
            and (is_admin() or exists (
              select 1
              from student_section_assignments ssa
              join sections sec on sec.id = ssa.section_id
              join teacher_class_assignments tca on tca.class_id = sec.class_id
              where ssa.student_id = sse4.student_id
                and tca.teacher_id = v_caller_teacher_id and tca.subject_id = p_subject_id
            ))
            and not exists (
              select 1 from activity_submissions s8 where s8.activity_id = a8.id and s8.student_id = sse4.student_id
            )
        ) x
      ) as class_failures
  ) stat on true
  where u.is_active = true
    and exists (
      select 1 from student_subject_enrollments sse
      where sse.student_id = s.id and sse.subject_id = p_subject_id
    )
    and (p_section_id is null or exists (
      select 1
      from student_section_assignments ssa
      where ssa.student_id = s.id and ssa.section_id = p_section_id
    ))
    and (is_admin() or exists (
      select 1
      from student_section_assignments ssa
      join sections sec on sec.id = ssa.section_id
      join teacher_class_assignments tca
        on tca.class_id = sec.class_id and tca.subject_id = p_subject_id
      where ssa.student_id = s.id
        and tca.teacher_id = v_caller_teacher_id
        and (p_section_id is null or sec.id = p_section_id)
    ));
  return v_result;
end;
$$;

revoke all on function public.get_class_performance(integer, integer, text, numeric) from public, anon;
grant execute on function public.get_class_performance(integer, integer, text, numeric) to authenticated;

create or replace function public.get_class_performance_details(
  p_subject_id integer,
  p_section_id integer default null,
  p_term text default null,
  p_student_id integer default null,
  p_since timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_term text := normalize_term(p_term);
  v_result jsonb;
begin
  if not is_admin() and not teacher_can_access_subject(p_subject_id, p_section_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', s.id,
        'student_name', u.first_name || ' ' || u.last_name,
        'student_number', s.student_number,
        'activity_id', a.id,
        'activity_name', a.title,
        'score', sub.score,
        'max_score', coalesce(nullif(sub.max_score, 0), a.max_score),
        'status', case
          when sub.is_graded and sub.score is not null then 'graded'
          when sub.id is not null then 'awaiting_grade'
          when a.due_date is null or a.due_date <= now() then 'missing'
          else 'pending'
        end,
        'due_date', a.due_date,
        'submitted_at', sub.submitted_at
      ) order by s.id, a.due_date nulls last, a.id)
      from students s
      join users u on u.id = s.user_id and u.is_active = true
      join student_subject_enrollments sse on sse.student_id = s.id and sse.subject_id = p_subject_id
      join activities a on a.subject_id = p_subject_id and a.is_published = true
      left join activity_submissions sub on sub.activity_id = a.id and sub.student_id = s.id
      where (p_student_id is null or s.id = p_student_id)
        and (v_term is null or normalize_term(a.term) = v_term)
        and (
          p_since is null
          or sub.submitted_at >= p_since
          or a.created_at >= p_since
          or (sub.id is null and a.due_date >= p_since and a.due_date <= now())
        )
        and (p_section_id is null or exists (
          select 1 from student_section_assignments ssa
          where ssa.student_id = s.id and ssa.section_id = p_section_id
        ))
        and (is_admin() or exists (
          select 1
          from student_section_assignments ssa
          join sections sec on sec.id = ssa.section_id
          join teacher_class_assignments tca on tca.class_id = sec.class_id
          where ssa.student_id = s.id
            and tca.teacher_id = auth_teacher_id()
            and tca.subject_id = p_subject_id
            and (p_section_id is null or sec.id = p_section_id)
        ))
    ), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', s.id,
        'student_name', u.first_name || ' ' || u.last_name,
        'student_number', s.student_number,
        'session_date', ats.session_date,
        'status', lower(trim(ar.status)),
        'subject_name', coalesce(subj.name, 'General / Homeroom')
      ) order by s.id, ats.session_date)
      from students s
      join users u on u.id = s.user_id and u.is_active = true
      join student_subject_enrollments sse on sse.student_id = s.id and sse.subject_id = p_subject_id
      join attendance_records ar on ar.student_id = s.id
      join attendance_sessions ats on ats.id = ar.session_id
      left join subjects subj on subj.id = ats.subject_id
      where ats.subject_id = p_subject_id and ats.has_class = true
        and (p_student_id is null or s.id = p_student_id)
        and (v_term is null or normalize_term(ats.term) = v_term)
        and (p_since is null or ats.session_date >= p_since::date)
        and (p_section_id is null or exists (
          select 1 from student_section_assignments ssa
          where ssa.student_id = s.id and ssa.section_id = p_section_id
        ))
        and (is_admin() or exists (
          select 1
          from student_section_assignments ssa
          join sections sec on sec.id = ssa.section_id
          join teacher_class_assignments tca on tca.class_id = sec.class_id
          where ssa.student_id = s.id
            and tca.teacher_id = auth_teacher_id()
            and tca.subject_id = p_subject_id
            and (p_section_id is null or sec.id = p_section_id)
        ))
    ), '[]'::jsonb),
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
        'student_id', s.id,
        'student_name', u.first_name || ' ' || u.last_name,
        'student_number', s.student_number,
        'module_id', m.id,
        'module_name', m.title,
        'is_read', smr.id is not null,
        'first_read_at', smr.first_read_at,
        'last_read_at', smr.last_read_at
      ) order by s.id, m."order", m.id)
      from students s
      join users u on u.id = s.user_id and u.is_active = true
      join student_subject_enrollments sse on sse.student_id = s.id and sse.subject_id = p_subject_id
      join modules m on m.subject_id = p_subject_id and m.is_published = true
      left join student_module_reads smr on smr.student_id = s.id and smr.module_id = m.id
      where (p_student_id is null or s.id = p_student_id)
        and (v_term is null or normalize_term(m.term) = v_term)
        and (p_section_id is null or exists (
          select 1 from student_section_assignments ssa
          where ssa.student_id = s.id and ssa.section_id = p_section_id
        ))
        and (is_admin() or exists (
          select 1
          from student_section_assignments ssa
          join sections sec on sec.id = ssa.section_id
          join teacher_class_assignments tca on tca.class_id = sec.class_id
          where ssa.student_id = s.id
            and tca.teacher_id = auth_teacher_id()
            and tca.subject_id = p_subject_id
            and (p_section_id is null or sec.id = p_section_id)
        ))
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_class_performance_details(integer, integer, text, integer, timestamptz) from public, anon;
grant execute on function public.get_class_performance_details(integer, integer, text, integer, timestamptz) to authenticated;

create table if not exists public.performance_notification_log (
  student_id integer not null references students(id) on delete cascade,
  kind text not null,
  ref_key text not null,
  created_at timestamptz not null default now(),
  constraint uq_performance_notification_log unique (student_id, kind, ref_key)
);

create or replace function public.generate_performance_notifications()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id integer;
  v_student record;
  v_activity record;
  v_subject_ids integer[];
  v_overall jsonb;
  v_rating text;
  v_week text;
  v_score numeric;
  v_inserted integer;
begin
  if current_setting('role', true) = 'authenticated' and auth_student_id() is not null then
    raise exception 'Students may not trigger performance notifications' using errcode = '42501';
  end if;

  if not is_admin() and auth_teacher_id() is null and current_user not in ('postgres', 'service_role') then
    raise exception 'Admin or teacher access required' using errcode = '42501';
  end if;

  v_actor_user_id := coalesce(auth_user_id(), (select u.id from users u join roles r on r.id = u.role_id where r.name = 'admin' limit 1));

  -- backlog notifications: each past-due unpublished/unsubmitted published activity gets one notification
  for v_student in
    select s.id as student_id, u.id as user_id
    from students s
    join users u on u.id = s.user_id
    where u.is_active = true
      and (is_admin() or exists (
        select 1
        from student_section_assignments ssa
        join sections sec on sec.id = ssa.section_id
        join teacher_class_assignments tca on tca.class_id = sec.class_id
        where ssa.student_id = s.id and tca.teacher_id = auth_teacher_id()
      ))
  loop
    for v_activity in
      select a.id, a.title, a.subject_id, a.due_date
      from activities a
      join student_subject_enrollments sse on sse.subject_id = a.subject_id
      where sse.student_id = v_student.student_id
        and a.is_published = true
        and a.max_score > 0
        and a.due_date is not null
        and a.due_date <= now()
        and (is_admin() or exists (
          select 1
          from student_section_assignments ssa
          join sections sec on sec.id = ssa.section_id
          join teacher_class_assignments tca on tca.class_id = sec.class_id
          where ssa.student_id = v_student.student_id
            and tca.teacher_id = auth_teacher_id()
            and tca.subject_id = a.subject_id
        ))
        and not exists (
          select 1 from activity_submissions s where s.activity_id = a.id and s.student_id = v_student.student_id
        )
    loop
      insert into performance_notification_log(student_id, kind, ref_key)
      values (v_student.student_id, 'backlog', format('activity:%s', v_activity.id))
      on conflict do nothing;
      get diagnostics v_inserted = row_count;

      if v_inserted = 1 then
        perform _notify(
          v_student.user_id,
          v_actor_user_id,
          'backlog_activity',
          'Backlogged activity',
          'You have a past-due activity: ' || v_activity.title || '.',
          'activity',
          v_activity.id
        );
      end if;
    end loop;

    -- weekly performance notification when the student is currently rated at risk or needs improvement.
    if is_admin() then
      select coalesce(array_agg(sse.subject_id), '{}')
        into v_subject_ids
      from student_subject_enrollments sse
      where sse.student_id = v_student.student_id;
      v_overall := get_performance_components(v_student.student_id, v_subject_ids, null);

      select avg(
      (
        coalesce(parts.academic_pct * 0.75, 0)
        + coalesce(parts.attendance_pct * 0.15, 0)
        + coalesce(parts.modules_pct * 0.10, 0)
      ) / nullif(
        (case when parts.academic_pct is not null then 0.75 else 0 end)
        + (case when parts.attendance_pct is not null then 0.15 else 0 end)
        + (case when parts.modules_pct is not null then 0.10 else 0 end),
        0
      )
      )
        into v_score
      from jsonb_array_elements(v_overall) as items(value)
      cross join lateral (
        select
          (items.value->>'academic_earned')::numeric
            / nullif((items.value->>'academic_possible')::numeric, 0) * 100 as academic_pct,
          (items.value->>'attendance_weighted')::numeric
            / nullif((items.value->>'attendance_sessions')::numeric, 0) * 100 as attendance_pct,
          (items.value->>'modules_read')::numeric
            / nullif((items.value->>'modules_total')::numeric, 0) * 100 as modules_pct
      ) parts
      where
        parts.academic_pct is not null
        or parts.attendance_pct is not null
        or parts.modules_pct is not null;

      v_rating := case
        when v_score is null then 'Unknown'
        when v_score >= 90 then 'Excellent'
        when v_score >= 85 then 'Very Good'
        when v_score >= 80 then 'Good'
        when v_score >= 75 then 'Fair'
        when v_score >= 70 then 'Needs Improvement'
        else 'At Risk'
      end;
    else
      v_rating := 'Unknown';
    end if;

    if is_admin() and v_rating in ('Needs Improvement', 'At Risk') then
      v_week := to_char(now(), 'IYYY-IW');
      insert into performance_notification_log(student_id, kind, ref_key)
      values (v_student.student_id, 'weekly_performance', v_week)
      on conflict do nothing;
      get diagnostics v_inserted = row_count;

      if v_inserted = 1 then
        perform _notify(
          v_student.user_id,
          v_actor_user_id,
          'weekly_performance',
          'Performance check',
          'Your current performance rating is ' || v_rating || '. Please review your backlog and recent submissions.',
          null,
          null
        );
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.generate_performance_notifications() from public, anon;
grant execute on function public.generate_performance_notifications() to authenticated;

-- Optional pg_cron schedule if the extension is enabled:
-- select cron.schedule('daily-performance-notifications', '0 7 * * *',
--   $$select public.generate_performance_notifications();$$);

-- These functions are intentionally kept in the new migration file and remain
-- callable from the frontend as long as the callers remain compatible.
notify pgrst, 'reload schema';
