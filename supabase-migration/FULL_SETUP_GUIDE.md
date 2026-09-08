# IJED LMS — Supabase Experiment: Full Setup Guide

## From the zip you downloaded → Git → Supabase → Vercel, live

Follow these in order. Each phase assumes the previous one is done.

---

## PHASE 1 — Unzip and put it under Git

```bash
# unzip wherever you keep projects
unzip IJED-HCJ-supabase-experiment.zip -d ijed-supabase-experiment
cd ijed-supabase-experiment
```

You have two options for where this lives in git. Pick one:

### Option A — New branch on your existing Bitbucket repo (recommended)

Keeps this experiment alongside your real thesis repo, easy to compare/merge later.

```bash
git init   # only if this folder isn't already a clone of your repo
git remote add origin <your-bitbucket-repo-url>
git fetch origin
git checkout -b supabase-experiment origin/main
# now copy the unzipped files on top of this branch, replacing what changed
git add .
git commit -m "Experiment: migrate backend to Supabase-only (RLS + RPC + Edge Functions)"
git push -u origin supabase-experiment
```

### Option B — Fresh standalone repo (cleanest, no risk to the real project at all)

```bash
git init
git add .
git commit -m "Initial commit: Supabase-only experiment"
```

Then create a new empty repo on GitHub or Bitbucket and:

```bash
git remote add origin <new-repo-url>
git branch -M main
git push -u origin main
```

**Either way — before you push, double check `.gitignore` excludes `.venv/`**
(the old FastAPI backend's virtualenv). It's harmless to leave the
`lms-admin-backend/` folder in the repo for now — keeping it is your
rollback path — but you don't want its 14MB `.venv` in git history:

```bash
echo ".venv/" >> .gitignore
echo "__pycache__/" >> .gitignore
git rm -r --cached lms-admin-backend/.venv 2>/dev/null
git add .gitignore
git commit -m "Ignore venv"
```

---

## PHASE 2 — Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New Project**.
2. Pick an org, name it (e.g. `ijed-supabase-experiment`), set a strong
   database password (save it somewhere — you'll want it for `pg_dump`/CLI
   later), pick the region closest to you, **Free tier** is fine.
3. Wait ~2 minutes for provisioning.

### Get your keys

Dashboard → **Settings → API**. You need two values for later:

- **Project URL** — looks like `https://xxxxxxxxxxxx.supabase.co`
- **anon public key** — long JWT-looking string

(Don't worry about the `service_role` key for now — it's only used inside
the Edge Function, never in frontend code.)

---

## PHASE 3 — Run the SQL (schema → RLS → functions → seed data)

Dashboard → **SQL Editor → New query**. Run these **one at a time, in this
exact order**, from `supabase-migration/` in your unzipped folder:

1. `01_schema.sql` → Run
2. `02_rls_policies.sql` → Run
3. `03_functions.sql` → Run
4. `04_sample_seed_data.sql` → Run (this is your test data — skip it if you
   already have real data to migrate instead)

If any of them errors, stop and paste me the exact error — don't run the
next file until the current one succeeds, since later files depend on
earlier ones (functions reference tables, seed data references functions/triggers).

---

## PHASE 4 — Create the test accounts

Dashboard → **Authentication → Users → Add User**.

Create the 8 accounts listed in `supabase-migration/SAMPLE_DATA_README.md`
(admin, 2 teachers, 5 students) — exact emails matter, password is up to
you, and check **"Auto Confirm User"** on each one.

Verify they linked to their profile rows:

```sql
select email, auth_uid is not null as linked from users order by email;
```

All 8 should show `linked = true`.

---

## PHASE 5 — Storage bucket (for module file uploads)

Dashboard → **Storage → New Bucket**:

- Name: `module-files`
- Public bucket: **ON**

Then SQL Editor, run:

```sql
create policy "Teachers can upload module files"
on storage.objects for insert
with check (bucket_id = 'module-files' and auth_role() = 'teacher');

create policy "Anyone can read module files"
on storage.objects for select
using (bucket_id = 'module-files');
```

---

## PHASE 6 — Deploy the Edge Function (admin user creation)

You need the Supabase CLI for this one piece.

**Install the CLI:**

```bash
# macOS / Linux
brew install supabase/tap/supabase

# Windows — use Scoop
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Or, any OS, via npx (no install needed)
npx supabase --version
```

**Login and link to your project:**

```bash
supabase login
# opens a browser to authorize

cd ijed-supabase-experiment
supabase link --project-ref xxxxxxxxxxxx
# the project-ref is the subdomain part of your Project URL
```

**Deploy the function:**

```bash
supabase functions deploy admin-create-user --project-ref xxxxxxxxxxxx
```

(The function code is already at
`supabase-migration/edge_functions/admin-create-user/index.ts` — the CLI
looks for it under a `supabase/functions/` folder, so if it can't find it,
copy it there first: `mkdir -p supabase/functions/admin-create-user && cp supabase-migration/edge_functions/admin-create-user/index.ts supabase/functions/admin-create-user/`)

No extra secrets to configure — `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are auto-injected into every Edge Function.

---

## PHASE 7 — Configure the frontend with your project's keys

Open `lms-frontend/assets/js/lms-supabase-api.js` and edit the top two lines:

```js
const SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";       // your Project URL
const SUPABASE_ANON_KEY = "eyJhbGciOi...";                       // your anon public key
```

Save, commit, push:

```bash
git add lms-frontend/assets/js/lms-supabase-api.js
git commit -m "Configure Supabase project keys"
git push
```

---

## PHASE 8 — Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New → Project**.
2. **Import** your Git repo (connect GitHub or Bitbucket if you haven't —
   Vercel supports both).
3. On the configure screen:
   - **Root Directory** → click "Edit" → select `lms-frontend` (this is
     the actual static site; `lms-admin-backend` and `supabase-migration`
     should NOT be deployed)
   - **Framework Preset** → "Other" (it's vanilla JS, no build step)
   - **Build Command** → leave empty
   - **Output Directory** → leave as default (or `.` since root dir is
     already `lms-frontend`)
4. Click **Deploy**.
5. Wait ~30 seconds, then open the live URL Vercel gives you
   (`your-project.vercel.app`).

No environment variables needed in Vercel — the Supabase anon key is
meant to be public in frontend code (RLS does the actual protecting), and
it's already hardcoded in `lms-supabase-api.js` from Phase 7.

---

## PHASE 9 — Test the live site

Open your Vercel URL and walk through
`supabase-migration/SAMPLE_DATA_README.md`'s test flow:

1. Log in as `admin@ijed.test` → check dashboard stats
2. Log in as `teacher1@ijed.test` → check subjects/modules/activities
3. Log in as `student1@ijed.test` → submit the quiz (auto-grades) and the
   essay (pending grade)
4. Back to teacher → grade the essay
5. Back to student → confirm graded result + analytics tab populates

If something breaks, open the browser console (F12) and grab the exact
error — paste it to me and I'll fix the specific file fast.

---

## Quick reference — what lives where

| Thing | Where |
| --- | --- |
| Frontend code | `lms-frontend/` (this is what Vercel deploys) |
| Supabase SQL + guides | `supabase-migration/` (not deployed — reference only) |
| Old FastAPI backend | `lms-admin-backend/` (untouched, your rollback path) |
| Supabase keys | top of `lms-frontend/assets/js/lms-supabase-api.js` |
| Edge Function source | `supabase-migration/edge_functions/admin-create-user/` |

---

## If you want to redo this on a brand-new Supabase project later

Just repeat Phases 2–7 — nothing in the frontend code or Vercel deployment
needs to change except the two constants in Phase 7.
