/**
 * lms-admin-api.js
 * Drop this into your IJED-HCJ frontend and import/reference in your HTML.
 *
 * Usage:
 *   <script src="lms-admin-api.js"></script>
 *   const api = new LMSAdminAPI("http://localhost:8000");
 *   await api.login("admin@lms.edu", "Admin@1234");
 *   const stats = await api.getDashboardStats();
 */

class LMSAdminAPI {
  /**
   * Auto-detects backend URL:
   *   localhost / 127.0.0.1  →  http://localhost:8000  (local dev)
   *   any other host         →  https://ijed-hcj-1.onrender.com  (production)
   */
  constructor() {
    const isLocal = window.location.hostname === "localhost" ||
                    window.location.hostname === "127.0.0.1";
    this.baseURL = isLocal
      ? "http://localhost:8000"
      : "https://ijed-hcj-1.onrender.com";
    this.token = localStorage.getItem("lms_token") || null;

    // ── PERF FIX: in-memory TTL cache ──────────────────────────────────────
    // Eliminates repeat round-trips for stable data (subjects, classes,
    // sections) on every navigation. Cache lives only for the current page
    // session — refreshing the page clears it automatically.
    // Key format:  "METHOD:path"  (e.g. "GET:/teacher/me/subjects")
    // Value:       { data: <response>, ts: <Date.now()> }
    // ─────────────────────────────────────────────────────────────────────
    this._cache = new Map();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _headers(extra = {}) {
    const h = { "Content-Type": "application/json", ...extra };
    if (this.token) {
      h["Authorization"] = `Bearer ${this.token}`;
    }
    return h;
  }

  /**
   * PERF FIX: Cached GET — returns cached response if within TTL, else fetches fresh.
   * Use for stable read-heavy data: subjects, classes, sections.
   * Never use for submissions, grades, or notifications (real-time data).
   * @param {string} path    - API path, e.g. "/teacher/me/subjects"
   * @param {number} [ttlMs] - Cache TTL in ms (default 60s)
   */
  async _cachedGet(path, ttlMs = 60_000) {
    const key = `GET:${path}`;
    const cached = this._cache.get(key);
    if (cached && (Date.now() - cached.ts) < ttlMs) {
      return cached.data;
    }
    const data = await this._request("GET", path);
    this._cache.set(key, { data, ts: Date.now() });
    return data;
  }

  /**
   * Bust cached entries matching pathPattern.
   * Call after mutations (create/update/delete) to avoid stale reads.
   * Pass no args to clear everything (e.g. on logout).
   * @param {string} [pathPattern]
   */
  clearCache(pathPattern = null) {
    if (!pathPattern) { this._cache.clear(); return; }
    for (const key of this._cache.keys()) {
      if (key.includes(pathPattern)) this._cache.delete(key);
    }
  }

  async _request(method, path, body = null) {
    const opts = { method, headers: this._headers() };
    if (body) opts.body = JSON.stringify(body);

    // Auto-show top progress bar for every API call
    if (typeof Loader !== 'undefined') Loader.start();

    try {
      const res = await fetch(`${this.baseURL}${path}`, opts);

      if (res.status === 401) {
        this._clearToken();
        throw new Error("Session expired. Please log in again.");
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      if (res.status === 204) return null;
      return res.json();
    } finally {
      if (typeof Loader !== 'undefined') Loader.done();
    }
  }

  /**
   * PERF FIX: Timeout + retry aware GET, for slow/heavy endpoints
   * (Bayesian analytics, peer comparisons) where a hung connection should
   * fail fast with a clear message instead of leaving the user staring at
   * a blank screen until the browser's own (very long) default timeout.
   *
   * Behaviour:
   *   - Aborts the request after `timeoutMs` (default 25s — Render free tier
   *     cold starts can take 15-30s, so this must be longer than that).
   *   - On timeout or network failure, retries once after a short delay.
   *   - On second failure, throws a clear "still warming up" style message
   *     instead of the raw "Failed to fetch" browser error.
   *
   * @param {string} path
   * @param {number} [timeoutMs] - abort after this many ms (default 25000)
   * @param {number} [retries]   - number of retry attempts after first failure (default 1)
   */
  async _requestWithTimeout(path, timeoutMs = 25_000, retries = 1) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      if (typeof Loader !== 'undefined') Loader.start();

      try {
        const res = await fetch(`${this.baseURL}${path}`, {
          method: 'GET',
          headers: this._headers(),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 401) {
          this._clearToken();
          throw new Error("Session expired. Please log in again.");
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({ detail: res.statusText }));
          throw new Error(err.detail || `HTTP ${res.status}`);
        }
        return await res.json();

      } catch (err) {
        clearTimeout(timer);
        lastError = err;

        const isAbort = err.name === 'AbortError';
        const isLastAttempt = attempt === retries;

        if (isLastAttempt) {
          if (isAbort) {
            throw new Error(
              "This is taking longer than expected. The server may be starting up " +
              "after being idle — please try again in a moment."
            );
          }
          throw err;
        }

        // Brief pause before retrying (gives a cold-starting backend a
        // moment to finish waking up).
        await new Promise(r => setTimeout(r, 1500));

      } finally {
        if (typeof Loader !== 'undefined') Loader.done();
      }
    }

    throw lastError;
  }

