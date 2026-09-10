-- ============================================================================
-- IJED LMS - Notifications and Realtime
-- Run after 05_profile_settings.sql.
--
-- Notification foreign keys reference users.id (integer), not auth.uid()
-- (UUID). Always resolve the current actor through auth_user_id().
-- ============================================================================

create or replace function notify_module_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id integer := auth_user_id();
begin
  if new.is_published and (tg_op = 'INSERT' or not coalesce(old.is_published, false)) then
    insert into notifications (target_user_id, actor_user_id, notification_type, title, message, link_type, link_id)
    select distinct s.user_id, actor_id, 'module_uploaded', 'New module available',
           new.title || ' is now available.', 'module', new.id
    from student_subject_enrollments enrollment
    join students s on s.id = enrollment.student_id
    join users target on target.id = s.user_id and target.is_active = true
    where enrollment.subject_id = new.subject_id
      and s.user_id <> actor_id;

    insert into notifications (target_user_id, actor_user_id, notification_type, title, message, link_type, link_id)
    select admin.id, actor_id, 'module_uploaded', 'Module published',
           new.title || ' was published.', 'module', new.id
    from users admin
    join roles role on role.id = admin.role_id
    where role.name = 'admin'
      and admin.is_active = true
      and admin.id <> actor_id;
  end if;
  return new;
end;
$$;

drop trigger if exists modules_notify_published on modules;
create trigger modules_notify_published
after insert or update of is_published on modules
for each row execute function notify_module_published();

create or replace function notify_activity_published()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id integer := auth_user_id();
begin
  if new.is_published and (tg_op = 'INSERT' or not coalesce(old.is_published, false)) then
    insert into notifications (target_user_id, actor_user_id, notification_type, title, message, link_type, link_id)
    select distinct s.user_id, actor_id, 'activity_created', 'New activity available',
           new.title || ' is now available.', 'activity', new.id
    from student_subject_enrollments enrollment
    join students s on s.id = enrollment.student_id
    join users target on target.id = s.user_id and target.is_active = true
    where enrollment.subject_id = new.subject_id
      and s.user_id <> actor_id;
  end if;
  return new;
end;
$$;

drop trigger if exists activities_notify_published on activities;
create trigger activities_notify_published
after insert or update of is_published on activities
for each row execute function notify_activity_published();

-- Enable INSERT events for the notification bell's Realtime subscription.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end;
$$;
