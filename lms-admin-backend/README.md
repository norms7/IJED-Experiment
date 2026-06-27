# LMS Admin Backend

Production-ready FastAPI backend for the IJED-HCJ Learning Management System admin dashboard.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | FastAPI 0.111 |
| ORM | SQLAlchemy 2.0 (async) |
| Database | PostgreSQL (Supabase-compatible) |
| Migrations | Alembic |
| Auth | JWT (python-jose) + bcrypt (passlib) |
| Validation | Pydantic v2 |
| Server | Uvicorn |

---

## Project Structure

```
lms-admin-backend/
├── app/
│   ├── main.py                    # FastAPI app factory + CORS + error handlers
│   ├── api/
│   │   └── v1/
│   │       ├── router.py          # Aggregates all routers
│   │       └── endpoints/
│   │           ├── auth.py        # POST /auth/login
│   │           ├── dashboard.py   # GET  /admin/dashboard/stats
│   │           ├── users.py       # CRUD /admin/users
│   │           ├── teachers.py    # CRUD /admin/teachers
│   │           ├── students.py    # CRUD /admin/students
│   │           ├── modules.py     # CRUD /admin/modules + /admin/activities
│   │           └── classes.py     # /admin/classes + /sections + /subjects
│   ├── core/
│   │   ├── config.py              # Pydantic settings (reads .env)
│   │   └── security.py            # JWT + bcrypt + FastAPI dependency
│   ├── db/
│   │   └── session.py             # Async engine, session, Base, get_db()
│   ├── models/
│   │   └── models.py              # All SQLAlchemy ORM models
│   ├── schemas/
│   │   └── schemas.py             # All Pydantic v2 request/response schemas
│   └── services/
│       ├── auth_service.py
│       ├── dashboard_service.py
│       ├── user_service.py
│       ├── teacher_service.py
│       ├── student_service.py
│       └── module_service.py
├── alembic/
│   ├── env.py                     # Async Alembic env wired to SQLAlchemy
│   ├── script.py.mako
│   └── versions/
│       └── 001_initial.py         # Full schema + roles seed
├── frontend/
│   └── lms-admin-api.js           # Drop-in JS client for your HTML dashboard
├── seed.py                        # Bootstrap script (admin user + sample data)
├── alembic.ini
├── requirements.txt
└── .env.example
```

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/norms7/IJED-HCJ.git
cd IJED-HCJ

# Place backend alongside frontend
cp -r lms-admin-backend backend
cd backend

python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
# Local PostgreSQL
DATABASE_URL=postgresql+asyncpg://postgres:yourpassword@localhost:5432/lms_db

# Supabase (alternative)
DATABASE_URL=postgresql+asyncpg://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres

SECRET_KEY=generate-with-openssl-rand-hex-32
ACCESS_TOKEN_EXPIRE_MINUTES=480

# Add your frontend origin(s), space-separated
CORS_ORIGINS=http://localhost:5500 http://127.0.0.1:5500 http://localhost:3000
```

Generate a secure key:
```bash
openssl rand -hex 32
```

### 3. Run Migrations

```bash
# Create the database first (skip if using Supabase)
createdb lms_db

