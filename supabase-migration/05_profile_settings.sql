-- IJED LMS - persisted profile settings
-- Run after 01_schema.sql through 04_sample_seed_data.sql.

alter table users add column if not exists avatar_url varchar(500);
alter table users add column if not exists profile_details jsonb not null default '{}'::jsonb;

insert into storage.buckets (id, name, public)
values ('profile-images', 'profile-images', true)
on conflict (id) do nothing;

create policy "Users can upload their profile image"
on storage.objects for insert
with check (bucket_id = 'profile-images' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "Users can update their profile image"
on storage.objects for update
using (bucket_id = 'profile-images' and (storage.foldername(name))[1] = (select auth.uid()::text));

create policy "Anyone can read profile images"
on storage.objects for select
using (bucket_id = 'profile-images');

-- The existing users_update policy already permits a user to update their own
-- row. These columns contain contact preferences only; identity and role data
-- remain read-only in the frontend.
