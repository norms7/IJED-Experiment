# IJED Learning Management System

<!-- markdownlint-disable MD033 -->
<p align="center">
  <img src="lms-frontend/assets/images/logo.png" alt="IJED Logo" width="120"/>
</p>
<p align="center">
  A browser-based Learning Management System for <strong>Imelda Justice Education for Development (IJED)</strong><br>
  and <strong>Infant Jesus Learning Academy</strong>.
</p>
<p align="center">
  <img src="https://img.shields.io/badge/Frontend-Vanilla%20HTML%2FCSS%2FJS-F7DF1E?logo=javascript" alt="Vanilla JavaScript"/>
  <img src="https://img.shields.io/badge/Backend-Supabase-3ECF8E?logo=supabase" alt="Supabase"/>
  <img src="https://img.shields.io/badge/Database-PostgreSQL-336791?logo=postgresql" alt="PostgreSQL"/>
  <img src="https://img.shields.io/badge/Analytics-Descriptive%20%2B%20Bayesian-6D597A" alt="Analytics"/>
</p>
<!-- markdownlint-enable MD033 -->

## Overview

IJED LMS provides separate workflows for administrators, teachers, and students. The current experiment is a Supabase-only implementation: the static frontend communicates directly with Supabase for authentication, database access, file storage, realtime notifications, and protected analytics computation.

There is no FastAPI, Python, SQLAlchemy, Alembic, or separate Node/Express server in the current stack.

## Features

### Administrator

- Dashboard statistics and system overview
- Manage users, teachers, students, classes, sections, subjects, modules, and activities
- Manage teacher assignments and student subject enrollments
- Publish announcements and manage notification delivery
- Create user accounts through the protected `admin-create-user` Edge Function

### Teacher

- View assigned subjects, classes, and students
- Create, publish, edit, and delete learning modules
- Upload PDF module files to Supabase Storage
- Create and manage multiple-choice, freeform, hybrid, and assignment activities, including activity files for manually graded work
- Review student-uploaded files alongside written answers and manually grade submissions
- Review submissions and manually grade activities when required
- Track module reading progress
- Create attendance sessions and record present, late, absent, or excused status
- View attendance summaries and gradebook data
- Gradebook ACT% is earned points divided by possible points; graded submissions count immediately, pending submissions do not count, and due unsubmitted activities count as zero. The term's shared 75/15/10 current-standing percentage is shown as the Initial Grade and converted to the DepEd Transmuted Grade, with 75 as the passing mark.

### Student

- Role-based dashboard with progress, upcoming activities, and notifications
- View enrolled subjects and published modules
- Read modules and track reading progress
- Submit activities and view grades and submission results
- View subject and term attendance summaries
- Use the calendar and notification inbox
- Explore Performance Analytics with descriptive and Bayesian analysis

## Performance Analytics

Analytics are available in the student Performance Analytics area. Results are filtered by subject and term and cached in Supabase for faster repeat loads. Students receive their own records and authorized aggregate comparisons; cross-student information is computed by protected PostgreSQL RPCs.

Teachers can open **Class Performance** for their assigned subjects and sections; administrators can select across the available subjects and sections. The report includes rating-band counts, a needs-attention list, per-student component scores, and a drill-down of activities, attendance, and module reading. The Excel export contains Summary, Activities, Attendance, Modules, and Formulas sheets. Weekly reports retain current-standing summary scores while limiting activity and attendance details to the previous seven days; term reports include the selected term.

### Descriptive analysis

- **Grade progress:** chronological graded scores, percentages, activity names, and activity types
- **Attendance calendar:** attendance status by date, subject, month, year, and term
- **Score versus class average:** compares the student's results with an aggregate class result without exposing peer identities
- **Module reading progress:** modules read, remaining modules, and completion percentage per subject and overall
- **Subject radar:** average percentage and activity count for each enrolled subject

The underlying academic measures use the following formulas:

- Academic score = `(total earned points / total possible points) * 100`
- Attendance score = `((present + late * 0.5) / non-excused meetings) * 100`
- Module score = `(modules read / total published modules) * 100`

The calculation process is:

1. Published activities with a graded submission count immediately, even if their due date is in the future.
2. Unsubmitted activities count only when due or undated, and contribute `0 / max_score`; future activities without a submission are excluded.
3. Graded submissions contribute their earned points and maximum points; if a legacy submission has no valid `max_score`, the activity's `max_score` is used. Submissions waiting for grading are excluded until graded.
4. Published modules and recorded attendance are filtered to the selected subject and term.
5. The resulting component percentages are displayed in the descriptive cards and reused by the Bayesian calculations.

