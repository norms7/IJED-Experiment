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
- Create and manage multiple-choice, freeform, hybrid, and assignment activities
- Review submissions and manually grade activities when required
- Track module reading progress
- Create attendance sessions and record present, late, absent, or excused status
- View attendance summaries and gradebook data

### Student

- Role-based dashboard with progress, upcoming activities, and notifications
- View enrolled subjects and published modules
- Read modules and track reading progress
- Submit activities and view grades and submission results
- View subject and term attendance summaries
- Use the calendar and notification inbox
- Explore Performance Analytics with descriptive and Bayesian analysis

## Performance Analytics

Analytics are available in the student Performance Analytics area. Results are filtered by subject and term and cached in Supabase for faster repeat loads. Row Level Security (RLS) ensures that students receive their own records and aggregate comparisons only.

### Descriptive analysis

- **Grade progress:** chronological graded scores, percentages, activity names, and activity types
- **Attendance calendar:** attendance status by date, subject, month, year, and term
- **Score versus class average:** compares the student's results with an aggregate class result without exposing peer identities
- **Module reading progress:** modules read, remaining modules, and completion percentage per subject and overall
- **Subject radar:** average percentage and activity count for each enrolled subject

The underlying academic measures use the following formulas:

- Academic score = `(total earned points / total possible points) * 100`
- Attendance score = `((present + late * 0.5) / total meetings) * 100`
- Module score = `(modules read / total published modules) * 100`

The calculation process is:

1. Only published activities that are due, or have no due date, are included.
2. Graded submissions contribute their actual earned and maximum points.
3. Past-due activities with no submission contribute `0 / max_score`; submissions waiting for grading are excluded until graded.
4. Published modules and recorded attendance are filtered to the selected subject and term.
5. The resulting component percentages are displayed in the descriptive cards and reused by the Bayesian calculations.

For class comparisons, the browser does not read other students' raw rows. Supabase RPCs calculate the class aggregate inside PostgreSQL and return only the requesting student's result and permitted summary statistics.

### Bayesian analysis

- **Predicted final grade:** combines academic performance, attendance, and module completion using the school weighting of 75%, 15%, and 10%. Missing components have their available weights redistributed rather than being treated as zero.
- **Estimated range:** reports a transparent uncertainty range that narrows as more graded activities are recorded.
- **Probability of reaching a target grade:** uses a Beta-Binomial posterior instead of a fixed lookup table. The prior is centered on the class success rate at the selected target and has a strength of four pseudo-observations; the student's own successes and failures update that prior.
- **Credible interval:** reports a 90% approximate credible interval for the probability of meeting the target.
- **Comparison with class performance:** estimates the probability that the student's underlying success rate is above the class rate using the posterior distribution and a normal CDF approximation.
- **Students Like You:** computes an engagement index and peer percentile from attendance and module completion inside a protected PostgreSQL RPC. Peer identities and raw peer scores are never sent to the browser.
- **Performance rating:** classifies the weighted score as Excellent, Very Good, Good, Fair, Needs Improvement, or At Risk and explains the indicators that affect it.

#### Bayesian computation

The Bayesian target model answers: "Given the available evidence, how likely is this student to reach the selected target percentage on a future activity?"

1. A graded activity is marked a **success** when `score / max_score * 100 >= target_grade`; otherwise it is a failure.
2. The class success rate at that same target supplies an empirical prior. If `peer_successes` and `peer_failures` are the class evidence, then:

  ```text
  class_rate = peer_successes / (peer_successes + peer_failures)
  alpha0 = class_rate * 4
  beta0  = (1 - class_rate) * 4
  ```

  When no class evidence exists, the prior defaults to a neutral 50/50 split. The value `4` is the prior strength, or four pseudo-observations.

3. The student's own results update the prior. With `student_successes = s` and `student_failures = f`, the posterior is:

  ```text
  theta | data ~ Beta(alpha0 + s, beta0 + f)
  ```

4. The reported probability is the posterior mean, which is also the Beta-Binomial posterior-predictive probability of success on the next activity:

  ```text
  probability = (alpha0 + s) / (alpha0 + beta0 + s + f)
  ```

5. The posterior standard deviation is calculated from:

  ```text
  variance = (alpha * beta) / ((alpha + beta)^2 * (alpha + beta + 1))
  sd = sqrt(variance)
  ```

  The UI reports an approximate 90% credible interval using `mean +/- 1.645 * sd`, clipped to the range 0% to 100%. As the student's evidence grows, the posterior normally becomes narrower.

6. To compare the student with the class context, the implementation calculates a z-score from the posterior mean and the class rate, then applies the standard normal CDF. This produces `above_class_average_probability` without exposing individual classmates.

The final-grade prediction is a separate weighted estimate using the shared component scores:

```text
predicted_grade = 0.75 * academic_score
           + 0.15 * attendance_score
           + 0.10 * module_score
```

Only components with available data are included, and their weights are normalized to the weights that remain. Its displayed estimate range is the transparent heuristic `predicted_grade +/- max(2, 15 / sqrt(n))`, where `n` is the number of applicable graded activities.

The performance rating uses the same 75/15/10 component weighting and six rating bands: 90+ Excellent, 85-89 Very Good, 80-84 Good, 75-79 Fair, 70-74 Needs Improvement, and below 70 At Risk.

Analytics functions are defined in `lms-frontend/assets/js/analytics.engine.js` and the supporting secure RPCs are in `supabase-migration/03_functions.sql`.

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
| File storage | Supabase Storage (`module-files` bucket) |
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
    ├── 07_audit_log.sql                    # Administrative audit history and triggers
    ├── edge_functions/admin-create-user/   # Secure admin account creation
    ├── edge_functions/admin-update-user/   # Secure admin email/password updates
    ├── FULL_SETUP_GUIDE.md
    └── MIGRATION_GUIDE.md
```

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
7. `supabase-migration/07_audit_log.sql`

The migration guide explains account linking, storage policies, and deployment details: [supabase-migration/FULL_SETUP_GUIDE.md](supabase-migration/FULL_SETUP_GUIDE.md).

### 2. Configure Supabase

Update the project URL and public anon key in `lms-frontend/assets/js/lms-supabase-api.js` if they are not already configured. The anon key is intended for browser use; database protection must come from the RLS policies. Never put the Supabase service-role key in frontend files.

Create a public Storage bucket named `module-files` and apply the teacher upload and file read policies described in the setup guide.

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
- Analytics cache entries expire after five minutes for descriptive results and ten minutes for Bayesian results.
- Attendance treats present as 100%, late as 50%, and absent as 0%.
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
