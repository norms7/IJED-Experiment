# IJED LMS — Supabase-Only Migration Guide (Experiment Branch)

Goal: same frontend, same behavior for admin/teacher/student, but **zero
FastAPI backend**. Supabase (Postgres + Auth + Storage + Edge Functions)
replaces Render entirely.

Do this on a **new branch**, not `Norms-Branch` or `main`. Suggested:
`git checkout -b supabase-experiment`

---

## Phase 0 — Before touching anything

1. **Backup your current Supabase database.** Dashboard → Database →
   Backups → trigger a manual backup. If anything goes wrong, you restore
   and lose nothing.
2. Export your current data as a safety net too:

   ```bash
   pg_dump "postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres" \
     --data-only --no-owner --no-privileges > data_backup.sql
   ```

---

## Phase 1 — Run the SQL files (in order)

Open Supabase Dashboard → SQL Editor → paste and run each file fully,
**one at a time, in this exact order**:

1. `01_schema.sql` — creates all 21 tables (safe to run even if tables
   already exist — uses `create table if not exists`). Adds the new
   `users.auth_uid` bridge column.
2. `02_rls_policies.sql` — creates the `auth_user_id()` / `auth_role()` /
   `auth_teacher_id()` / `auth_student_id()` / `is_admin()` helper
   functions, enables RLS on every table, and adds the policies.
3. `03_functions.sql` — creates the RPC functions (`submit_activity`,
   `manual_grade_submission`, `enroll_student_subjects`,
   `create_attendance_session`, `get_dashboard_stats`,
   `get_student_dashboard_stats`, `mark_module_read`, the
   `analytics_cache_get/set` pair, and the `on_auth_user_created` trigger).
4. `04_sample_seed_data.sql` — optional sample LMS data.
5. `05_profile_settings.sql` — adds persisted contact details, avatar URLs,
   and the `profile-images` Storage bucket policies.
6. `06_notifications_realtime.sql` — publishes notification changes through
   Supabase Realtime and creates notifications for published activities and modules.

Copy both files from `edge_functions/` into the canonical CLI paths under
`supabase/functions/`, then deploy `admin-update-user` alongside
`admin-create-user` so administrators can update Auth email addresses and
passwords without exposing the service role key.

If you already have data in these tables from the old Render setup, **skip
straight to Phase 2** — your existing rows are untouched by `create table
if not exists`.

---

## Phase 2 — Link existing accounts to Supabase Auth

Your current `users` table has emails + bcrypt hashes, but Supabase Auth
doesn't know about them yet. You have two options:

### Option A — Reset passwords (recommended, simplest)

For each existing user (or have them self-serve via "Forgot Password"):

1. Create their Supabase Auth account:

   ```sql
   -- Run once per user, or better, do this via the Dashboard:
   -- Authentication → Users → Add User → enter their email + a temp password
   ```

   The `on_auth_user_created` trigger (from `03_functions.sql`) will
   automatically match the new Auth user to their existing `users` row by
   email and set `auth_uid`.
2. Tell them to log in with the temp password and change it (or send a
   password-reset email via Dashboard → Authentication → Users →
   "Send password recovery").

### Option B — Bulk-create via Edge Function

If you have many users, loop through them calling
`supabase.auth.admin.createUser()` from a one-off script using the
service role key (never in the browser). Same trigger links them.

**Verify the link worked:**

```sql
select id, email, auth_uid from users where auth_uid is null;
-- should return 0 rows once everyone is migrated
```

---

## Phase 3 — Deploy the Edge Function (admin user creation)

This is the only piece of "server" code in the whole experiment — needed
because creating a new login account requires the service-role key, which
can never be exposed to the browser.

```bash
# from your project root
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy admin-create-user
```

The function file is at
`edge_functions/admin-create-user/index.ts` in this delivery — copy it
into `supabase/functions/admin-create-user/index.ts` in your repo before
deploying.

