# IJED Learning Management System

<p align="center">
  <img src="lms-frontend/assets/images/logo.png" alt="IJED Logo" width="120"/>
</p>

<p align="center">
  A full-stack Learning Management System for <strong>Imelda Justice Education for Development (IJED)</strong>,<br>
  built for <strong>Infant Jesus Learning Academy</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/FastAPI-0.111-009688?logo=fastapi" alt="FastAPI"/>
  <img src="https://img.shields.io/badge/Python-3.12-3776AB?logo=python" alt="Python"/>
  <img src="https://img.shields.io/badge/PostgreSQL-Async-336791?logo=postgresql" alt="PostgreSQL"/>
  <img src="https://img.shields.io/badge/Frontend-HTML%2FCSS%2FJS-F7DF1E?logo=javascript" alt="Frontend"/>
  <img src="https://img.shields.io/badge/Auth-JWT-000000?logo=jsonwebtokens" alt="JWT"/>
</p>

---

## Overview

IJED LMS is a web-based Learning Management System designed for school administrators, teachers, and students. It provides role-based dashboards, user management, course modules, attendance tracking, activity submission with auto-grading, real-time notifications, and more — all backed by a modern async FastAPI API.

---

## Features

| Role | Capabilities |
|------|-------------|
| **Admin** | Manage users, teachers, students, classes, sections, subjects, modules, activities; broadcast announcements |
| **Teacher** | View assigned subjects & students, manage modules (PDF upload), create & grade activities, record attendance per session |
| **Student** | Access published modules, submit activities, view grades, view own attendance summary, receive notifications, dashboard overview |

**Core highlights:**

- Role-based access control (Admin / Teacher / Student)
- JWT authentication with bcrypt password hashing
- Full CRUD for users, teachers, students, classes, sections, subjects, modules, activities, and attendance sessions
- Student attendance tracking — per-subject, per-term breakdown visible to both teacher and student
- Activity engine — multiple choice, freeform, hybrid, and assignment types with auto-grading
- PDF module uploads served via the backend
- Real-time notifications via SSE (Server-Sent Events) with admin broadcast
- Student dashboard with progress summary, upcoming activities, and module read tracking
- Async PostgreSQL with SQLAlchemy 2.0 (Supabase-compatible)
- Alembic database migrations
- Responsive sidebar UI with dark mode support
- Toast notifications, modal system, and live clock
- MVC-patterned vanilla JS frontend

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend Framework | FastAPI 0.111 |
| Language | Python 3.12 |
| ORM | SQLAlchemy 2.0 (async) |
| Database | PostgreSQL (local or Supabase) |
| Migrations | Alembic 1.13 |
| Auth | JWT (`python-jose`) + bcrypt (`passlib`) |
| Validation | Pydantic v2 |
| Server | Uvicorn |
| Frontend | Vanilla HTML / CSS / JavaScript (MVC pattern) |

---

## Project Structure

