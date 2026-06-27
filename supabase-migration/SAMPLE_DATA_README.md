# Sample Data — Setup & Test Flow

## 1. Run the SQL, in order, in a fresh Supabase project's SQL Editor

```
01_schema.sql
02_rls_policies.sql
03_functions.sql
04_sample_seed_data.sql
```

`04_sample_seed_data.sql` creates **profile rows only** (in `users`,
`teachers`, `students`, etc.) with `auth_uid = null`. It prints a
`NOTICE` at the end with the generated ids — useful for poking around,
but not required for testing.

---

## 2. Create the matching Supabase Auth accounts

Go to **Dashboard → Authentication → Users → Add User** and create these
8 accounts. Use the **exact emails** below (case-sensitive match to the
seed data) — any password works, suggested ones below for convenience.
Check "Auto Confirm User" so they can log in immediately.

| Role    | Email                  | Suggested Password | Name             |
|---------|------------------------|---------------------|------------------|
| Admin   | admin@ijed.test        | Admin123!           | Grace Villanueva |
| Teacher | teacher1@ijed.test     | Teacher123!         | Maria Santos (Math + Science) |
| Teacher | teacher2@ijed.test     | Teacher123!         | Juan Cruz (English) |
| Student | student1@ijed.test     | Student123!         | Ana Reyes        |
| Student | student2@ijed.test     | Student123!         | Ben Tan          |
| Student | student3@ijed.test     | Student123!         | Carla Lim        |
| Student | student4@ijed.test     | Student123!         | Dario Cruz       |
| Student | student5@ijed.test     | Student123!         | Elena Bautista   |

The moment each account is created, the `on_auth_user_created` trigger
(from `03_functions.sql`) fires and sets `auth_uid` on the matching
`users` row automatically — no extra SQL needed.

**Verify the link worked:**
```sql
select email, auth_uid is not null as linked from users order by email;
-- all 8 rows should show linked = true
```

> Do **not** use the `admin-create-user` Edge Function for these 8 — that
> function is for creating genuinely *new* accounts later (it inserts a
> fresh profile row, which would collide with the ones the seed script
> already made). The Dashboard method above is correct specifically
> because these profile rows already exist.

---

## 3. What's in the sample data

- **1 class**: Grade 7 - Faith, with **1 section**: Section A (all 5
  students assigned here)
- **3 subjects**: Mathematics 7, Science 7, English 7 — all 5 students
  enrolled in all 3
- **2 teachers**: Maria Santos (Math + Science), Juan Cruz (English)
- **2 modules**: "Integers" (Math), "Cells" (Science), both published
- **2 activities**:
  - *Integers Quiz 1* — auto-graded, 3 multiple-choice questions, due in
    5 days (open now)
  - *Cell Theory Reflection* — manual-graded essay, due in 7 days (open now)
- **1 attendance session** (yesterday, Math class) with mixed statuses
  (present/present/late/absent/present) across the 5 students

## 4. Suggested test flow

1. **Log in as admin** (`admin@ijed.test`) → dashboard stats should show
   8 users (1 admin, 2 teachers, 5 students), 1 class, 2 modules, 2 activities.
2. **Log in as Maria Santos** (`teacher1@ijed.test`) → should see Math 7
   and Science 7 under "My Subjects", both modules, both activities.
3. **Log in as Ana Reyes** (`student1@ijed.test`):
   - Dashboard should show 3 enrolled subjects.
   - Open "Integers Quiz 1" → answer the 3 questions → submit → should
     **auto-grade instantly** (all multiple-choice → `grading_mode: auto`).
   - Open "Cell Theory Reflection" → submit a short answer → should show
     **"Submitted – Pending Grade"** (essay → manual grading required).
   - Mark the "Cells" module as read → dashboard module count should tick up.
4. **Back to Maria Santos** → open submissions for "Cell Theory
   Reflection" → grade Ana Reyes's submission → she should get a
   notification.
5. **Back to Ana Reyes** → result should show as graded; check the
   Analytics tab — Grade Progress should now show 2 data points (the
   auto-graded quiz + the just-graded essay), and the Bayesian "Predicted
   Final Grade" should shift toward her actual scores.
6. Try **Ben Tan, Carla Lim, etc.** the same way — submit a few quiz
   attempts with different right/wrong answers so "Score vs Class
   Average" and "Students Like You" have more than one data point to
   compare against (those need ≥2 students with submissions to be
   meaningful).

If all of the above works, every layer (RLS, RPC functions, Edge
Function, analytics engine) is functioning correctly end-to-end.