# Apply all migrations (creates tables + seeds roles)
alembic upgrade head
```

### 4. Seed Sample Data

```bash
python seed.py
```

Creates:
| Email | Password | Role |
|---|---|---|
| admin@lms.edu | Admin@1234 | admin |
| teacher@lms.edu | Teacher@1234 | teacher |
| student@lms.edu | Student@1234 | student |

### 5. Start the Server

```bash
uvicorn app.main:app --reload --port 8000
```

Open **http://localhost:8000/docs** → Swagger UI with all endpoints.

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

### Dashboard

```http
GET /admin/dashboard/stats
```

```json
{
  "total_users": 42,
  "total_admins": 2,
  "total_teachers": 8,
  "total_students": 32,
  "total_classes": 5,
  "total_modules": 18,
  "total_activities": 74,
  "recent_users": [ ... ]
}
```

---

### Users

| Method | Path | Description |
|--------|------|-------------|
| POST | /admin/users | Create user |
| GET | /admin/users | List (paginated, filterable) |
| GET | /admin/users/recent | Latest 10 registrations |
| GET | /admin/users/{id} | Single user |
| PUT | /admin/users/{id} | Partial update |
| DELETE | /admin/users/{id} | Soft delete (is_active=false) |

**Create User:**
```json
{
  "email": "newteacher@lms.edu",
  "password": "Secure@123",
  "first_name": "Pedro",
  "last_name": "Reyes",
  "role_id": 2
}
```

**List with filters:**
```
GET /admin/users?role=teacher&is_active=true&search=reyes&page=1&page_size=20
```

---

### Teachers

| Method | Path | Description |
|--------|------|-------------|
| POST | /admin/teachers | Create teacher profile |
| GET | /admin/teachers | List all with assignments |
| GET | /admin/teachers/{id} | Full detail + schedule |
| POST | /admin/teachers/assign-class | Assign teacher to class/subject |

**Assign to class:**
```json
{
  "teacher_id": 1,
  "class_id": 2,
  "subject_id": 3,
  "schedule": "MWF 8:00-9:00 AM"
}
```

---

### Students

| Method | Path | Description |
|--------|------|-------------|
| POST | /admin/students | Create student profile |
| GET | /admin/students | List all |
| GET | /admin/students/{id} | Single student detail |
| GET | /admin/students/by-section/{id} | Students in section |
| POST | /admin/students/assign-section | Enroll in section |

---

### Modules & Activities

```
POST   /admin/modules
GET    /admin/modules?class_id=1&subject_id=2
GET    /admin/modules/{id}
PUT    /admin/modules/{id}
DELETE /admin/modules/{id}         ← cascade-deletes activities

POST   /admin/activities
GET    /admin/activities?module_id=1
GET    /admin/activities/{id}
PUT    /admin/activities/{id}
DELETE /admin/activities/{id}
```

---

### Classes / Sections / Subjects

```
POST  /admin/classes
GET   /admin/classes
GET   /admin/classes/{id}

POST  /admin/sections
GET   /admin/sections

POST  /admin/subjects
GET   /admin/subjects
```

---

## Plugging into Your Frontend

1. Copy `frontend/lms-admin-api.js` into your IJED-HCJ project folder.
2. Include it in your HTML:
```html
<script src="lms-admin-api.js"></script>
```
3. Use it in your dashboard JS:
```javascript
const api = new LMSAdminAPI("http://localhost:8000");

// Login page
async function handleLogin() {
  const email    = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    await api.login(email, password);
    window.location.href = "/admin-dashboard.html";
  } catch (err) {
    alert(err.message);
  }
}

// Dashboard page
async function loadDashboard() {
  if (!api.isLoggedIn()) { window.location.href = "/login.html"; return; }
  const stats = await api.getDashboardStats();
  document.getElementById("stat-users").textContent    = stats.total_users;
  document.getElementById("stat-teachers").textContent = stats.total_teachers;
  document.getElementById("stat-students").textContent = stats.total_students;
  document.getElementById("stat-modules").textContent  = stats.total_modules;
}
```

---

## Supabase Setup

If using Supabase instead of local Postgres:

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **Settings → Database → Connection string → URI**
3. Replace `postgresql://` with `postgresql+asyncpg://` in your `.env`
4. Run `alembic upgrade head` — Alembic will create all tables in your Supabase DB

---

## Database Schema (ERD Summary)

```
roles (1) ──< users (1) ──< teachers (1) ──< teacher_class_assignments
                      │                              │            │
                      │                           classes      subjects
                      │                              │
                      └──< students (1) ──< student_section_assignments
                                                      │
                                                   sections >── classes
classes ──< modules ──< activities
```

---

## Development Notes

- **Soft deletes**: Users are deactivated (`is_active=false`), never hard-deleted.
- **Unique constraints**: Email, teacher→class→subject combo, student→section combo are all enforced at DB level.
- **Async throughout**: All DB calls use `await`; the engine pool is configured for production load.
- **Error handling**: `IntegrityError` from SQLAlchemy is caught globally and returns a clean 409.
- **Migrations**: Always use `alembic revision --autogenerate -m "description"` for schema changes — never edit models without a migration.
