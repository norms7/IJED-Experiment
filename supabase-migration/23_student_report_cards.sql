create table if not exists public.student_report_cards (
  id serial primary key,
  student_id integer not null references public.students(id) on delete cascade,
  subject_id integer not null references public.subjects(id) on delete cascade,
  section_id integer not null references public.sections(id) on delete cascade,
  teacher_id integer not null references public.teachers(id),
  semester varchar(3) not null check (semester in ('1st', '2nd')),
  term varchar(3) not null check (term in ('1st', '2nd', '3rd', '4th')),
  school_year varchar(20) not null default '',
  activity_pct numeric(5,2) check (activity_pct between 0 and 100),
  attendance_pct numeric(5,2) check (attendance_pct between 0 and 100),
  module_pct numeric(5,2) check (module_pct between 0 and 100),
  initial_grade numeric(5,2) check (initial_grade between 0 and 100),
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_student_report_card_term
    unique (student_id, subject_id, school_year, semester, term)
);

create index if not exists ix_student_report_cards_student_period
  on public.student_report_cards (student_id, semester, school_year);
create index if not exists ix_student_report_cards_teacher_section
  on public.student_report_cards (teacher_id, section_id, subject_id);

do $$
begin
  if exists (
    select 1
    from public.sections
    where adviser_id is not null
    group by adviser_id
    having count(*) > 1
  ) then
    raise exception 'A teacher is assigned as adviser to multiple sections. Resolve duplicate adviser assignments before applying migration 23.';
  end if;
end;
$$;

create unique index if not exists uq_sections_adviser_id
  on public.sections (adviser_id)
  where adviser_id is not null;

alter table public.student_report_cards enable row level security;

drop policy if exists student_report_cards_select on public.student_report_cards;
create policy student_report_cards_select on public.student_report_cards for select
  using (
    (student_id = public.auth_student_id() and is_published)
    or (
      public.auth_role() = 'teacher'
      and exists (
        select 1 from public.sections report_section
        where report_section.id = student_report_cards.section_id
          and report_section.adviser_id = public.auth_teacher_id()
      )
    )
  );

grant select on public.student_report_cards to authenticated;

drop function if exists public.publish_student_report_card_grade(
  integer, integer, integer, text, text, numeric, numeric, numeric
);

create or replace function public.publish_student_report_card_grade(
  p_student_id integer,
  p_subject_id integer,
  p_section_id integer,
  p_semester text,
  p_term text,
  p_activity_pct numeric,
  p_attendance_pct numeric,
  p_module_pct numeric,
  p_is_published boolean default true
) returns public.student_report_cards
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_teacher_id integer := public.auth_teacher_id();
  v_semester text;
  v_term text;
  v_subject_semester text;
  v_school_year text;
  v_initial_grade numeric(5,2);
  v_weight numeric;
  v_result public.student_report_cards;