  /**
   * Cached GET with timeout/retry — combines _cachedGet's TTL caching with
   * _requestWithTimeout's resilience. Use for expensive analytics endpoints.
   *
   * @param {string} path
   * @param {number} [ttlMs]     - cache TTL in ms
   * @param {number} [timeoutMs] - abort after this many ms
   */
  async _cachedGetWithTimeout(path, ttlMs = 120_000, timeoutMs = 25_000) {
    const key = `GET:${path}`;
    const cached = this._cache.get(key);
    if (cached && (Date.now() - cached.ts) < ttlMs) {
      return cached.data;
    }
    const data = await this._requestWithTimeout(path, timeoutMs, 1);
    this._cache.set(key, { data, ts: Date.now() });
    return data;
  }

  _saveToken(token) {
    this.token = token;
    localStorage.setItem("lms_token", token);
    // Also store the token in the session object for reload
    const session = this.getCurrentUser();
    if (session) {
      session._token = token;
      localStorage.setItem("ijla_session", JSON.stringify(session));
    }
  }

  _clearToken() {
    this.token = null;
    localStorage.removeItem("lms_token");
    localStorage.removeItem("lms_user");
    localStorage.removeItem("ijla_session");
  }

  isLoggedIn() {
    return !!this.token;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async login(email, password) {
    const data = await this._request("POST", "/auth/login", { email, password });
    this._saveToken(data.access_token);

    const userPayload = {
      id:        data.user_id,
      role:      data.role,
      full_name: data.full_name,
      name:      data.full_name,
      email:     email,
      _token:    data.access_token,
    };

    localStorage.setItem("lms_user", JSON.stringify(userPayload));
    localStorage.setItem("ijla_session", JSON.stringify(userPayload));

    return data;
  }

  logout() {
    this._clearToken();
    this.clearCache(); // bust all cached data on logout
  }

  getCurrentUser() {
    const raw = localStorage.getItem("lms_user");
    return raw ? JSON.parse(raw) : null;
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  async getDashboardStats() {
    // PERF: cached 20s — short TTL since this reflects aggregate counts that
    // can change as admins create/edit records elsewhere. Self-expires fast
    // enough that we don't need manual invalidation wiring on every mutation.
    return this._cachedGet("/admin/dashboard/stats", 20_000);
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  async getUsers(params = {}) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && q.append(k, v));
    return this._request("GET", `/admin/users?${q}`);
  }

  async getUser(id) {
    return this._request("GET", `/admin/users/${id}`);
  }

  async createUser({ email, password, first_name, last_name, role_id }) {
    return this._request("POST", "/admin/users", { email, password, first_name, last_name, role_id });
  }

  async updateUser(id, fields) {
    return this._request("PUT", `/admin/users/${id}`, fields);
  }

  async deleteUser(id) {
    return this._request("DELETE", `/admin/users/${id}`);
  }

  async getRecentUsers(limit = 10) {
    return this._request("GET", `/admin/users/recent?limit=${limit}`);
  }

  // ── Teachers ──────────────────────────────────────────────────────────────

  async getTeachers() {
    return this._cachedGet("/admin/teachers", 60_000); // PERF: cached 60s
  }

  async getTeacher(id) {
    return this._request("GET", `/admin/teachers/${id}`);
  }

  async createTeacherProfile({ user_id, employee_id, specialization, contact_number }) {
    const result = await this._request("POST", "/admin/teachers", {
      user_id, employee_id, specialization, contact_number,
    });
    this.clearCache("/admin/teachers"); // bust stale teacher list
    return result;
  }

  async assignTeacherToClass({ teacher_id, class_id, subject_id, schedule }) {
    const result = await this._request("POST", "/admin/teachers/assign-class", {
      teacher_id, class_id, subject_id, schedule,
    });
    this.clearCache("/admin/teachers");
    return result;
  }

  async getTeacherByUserId(userId) {
    return this._request("GET", `/admin/teachers/by-user/${userId}`);
  }

  async updateTeacherProfile(teacherId, data) {
    const result = await this._request("PUT", `/admin/teachers/${teacherId}`, data);
    this.clearCache("/admin/teachers");
    return result;
  }

  async updateTeacherAssignment(assignmentId, data) {
    const result = await this._request("PUT", `/admin/teachers/assignments/${assignmentId}`, data);
    this.clearCache("/admin/teachers");
    return result;
  }

  async deleteTeacherAssignment(assignmentId) {
    const result = await this._request("DELETE", `/admin/teachers/assignments/${assignmentId}`);
    this.clearCache("/admin/teachers");
    return result;
  }

  // ── Students ──────────────────────────────────────────────────────────────

  async getStudents() {
    return this._cachedGet("/admin/students", 60_000); // PERF: cached 60s
  }

  async getStudent(id) {
    return this._request("GET", `/admin/students/${id}`);
  }

  async createStudentProfile({ user_id, student_number, contact_number, guardian_name, guardian_contact }) {
    const result = await this._request("POST", "/admin/students", {
      user_id, student_number, contact_number, guardian_name, guardian_contact,
    });
    this.clearCache("/admin/students"); // bust stale student list
    return result;
  }

  async getStudentsBySection(sectionId) {
    return this._cachedGet(`/admin/students/by-section/${sectionId}`, 60_000); // PERF: cached 60s
  }

  async assignStudentToSection({ student_id, section_id }) {
    const result = await this._request("POST", "/admin/students/assign-section", { student_id, section_id });
    this.clearCache("/admin/students"); // covers both /admin/students and by-section listings
    return result;
  }

  async getStudentSubjectEnrollments(studentId) {
    return this._request("GET", `/admin/students/${studentId}/subjects`);
  }

  async enrollStudentSubjects(studentId, subjectIds) {
    const result = await this._request("POST", `/admin/students/${studentId}/subjects`, { subject_ids: subjectIds });
    this.clearCache("/admin/students");
    return result;
  }

  async unenrollStudentSubject(studentId, subjectId) {
    const result = await this._request("DELETE", `/admin/students/${studentId}/subjects/${subjectId}`);
    this.clearCache("/admin/students");
    return result;
  }

  // ── Classes ───────────────────────────────────────────────────────────────

  async getClasses() {
    return this._cachedGet("/admin/classes"); // PERF: cached 60s
  }

  async createClass({ name, grade_level, school_year }) {
    const result = await this._request("POST", "/admin/classes", { name, grade_level, school_year });
    this.clearCache("/admin/classes"); // bust stale class list
    return result;
  }

  // ── Sections ──────────────────────────────────────────────────────────────

  async getSections() {
    return this._cachedGet("/admin/sections"); // PERF: cached 60s
  }

  async getSection(id) {
    return this._request("GET", `/admin/sections/${id}`);
  }

  async createSection({ name, class_id }) {
    const result = await this._request("POST", "/admin/sections", { name, class_id });
    this.clearCache("/admin/sections"); // bust stale section list
    return result;
  }

  async updateSection(id, data) {
    const result = await this._request("PUT", `/admin/sections/${id}`, data);
    this.clearCache("/admin/sections");
    return result;
  }

  async deleteSection(id) {
    const result = await this._request("DELETE", `/admin/sections/${id}`);
    this.clearCache("/admin/sections");
    return result;
  }

  // ── Subjects ──────────────────────────────────────────────────────────────

  async getSubjects() {
    return this._cachedGet("/admin/subjects"); // PERF: cached 60s
  }

  async createSubject({ name, description }) {
    const result = await this._request("POST", "/admin/subjects", { name, description });
    this.clearCache("/admin/subjects"); // bust stale subject list
    return result;
  }

  // ── Modules ───────────────────────────────────────────────────────────────

  async getModules({ class_id, subject_id } = {}) {
    const q = new URLSearchParams();
    if (class_id)   q.append("class_id", class_id);
    if (subject_id) q.append("subject_id", subject_id);
    return this._cachedGet(`/admin/modules?${q}`, 60_000); // PERF: cached 60s
  }

  async getModule(id) {
    return this._request("GET", `/admin/modules/${id}`);
  }

  async createModule({ title, description, class_id, subject_id, order, is_published }) {
    const result = await this._request("POST", "/admin/modules", {
      title, description, class_id, subject_id, order, is_published,
    });
    this.clearCache("/admin/modules"); // bust stale module lists (all filter variants)
    return result;
  }

  async updateModule(id, fields) {
    const result = await this._request("PUT", `/admin/modules/${id}`, fields);
    this.clearCache("/admin/modules");
    return result;
  }

  async deleteModule(id) {
    const result = await this._request("DELETE", `/admin/modules/${id}`);
    this.clearCache("/admin/modules");
    return result;
  }

  // ── Activities (admin) ────────────────────────────────────────────────────

  async getActivities(module_id) {
    return this._cachedGet(`/admin/activities?module_id=${module_id}`, 60_000); // PERF: cached 60s
  }

  async createActivity({ title, description, activity_type, module_id, max_score, due_date, is_published }) {
    const result = await this._request("POST", "/admin/activities", {
      title, description, activity_type, module_id, max_score, due_date, is_published,
    });
    this.clearCache("/admin/activities"); // bust stale activity lists
    return result;
  }

  async updateActivity(id, fields) {
    const result = await this._request("PUT", `/admin/activities/${id}`, fields);
    this.clearCache("/admin/activities");
    return result;
  }

  async deleteActivity(id) {
    const result = await this._request("DELETE", `/admin/activities/${id}`);
    this.clearCache("/admin/activities");
    return result;
  }

  // ── Teacher Portal ────────────────────────────────────────────────────────

  async getMySubjects() {
    return this._cachedGet("/teacher/me/subjects"); // PERF: cached 60s — loaded on every teacher page
  }

  async getClassStudents(classId) {
    return this._cachedGet(`/teacher/me/class/${classId}/students`, 60_000); // PERF: cached 60s
  }

  async getClassModuleReads(classId) {
    return this._cachedGet(`/teacher/me/class/${classId}/module-reads`, 30_000); // PERF: cached 30s — reflects live student activity, shorter TTL
  }

  async uploadSubjectMaterial(subjectId, formData) {
    const res = await fetch(`${this.baseURL}/teacher/me/subjects/${subjectId}/materials`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async getMyModules(subject_id = null) {
    const q = subject_id ? `?subject_id=${subject_id}` : "";
    return this._cachedGet(`/teacher/me/modules${q}`, 60_000); // PERF: cached 60s
  }

  async deleteMyModule(id) {
    const result = await this._request("DELETE", `/teacher/me/modules/${id}`);
    this.clearCache("/teacher/me/modules"); // bust stale module lists
    return result;
  }

  async uploadModuleFile(file) {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${this.baseURL}/teacher/me/modules/upload`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async createMyModule({ title, subject_id, description, term, file_url, file_name, is_published = true }) {
    const formData = new FormData();
    formData.append("title", title);
    formData.append("subject_id", subject_id);
    if (description) formData.append("description", description);
    if (term) formData.append("term", term);
    if (file_url) formData.append("file_url", file_url);
    if (file_name) formData.append("file_name", file_name);
    formData.append("is_published", is_published);

    const res = await fetch(`${this.baseURL}/teacher/me/modules`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.token}` },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const result = await res.json();
    this.clearCache("/teacher/me/modules"); // bust stale module lists
    return result;
  }

  // ── Teacher Activities ────────────────────────────────────────────────────

  /**
   * Create a full activity with questions and choices.
   * @param {Object} payload - matches ActivityCreateV2 schema
   * @param {string} payload.title
   * @param {number} payload.module_id
   * @param {number} payload.subject_id
   * @param {string} payload.activity_type  - quiz | long_quiz | task_performance | exam | lab_exercise | assignment | other
   * @param {string} payload.format_type    - multiple_choice | checkbox | enumeration | freeform | assignment | hybrid
   * @param {string} payload.grading_mode   - auto | manual
   * @param {string} [payload.instructions]
   * @param {string} [payload.start_date]   - ISO string
   * @param {string} [payload.due_date]     - ISO string
   * @param {Array}  payload.questions      - array of question objects
   */
  async createTeacherActivity(payload) {
    const result = await this._request("POST", "/teacher/me/activities", payload);
    this.clearCache("/teacher/me/activities"); // bust stale activity lists
    return result;
  }

  /**
   * List activities created by the logged-in teacher.
   * PERF: cached 60s — read-heavy, rarely changes second-to-second.
   * @param {Object} [filters]
   * @param {number} [filters.module_id]
   * @param {number} [filters.subject_id]
   */
  async getTeacherActivities({ module_id, subject_id } = {}) {
    const q = new URLSearchParams();
    if (module_id)  q.append("module_id", module_id);
    if (subject_id) q.append("subject_id", subject_id);
    const qs = q.toString() ? `?${q.toString()}` : "";
    return this._cachedGet(`/teacher/me/activities${qs}`, 60_000);
  }

  /**
   * Get one activity including all questions, choices, and correct answers (teacher only).
   * @param {number} id
   */
  async getTeacherActivity(id) {
    return this._cachedGet(`/teacher/me/activities/${id}`, 60_000); // PERF: cached 60s
  }

  /**
   * Update an activity. Pass a questions array to fully replace all questions.
   * @param {number} id
   * @param {Object} payload - partial ActivityUpdateV2
   */
  async updateTeacherActivity(id, payload) {
    const result = await this._request("PUT", `/teacher/me/activities/${id}`, payload);
    this.clearCache("/teacher/me/activities"); // covers both list and single-item cache entries
    return result;
  }

  /**
   * Delete an activity and all its submissions.
   * @param {number} id
   */
  async deleteTeacherActivity(id) {
    const result = await this._request("DELETE", `/teacher/me/activities/${id}`);
    this.clearCache("/teacher/me/activities");
    return result;
  }

  /**
   * Get all student submissions for one activity.
   * PERF: intentionally NOT cached — this is an active grading workflow
   * where a teacher needs to see new submissions arrive in real time.
   * @param {number} activityId
   */
  async getActivitySubmissions(activityId) {
    return this._request("GET", `/teacher/me/activities/${activityId}/submissions`);
  }

  /**
   * Manually grade a submission (for freeform / hybrid / assignment activities).
   *
   * Note on caching boundaries: this happens in the teacher's browser, but
   * the resulting grade is read by the STUDENT in their own browser session
   * via getStudentActivities() / getStudentDashboardStats(). Client-side
   * cache invalidation (this.clearCache()) only affects the browser it runs
   * in — it has no way to reach into a different student's browser tab.
   * That's fine here: those two caches are short-lived (30s and 20s), so
   * the student sees the new grade within that window automatically, no
   * cross-session invalidation needed.
   *
   * @param {number} activityId
   * @param {number} submissionId
   * @param {{ score: number, grade?: string, remarks?: string }} gradeData
   */
  async manualGradeSubmission(activityId, submissionId, gradeData) {
    return this._request(
      "POST",
      `/teacher/me/activities/${activityId}/submissions/${submissionId}/grade`,
      gradeData
    );
  }

  // ── Student Portal ────────────────────────────────────────────────────────

  async getStudentSubjects() {
    return this._cachedGet("/student/me/subjects"); // PERF: cached 60s
  }

  async getStudentModules(subject_id = null) {
    const q = subject_id ? `?subject_id=${subject_id}` : "";
    return this._cachedGet(`/student/me/modules${q}`, 60_000); // PERF: cached 60s
  }

  /**
   * Get published activities for the student's enrolled subjects.
   * Correct answers are never included in the response.
   * PERF: cached 30s — shorter TTL than modules since submission status
   * (graded/ungraded, score) can change here whenever a teacher grades
   * something, and we want that to surface reasonably quickly.
   * @param {number} [subject_id] - optional filter
   */
  async getStudentActivities(subject_id = null) {
    const q = subject_id ? `?subject_id=${subject_id}` : "";
    return this._cachedGet(`/student/me/activities${q}`, 30_000);
  }

  /**
   * Get one activity with questions for answering (no correct answers exposed).
   * PERF: intentionally NOT cached — an in-progress answer session should
   * always reflect the true current state of the activity.
   * @param {number} id
   */
  async getStudentActivity(id) {
    return this._request("GET", `/student/me/activities/${id}`);
  }

  /**
   * Submit answers for an activity.
   * Auto-graded formats return a score immediately.
   * Manual formats return is_graded: false until the teacher grades.
   * @param {number} activityId
   * @param {Array<{ question_id: number, answer_value: string }>} answers
   */
  async submitActivityAnswers(activityId, answers) {
    const result = await this._request("POST", `/student/me/activities/${activityId}/submit`, { answers });
    // Submission changes activity status (submitted/graded) and dashboard
    // completion counts — bust both so the next view reflects reality.
    this.clearCache("/student/me/activities");
    this.clearCache("/student/me/dashboard");
    return result;
  }

  /**
   * Get the student's own submission result for an activity.
   * PERF: intentionally NOT cached — checked right after submission, needs
   * to reflect the true current grading state.
   * @param {number} activityId
   */
  async getMyActivityResult(activityId) {
    return this._request("GET", `/student/me/activities/${activityId}/result`);
  }

  /**
   * Get aggregated student dashboard stats.
   * PERF: cached 20s — short TTL since this reflects live progress (module
   * reads, submissions) that the student expects to update soon after they
   * take an action, but doesn't need to be querie­d on every single render.
   * Returns: { enrolled_subjects, modules: {done, total}, activities: {done, total}, average_score }
   */
  async getStudentDashboardStats() {
    return this._cachedGet("/student/me/dashboard", 20_000);
  }

  /**
   * Mark a module as read by the current student.
   * Triggers progress tracking for the dashboard modules counter.
   * @param {number} moduleId
   */
  async markModuleRead(moduleId) {
    const result = await this._request("POST", `/student/me/modules/${moduleId}/read`);
    // Marking a module read changes the dashboard's module completion count.
    this.clearCache("/student/me/dashboard");
    return result;
  }

  /**
   * Get the student's own attendance summary, grouped by subject and term.
   * PERF: cached 30s — attendance is marked by teachers in batches, not
   * continuously, so a short cache window is safe here.
   * Returns an array of { subject_id, subject_name, class_name, terms[], totals }.
   */
  async getMyAttendance() {
    return this._cachedGet("/student/me/attendance", 30_000);
  }

  // ── Legacy / utility ──────────────────────────────────────────────────────

  async request(method, path, body) {
    const url = this.baseURL + '/api/v1' + path;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      },
      body: body ? JSON.stringify(body) : undefined
    };
    const res = await fetch(url, options);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    return res.json();
  }

