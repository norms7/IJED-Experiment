/**
 * lms-supabase-api.js  — fixed build
 * All data shapes normalized to match what admin/teacher/student views expect.
 */

const SUPABASE_URL = "https://qjkoqznvrvlszacvmeug.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqa29xem52cnZsc3phY3ZtZXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NjQ2OTAsImV4cCI6MjA5ODE0MDY5MH0.hHRQpLeZyBKeIskeFIBshbv-e_jJkw07lNktTvPSSKE";

class LMSAdminAPI {
  constructor() {
    this.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    this._cache = new Map();
    this._session = null;
    this._restoreSession();
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  async _restoreSession() {
    const { data } = await this.sb.auth.getSession();
    if (data?.session) await this._hydrateSessionUser(data.session);
  }

  async _hydrateSessionUser(session) {
    const { data: profile } = await this.sb
      .from("users")
      .select("id, email, first_name, last_name, role_id, roles(name)")
      .eq("auth_uid", session.user.id)
      .single();
    if (!profile) return null;
    const userPayload = {
      id: profile.id,
      role: profile.roles.name,
      full_name: `${profile.first_name} ${profile.last_name}`,
      name: `${profile.first_name} ${profile.last_name}`,
      email: profile.email,
      _token: session.access_token,
    };
    localStorage.setItem("lms_user", JSON.stringify(userPayload));
    localStorage.setItem("ijla_session", JSON.stringify(userPayload));
    this._session = userPayload;
    return userPayload;
  }

  clearCache(pathPattern = null) {
    if (!pathPattern) { this._cache.clear(); return; }
    for (const key of this._cache.keys()) {
      if (key.includes(pathPattern)) this._cache.delete(key);
    }
  }

  async _cached(key, ttlMs, fn) {
    const cached = this._cache.get(key);
    if (cached && (Date.now() - cached.ts) < ttlMs) return cached.data;
    if (typeof Loader !== "undefined") Loader.start();
    try {
      const data = await fn();
      this._cache.set(key, { data, ts: Date.now() });
      return data;
    } finally {
      if (typeof Loader !== "undefined") Loader.done();
    }
  }

  _throwIfError(res) {
    if (res.error) throw new Error(res.error.message || "Request failed");
    return res.data;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async login(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message || "Invalid email or password");
    const userPayload = await this._hydrateSessionUser(data.session);
    if (!userPayload) {
      await this.sb.auth.signOut();
      throw new Error("Account not provisioned. Contact an administrator.");
    }
    return {
      access_token: data.session.access_token,
      user_id: userPayload.id,
      role: userPayload.role,
      full_name: userPayload.full_name,
    };
  }

  logout() {
    this.sb.auth.signOut();
    localStorage.removeItem("lms_user");
    localStorage.removeItem("ijla_session");
    this._session = null;
    this.clearCache();
  }

  getCurrentUser() {
    const raw = localStorage.getItem("lms_user");
    return raw ? JSON.parse(raw) : null;
  }

  isLoggedIn() { return !!this.getCurrentUser(); }

  // ── Dashboard (admin) ─────────────────────────────────────────────────────

  async getDashboardStats() {
    return this._cached("dash:admin", 20_000, async () =>
      this._throwIfError(await this.sb.rpc("get_dashboard_stats"))
    );
  }

  // ── Users (admin) ─────────────────────────────────────────────────────────

  async getUsers(params = {}) {
    let q = this.sb.from("users").select("id, email, first_name, last_name, role_id, is_active, created_at, roles(name)");
    if (params.role_id) q = q.eq("role_id", params.role_id);
    if (params.is_active !== undefined) q = q.eq("is_active", params.is_active);
    const data = this._throwIfError(await q);
    // FIX: add full_name and normalize roles -> role for view compatibility
    return data.map(u => ({
      ...u,
      full_name: `${u.first_name} ${u.last_name}`.trim(),
      role: u.roles,
    }));
  }

  async getUser(id) {
    return this._throwIfError(
      await this.sb.from("users").select("*, roles(name)").eq("id", id).single()
    );
  }

  async createUser({ email, password, first_name, last_name, role_id }) {
    const { data, error } = await this.sb.functions.invoke("admin-create-user", {
      body: { email, password, first_name, last_name, role_id },
    });
    if (error) throw new Error(error.message || "Failed to create user");
    this.clearCache("users");
    return data;
  }

  async updateUser(id, fields) {
    return this._throwIfError(await this.sb.from("users").update(fields).eq("id", id).select().single());
  }

  async deleteUser(id) {
    return this._throwIfError(await this.sb.from("users").delete().eq("id", id));
  }

  async getRecentUsers(limit = 10) {
    return this._throwIfError(
      await this.sb.from("users").select("*").order("created_at", { ascending: false }).limit(limit)
    );
  }

  // ── Teachers (admin) ──────────────────────────────────────────────────────

  async getTeachers() {
    return this._cached("teachers:all", 60_000, async () => {
      const teachers = this._throwIfError(
        await this.sb.from("teachers")
          .select("*, users(id, first_name, last_name, email, is_active)")
      );
      const teacherIds = teachers.map(t => t.id);
      const assignments = teacherIds.length ? this._throwIfError(
        await this.sb.from("teacher_class_assignments")
          .select("*, subjects(id, name), classes(id, name, grade_level)")
          .in("teacher_id", teacherIds)
      ) : [];
      const byTeacher = {};
      assignments.forEach(a => {
        if (!byTeacher[a.teacher_id]) byTeacher[a.teacher_id] = [];
        byTeacher[a.teacher_id].push({
          ...a,
          subject: a.subjects,   // view uses a.subject.name
          class_: a.classes,     // view uses a.class_.name
        });
      });
      // FIX: rename users -> user, attach class_assignments
      return teachers.map(t => ({
        ...t,
        user: t.users,
        class_assignments: byTeacher[t.id] || [],
      }));
    });
  }

  async getTeacher(id) {
    return this._throwIfError(
      await this.sb.from("teachers").select("*, users(first_name, last_name, email)").eq("id", id).single()
    );
  }

  async createTeacherProfile({ user_id, employee_id, specialization, contact_number }) {
    const result = this._throwIfError(
      await this.sb.from("teachers").insert({ user_id, employee_id, specialization, contact_number }).select().single()
    );
    this.clearCache("teachers");
    return result;
  }

  async assignTeacherToClass({ teacher_id, class_id, subject_id, schedule }) {
    const result = this._throwIfError(
      await this.sb.from("teacher_class_assignments").insert({ teacher_id, class_id, subject_id, schedule }).select().single()
    );
    this.clearCache("teachers");
    return result;
  }

  // FIX: also fetch class_assignments so the edit teacher modal works
  async getTeacherByUserId(userId) {
    const teacher = this._throwIfError(
      await this.sb.from("teachers").select("*").eq("user_id", userId).single()
    );
    if (!teacher) return null;
    const assignments = this._throwIfError(
      await this.sb.from("teacher_class_assignments")
        .select("*, subjects(id, name), classes(id, name, grade_level)")
        .eq("teacher_id", teacher.id)
    );
    return {
      ...teacher,
      class_assignments: assignments.map(a => ({
        ...a,
        subject: a.subjects,
        class_: a.classes,
      })),
    };
  }

  async updateTeacherProfile(teacherId, data) {
    const result = this._throwIfError(
      await this.sb.from("teachers").update(data).eq("id", teacherId).select().single()
    );
    this.clearCache("teachers");
    return result;
  }

  async updateTeacherAssignment(assignmentId, data) {
    const result = this._throwIfError(
      await this.sb.from("teacher_class_assignments").update(data).eq("id", assignmentId).select().single()
    );
    this.clearCache("teachers");
    return result;
  }

  async deleteTeacherAssignment(assignmentId) {
    const result = this._throwIfError(
      await this.sb.from("teacher_class_assignments").delete().eq("id", assignmentId)
    );
    this.clearCache("teachers");
    return result;
  }

  // ── Students (admin) ──────────────────────────────────────────────────────

  async getStudents() {
    return this._cached("students:all", 60_000, async () => {
      const students = this._throwIfError(
        await this.sb.from("students")
          .select("*, users(id, first_name, last_name, email, is_active)")
      );
      const studentIds = students.map(s => s.id);
      const sectionAssignments = studentIds.length ? this._throwIfError(
        await this.sb.from("student_section_assignments").select("*").in("student_id", studentIds)
      ) : [];
      const byStu = {};
      sectionAssignments.forEach(sa => {
        if (!byStu[sa.student_id]) byStu[sa.student_id] = [];
        byStu[sa.student_id].push(sa);
      });
      // FIX: rename users -> user, attach section_assignments
      return students.map(s => ({
        ...s,
        user: s.users,
        section_assignments: byStu[s.id] || [],
      }));
    });
  }

  async getStudent(id) {
    return this._throwIfError(
      await this.sb.from("students").select("*, users(first_name, last_name, email)").eq("id", id).single()
    );
  }

  async createStudentProfile({ user_id, student_number, contact_number, guardian_name, guardian_contact }) {
    const result = this._throwIfError(
      await this.sb.from("students")
        .insert({ user_id, student_number, contact_number, guardian_name, guardian_contact })
        .select().single()
    );
    this.clearCache("students");
    return result;
  }

  async getStudentsBySection(sectionId) {
    return this._cached(`students:section:${sectionId}`, 60_000, async () =>
      this._throwIfError(
        await this.sb.from("student_section_assignments")
          .select("students(*, users(first_name, last_name, email))")
          .eq("section_id", sectionId)
      )
    );
  }

  async assignStudentToSection({ student_id, section_id }) {
    const result = this._throwIfError(
      await this.sb.from("student_section_assignments").insert({ student_id, section_id }).select().single()
    );
    this.clearCache("students");
    return result;
  }

  async getStudentSubjectEnrollments(studentId) {
    return this._throwIfError(
      await this.sb.from("student_subject_enrollments").select("*, subjects(*)").eq("student_id", studentId)
    );
  }

  async enrollStudentSubjects(studentId, subjectIds) {
    const result = this._throwIfError(
      await this.sb.rpc("enroll_student_subjects", { p_student_id: studentId, p_subject_ids: subjectIds })
    );
    this.clearCache("students");
    return result;
  }

  async unenrollStudentSubject(studentId, subjectId) {
    const result = this._throwIfError(
      await this.sb.rpc("unenroll_student_subject", { p_student_id: studentId, p_subject_id: subjectId })
    );
    this.clearCache("students");
    return result;
  }

  // ── Classes (admin) ───────────────────────────────────────────────────────

  async getClasses() {
    return this._cached("classes:all", 60_000, async () =>
      this._throwIfError(await this.sb.from("classes").select("*").eq("is_active", true))
    );
  }

  async createClass({ name, grade_level, school_year }) {
    const result = this._throwIfError(
      await this.sb.from("classes").insert({ name, grade_level, school_year }).select().single()
    );
    this.clearCache("classes");
    return result;
  }

  // ── Sections (admin) ──────────────────────────────────────────────────────

  async getSections() {
    return this._cached("sections:all", 60_000, async () =>
      this._throwIfError(await this.sb.from("sections").select("*"))
    );
  }

  async getSection(id) {
    return this._throwIfError(await this.sb.from("sections").select("*").eq("id", id).single());
  }

  async createSection({ name, class_id }) {
    const result = this._throwIfError(
      await this.sb.from("sections").insert({ name, class_id }).select().single()
    );
    this.clearCache("sections");
    return result;
  }

  async updateSection(id, data) {
    const result = this._throwIfError(
      await this.sb.from("sections").update(data).eq("id", id).select().single()
    );
    this.clearCache("sections");
    return result;
  }

  async deleteSection(id) {
    const result = this._throwIfError(await this.sb.from("sections").delete().eq("id", id));
    this.clearCache("sections");
    return result;
  }

  // ── Subjects (admin) ──────────────────────────────────────────────────────

  async getSubjects() {
    return this._cached("subjects:all", 60_000, async () =>
      this._throwIfError(await this.sb.from("subjects").select("*"))
    );
  }

  async createSubject({ name, description }) {
    const result = this._throwIfError(
      await this.sb.from("subjects").insert({ name, description }).select().single()
    );
    this.clearCache("subjects");
    return result;
  }

  // ── Modules (admin) ───────────────────────────────────────────────────────

  async getModules({ class_id, subject_id } = {}) {
    return this._cached(`modules:${class_id || ""}:${subject_id || ""}`, 60_000, async () => {
      let q = this.sb.from("modules").select("*");
      if (class_id) q = q.eq("class_id", class_id);
      if (subject_id) q = q.eq("subject_id", subject_id);
      return this._throwIfError(await q);
    });
  }

  async getModule(id) {
    return this._throwIfError(await this.sb.from("modules").select("*").eq("id", id).single());
  }

  async createModule({ title, description, class_id, subject_id, order, is_published }) {
    const result = this._throwIfError(
      await this.sb.from("modules")
        .insert({ title, description, class_id, subject_id, order, is_published })
        .select().single()
    );
    this.clearCache("modules");
    return result;
  }

  async updateModule(id, fields) {
    const result = this._throwIfError(
      await this.sb.from("modules").update(fields).eq("id", id).select().single()
    );
    this.clearCache("modules");
    return result;
  }

  async deleteModule(id) {
    const result = this._throwIfError(await this.sb.from("modules").delete().eq("id", id));
    this.clearCache("modules");
    return result;
  }

  // ── Activities (admin) ────────────────────────────────────────────────────

  async getActivities(module_id) {
    return this._cached(`activities:${module_id}`, 60_000, async () =>
      this._throwIfError(await this.sb.from("activities").select("*").eq("module_id", module_id))
    );
  }

  async createActivity({ title, description, activity_type, module_id, max_score, due_date, is_published }) {
    const result = this._throwIfError(
      await this.sb.from("activities")
        .insert({ title, description, activity_type, module_id, max_score, due_date, is_published })
        .select().single()
    );
    this.clearCache("activities");
    return result;
  }

  async updateActivity(id, fields) {
    const result = this._throwIfError(
      await this.sb.from("activities").update(fields).eq("id", id).select().single()
    );
    this.clearCache("activities");
    return result;
  }

  async deleteActivity(id) {
    const result = this._throwIfError(await this.sb.from("activities").delete().eq("id", id));
    this.clearCache("activities");
    return result;
  }

  // ── Teacher Portal ────────────────────────────────────────────────────────

  // FIX: flatten nested subjects/classes to flat subject_name, class_name, etc.
  async getMySubjects() {
    return this._cached("teacher:mysubjects", 60_000, async () => {
      const data = this._throwIfError(
        await this.sb.from("teacher_class_assignments")
          .select("*, subjects(*), classes(*)")
          .eq("teacher_id", (await this._myTeacherId()))
      );
      return data.map(row => ({
        ...row,
        subject_id: row.subject_id,
        subject_name: row.subjects?.name || "",
        subject_description: row.subjects?.description || "",
        class_id: row.class_id,
        class_name: row.classes?.name || "",
        grade_level: row.classes?.grade_level || "",
      }));
    });
  }

  async _myTeacherId() {
    const user = this.getCurrentUser();
    const { data } = await this.sb.from("teachers").select("id").eq("user_id", user.id).single();
    return data?.id;
  }

  async _myStudentId() {
    const user = this.getCurrentUser();
    const { data } = await this.sb.from("students").select("id").eq("user_id", user.id).single();
    return data?.id;
  }

  async getClassStudents(classId) {
    return this._cached(`teacher:classstudents:${classId}`, 60_000, async () =>
      this._throwIfError(
        await this.sb.from("student_section_assignments")
          .select("students(*, users(first_name, last_name)), sections!inner(class_id)")
          .eq("sections.class_id", classId)
      )
    );
  }

  async getClassModuleReads(classId) {
    return this._cached(`teacher:modreads:${classId}`, 30_000, async () =>
      this._throwIfError(
        await this.sb.from("student_module_reads")
          .select("*, modules!inner(class_id)")
          .eq("modules.class_id", classId)
      )
    );
  }

  async uploadModuleFile(file) {
    const path = `${Date.now()}_${file.name}`;
    const { error } = await this.sb.storage.from("module-files").upload(path, file);
    if (error) throw new Error(error.message);
    const { data } = this.sb.storage.from("module-files").getPublicUrl(path);
    return { file_url: data.publicUrl, file_name: file.name };
  }

  async uploadSubjectMaterial(subjectId, formData) {
    const file = formData.get("file");
    const upload = await this.uploadModuleFile(file);
    return this.createMyModule({
      title: file.name, subject_id: subjectId,
      file_url: upload.file_url, file_name: upload.file_name,
    });
  }

  async getMyModules(subject_id = null) {
    return this._cached(`teacher:mymodules:${subject_id || ""}`, 60_000, async () => {
      let q = this.sb.from("modules").select("*").eq("teacher_id", await this._myTeacherId());
      if (subject_id) q = q.eq("subject_id", subject_id);
      return this._throwIfError(await q);
    });
  }

  async deleteMyModule(id) {
    const result = this._throwIfError(await this.sb.from("modules").delete().eq("id", id));
    this.clearCache("teacher:mymodules");
    return result;
  }

  async createMyModule({ title, subject_id, description, term, file_url, file_name, is_published = true }) {
    const teacher_id = await this._myTeacherId();
    const result = this._throwIfError(
      await this.sb.from("modules")
        .insert({ title, subject_id, description, term, file_url, file_name, is_published, teacher_id })
        .select().single()
    );
    this.clearCache("teacher:mymodules");
    return result;
  }

  // ── Teacher Activities ────────────────────────────────────────────────────

  async createTeacherActivity(payload) {
    const teacher_id = await this._myTeacherId();
    const { questions, ...activityFields } = payload;
    const activity = this._throwIfError(
      await this.sb.from("activities").insert({ ...activityFields, teacher_id }).select().single()
    );
    for (const [i, q] of (questions || []).entries()) {
      const { choices, ...qFields } = q;
      const question = this._throwIfError(
        await this.sb.from("activity_questions")
          .insert({ ...qFields, activity_id: activity.id, order: q.order ?? i }).select().single()
      );
      if (choices?.length) {
        await this.sb.from("activity_question_choices").insert(
          choices.map((c, j) => ({ ...c, question_id: question.id, order: c.order ?? j }))
        );
      }
    }
    this.clearCache("teacher:activities");
    return activity;
  }

  async getTeacherActivities({ module_id, subject_id } = {}) {
    return this._cached(`teacher:activities:${module_id || ""}:${subject_id || ""}`, 60_000, async () => {
      let q = this.sb.from("activities").select("*").eq("teacher_id", await this._myTeacherId());
      if (module_id) q = q.eq("module_id", module_id);
      if (subject_id) q = q.eq("subject_id", subject_id);
      return this._throwIfError(await q);
    });
  }

  async getTeacherActivity(id) {
    return this._cached(`teacher:activity:${id}`, 60_000, async () =>
      this._throwIfError(
        await this.sb.from("activities")
          .select("*, activity_questions(*, activity_question_choices(*))")
          .eq("id", id).single()
      )
    );
  }

  async updateTeacherActivity(id, payload) {
    const { questions, ...fields } = payload;
    const result = this._throwIfError(
      await this.sb.from("activities").update(fields).eq("id", id).select().single()
    );
    if (questions) {
      await this.sb.from("activity_questions").delete().eq("activity_id", id);
      for (const [i, q] of questions.entries()) {
        const { choices, ...qFields } = q;
        const question = this._throwIfError(
          await this.sb.from("activity_questions")
            .insert({ ...qFields, activity_id: id, order: q.order ?? i }).select().single()
        );
        if (choices?.length) {
          await this.sb.from("activity_question_choices").insert(
            choices.map((c, j) => ({ ...c, question_id: question.id, order: c.order ?? j }))
          );
        }
      }
    }
    this.clearCache("teacher:activit");
    return result;
  }

  async deleteTeacherActivity(id) {
    const result = this._throwIfError(await this.sb.from("activities").delete().eq("id", id));
    this.clearCache("teacher:activit");
    return result;
  }

  async getActivitySubmissions(activityId) {
    return this._throwIfError(
      await this.sb.from("activity_submissions")
        .select("*, students(*, users(first_name, last_name)), activity_answers(*)")
        .eq("activity_id", activityId)
    );
  }

  async manualGradeSubmission(activityId, submissionId, gradeData) {
    return this._throwIfError(
      await this.sb.rpc("manual_grade_submission", {
        p_activity_id: activityId, p_submission_id: submissionId,
        p_score: gradeData.score, p_grade: gradeData.grade || null, p_remarks: gradeData.remarks || null,
      })
    );
  }

  // ── Student Portal ────────────────────────────────────────────────────────

  async getStudentSubjects(semesterFilter = null) {
    const cacheKey = `student:mysubjects:${semesterFilter || 'all'}`;
    return this._cached(cacheKey, 60_000, async () => {
      const data = this._throwIfError(
        await this.sb.from("student_subject_enrollments")
          .select("*, subjects(id, name, description, semester)")
          .eq("student_id", await this._myStudentId())
      );
      const rows = data.map(row => ({
        ...row,
        subject_id:   row.subject_id,
        subject_name: row.subjects?.name || "",
        semester:     row.subjects?.semester ?? null,
      }));
      if (semesterFilter) return rows.filter(r => r.semester === semesterFilter);
      return rows;
    });
  }

  // Returns the "current" semester: the highest semester the student is enrolled in.
  // Used to set the default tab in the My Subjects view.
  async getStudentCurrentSemester() {
    const all = await this.getStudentSubjects();
    const semesters = [...new Set(all.map(r => r.semester).filter(Boolean))].sort();
    return semesters.length ? semesters[semesters.length - 1] : 1;
  }

  async getStudentModules(subject_id = null) {
    return this._cached(`student:modules:${subject_id || ""}`, 60_000, async () => {
      const studentId = await this._myStudentId();
      const { data: enrollments } = await this.sb
        .from("student_subject_enrollments").select("subject_id").eq("student_id", studentId);
      const subjectIds = subject_id ? [subject_id] : (enrollments || []).map(e => e.subject_id);
      if (!subjectIds.length) return [];
      return this._throwIfError(
        await this.sb.from("modules").select("*").in("subject_id", subjectIds).eq("is_published", true)
      );
    });
  }

  async getStudentActivities(subject_id = null) {
    return this._cached(`student:activities:${subject_id || ""}`, 30_000, async () => {
      const studentId = await this._myStudentId();
      const { data: enrollments } = await this.sb
        .from("student_subject_enrollments").select("subject_id").eq("student_id", studentId);
      const subjectIds = subject_id ? [subject_id] : (enrollments || []).map(e => e.subject_id);
      if (!subjectIds.length) return [];
      const activities = this._throwIfError(
        await this.sb.from("activities").select("*").in("subject_id", subjectIds).eq("is_published", true)
      );
      const { data: submissions } = await this.sb
        .from("activity_submissions").select("*").eq("student_id", studentId);
      const subByActivity = new Map((submissions || []).map(s => [s.activity_id, s]));
      const now = new Date();
      return activities.map(a => {
        const sub = subByActivity.get(a.id);
        let status = { status: "open", label: "Open" };
        if (sub) status = sub.is_graded
          ? { status: "graded", label: "Graded" }
          : { status: "submitted", label: "Submitted – Pending Grade" };
        else if (a.due_date && now > new Date(a.due_date))
          status = { status: "past_due", label: "Past Due – No Submission" };
        return { ...a, submission: sub || null, ...status };
      });
    });
  }

  async getStudentActivity(id) {
    const activity = this._throwIfError(await this.sb.from("activities").select("*").eq("id", id).single());
    const questions = this._throwIfError(
      await this.sb.from("student_safe_questions")
        .select("*, activity_question_choices(*)")
        .eq("activity_id", id).order("order")
    );
    return { ...activity, questions };
  }

  async submitActivityAnswers(activityId, answers) {
    const result = this._throwIfError(
      await this.sb.rpc("submit_activity", { p_activity_id: activityId, p_answers: answers })
    );
    this.clearCache("student:activities");
    this.clearCache("student:dashboard");
    return result;
  }

  async getMyActivityResult(activityId) {
    const studentId = await this._myStudentId();
    return this._throwIfError(
      await this.sb.from("activity_submissions")
        .select("*, activity_answers(*)")
        .eq("activity_id", activityId).eq("student_id", studentId).single()
    );
  }

  async getStudentDashboardStats() {
    return this._cached("student:dashboard", 20_000, async () =>
      this._throwIfError(await this.sb.rpc("get_student_dashboard_stats"))
    );
  }

  async markModuleRead(moduleId) {
    const result = this._throwIfError(await this.sb.rpc("mark_module_read", { p_module_id: moduleId }));
    this.clearCache("student:dashboard");
    return result;
  }

  async getMyAttendance() {
    return this._cached("student:attendance", 30_000, async () =>
      this._throwIfError(
        await this.sb.from("attendance_records")
          .select("*, attendance_sessions(*, subjects(name), classes(name))")
          .eq("student_id", await this._myStudentId())
      )
    );
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  async getNotifications(limit = 20, offset = 0, unreadOnly = false) {
    let q = this.sb.from("notifications").select("*")
      .order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    if (unreadOnly) q = q.eq("is_read", false);
    return this._throwIfError(await q);
  }

  async markNotificationRead(notifId) {
    return this._throwIfError(
      await this.sb.from("notifications").update({ is_read: true }).eq("id", notifId).select().single()
    );
  }

  async markAllNotificationsRead() {
    const user = this.getCurrentUser();
    return this._throwIfError(
      await this.sb.from("notifications").update({ is_read: true }).eq("target_user_id", user.id)
    );
  }

  async deleteNotification(notifId) {
    return this._throwIfError(await this.sb.from("notifications").delete().eq("id", notifId));
  }

  async sendAnnouncement(title, message, target = "all") {
    let roleFilter = null;
    if (target === "teachers") roleFilter = "teacher";
    if (target === "students") roleFilter = "student";
    const { data: users } = await this.sb
      .from("users").select("id, role_id, roles(name)").eq("is_active", true);
    const targets = (users || []).filter(u => !roleFilter || u.roles.name === roleFilter).map(u => u.id);
    const me = this.getCurrentUser();
    const rows = targets.map(uid => ({
      target_user_id: uid, actor_user_id: me.id, notification_type: "announcement",
      title, message,
    }));
    if (rows.length) await this.sb.from("notifications").insert(rows);
    // FIX: return sent_to count for admin.controller.js
    return { message: `Announcement sent to ${rows.length} user(s).`, sent_to: rows.length };
  }

  // ── Attendance (teacher) ──────────────────────────────────────────────────

  async getAttendanceSections() {
    return this._throwIfError(
      await this.sb.from("teacher_class_assignments")
        .select("*, classes(*, sections(*))")
        .eq("teacher_id", await this._myTeacherId())
    );
  }

  async getAttendanceSectionStudents(classId, { subjectId = null, term = null } = {}) {
    return this._throwIfError(
      await this.sb.from("student_section_assignments")
        .select("students(*, users(first_name, last_name)), sections!inner(class_id)")
        .eq("sections.class_id", classId)
    );
  }

  async getAttendanceSessions(classId, { subjectId = null, term = null } = {}) {
    let q = this.sb.from("attendance_sessions").select("*").eq("class_id", classId);
    if (subjectId) q = q.eq("subject_id", subjectId);
    if (term) q = q.eq("term", term);
    return this._throwIfError(await q);
  }

  async getAttendanceSession(sessionId) {
    return this._throwIfError(
      await this.sb.from("attendance_sessions")
        .select("*, attendance_records(*, students(*, users(first_name, last_name)))")
        .eq("id", sessionId).single()
    );
  }

  async createAttendanceSession(payload) {
    return this._throwIfError(
      await this.sb.rpc("create_attendance_session", {
        p_class_id: payload.class_id, p_subject_id: payload.subject_id, p_term: payload.term,
        p_session_date: payload.session_date, p_has_class: payload.has_class,
        p_notes: payload.notes || null, p_records: payload.records || [],
      })
    );
  }

  async updateAttendanceSession(sessionId, payload) {
    const { records, ...sessionFields } = payload;
    const result = this._throwIfError(
      await this.sb.from("attendance_sessions").update(sessionFields).eq("id", sessionId).select().single()
    );
    if (records) {
      for (const r of records) {
        await this.sb.from("attendance_records")
          .upsert({ session_id: sessionId, student_id: r.student_id, status: r.status, remarks: r.remarks },
                  { onConflict: "session_id,student_id" });
      }
    }
    return result;
  }

  async deleteAttendanceSession(sessionId) {
    return this._throwIfError(await this.sb.from("attendance_sessions").delete().eq("id", sessionId));
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  async getDescriptiveAnalytics(subjectId = null) {
    const studentId = await this._myStudentId();
    const [grade_progress, attendance_calendar, score_vs_avg, module_progress, subject_radar] = await Promise.all([
      AnalyticsEngine.getGradeProgress(this.sb, studentId, subjectId),
      AnalyticsEngine.getAttendanceCalendar(this.sb, studentId, subjectId),
      AnalyticsEngine.getScoreVsClassAverage(this.sb, studentId, subjectId),
      AnalyticsEngine.getModuleReadingProgress(this.sb, studentId, subjectId),
      AnalyticsEngine.getSubjectRadar(this.sb, studentId),
    ]);
    return { grade_progress, attendance_calendar, score_vs_avg, module_progress, subject_radar };
  }

  async getBayesianAnalytics(targetGrade = 90, subjectId = null) {
    const studentId = await this._myStudentId();
    const [predicted_grade, improvement_probability, students_like_you, risk_assessment] = await Promise.all([
      AnalyticsEngine.getPredictedFinalGrade(this.sb, studentId, subjectId),
      AnalyticsEngine.getImprovementProbability(this.sb, studentId, targetGrade, subjectId),
      AnalyticsEngine.getStudentsLikeYou(this.sb, studentId),
      AnalyticsEngine.getRiskAssessment(this.sb, studentId),
    ]);
    return { predicted_grade, improvement_probability, students_like_you, risk_assessment };
  }

  async getPredictedGrade(subjectId = null) {
    return AnalyticsEngine.getPredictedFinalGrade(this.sb, await this._myStudentId(), subjectId);
  }

  async getImprovementProbability(targetGrade = 90, subjectId = null) {
    return AnalyticsEngine.getImprovementProbability(this.sb, await this._myStudentId(), targetGrade, subjectId);
  }

  async getRiskAssessment() {
    return AnalyticsEngine.getRiskAssessment(this.sb, await this._myStudentId());
  }
}

// Global singleton — all controllers reference this as `api`
const api = new LMSAdminAPI();