begin
  if v_teacher_id is null or public.auth_role() <> 'teacher' then
    raise exception 'Teacher access required' using errcode = '42501';
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
  v_term := case lower(trim(coalesce(p_term, '')))
    when '1' then '1st'
    when '1st' then '1st'
    when 'first' then '1st'
    when '2' then '2nd'
    when '2nd' then '2nd'
    when 'second' then '2nd'
    when '3' then '3rd'
    when '3rd' then '3rd'
    when 'third' then '3rd'
    when '4' then '4th'
    when '4th' then '4th'
    when 'fourth' then '4th'
    else null
  end;

  if v_semester is null or v_term is null
     or p_student_id is null or p_subject_id is null or p_section_id is null then
    raise exception 'A valid student, subject, section, semester, and term are required'
      using errcode = '22023';
  end if;

  if (p_activity_pct is not null and (p_activity_pct < 0 or p_activity_pct > 100))
     or (p_attendance_pct is not null and (p_attendance_pct < 0 or p_attendance_pct > 100))
     or (p_module_pct is not null and (p_module_pct < 0 or p_module_pct > 100)) then
    raise exception 'Grade components must be between 0 and 100'
      using errcode = '22023';
  end if;

  select
    case lower(trim(coalesce(subj.semester, '')))
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
      else case when nullif(trim(coalesce(subj.semester, '')), '') is null then '1st' end
    end,
    coalesce(cls.school_year, '')
  into v_subject_semester, v_school_year
  from public.subjects subj
  join public.sections sec on sec.id = p_section_id
  join public.classes cls on cls.id = sec.class_id
  where subj.id = p_subject_id;

  if not found or v_subject_semester is distinct from v_semester then
    raise exception 'The subject does not belong to the selected semester'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.teacher_class_assignments assignment
    where assignment.teacher_id = v_teacher_id
      and assignment.subject_id = p_subject_id
      and assignment.section_id = p_section_id
  ) then
    raise exception 'You are not assigned to teach this subject in this section'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.student_section_assignments enrollment
    where enrollment.student_id = p_student_id
      and enrollment.section_id = p_section_id
  ) then
    raise exception 'The student is not enrolled in this section'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.student_subject_enrollments enrollment
    where enrollment.student_id = p_student_id
      and enrollment.subject_id = p_subject_id
  ) then
    raise exception 'The student is not enrolled in this subject'
      using errcode = '42501';
  end if;

  v_weight :=
      case when p_activity_pct is not null then 0.75 else 0 end
    + case when p_attendance_pct is not null then 0.15 else 0 end
    + case when p_module_pct is not null then 0.10 else 0 end;

  if v_weight > 0 then
    v_initial_grade := round((
        coalesce(round(p_activity_pct, 2) * 0.75, 0)
      + coalesce(round(p_attendance_pct, 2) * 0.15, 0)
      + coalesce(round(p_module_pct, 2) * 0.10, 0)
    ) / v_weight, 2);
  end if;

  insert into public.student_report_cards (
    student_id, subject_id, section_id, teacher_id, semester, term, school_year,
    activity_pct, attendance_pct, module_pct, initial_grade,
    is_published, published_at, updated_at
  ) values (
    p_student_id, p_subject_id, p_section_id, v_teacher_id, v_semester, v_term,
    v_school_year, round(p_activity_pct, 2), round(p_attendance_pct, 2),
    round(p_module_pct, 2),
    v_initial_grade, coalesce(p_is_published, false),
    case when p_is_published then now() else null end, now()
  )
  on conflict (student_id, subject_id, school_year, semester, term)
  do update set
    section_id = excluded.section_id,
    teacher_id = excluded.teacher_id,
    activity_pct = excluded.activity_pct,
    attendance_pct = excluded.attendance_pct,
    module_pct = excluded.module_pct,
    initial_grade = excluded.initial_grade,
    is_published = student_report_cards.is_published or excluded.is_published,
    published_at = case
      when excluded.is_published then now()
      else student_report_cards.published_at
    end,
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.publish_student_report_card_grade(
  integer, integer, integer, text, text, numeric, numeric, numeric, boolean
) from public, anon;
grant execute on function public.publish_student_report_card_grade(
  integer, integer, integer, text, text, numeric, numeric, numeric, boolean
) to authenticated;

