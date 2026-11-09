drop function if exists public.publish_student_report_card_grade(
  integer, integer, integer, text, text, numeric, numeric, numeric
);
drop function if exists public.publish_student_report_card_grade(
  integer, integer, integer, text, text, numeric, numeric, numeric, boolean
);
drop function if exists public.get_adviser_report_card(integer, text);
drop function if exists public.get_my_adviser_sections();
drop index if exists public.uq_sections_adviser_id;
drop table if exists public.student_report_cards cascade;