For class comparisons, the browser does not read other students' raw rows. Supabase RPCs calculate the class aggregate inside PostgreSQL and return only the requesting student's result and permitted summary statistics.

### Bayesian analysis

- **Predicted final grade:** combines academic performance, attendance, and module completion using the school weighting of 75%, 15%, and 10%. Missing components have their available weights redistributed rather than being treated as zero.
- **Estimated range:** reports a transparent uncertainty range that narrows as more graded activities are recorded.
- **Probability of reaching a target grade:** uses a Beta-Binomial posterior instead of a fixed lookup table. The prior is centered on the class success rate at the selected target and has a strength of four pseudo-observations; the student's own successes and failures update that prior.
- **Credible interval:** reports a 90% credible interval computed from exact Beta-distribution quantiles.
- **Comparison with class performance:** computes the exact Beta posterior probability that the student's underlying success rate is above the class rate.
- **Engagement leaderboard:** ranks section-mates using attendance (40%) and module reading (60%) only; academic scores are excluded. It shows the top five plus the current student's row when outside the top five, using the selected subject and term filters. The protected RPC returns no student IDs or raw attendance/module records.
- **Performance rating:** classifies the weighted score as Excellent, Very Good, Good, Fair, Needs Improvement, or At Risk and explains the indicators that affect it.

#### Bayesian computation

##### In plain language

The Bayesian card estimates the chance that the student's **next graded activity** will reach the selected target. It is not a prediction of the final course grade.

The estimate starts with a small class-based starting point, then adjusts it using the student's own graded activities:

1. Pick a target, such as **90%**. Each graded activity is a success if its score percentage meets or exceeds the target; otherwise it is a failure. A past-due, unsubmitted activity counts as a failure. Ungraded work is not counted yet.
2. Count the other students' successes and failures at that target. The student is left out of this class count. Their success rate becomes the starting estimate.
3. Give that starting estimate the weight of four imaginary results. This keeps a small class sample from dominating the estimate. For example, if the class has 3 successes and 7 failures, its rate is 3/10 = 30%. The four imaginary results become 1.2 successes and 2.8 failures.
4. Add the student's real results to those starting counts. If the student has 3 successes and 2 failures, the updated counts are 4.2 successes and 4.8 failures.
5. Divide updated successes by all updated counts: 4.2 / (4.2 + 4.8) = **46.7%**. That is the estimated chance the next graded activity reaches 90%.

The displayed 90% range describes uncertainty around that estimate; it is not a guaranteed range for the next score. In the example above, the range is about **21% to 73%**. More graded evidence usually makes this range narrower. If there is no class evidence, the starting point is neutral (50%).

##### The calculation

For a selected target:

```text
class_rate = peer_successes / (peer_successes + peer_failures)
prior_alpha = class_rate * 4
prior_beta  = (1 - class_rate) * 4
posterior_alpha = prior_alpha + student_successes
posterior_beta  = prior_beta + student_failures
next_activity_probability = posterior_alpha / (posterior_alpha + posterior_beta)
```

When no class results exist, `class_rate` is set to `0.5`. The engine computes the 90% uncertainty range from the Beta distribution and calculates the probability that the student's underlying success rate is above the class rate. These calculations use aggregate counts only; individual classmates' identities and grades are not exposed.

The final-grade prediction is a separate weighted estimate using the shared component scores:

```text
predicted_grade = 0.75 * academic_score
           + 0.15 * attendance_score
           + 0.10 * module_score
```

Only components with available data are included, and their weights are normalized to the weights that remain. Its displayed estimate range is the transparent heuristic `predicted_grade +/- max(2, 15 / sqrt(n))`, where `n` is the number of applicable graded activities.

The performance rating uses the same 75/15/10 component weighting and six rating bands: 90+ Excellent, 85-89 Very Good, 80-84 Good, 75-79 Fair, 70-74 Needs Improvement, and below 70 At Risk.

Pure analytics calculations live in `lms-frontend/assets/js/analytics.engine.js`. The core analytics RPCs include `_student_attendance_rows`, `get_beta_binomial_evidence`, `get_score_vs_class_average`, `get_engagement_percentile`, `get_engagement_leaderboard`, and `get_student_attendance_calendar`; the protected functions and report/notification RPCs are defined in `supabase-migration/08_performance_overview.sql`.

### How the computations work