  // ── Notifications ──────────────────────────────────────────────────────────

  async getNotifications(limit = 20, offset = 0, unreadOnly = false) {
    return this._request("GET", `/notifications?limit=${limit}&offset=${offset}&unread_only=${unreadOnly}`);
  }

  async markNotificationRead(notifId) {
    return this._request("PATCH", `/notifications/${notifId}/read`);
  }

  async markAllNotificationsRead() {
    return this._request("PATCH", `/notifications/mark-all-read`);
  }

  async deleteNotification(notifId) {
    return this._request("DELETE", `/notifications/${notifId}`);
  }

  async sendAnnouncement(title, message, target = "all") {
    return this._request("POST", "/notifications/announce", { title, message, target });
  }
  // ── Attendance ─────────────────────────────────────────────────────────────

  async getAttendanceSections() {
    return this._request("GET", "/teacher/attendance/sections");
  }

  async getAttendanceSectionStudents(classId, { subjectId = null, term = null } = {}) {
    const q = new URLSearchParams();
    if (subjectId) q.append("subject_id", subjectId);
    if (term)      q.append("term", term);
    const qs = q.toString() ? `?${q}` : "";
    return this._request("GET", `/teacher/attendance/sections/${classId}/students${qs}`);
  }

  async getAttendanceSessions(classId, { subjectId = null, term = null } = {}) {
    const q = new URLSearchParams({ class_id: classId });
    if (subjectId) q.append("subject_id", subjectId);
    if (term)      q.append("term", term);
    return this._request("GET", `/teacher/attendance/sessions?${q}`);
  }

