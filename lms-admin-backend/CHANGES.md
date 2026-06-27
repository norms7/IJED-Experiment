# Refactor Changelog

## Bug Fixes

### 1. Double router mount removed (`app/main.py`)
**Before:** The API router was mounted twice — once at `/api/v1` and once with no
prefix, creating duplicate routes at both `/api/v1/auth/login` and `/auth/login`.
This caused silent shadowing and made the frontend's base URL ambiguous.

**After:** Single mount at `/api/v1`. The frontend must prefix all calls with
`/api/v1/`. Example: `POST /api/v1/auth/login`, `GET /api/v1/admin/users`.

---

### 2. Route ordering collision fixed (`app/api/v1/endpoints/teachers.py`)
**Before:** `GET /admin/teachers/by-user/{user_id}` was registered *after*
`GET /admin/teachers/{teacher_id}`. FastAPI matched the literal string `"by-user"`
as a `teacher_id` integer, resulting in a 422 Unprocessable Entity on every call.

**After:** All static/sub-resource routes (`/assign-class`, `/by-user/{user_id}`,
`/assignments/{id}`) are declared **before** the `/{teacher_id}` catch-all routes.

---

### 3. `exclude_none` → `exclude_unset` in module update (`app/services/module_service.py`)
**Before:** `data.model_dump(exclude_none=True)` — prevented callers from
intentionally clearing optional fields like `file_url` by passing `null`.

**After:** `data.model_dump(exclude_unset=True)` — only fields explicitly included
in the request body are applied, allowing null to clear a field.

Same fix applied to `update_activity`.

---

### 4. Missing CRUD on classes, sections, subjects (`app/api/v1/endpoints/classes.py`)
**Before:** All three resources only had POST + GET (list) + GET (single).
No way to update or remove them from the frontend.

**After:** Full CRUD on all three:
- `PUT /admin/classes/{id}` — update name, grade_level, school_year, is_active
- `DELETE /admin/classes/{id}` — soft-delete (sets `is_active = false`)
- `PUT /admin/sections/{id}`, `DELETE /admin/sections/{id}`
- `PUT /admin/subjects/{id}`, `DELETE /admin/subjects/{id}`

New schemas added: `ClassUpdate`, `SectionUpdate`, `SubjectUpdate`.

---

### 5. Missing CRUD on student profiles (`app/api/v1/endpoints/students.py`)
**Before:** No `PUT` or `DELETE` on the student profile resource.

**After:**
- `PUT /admin/students/{id}` — update student_number, contact, guardian info
- `DELETE /admin/students/{id}` — deletes the profile record (not the user account)
- `DELETE /admin/students/section-assignment/{student_id}` — removes a student's
  current section so they can be reassigned (was impossible before).

New schema added: `StudentUpdate`.

---

### 6. Student portal extracted to its own file (`app/api/v1/endpoints/student_portal.py`)
**Before:** `student_router` was defined inside `teacher_portal.py` and re-exported
through the router. This tangled two unrelated concerns.

**After:** Student portal lives in `student_portal.py`. Both are imported cleanly
in `router.py`.

---

### 7. CORS origins expanded (`app/core/config.py`)
**Before:** Only `localhost:3000`, `localhost:5500`, `127.0.0.1:5500`.

**After:** Also includes `localhost:5501` and `127.0.0.1:5501` (Live Server
sometimes increments the port when 5500 is taken). All ports configurable via
`CORS_ORIGINS` in `.env`.

---

### 8. File URL path corrected in teacher portal (`app/api/v1/endpoints/teacher_portal.py`)
**Before:** Upload returned `file_url: /teacher/files/{name}` — broken because the
backend is mounted at `/api/v1`.

**After:** Returns `file_url: /api/v1/teacher/files/{name}` — matches the actual
served route.

---

### 9. `get_current_user` dependency added (`app/core/security.py`)
Added a generic `get_current_user` dependency for any authenticated role, separate
from `get_current_admin`. Useful for future mixed-role endpoints without duplicating
JWT decode logic.

---

## API Base URL

All endpoints are now served exclusively under:

```
http://localhost:8000/api/v1/
```

Frontend fetch calls should use this base. Example `api.js`:

```js
const BASE = 'http://localhost:8000/api/v1';

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json();
}
```