The gradebook and student analytics use the same component calculations. Academic percentage is earned points divided by possible points; due or undated unsubmitted activities count as zero, while submitted work awaiting a grade is left out. Attendance gives full credit for present, half credit for late, and excludes excused meetings from the denominator. Module percentage is modules read divided by published modules. The 75/15/10 weights are redistributed across components that have data, and the per-subject result is rounded to two decimal places. The gradebook treats that result as the Initial Grade and applies DepEd Order No. 8, s. 2015 transmutation; 75 is passing.

For transmutation, an Initial Grade of 60 or higher maps to `min(100, 75 + floor((Initial Grade - 60) / 1.6 + 1e-9))`; below 60 it maps to `min(100, 60 + floor(Initial Grade / 4 + 1e-9))`.

The documented calculation decisions are:

- **D1 — Excused attendance:** exclude excused meetings from the attendance denominator.
- **D2 — All subjects:** calculate each subject separately, then give equal weight to subjects with data; Bayesian activity evidence is pooled across selected subjects.
- **D3 — DepEd grade:** transmute the per-subject, per-term 75/15/10 overall percentage as the Initial Grade.

Performance notifications are deduplicated in the database. This repository triggers the notification RPC once at admin/teacher login; no `pg_cron` schedule is configured here.

## Why the technology stack changed

The original documentation described a FastAPI backend with SQLAlchemy, JWT authentication, Alembic migrations, and Server-Sent Events. The current implementation moved those responsibilities to Supabase for this experiment:

| Previous approach | Current approach | Reason |
| --- | --- | --- |
| FastAPI application server | Supabase Postgres, RPCs, and Edge Functions | Removes a separate always-on API service and reduces deployment and maintenance overhead |
| SQLAlchemy models and Alembic | Versioned SQL in `supabase-migration/` | Keeps schema, RLS policies, functions, triggers, and analytics calculations together with the database they control |
| Application-managed JWT and password hashing | Supabase Auth | Provides managed authentication and links Auth users to LMS records through `users.auth_uid` |
| Backend SSE endpoint | Supabase Realtime | Delivers notification updates directly from the database without maintaining open connections in a custom server |
| Backend PDF handling | Supabase Storage | Provides hosted file storage and access policies for module files |
| Server-side analytics service | Client analytics engine plus protected PostgreSQL RPCs | Keeps student-specific calculations responsive while moving cross-student aggregates behind RLS-aware database functions |

This change does not mean that all computation moved into the browser. Any calculation that requires rows belonging to other students, such as class averages and engagement percentiles, remains inside `SECURITY DEFINER` RPCs and returns only the minimum aggregate data needed by the current student.

## Current technology stack

| Layer | Technology |
| --- | --- |
| Frontend | Vanilla HTML, CSS, and JavaScript using an MVC-style organization |
| Database | Supabase PostgreSQL |
| Authentication | Supabase Auth |
| Authorization | PostgreSQL Row Level Security policies |
| Database logic | PostgreSQL functions and RPCs |
| Realtime | Supabase Realtime subscriptions |
| File storage | Supabase Storage (`module-files` and private `Activity-files` buckets) |
| Administrative server code | Supabase Edge Function (`admin-create-user`) |
| Spreadsheet support | SheetJS via CDN |
| Frontend hosting | Any static host or local Live Server |

## Project structure

```text
Experiment/
├── lms-frontend/
│   ├── index.html                         # Static single-page application shell
│   ├── assets/
│   │   ├── css/                           # Layout, components, analytics, dark mode
│   │   ├── images/                        # Branding assets
│   │   └── js/
│   │       ├── analytics.engine.js        # Descriptive and Bayesian calculations
│   │       ├── lms-supabase-api.js        # Supabase data and Auth client
│   │       └── lms-icons.js               # Shared icons
│   ├── controllers/                       # Auth, role, dashboard, attendance, and analytics flows
│   ├── models/                            # Local frontend models
│   ├── utils/                             # Loading, storage, toast, modal, and validation helpers
│   └── views/                             # Admin, teacher, student, calendar, and analytics renderers
└── supabase-migration/
    ├── 01_schema.sql                      # Tables, indexes, triggers, and storage definitions
    ├── 02_rls_policies.sql                # Row Level Security and authorization helpers
    ├── 03_functions.sql                   # RPCs, analytics functions, and auth trigger
    ├── 04_sample_seed_data.sql             # Optional sample LMS data
    ├── 05_profile_settings.sql             # Profile details and avatar storage policies
    ├── 06_notifications_realtime.sql       # Notification triggers and Realtime publication
    ├── 07_activity_term.sql                # Activity term column and index
    ├── 08_performance_overview.sql         # Protected analytics/report RPCs, cache invalidation, notifications
    ├── edge_functions/admin-create-user/   # Secure admin account creation
    ├── edge_functions/admin-update-user/   # Secure admin email/password updates
    ├── FULL_SETUP_GUIDE.md
    └── MIGRATION_GUIDE.md
```