  async getAttendanceSession(sessionId) {
    return this._request("GET", `/teacher/attendance/sessions/${sessionId}`);
  }

  async createAttendanceSession(payload) {
    return this._request("POST", "/teacher/attendance/sessions", payload);
  }

  async updateAttendanceSession(sessionId, payload) {
    return this._request("PUT", `/teacher/attendance/sessions/${sessionId}`, payload);
  }

  async deleteAttendanceSession(sessionId) {
    return this._request("DELETE", `/teacher/attendance/sessions/${sessionId}`);
  }

  // ── Student Analytics ─────────────────────────────────────────────────────

  /**
   * Fetch the full descriptive analytics bundle (one round-trip for all charts).
   * PERF FIX: now uses timeout+retry aware caching — backend caches the
   * underlying computation for 5 min, this caches the HTTP response for
   * 2 min on top, and a hung request fails gracefully after 25s with one
   * retry instead of hanging until the browser's default timeout.
   * @param {number|null} subjectId  - optional subject filter
   * @returns {Promise<{grade_progress, attendance_calendar, score_vs_avg, module_progress, subject_radar}>}
   */
  async getDescriptiveAnalytics(subjectId = null) {
    const q = subjectId ? `?subject_id=${subjectId}` : '';
    return this._cachedGetWithTimeout(`/student/me/analytics/descriptive${q}`, 120_000, 25_000);
  }