No extra secrets to set — `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
are automatically available inside Edge Functions.

---

## Phase 4 — Storage bucket for module files

Dashboard → Storage → New Bucket:

- Name: `module-files`
- Public: **Yes** (so `getPublicUrl()` works without extra signing logic —
  fine for an LMS where files are course material, not sensitive)

Then add a simple storage policy so teachers can upload:

```sql
create policy "Teachers can upload module files"
on storage.objects for insert
with check (
  bucket_id = 'module-files' and auth_role() = 'teacher'
);
create policy "Anyone can read module files"
on storage.objects for select
using (bucket_id = 'module-files');
```

---

## Phase 5 — Swap the frontend

1. Add the Supabase JS SDK to your HTML entry point, **before** your own
   scripts:

   ```html
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
   ```

2. Replace the old API script tag:

   ```html
   <!-- OLD -->
   <script defer src="assets/js/lms-admin-api.js"></script>
   <!-- NEW -->
   <script defer src="assets/js/lms-supabase-api.js"></script>
   ```

3. Edit `lms-supabase-api.js` and fill in the two constants at the top:

   ```js
   const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
   const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";  // Dashboard → Settings → API
   ```

   The anon key is safe to ship in frontend code — RLS is what actually
   protects your data, not key secrecy.
4. Delete (or just stop loading) `lms-frontend/models/models.js` — it was
   dead localStorage-mock code, never wired to anything live.
5. Your controllers (`admin.controller.js`, `teacher.controller.js`,
   `student.controller.js`, etc.) call `api.getXyz()` exactly as before —
   **no changes needed there**, since `lms-supabase-api.js` keeps the same
   method names and signatures.

---

## Phase 6 — Test, role by role

Go through this checklist in order — each role builds on the previous:

**Admin:**

- [ ] Log in
- [ ] Dashboard stats load
- [ ] Create a class, section, subject
- [ ] Create a teacher account (tests the Edge Function)
- [ ] Create a student account, enroll them in a subject

**Teacher:**

- [ ] Log in as the teacher you just created
- [ ] See assigned subjects/classes
- [ ] Upload a module file
- [ ] Create an activity with questions (multiple choice + one essay, to
      test both auto and manual grading paths)
- [ ] Create an attendance session with records

**Student:**

- [ ] Log in as the student
- [ ] See enrolled subjects + modules
- [ ] Mark a module as read
- [ ] Submit the multiple-choice activity → should auto-grade instantly
- [ ] Submit the essay-only activity → should show "pending grade"

**Back to Teacher:**

- [ ] Manually grade the essay submission
- [ ] Confirm a notification appears for the student

**Back to Student:**

- [ ] Confirm the graded result shows up
- [ ] Confirm dashboard stats updated

If every box checks, the core LMS (everything except Analytics) is fully
running on Supabase with no backend server.

---

## Phase 7 — Analytics module (now ported)

`analytics.engine.js` (in `lms-frontend/assets/js/`) is a 1:1 port of
`analytics_service.py` — same formulas, same cache keys, same TTLs
(5 min descriptive / 10 min Bayesian), backed by the `analytics_cache_get`
/ `analytics_cache_set` RPCs from `03_functions.sql`. It must load
**before** `lms-supabase-api.js` (already wired in `index.html`).

No further setup needed — `getDescriptiveAnalytics()`, `getBayesianAnalytics()`,
`getPredictedGrade()`, `getImprovementProbability()`, and `getRiskAssessment()`
all work exactly as before from the student controller's point of view.

Add this to the Phase 6 test checklist:

- [ ] Student → Analytics tab loads grade progress, attendance calendar,
      score-vs-average, module progress, and subject radar
- [ ] Student → Bayesian tab shows predicted grade, improvement probability,
      "students like you" percentile, and risk assessment
- [ ] Numbers look sane (predicted grade somewhere between observed scores
      and the 78 prior if very few submissions exist yet)

---

## Rollback

If the experiment doesn't work out, nothing about your Render/FastAPI
deployment changed — `main` and `Norms-Branch` are untouched. Just don't
merge `supabase-experiment`. Your Supabase Postgres tables gained one
nullable column (`auth_uid`) and some new functions/policies, which are
harmless to leave in place even if you go back to the FastAPI backend.
