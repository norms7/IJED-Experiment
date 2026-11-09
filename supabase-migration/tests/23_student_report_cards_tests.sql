do $$
begin
  if to_regclass('public.student_report_cards') is null then
    raise exception 'student_report_cards table is missing';
  end if;
  if to_regclass('public.uq_sections_adviser_id') is null then
    raise exception 'A teacher may be assigned to only one section adviser role';
  end if;
  if to_regprocedure('public.publish_student_report_card_grade(integer,integer,integer,text,text,numeric,numeric,numeric,boolean)') is null then
    raise exception 'Report-card publish RPC is missing';
  end if;
  if to_regprocedure('public.get_my_adviser_sections()') is null
     or to_regprocedure('public.get_adviser_report_card(integer,text)') is null then
    raise exception 'Adviser section/report-card RPCs are missing';
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'student_report_cards'
      and policyname = 'student_report_cards_select'
      and cmd = 'SELECT'
  ) then
    raise exception 'Report-card row-level select policy is missing';
  end if;
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'student_report_cards'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'Report-card writes must be restricted to the publish RPC';
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'student_report_cards'
      and policyname = 'student_report_cards_select'
      and qual ilike '%adviser_id%'
      and qual ilike '%auth_teacher_id%'
  ) then
    raise exception 'Teacher report-card reads must be restricted to the section adviser';
  end if;
  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.student_report_cards'::regclass
  ) then
    raise exception 'Report-card row-level security is not enabled';
  end if;
  if not (
    select prosecdef
    from pg_proc
    where oid = to_regprocedure(
      'public.publish_student_report_card_grade(integer,integer,integer,text,text,numeric,numeric,numeric,boolean)'
    )
  ) then
    raise exception 'Report-card publish RPC must enforce its own authorization';
  end if;
  if has_function_privilege(
    'anon',
    'public.publish_student_report_card_grade(integer,integer,integer,text,text,numeric,numeric,numeric,boolean)',
    'EXECUTE'
  ) then
    raise exception 'Anonymous users must not execute the report-card publish RPC';
  end if;
  if position(
    'card.is_published' in lower(pg_get_functiondef(
      to_regprocedure('public.get_adviser_report_card(integer,text)')
    ))
  ) > 0 then
    raise exception 'Adviser report cards must include unpublished draft grades';
  end if;
  if not (
    select pg_get_functiondef(
      to_regprocedure('public.get_adviser_report_card(integer,text)')
    ) ilike '%activity_submissions%'
      and pg_get_functiondef(
        to_regprocedure('public.get_adviser_report_card(integer,text)')
      ) ilike '%attendance_records%'
      and pg_get_functiondef(
        to_regprocedure('public.get_adviser_report_card(integer,text)')
      ) ilike '%student_module_reads%'
  ) then
    raise exception 'Adviser report cards must calculate grades from existing learning and attendance data';
  end if;
  raise notice 'PASS report-card table, RLS policy, and grade RPCs are installed';
end;
$$;