begin;

alter table public.activities
  add column if not exists file_path text,
  add column if not exists file_name varchar(255);

insert into storage.buckets (id, name, public, file_size_limit)
values ('Activity-files', 'Activity-files', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = 52428800;

drop policy if exists activity_files_select on storage.objects;
create policy activity_files_select on storage.objects for select
  using (
    bucket_id = 'Activity-files'
    and (
      (
        (storage.foldername(name))[1] = 'activities'
        and exists (
          select 1
          from public.activities a
          where a.id::text = (storage.foldername(name))[2]
            and (
              public.is_admin()
              or a.teacher_id = public.auth_teacher_id()
              or (
                a.is_published
                and public.auth_role() = 'student'
                and exists (
                  select 1
                  from public.student_subject_enrollments sse
                  where sse.subject_id = a.subject_id
                    and sse.student_id = public.auth_student_id()
                )
              )
            )
        )
      )
      or (
        (storage.foldername(name))[1] = 'submissions'
        and (storage.foldername(name))[3] is not null
        and exists (
          select 1
          from public.activities a
          where a.id::text = (storage.foldername(name))[2]
            and (
              public.is_admin()
              or a.teacher_id = public.auth_teacher_id()
              or (
                (storage.foldername(name))[3] = public.auth_student_id()::text
                and public.auth_role() = 'student'
              )
            )
        )
      )
    )
  );

drop policy if exists activity_files_insert on storage.objects;
create policy activity_files_insert on storage.objects for insert
  with check (
    bucket_id = 'Activity-files'
    and (
      (
        (storage.foldername(name))[1] = 'activities'
        and exists (
          select 1
          from public.activities a
          where a.id::text = (storage.foldername(name))[2]
            and (
              public.is_admin()
              or a.teacher_id = public.auth_teacher_id()
            )
        )
      )
      or (
        (storage.foldername(name))[1] = 'submissions'
        and (storage.foldername(name))[3] = public.auth_student_id()::text
        and public.auth_role() = 'student'
        and exists (
          select 1
          from public.activities a
          where a.id::text = (storage.foldername(name))[2]
            and a.is_published
            and (a.start_date is null or now() >= a.start_date)
            and (
              a.due_date is null
              or now() <= a.due_date
              or a.allow_late_submission
            )
            and exists (
              select 1
              from public.student_subject_enrollments sse
              where sse.subject_id = a.subject_id
                and sse.student_id = public.auth_student_id()
            )
            and not exists (
              select 1
              from public.activity_submissions s
              where s.activity_id = a.id
                and s.student_id = public.auth_student_id()
            )
        )
      )
    )
  );

drop policy if exists activity_files_delete on storage.objects;
create policy activity_files_delete on storage.objects for delete
  using (
    bucket_id = 'Activity-files'
    and (
      (
        (storage.foldername(name))[1] = 'activities'
        and exists (
          select 1
          from public.activities a
          where a.id::text = (storage.foldername(name))[2]
            and (
              public.is_admin()
              or a.teacher_id = public.auth_teacher_id()
            )
        )
      )
      or (
        (storage.foldername(name))[1] = 'submissions'
        and (storage.foldername(name))[3] = public.auth_student_id()::text
        and public.auth_role() = 'student'
      )
    )
  );

commit;