```
IJED/
├── lms-admin-backend/                  # FastAPI backend
│   ├── app/
│   │   ├── main.py                     # App factory, CORS, SSE, error handlers
│   │   ├── api/
│   │   │   └── v1/
│   │   │       ├── router.py           # Aggregates all routers
│   │   │       └── endpoints/
│   │   │           ├── auth.py                  # POST /auth/login
│   │   │           ├── dashboard.py             # Admin dashboard stats
│   │   │           ├── users.py                 # Admin user CRUD
│   │   │           ├── teachers.py              # Admin teacher management
│   │   │           ├── students.py              # Admin student management & enrollment
│   │   │           ├── classes.py               # Admin classes, sections, subjects
│   │   │           ├── modules.py               # Admin module & activity CRUD
│   │   │           ├── teacher_portal.py        # Teacher self-service + student portal base
│   │   │           ├── teacher_activities.py    # Teacher activity creation & grading
│   │   │           ├── attendance.py            # Teacher attendance sessions & records
│   │   │           ├── student_portal.py        # Student subjects, modules, attendance
│   │   │           ├── student_activities.py    # Student activity listing & submission
│   │   │           ├── student_dashboard.py     # Student dashboard & module read tracking
│   │   │           └── notifications.py         # SSE stream, inbox, admin broadcast
│   │   ├── core/
│   │   │   ├── config.py               # Pydantic settings (reads .env)
│   │   │   └── security.py             # JWT + bcrypt + auth dependency
│   │   ├── db/
│   │   │   └── session.py              # Async engine, session factory, Base
│   │   ├── models/
│   │   │   └── models.py               # All SQLAlchemy ORM models
│   │   ├── schemas/
│   │   │   └── schemas.py              # All Pydantic v2 request/response schemas
│   │   └── services/                   # Business logic layer
│   │       ├── auth_service.py
│   │       ├── dashboard_service.py
│   │       ├── user_service.py
│   │       ├── teacher_service.py
│   │       ├── student_service.py
│   │       └── module_service.py
│   ├── alembic/
│   │   └── versions/
│   │       └── 001_initial.py          # Full schema + roles seed
│   ├── seed.py                         # Bootstrap script (users + sample data)
│   ├── requirements.txt
│   ├── alembic.ini
│   └── .env.example
│
└── lms-frontend/                       # Vanilla JS frontend (MVC)
    ├── index.html                      # Single-page app shell
    ├── assets/
    │   ├── css/
    │   │   ├── main.css                # CSS variables, reset, base styles
    │   │   ├── layout.css              # Sidebar, topbar, page layout
    │   │   ├── components.css          # Cards, tables, modals, badges
    │   │   └── notifications.css       # Notification bell & dropdown styles
    │   ├── js/
    │   │   ├── app.js                  # Entry point (bootstraps App.init)
    │   │   └── lms-admin-api.js        # API client class (LMSAdminAPI)
    │   └── images/
    │       └── logo.png
    ├── controllers/
    │   ├── app.controller.js           # App bootstrap & routing
    │   ├── auth.controller.js          # Login / logout
    │   ├── admin.controller.js         # Admin section controllers
    │   ├── teacher.controller.js       # Teacher portal controllers
    │   ├── student.controller.js       # Student portal controllers (modules, attendance)
    │   ├── attendance.controller.js    # Attendance session management
    │   ├── dashboard.controller.js     # Role-based dashboard
    │   ├── gradebook.controller.js     # Gradebook view
    │   ├── calendar.controller.js      # Calendar view
    │   └── notification.controller.js  # Notification bell & SSE listener
    ├── models/
    │   └── models.js                   # Local data models
    ├── utils/
    │   └── utils.js                    # Storage, Toast, Modal, Validate helpers
    └── views/
        ├── admin.view.js               # Admin HTML template renderers
        ├── teacher.view.js             # Teacher HTML template renderers
        ├── student.view.js             # Student HTML template renderers
        └── calendar.view.js            # Calendar HTML template renderers
```

---

## Getting Started

### Prerequisites