The obsolete copies formerly under `supabase-migration/frontend_additions/` were removed; `lms-frontend/assets/js/` contains the canonical analytics engine and Supabase client.

## Tests

Run the dependency-free pure calculation suite with:

```powershell
node tests\performance.test.js
```

The Supabase integration assertions in `supabase-migration/tests/08_performance_overview_tests.sql` must be run in the Supabase SQL Editor after migrations 01-08. They run in a transaction and roll back their test users, classes, submissions, attendance, modules, and notifications.

## Setup

### Prerequisites

- A Supabase project
- A modern browser
- VS Code Live Server, Python's simple HTTP server, or another static file server
- Supabase CLI only when deploying the Edge Function

### 1. Create the database

Run these files in the Supabase SQL Editor, in order:

1. `supabase-migration/01_schema.sql`
2. `supabase-migration/02_rls_policies.sql`
3. `supabase-migration/03_functions.sql`
4. `supabase-migration/04_sample_seed_data.sql` (optional)
5. `supabase-migration/05_profile_settings.sql`
6. `supabase-migration/06_notifications_realtime.sql`
7. `supabase-migration/07_activity_term.sql`
8. `supabase-migration/08_performance_overview.sql`

The migration guide explains account linking, storage policies, and deployment details: [supabase-migration/FULL_SETUP_GUIDE.md](supabase-migration/FULL_SETUP_GUIDE.md).

### 2. Configure Supabase

Update the project URL and public anon key in `lms-frontend/assets/js/lms-supabase-api.js` if they are not already configured. The anon key is intended for browser use; database protection must come from the RLS policies. Never put the Supabase service-role key in frontend files.

Create a public Storage bucket named `module-files` and apply the teacher upload and file read policies described in the setup guide. Configure any private activity-file bucket and policies separately according to your Supabase project's storage setup; the performance migration does not create that bucket.

The profile settings migration creates the `profile-images` bucket, stores address/social details, and adds the avatar URL used by student and teacher profile settings. Profile identity, role, section, year level, employment, and account status remain read-only.

### 3. Deploy account creation

The admin user creation flow requires the service-role key and therefore runs as an Edge Function, never in the browser:

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy admin-create-user
```

### 4. Run the frontend

From the repository root, serve the static frontend. For example, with VS Code Live Server open `lms-frontend/index.html`, or run:

```bash
python -m http.server 5500 --directory lms-frontend
```

Open `http://localhost:5500` and sign in with a Supabase Auth account linked to a row in the `users` table. For sample accounts and data, see [supabase-migration/SAMPLE_DATA_README.md](supabase-migration/SAMPLE_DATA_README.md).

## Development notes

- Run SQL migrations in the documented order and review RLS policies whenever a table or RPC changes.
- Keep service-role credentials inside Edge Functions or Supabase-managed secrets.
- Use protected RPCs for aggregates that require access to other students' rows.
- Analytics cache entries expire after 300 seconds for descriptive results and 600 seconds for Bayesian results (`DESCRIPTIVE_TTL_SECONDS` / `BAYESIAN_TTL_SECONDS` in `analytics.engine.js`); database triggers invalidate affected student entries after relevant changes.
- Attendance treats present as 100%, late as 50%, absent as 0%, and excludes excused meetings from its denominator.
- Past-due, unsubmitted activities count as zero earned points against their own maximum score; activities awaiting grading are not penalized.
- The frontend has no package build step. Script order in `lms-frontend/index.html` is part of the runtime dependency order.

## Further documentation

- [Supabase migration guide](supabase-migration/MIGRATION_GUIDE.md)
- [Full setup guide](supabase-migration/FULL_SETUP_GUIDE.md)
- [Sample data guide](supabase-migration/SAMPLE_DATA_README.md)

## License

This project is developed for **Infant Jesus Learning Academy** and **Imelda Justice Education for Development**. All rights reserved.

<!-- markdownlint-disable MD033 -->
<p align="center">Built for IJED · Infant Jesus Learning Academy</p>
<!-- markdownlint-enable MD033 -->