  /**
   * Fetch the full Bayesian analytics bundle.
   * PERF FIX: timeout+retry aware — this bundle includes students_like_you,
   * the most expensive computation in the analytics suite, so it gets the
   * longest timeout window (25s) plus one automatic retry.
   * @param {number}      targetGrade - target grade threshold for improvement prob (default 90)
   * @param {number|null} subjectId   - optional subject filter
   */
  async getBayesianAnalytics(targetGrade = 90, subjectId = null) {
    const params = new URLSearchParams({ target_grade: targetGrade });
    if (subjectId) params.append('subject_id', subjectId);
    return this._cachedGetWithTimeout(`/student/me/analytics/bayesian?${params}`, 120_000, 25_000);
  }

  /**
   * Fetch only the predicted final grade (lighter call, e.g. for dashboard widget).
   * @param {number|null} subjectId
   */
  async getPredictedGrade(subjectId = null) {
    const q = subjectId ? `?subject_id=${subjectId}` : '';
    return this._cachedGetWithTimeout(`/student/me/analytics/predicted-grade${q}`, 120_000, 20_000);
  }

  /**
   * Fetch improvement probability for a given target grade.
   * @param {number}      targetGrade
   * @param {number|null} subjectId
   */
  async getImprovementProbability(targetGrade = 90, subjectId = null) {
    const params = new URLSearchParams({ target_grade: targetGrade });
    if (subjectId) params.append('subject_id', subjectId);
    return this._requestWithTimeout(`/student/me/analytics/improvement-probability?${params}`, 20_000, 1);
  }

  /**
   * Fetch the Bayesian risk assessment.
   */
  async getRiskAssessment() {
    return this._cachedGetWithTimeout('/student/me/analytics/risk-assessment', 120_000, 20_000);
  }

}

const api = new LMSAdminAPI();