create or replace function public.get_my_adviser_sections()
returns table (
  section_id integer,
  section_name text,
  class_id integer,
  class_name text,
  grade_level text,
  school_year text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.auth_role() <> 'teacher' or public.auth_teacher_id() is null then
    raise exception 'Teacher access required' using errcode = '42501';
  end if;

  return query
  select section.id, section.name::text, cls.id, cls.name::text,
         cls.grade_level::text, coalesce(cls.school_year, '')::text
  from public.sections section
  join public.classes cls on cls.id = section.class_id
  where section.adviser_id = public.auth_teacher_id()
  order by section.name;
end;
$$;

revoke all on function public.get_my_adviser_sections() from public, anon;
grant execute on function public.get_my_adviser_sections() to authenticated;

create or replace function public.get_adviser_report_card(
  p_section_id integer,
  p_semester text
)
returns table (
  student_id integer,
  student_name text,
  student_number text,
  subject_id integer,
  subject_name text,
  semester text,
  school_year text,
  first_term_grade numeric,
  second_term_grade numeric,
  third_term_grade numeric,
  fourth_term_grade numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_teacher_id integer := public.auth_teacher_id();
  v_semester text;
  v_school_year text;
begin
  if public.auth_role() <> 'teacher' or v_teacher_id is null then
    raise exception 'Teacher access required' using errcode = '42501';
  end if;

  if p_section_id is null then
    raise exception 'A section is required' using errcode = '22023';
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

  select coalesce(cls.school_year, '')
    into v_school_year
  from public.sections section
  join public.classes cls on cls.id = section.class_id
  where section.id = p_section_id
    and section.adviser_id = v_teacher_id;
  if not found then
    raise exception 'Only the assigned class adviser can view this report card'
      using errcode = '42501';
  end if;

  return query
  select
    student.id,
    trim(concat(profile.first_name, ' ', profile.last_name)),
    student.student_number::text,
    subj.id,
    subj.name::text,
    v_semester,
    v_school_year,
    max(term_grade.initial_grade) filter (where term_grade.term = '1st'),
    max(term_grade.initial_grade) filter (where term_grade.term = '2nd'),
    max(term_grade.initial_grade) filter (where term_grade.term = '3rd'),
    max(term_grade.initial_grade) filter (where term_grade.term = '4th')
  from public.student_section_assignments section_enrollment
  join public.students student on student.id = section_enrollment.student_id
  join public.users profile on profile.id = student.user_id
  join public.student_subject_enrollments subject_enrollment
    on subject_enrollment.student_id = student.id
  join public.subjects subj on subj.id = subject_enrollment.subject_id
  join public.sections enrolled_section on enrolled_section.id = p_section_id
  cross join (values ('1st'), ('2nd'), ('3rd'), ('4th')) as terms(term)
  left join lateral (
    select
      terms.term,
      coalesce(
        case when saved_grade.is_published then saved_grade.initial_grade end,
        calculated.initial_grade,
        saved_grade.initial_grade
      ) as initial_grade
    from (select 1) as seed
    left join public.student_report_cards saved_grade
      on saved_grade.student_id = student.id
     and saved_grade.subject_id = subj.id
     and saved_grade.section_id = p_section_id
     and saved_grade.semester = v_semester
     and saved_grade.term = terms.term
     and saved_grade.school_year = v_school_year
    cross join lateral (
      select
        case
          when activity_totals.possible > 0
            then activity_totals.earned / activity_totals.possible * 100
        end as activity_pct,
        case
          when attendance_totals.total > 0
            then (attendance_totals.present + attendance_totals.late * 0.5)
              / attendance_totals.total * 100
        end as attendance_pct,
        case
          when module_totals.total > 0
            then module_totals.read_count / module_totals.total * 100
        end as module_pct
      from (
        select
          coalesce(sum(case
            when submission.is_graded and submission.score is not null
                 and case
                   when submission.max_score > 0 then submission.max_score
                   else activity.max_score
                 end > 0
              then submission.score::numeric
            else 0
          end), 0) as earned,
          coalesce(sum(case
            when submission.is_graded and submission.score is not null
                 and case
                   when submission.max_score > 0 then submission.max_score
                   else activity.max_score
                 end > 0
              then (case
                when submission.max_score > 0 then submission.max_score
                else activity.max_score
              end)::numeric
            when submission.id is null
                 and (activity.due_date is null or activity.due_date <= now())
                 and activity.max_score > 0
              then activity.max_score::numeric
            else 0
          end), 0) as possible
        from public.modules module
        join public.activities activity on activity.module_id = module.id
        left join public.activity_submissions submission
          on submission.activity_id = activity.id
         and submission.student_id = student.id
        where module.section_id = p_section_id
          and module.subject_id = subj.id
          and module.is_published = true
          and activity.is_published = true
          and public.normalize_term(activity.term) = terms.term
      ) activity_totals
      cross join (
        select
          count(*) filter (where lower(trim(record.status)) = 'present')::numeric as present,
          count(*) filter (where lower(trim(record.status)) = 'late')::numeric as late,
          count(*) filter (where lower(trim(record.status)) in ('present', 'late', 'absent'))::numeric as total
        from public.attendance_sessions session
        join public.attendance_records record on record.session_id = session.id
        where session.class_id = enrolled_section.class_id
          and session.subject_id = subj.id
          and session.has_class = true
          and record.student_id = student.id
          and public.normalize_term(session.term) = terms.term
      ) attendance_totals
      cross join (
        select
          count(*)::numeric as total,
          count(module_read.id)::numeric as read_count
        from public.modules module
        left join public.student_module_reads module_read
          on module_read.module_id = module.id
         and module_read.student_id = student.id
        where module.section_id = p_section_id
          and module.subject_id = subj.id
          and module.is_published = true
          and public.normalize_term(module.term) = terms.term
      ) module_totals
    ) components
    cross join lateral (
      select round((
        coalesce(components.activity_pct * 0.75, 0)
        + coalesce(components.attendance_pct * 0.15, 0)
        + coalesce(components.module_pct * 0.10, 0)
      ) / nullif(
        (case when components.activity_pct is not null then 0.75 else 0 end)
        + (case when components.attendance_pct is not null then 0.15 else 0 end)
        + (case when components.module_pct is not null then 0.10 else 0 end),
        0
      ), 2) as initial_grade
    ) calculated
  ) term_grade on true
  where section_enrollment.section_id = p_section_id
    and case lower(trim(coalesce(subj.semester, '')))
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
      else case when nullif(trim(coalesce(subj.semester, '')), '') is null then '1st' end
    end = v_semester
  group by student.id, profile.first_name, profile.last_name,
           student.student_number, subj.id, subj.name
  order by profile.last_name, profile.first_name, subj.name;
end;
$$;

revoke all on function public.get_adviser_report_card(integer, text) from public, anon;
grant execute on function public.get_adviser_report_card(integer, text) to authenticated;