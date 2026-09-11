-- ============================================================================
-- IJED LMS — Supabase-only schema (Experiment: no FastAPI backend)
-- Run this in Supabase SQL Editor, in order: 01 → 02 → 03 → 04
--
-- DESIGN DECISIONS:
--   • Integer PKs kept as-is (matches your current data, zero migration risk).
--   • users.auth_uid bridges your existing `users` row to Supabase Auth
--     (auth.users.id, a uuid). This is what RLS policies key off of.
--   • hashed_password is kept but now OPTIONAL/legacy — Supabase Auth owns
--     credentials going forward. Do not write to it from the new frontend.
-- ============================================================================

-- ── roles ────────────────────────────────────────────────────────────────────
create table if not exists roles (
    id   serial primary key,
    name varchar(50) not null unique  -- admin | teacher | student
);

-- ── users (profile table, linked to Supabase Auth) ──────────────────────────
create table if not exists users (
    id              serial primary key,
    auth_uid        uuid unique references auth.users(id) on delete cascade,
    email           varchar(255) not null unique,
    hashed_password varchar(255),                 -- legacy, nullable now
    first_name      varchar(100) not null,
    last_name       varchar(100) not null,
    role_id         integer not null references roles(id),
    is_active       boolean not null default true,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index if not exists ix_users_email      on users(email);
create index if not exists ix_users_role_id    on users(role_id);
create index if not exists ix_users_is_active  on users(is_active);
create index if not exists ix_users_created_at on users(created_at);
create index if not exists ix_users_auth_uid   on users(auth_uid);

-- ── subjects ─────────────────────────────────────────────────────────────────
create table if not exists subjects (
    id          serial primary key,
    name        varchar(150) not null unique,
    description text
);

-- ── classes ──────────────────────────────────────────────────────────────────
create table if not exists classes (
    id          serial primary key,
    name        varchar(150) not null,
    grade_level varchar(50),
    school_year varchar(20),
    is_active   boolean default true
);

-- ── sections ─────────────────────────────────────────────────────────────────
create table if not exists sections (
    id       serial primary key,
    name     varchar(100) not null,
    class_id integer not null references classes(id)
);

-- ── teachers ─────────────────────────────────────────────────────────────────
create table if not exists teachers (
    id              serial primary key,
    user_id         integer not null unique references users(id),
    employee_id     varchar(50) unique,
    specialization  varchar(150),
    contact_number  varchar(30)
);

-- ── teacher_class_assignments ────────────────────────────────────────────────
create table if not exists teacher_class_assignments (
    id          serial primary key,
    teacher_id  integer not null references teachers(id),
    class_id    integer not null references classes(id),
    subject_id  integer not null references subjects(id),
    schedule    varchar(255),
    assigned_at timestamptz default now(),
    constraint uq_teacher_class_subject unique (teacher_id, class_id, subject_id)
);
create index if not exists ix_tca_teacher_id on teacher_class_assignments(teacher_id);
create index if not exists ix_tca_subject_id on teacher_class_assignments(subject_id);
create index if not exists ix_tca_class_id   on teacher_class_assignments(class_id);

-- ── students ─────────────────────────────────────────────────────────────────
create table if not exists students (
    id                serial primary key,
    user_id           integer not null unique references users(id),
    student_number    varchar(50) unique,
    contact_number    varchar(30),
    guardian_name     varchar(200),
    guardian_contact  varchar(30)
);

-- ── student_section_assignments ──────────────────────────────────────────────
create table if not exists student_section_assignments (
    id          serial primary key,
    student_id  integer not null references students(id),
    section_id  integer not null references sections(id),
    enrolled_at timestamptz default now(),
    constraint uq_student_section unique (student_id, section_id)
);
create index if not exists ix_ssa_student_id on student_section_assignments(student_id);
create index if not exists ix_ssa_section_id on student_section_assignments(section_id);

-- ── student_subject_enrollments ───────────────────────────────────────────────
create table if not exists student_subject_enrollments (
    id          serial primary key,
    student_id  integer not null references students(id) on delete cascade,
    subject_id  integer not null references subjects(id) on delete cascade,
    enrolled_at timestamptz not null default now(),
    constraint uq_student_subject unique (student_id, subject_id)
);
create index if not exists ix_sse_student_id on student_subject_enrollments(student_id);
create index if not exists ix_sse_subject_id on student_subject_enrollments(subject_id);

-- ── modules ───────────────────────────────────────────────────────────────────
create table if not exists modules (
    id           serial primary key,
    title        varchar(255) not null,
    description  text,
    class_id     integer references classes(id),
    subject_id   integer references subjects(id),
    teacher_id   integer references teachers(id),
    "order"      integer default 0,
    term         varchar(20),
    file_url     varchar(500),
    file_name    varchar(255),
    is_published boolean default false,
    created_at   timestamptz default now()
);
create index if not exists ix_modules_subject_id   on modules(subject_id);
create index if not exists ix_modules_is_published on modules(is_published);
create index if not exists ix_modules_class_id      on modules(class_id);

-- ── activities ────────────────────────────────────────────────────────────────
create table if not exists activities (
    id                    serial primary key,
    title                 varchar(255) not null,
    description           text,
    instructions          text,
    activity_type         varchar(50) not null default 'quiz',
    activity_type_custom  varchar(100),
    format_type           varchar(30) not null default 'multiple_choice',
    grading_mode          varchar(20) not null default 'auto',
    term                  varchar(20),
    module_id             integer not null references modules(id),
    subject_id            integer references subjects(id),
    teacher_id            integer references teachers(id),
    max_score             integer,
    start_date            timestamptz,
    due_date              timestamptz,
    is_published          boolean default false,
    created_at            timestamptz default now()
);
create index if not exists ix_activities_module_id    on activities(module_id);
create index if not exists ix_activities_subject_id   on activities(subject_id);
create index if not exists ix_activities_is_published on activities(is_published);

-- ── activity_questions ────────────────────────────────────────────────────────
create table if not exists activity_questions (
    id              serial primary key,
    activity_id     integer not null references activities(id) on delete cascade,
    "order"         integer default 0,
    question_text   text not null,
    question_type   varchar(30) not null,  -- multiple_choice | checkbox | fill_blank | enumeration | essay
    points          integer default 1,
    correct_answer  text
);

-- ── activity_question_choices ─────────────────────────────────────────────────
create table if not exists activity_question_choices (
    id           serial primary key,
    question_id  integer not null references activity_questions(id) on delete cascade,
    "order"      integer default 0,
    choice_text  text not null
);

-- ── activity_submissions ──────────────────────────────────────────────────────
create table if not exists activity_submissions (
    id            serial primary key,
    activity_id   integer not null references activities(id) on delete cascade,
    student_id    integer not null references students(id) on delete cascade,
    submitted_at  timestamptz default now(),
    score         integer,
    max_score     integer,
    grade         varchar(10),
    remarks       text,
    is_graded     boolean default false,
    constraint uq_submission_activity_student unique (activity_id, student_id)
);
create index if not exists ix_submissions_student_id  on activity_submissions(student_id);
create index if not exists ix_submissions_activity_id on activity_submissions(activity_id);
create index if not exists ix_submissions_is_graded   on activity_submissions(is_graded);

-- ── activity_answers ──────────────────────────────────────────────────────────
create table if not exists activity_answers (
    id             serial primary key,
    submission_id  integer not null references activity_submissions(id) on delete cascade,
    question_id    integer not null references activity_questions(id) on delete cascade,
    answer_value   text,
    is_correct     boolean,
    points_earned  integer
);

-- ── student_module_reads ──────────────────────────────────────────────────────
create table if not exists student_module_reads (
    id             serial primary key,
    student_id     integer not null references students(id) on delete cascade,
    module_id      integer not null references modules(id) on delete cascade,
    first_read_at  timestamptz default now(),
    last_read_at   timestamptz default now(),
    constraint uq_student_module_read unique (student_id, module_id)
);
create index if not exists ix_smr_student_id on student_module_reads(student_id);
create index if not exists ix_smr_module_id  on student_module_reads(module_id);

-- ── notifications ──────────────────────────────────────────────────────────────
create table if not exists notifications (
    id                 serial primary key,
    target_user_id     integer not null references users(id) on delete cascade,
    actor_user_id      integer references users(id) on delete set null,
    notification_type  varchar(50) not null,
    title              varchar(255) not null,
    message            text not null,
    link_type          varchar(50),
    link_id            integer,
    is_read            boolean not null default false,
    created_at         timestamptz not null default now()
);
create index if not exists ix_notifications_target_user_id on notifications(target_user_id);

-- ── attendance_sessions ────────────────────────────────────────────────────────
create table if not exists attendance_sessions (
    id            serial primary key,
    teacher_id    integer not null references teachers(id) on delete cascade,
    class_id      integer not null references classes(id) on delete cascade,
    subject_id    integer references subjects(id) on delete set null,
    term          varchar(20) not null default '1st',
    session_date  date not null,
    has_class     boolean not null default true,
    notes         text,
    created_at    timestamptz default now(),
    constraint uq_attendance_session_class_subject_date unique (class_id, subject_id, session_date)
);

-- ── attendance_records ─────────────────────────────────────────────────────────
create table if not exists attendance_records (
    id          serial primary key,
    session_id  integer not null references attendance_sessions(id) on delete cascade,
    student_id  integer not null references students(id) on delete cascade,
    status      varchar(10) not null default 'absent',  -- present | absent | late | excused
    remarks     text,
    constraint uq_att_record_session_student unique (session_id, student_id)
);

-- ── analytics_cache ────────────────────────────────────────────────────────────
create table if not exists analytics_cache (
    id           serial primary key,
    student_id   integer not null references students(id) on delete cascade,
    cache_key    varchar(120) not null,
    payload      text not null,
    computed_at  timestamptz not null default now(),
    constraint uq_analytics_cache_student_key unique (student_id, cache_key)
);
create index if not exists ix_analytics_cache_student_id  on analytics_cache(student_id);
create index if not exists ix_analytics_cache_computed_at on analytics_cache(computed_at);

-- ── Seed roles (idempotent) ────────────────────────────────────────────────────
insert into roles (name) values ('admin'), ('teacher'), ('student')
on conflict (name) do nothing;