- Python 3.12+
- PostgreSQL 14+ (or a free [Supabase](https://supabase.com) project)
- A code editor (VS Code recommended)

---

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/IJED.git
cd IJED
```

---

### 2. Set Up the Backend

```bash
cd lms-admin-backend

# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

---

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Local PostgreSQL
DATABASE_URL=postgresql+asyncpg://postgres:yourpassword@localhost:5432/lms_db

# OR Supabase
# DATABASE_URL=postgresql+asyncpg://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres

# Generate a secure key: openssl rand -hex 32
SECRET_KEY=your-secret-key-here

ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480

# Space-separated list of allowed frontend origins
CORS_ORIGINS=http://localhost:5500 http://127.0.0.1:5500
```

---

### 4. Run Database Migrations

```bash
# Create the database (skip if using Supabase)
createdb lms_db

# Apply all migrations — creates tables and seeds roles
alembic upgrade head
```

---

### 5. Seed Sample Data

```bash
python seed.py
```

This creates the following default accounts:

| Email | Password | Role |
|-------|----------|------|
| `admin@lms.edu` | `Admin@1234` | admin |
| `teacher@lms.edu` | `Teacher@1234` | teacher |
| `student@lms.edu` | `Student@1234` | student |

---

### 6. Start the Backend Server

```bash
uvicorn app.main:app --reload --port 8000
```

- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc
- **Health Check:** http://localhost:8000/health

---

### 7. Open the Frontend

Open `lms-frontend/index.html` directly in your browser, or serve it with VS Code Live Server (port 5500).

> Make sure `CORS_ORIGINS` in your `.env` includes your frontend's address.

---

## API Reference

### Authentication

```http
POST /auth/login
Content-Type: application/json

{
  "email": "admin@lms.edu",
  "password": "Admin@1234"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGci...",
  "token_type": "bearer",
  "user_id": 1,
  "role": "admin",
  "full_name": "System Admin"
}
```

Use the token on every subsequent request:
```http
Authorization: Bearer eyJhbGci...
```

---

### Endpoints Summary

#### Admin Endpoints

| Resource | Methods | Base Path |
|----------|---------|-----------|
| Dashboard Stats | GET | `/admin/dashboard/stats` |
| Users | GET, POST, PUT, DELETE | `/admin/users` |
| Teachers | GET, POST, PUT, DELETE | `/admin/teachers` |
| Teacher Class Assignments | POST, PUT, DELETE | `/admin/teachers/assign-class` |
| Students | GET, POST | `/admin/students` |
| Student Subject Enrollments | POST, GET, DELETE | `/admin/students/{id}/enrollments` |
| Classes | GET, POST | `/admin/classes` |
| Sections | GET, POST, PUT, DELETE | `/admin/sections` |
| Subjects | GET, POST | `/admin/subjects` |
| Modules | GET, POST, PUT, DELETE | `/admin/modules` |
| Activities | GET, POST, PUT, DELETE | `/admin/activities` |
| Announcements (broadcast) | POST | `/notifications/announce` |

#### Teacher Endpoints

| Resource | Methods | Path |
|----------|---------|------|
| My subjects | GET | `/teacher/me/subjects` |
| My modules | GET, POST, DELETE | `/teacher/me/modules` |
| PDF upload | POST | `/teacher/me/modules/upload` |
| Class students | GET | `/teacher/me/class/{class_id}/students` |
| Module read counts | GET | `/teacher/me/class/{class_id}/module-reads` |
| My activities | GET, POST, PUT, DELETE | `/teacher/activities` |
| Student submissions | GET | `/teacher/activities/{id}/submissions` |
| Grade submission | POST | `/teacher/activities/grade` |
| Attendance sections | GET | `/teacher/attendance/sections` |
| Section students + summary | GET | `/teacher/attendance/sections/{class_id}/students` |
| Attendance sessions | GET, POST | `/teacher/attendance/sessions` |
| Attendance session detail | GET, PUT, DELETE | `/teacher/attendance/sessions/{session_id}` |

#### Student Endpoints

| Resource | Methods | Path |
|----------|---------|------|
| Dashboard | GET | `/student/me/dashboard` |
| My subjects | GET | `/student/me/subjects` |
| My modules | GET | `/student/me/modules` |
| My attendance summary | GET | `/student/me/attendance` |
| My activities | GET | `/student/me/activities` |
| Activity detail | GET | `/student/activities/{id}` |
| Submit activity | POST | `/student/activities/{id}/submit` |
| My submission result | GET | `/student/activities/{id}/my-submission` |
| Mark module read | POST | `/student/me/module-read` |

#### Notifications

| Resource | Methods | Path |
|----------|---------|------|
| SSE stream | GET | `/notifications/stream` |
| My notifications | GET | `/notifications` |
| Delete notification | DELETE | `/notifications/{id}` |
| Admin broadcast | POST | `/notifications/announce` |

Full interactive docs available at `/docs` when the server is running.

---

## Database Schema

```
roles ──< users ──< teachers ──< teacher_class_assignments >── classes
                │                                                  │
                │                                              subjects
                │
                └──< students ──< student_section_assignments >── sections >── classes
                          │
                          └──< student_subject_enrollments >── subjects

classes ──< modules ──< activities ──< activity_questions ──< activity_question_choices
                              │
                              └──< activity_submissions ──< activity_answers

attendance_sessions (class + subject + teacher + date)
    └──< attendance_records (student + status per session)

modules ──< student_module_reads (tracking per student)

notifications (user inbox + SSE broadcast)
```

---

## Using the API Client (Frontend)

The `lms-admin-api.js` file is a drop-in JavaScript class for interacting with the backend:

```javascript
const api = new LMSAdminAPI("http://localhost:8000");

// Login
await api.login("admin@lms.edu", "Admin@1234");

// Fetch dashboard stats
const stats = await api.getDashboardStats();

// List users
const users = await api.getUsers({ role: "teacher", is_active: true });

// Create a module
await api.createModule({
  title: "Introduction to Algebra",
  class_id: 1,
  subject_id: 2,
  is_published: true,
});

// Student: get attendance summary
const attendance = await api.getMyAttendance();

// Teacher: create an attendance session
await api.createAttendanceSession({
  class_id: 1,
  subject_id: 2,
  term: "1st",
  session_date: "2025-01-15",
  has_class: true,
  records: [
    { student_id: 3, status: "present" },
    { student_id: 4, status: "absent" },
  ],
});
```

---

## Deployment

### Backend (e.g., Render, Railway, Fly.io)

1. Set all environment variables from `.env` in your platform's dashboard.
2. Set the start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
3. Add your deployed frontend URL to `CORS_ORIGINS`.

### Frontend (e.g., Vercel, Netlify, GitHub Pages)

1. Update the `LMSAdminAPI` base URL in `assets/js/lms-admin-api.js` to your deployed backend URL.
2. Deploy the `lms-frontend/` folder as a static site.

### Database (Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. Copy the **Connection string (URI)** from **Settings → Database**.
3. Replace `postgresql://` with `postgresql+asyncpg://` in your `DATABASE_URL`.
4. Run `alembic upgrade head` — Alembic handles all table creation.

---

## Development Notes

- **Soft deletes** — Users are deactivated (`is_active=false`) and never hard-deleted.
- **Async throughout** — All DB calls use `await`; the engine is configured for production concurrency.
- **Global error handling** — `IntegrityError` returns a clean 409; all unhandled exceptions return 500 with a safe message.
- **Migrations** — Always use `alembic revision --autogenerate -m "description"` for schema changes. Never edit tables manually.
- **Attendance logic** — Only sessions where `has_class=True` count as meetings. Sessions where class was cancelled are stored but not counted in totals.
- **Activity auto-grading** — Multiple choice questions are graded automatically on submission. Freeform, hybrid, and assignment types require manual teacher grading.
- **SSE notifications** — The `/notifications/stream` endpoint holds an open connection per user. Broadcast via `POST /notifications/announce` (admin only) fans out to all connected clients.
- **Frontend MVC** — `models.js` handles data, `views/*.view.js` renders HTML, `controllers/*.controller.js` wires logic, `utils.js` provides shared helpers.

---

## Changelog

### Bug Fixes

**`app/api/v1/router.py` — Student attendance endpoint returning 404**

The `GET /student/me/attendance` route was returning `404 Not Found` for all student accounts despite the endpoint being fully implemented in `student_portal.py`. The root cause was that `student_portal.py` was never imported or registered in the API router. The router was only including a `student_router` from `teacher_portal.py`, which did not expose the attendance route.

**Fix:** Added the missing import and router registration to `router.py`:

```python
# Added import
from app.api.v1.endpoints.student_portal import router as student_attendance_router

# Added registration
api_router.include_router(student_attendance_router)
```

This makes `GET /student/me/attendance` available and returns a per-subject, per-term attendance breakdown for the logged-in student.

---

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push to your branch: `git push origin feature/your-feature-name`
5. Open a Pull Request.

---

## License

This project is developed for **Infant Jesus Learning Academy** (Imelda Justice Education for Development). All rights reserved.

---

<p align="center">Built with ❤️ for IJED · Infant Jesus Learning Academy</p>
