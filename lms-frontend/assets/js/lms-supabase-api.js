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
      // FIX: was `.single()` + only destructuring `data`. `.single()` treats
      // "0 rows" as an *error*, and that error (plus any real 500/RLS/apikey
      // error) was being silently discarded — so every failure looked like
      // "no profile row", even when the real cause was a bad API key or a
      // permissions problem. `.maybeSingle()` returns error:null when there's
      // legitimately no row, so we can now tell the two cases apart.
      const { data: profile, error } = await this.sb
        .from("users")
        .select("id, email, first_name, last_name, role_id, is_active, avatar_url, profile_details, roles(name)")
        .eq("auth_uid", session.user.id)
        .maybeSingle();

      if (error) {
        // A real API/RLS/network failure — NOT "account not provisioned".
        console.error("[LMS] profile lookup failed:", error);
        throw new Error(
          `Could not verify your account (${error.message}). ` +
          `This is a Supabase connection/permissions issue, not a missing account — ` +
          `check the API key and RLS policies before assuming the user needs provisioning.`
        );
      }

      if (!profile) return null; // genuinely: no `users` row is linked to this auth account yet

      if (profile.is_active === false) {
        throw new Error("Your account has been deactivated. Contact an administrator.");
      }
      if (!profile.roles?.name) {
        throw new Error("Your account has no role assigned. Contact an administrator.");
      }

      const userPayload = {
        id: profile.id,
        role: profile.roles.name,
        full_name: `${profile.first_name} ${profile.last_name}`,
        name: `${profile.first_name} ${profile.last_name}`,
        email: profile.email,
        avatar_url: profile.avatar_url || null,
        profile_details: profile.profile_details || {},
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

    async getMyProfile() {
      return this._cached("profile:me", 30_000, async () => {
        const user = this.getCurrentUser();
        const profile = this._throwIfError(await this.sb.from("users")
          .select("id, email, first_name, last_name, is_active, created_at, updated_at, avatar_url, profile_details, roles(name)")
          .eq("id", user.id).single());
        const result = {
          ...profile,
          role: profile.roles?.name || user.role,
          full_name: `${profile.first_name} ${profile.last_name}`.trim(),
          profile_details: profile.profile_details || {},
        };
        if (result.role === "student") {
          const student = this._throwIfError(await this.sb.from("students").select("id, student_number, contact_number, guardian_name, guardian_contact").eq("user_id", user.id).single());
          const assignments = this._throwIfError(await this.sb.from("student_section_assignments").select("sections(id, name, classes(name, grade_level, school_year))").eq("student_id", student.id));
          const enrollments = this._throwIfError(await this.sb.from("student_subject_enrollments").select("subjects(name, semester)").eq("student_id", student.id));
          result.student = { ...student, sections: assignments.map(row => row.sections).filter(Boolean), subjects: enrollments.map(row => row.subjects).filter(Boolean) };
        } else if (result.role === "teacher") {
          const teacher = this._throwIfError(await this.sb.from("teachers").select("id, employee_id, specialization, contact_number").eq("user_id", user.id).single());
          result.teacher = { ...teacher, assignments: await this.getMySubjects() };
        }
        return result;
      });
    }

    async updateMyProfile({ address = "", phone = "", social = "" }) {
      const user = this.getCurrentUser();
      const current = await this.getMyProfile();
      const details = { ...(current.profile_details || {}), address, social, phone };
      this._throwIfError(await this.sb.from("users").update({ profile_details: details }).eq("id", user.id));
      if (current.role === "student") {
        this._throwIfError(await this.sb.from("students").update({ contact_number: phone || null }).eq("user_id", user.id));
      } else if (current.role === "teacher") {
        this._throwIfError(await this.sb.from("teachers").update({ contact_number: phone || null }).eq("user_id", user.id));
      }
      this.clearCache("profile:me");
      return this.getMyProfile();
    }

    async changeMyPassword(password) {
      const { error } = await this.sb.auth.updateUser({ password });
      if (error) throw new Error(error.message || "Could not update password");
    }

    async uploadMyProfilePicture(file) {
      const user = this.getCurrentUser();
      const { data: authData } = await this.sb.auth.getUser();
      const authUserId = authData?.user?.id;
      if (!authUserId) throw new Error("Your session has expired. Please sign in again.");
      const extension = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${authUserId}/${Date.now()}.${extension}`;
      const { error } = await this.sb.storage.from("profile-images").upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
      if (error) throw new Error(error.message);
      const { data } = this.sb.storage.from("profile-images").getPublicUrl(path);
      const avatarUrl = data.publicUrl;
      this._throwIfError(await this.sb.from("users").update({ avatar_url: avatarUrl }).eq("id", user.id));
      const session = { ...user, avatar_url: avatarUrl };
      localStorage.setItem("lms_user", JSON.stringify(session));
      localStorage.setItem("ijla_session", JSON.stringify(session));
      this._session = session;
      this.clearCache("profile:me");
      return avatarUrl;
    }

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
      const user = this._throwIfError(
        await this.sb.from("users").select("*, roles(name)").eq("id", id).single()
      );
      return { ...user, role: user.roles };
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
            .select("*, subjects(id, name), classes(id, name, grade_level), sections(id, name)")
            .in("teacher_id", teacherIds)
        ) : [];
        const byTeacher = {};
        assignments.forEach(a => {
          if (!byTeacher[a.teacher_id]) byTeacher[a.teacher_id] = [];
          byTeacher[a.teacher_id].push({
            ...a,
            subject: a.subjects,   // view uses a.subject.name
            class_: a.classes,     // view uses a.class_.name (whole class, e.g. "ICT G11")
            section: a.sections,   // view uses a.section.name (the specific section, e.g. "ICT1102")
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

    async assignTeacherToClass({ teacher_id, class_id, section_id, subject_id, schedule }) {
      const result = this._throwIfError(
        await this.sb.from("teacher_class_assignments").insert({ teacher_id, class_id, section_id, subject_id, schedule }).select().single()
      );
      this.clearCache("teachers");
      return result;
    }

    // Promotes/transfers selected students from one section to another —
    // moves their current section + subject enrollment forward, preserves
    // every historical grade/attendance record from the old section as-is.
    async transferStudents({ studentIds, fromSectionId, toSectionId }) {
      const { data, error } = await this.sb.rpc('transfer_students_to_section', {
        p_student_ids: studentIds,
        p_from_section_id: fromSectionId,
        p_to_section_id: toSectionId,
      });
      if (error) throw new Error(error.message);
      this.clearCache('sections');
      return data;
    }

    // FIX: also fetch class_assignments so the edit teacher modal works
    async getTeacherByUserId(userId) {
      const teacher = this._throwIfError(
        await this.sb.from("teachers").select("*").eq("user_id", userId).single()
      );
      if (!teacher) return null;
      const assignments = this._throwIfError(
        await this.sb.from("teacher_class_assignments")
          .select("*, subjects(id, name), classes(id, name, grade_level), sections(id, name)")
          .eq("teacher_id", teacher.id)
      );
      return {
        ...teacher,
        class_assignments: assignments.map(a => ({
          ...a,
          subject: a.subjects,
          class_: a.classes,
          section: a.sections,
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
    // The admin only ever sees/sets: name, grade level, school year, room,
    // and adviser. Under the hood each section still has a backing `classes`
    // row (grade_level + school_year live there) because
    // teacher_class_assignments / modules / activities all key off class_id
    // (NOT NULL) — but createSection/updateSection manage that row for you,
    // so nothing else in the app needs to change.

    async getSections() {
      return this._cached("sections:all", 60_000, async () => {
        const sections = this._throwIfError(
          await this.sb.from("sections")
            .select("*, classes(grade_level, school_year), adviser:teachers(id, user_id, users(first_name, last_name))")
        );
        return sections.map(sec => ({
          ...sec,
          grade_level: sec.classes?.grade_level ?? null,
          school_year: sec.classes?.school_year ?? null,
          adviser: sec.adviser ? { ...sec.adviser, user: sec.adviser.users } : null,
        }));
      });
    }

    async getSection(id) {
      const sec = this._throwIfError(
        await this.sb.from("sections")
          .select("*, classes(grade_level, school_year), adviser:teachers(id, user_id, users(first_name, last_name))")
          .eq("id", id).single()
      );
      return {
        ...sec,
        grade_level: sec.classes?.grade_level ?? null,
        school_year: sec.classes?.school_year ?? null,
        adviser: sec.adviser ? { ...sec.adviser, user: sec.adviser.users } : null,
      };
    }

    async createSection({ name, grade_level, school_year, room, adviser_id }) {
      // Auto-create the backing class row — invisible to the admin.
      const classRow = this._throwIfError(
        await this.sb.from("classes")
          .insert({ name, grade_level, school_year: school_year || null, is_active: true })
          .select().single()
      );
      const result = this._throwIfError(
        await this.sb.from("sections")
          .insert({ name, class_id: classRow.id, room: room || null, adviser_id: adviser_id || null })
          .select().single()
      );
      this.clearCache("sections");
      this.clearCache("classes");
      return result;
    }

    async updateSection(id, { name, grade_level, school_year, room, adviser_id }) {
      const existing = this._throwIfError(
        await this.sb.from("sections").select("class_id").eq("id", id).single()
      );
      if (existing.class_id) {
        this._throwIfError(
          await this.sb.from("classes")
            .update({ name, grade_level, school_year: school_year || null })
            .eq("id", existing.class_id)
        );
      }
      const result = this._throwIfError(
        await this.sb.from("sections")
          .update({ name, room: room || null, adviser_id: adviser_id || null })
          .eq("id", id).select().single()
      );
      this.clearCache("sections");
      this.clearCache("classes");
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
            .select("*, subjects(*), classes(*), sections(*)")
            .eq("teacher_id", (await this._myTeacherId()))
        );
        return data.map(row => ({
          ...row,
          subject_id: row.subject_id,
          subject_name: row.subjects?.name || "",
          subject_description: row.subjects?.description || "",
          subject_semester: row.subjects?.semester ?? null,
          class_id: row.class_id,
          class_name: row.classes?.name || "",
          grade_level: row.classes?.grade_level || "",
          section_id: row.section_id,
          section_name: row.sections?.name || row.classes?.name || "",
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

    // Renamed from getClassStudents(classId) — was pulling every student from
    // every section under the class, so viewing "ICT G11" mixed ICT1102 and
    // ICT1103 students together. student_section_assignments already has
    // section_id directly, so no join needed at all — simpler and correct.
    async getSectionStudents(sectionId) {
      return this._cached(`teacher:sectionstudents:${sectionId}`, 60_000, async () => {
        const data = this._throwIfError(
          await this.sb.from("student_section_assignments")
            .select("students(*, users(first_name, last_name))")
            .eq("section_id", sectionId)
        );
        // Flatten: pull students out + rename users -> user so views use stu.user.first_name
        return (data || [])
          .filter(r => r.students)
          .map(r => ({
            ...r.students,
            user: r.students.users,  // rename for view compatibility
          }));
      });
    }

    async getClassModuleReads(subjectId, term = null) {
      // Scoped by subject + teacher, not class_id -- class_id on modules is
      // not reliably populated (can be null even for real, in-use modules),
      // so filtering by it silently returns zero modules and makes every
      // student's read count look like 0/N. subject_id + teacher_id is the
      // same reliable pattern getMyModules() already uses.
      const cacheKey = `teacher:modreads:${subjectId}:${term || "all"}`;
      return this._cached(cacheKey, 30_000, async () => {
        const teacherId = await this._myTeacherId();
        let modQ = this.sb.from("modules").select("id")
          .eq("subject_id", subjectId).eq("teacher_id", teacherId).eq("is_published", true);
        if (term) modQ = modQ.eq("term", term);
        const { data: mods } = await modQ;
        const moduleIds = (mods || []).map(m => m.id);
        if (!moduleIds.length) return { module_reads: {}, read_module_ids: {}, total_modules: 0 };

        // Count unique modules read per student
        const { data: reads } = await this.sb.from("student_module_reads")
          .select("student_id, module_id").in("module_id", moduleIds);

        const byStudent = {};
        (reads || []).forEach(r => {
          if (!byStudent[r.student_id]) byStudent[r.student_id] = new Set();
          byStudent[r.student_id].add(r.module_id);
        });
        const module_reads = {};
        const read_module_ids = {};
        Object.entries(byStudent).forEach(([sid, set]) => {
          module_reads[parseInt(sid)] = set.size;
          read_module_ids[parseInt(sid)] = [...set];
        });
        return { module_reads, read_module_ids, total_modules: moduleIds.length };
      });
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

    async getMyModules(subject_id = null, term = null) {
      return this._cached(`teacher:mymodules:${subject_id || ""}:${term || ""}`, 60_000, async () => {
        let q = this.sb.from("modules").select("*").eq("teacher_id", await this._myTeacherId());
        if (subject_id) q = q.eq("subject_id", subject_id);
        if (term) q = q.eq("term", term);
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

    async getTeacherActivities({ module_id, subject_id, term } = {}) {
      return this._cached(`teacher:activities:${module_id || ""}:${subject_id || ""}:${term || ""}`, 60_000, async () => {
        let q = this.sb.from("activities")
          .select("*, activity_questions(id, points), activity_submissions(id, is_graded, score)")
          .eq("teacher_id", await this._myTeacherId());
        if (module_id) q = q.eq("module_id", module_id);
        if (subject_id) q = q.eq("subject_id", subject_id);
        if (term) q = q.eq("term", term);
        const rows = this._throwIfError(await q);
        return rows.map(activity => {
          const questions = activity.activity_questions || [];
          const submissions = activity.activity_submissions || [];
          return {
            ...activity,
            questions,
            submission_count: submissions.length,
            pending_submission_count: submissions.filter(submission => !submission.is_graded).length,
          };
        });
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
      this.clearCache("teacher:activities");
      this.clearCache(`teacher:activity:${id}`);
      return result;
    }

    async deleteTeacherActivity(id) {
      const result = this._throwIfError(await this.sb.from("activities").delete().eq("id", id));
      this.clearCache("teacher:activities");
      return result;
    }

    async getActivitySubmissions(activityId) {
      const data = this._throwIfError(
        await this.sb.from("activity_submissions")
          .select(`*,
            students(id, student_number,
              users(first_name, last_name),
              student_section_assignments(
                sections(id, name, classes(id, name))
              )
            ),
            activity_answers(*)`)
          .eq("activity_id", activityId)
          .order("submitted_at", { ascending: true })
      );
      // Normalize: flatten name and section so controller/view uses simple fields
      return (data || []).map(s => {
        const u        = s.students?.users;
        const fullName = u
          ? `${u.first_name || ""} ${u.last_name || ""}`.trim()
          : `Student #${s.student_id}`;
        const assign   = (s.students?.student_section_assignments || [])[0];
        const cls      = assign?.sections?.classes;
        return {
          ...s,
          student_name:   fullName,
          student_number: s.students?.student_number || null,
          section_name:   cls?.name || assign?.sections?.name || null,
          class_id:       cls?.id   || null,
        };
      });
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

    _normalizeSemester(value) {
      const normalized = String(value ?? '').trim().toLowerCase();
      if (normalized === '1' || normalized === '1st' || normalized === 'first' || normalized === '1st semester') return '1st';
      if (normalized === '2' || normalized === '2nd' || normalized === 'second' || normalized === '2nd semester') return '2nd';
      return normalized;
    }

    async getStudentSubjects(semesterFilter = null) {
      const cacheKey = `student:mysubjects:${semesterFilter || 'all'}`;
      return this._cached(cacheKey, 60_000, async () => {
        const studentId = await this._myStudentId();
        const data = this._throwIfError(
          await this.sb.from("student_subject_enrollments")
            .select("*, subjects(id, name, description, semester)")
            .eq("student_id", studentId)
        );

        // Enrich with real section/schedule/teacher info via the student's
        // actual section assignment -- same reliable join
        // getStudentWeeklySchedule() already uses, so class_name here is a
        // real value instead of always falling back to a placeholder.
        //
        // FIX: teacher_class_assignments has no section_id column at all
        // (only teacher_id/class_id/subject_id) and no direct relationship
        // to `sections`, so the previous .in('section_id', ...) filter and
        // sections(name) embed both silently failed every time, leaving
        // every subject's class/schedule/teacher info blank. The real path
        // is: student_section_assignments.section_id -> sections.class_id
        // -> teacher_class_assignments.class_id.
        const { data: secRows } = await this.sb
          .from('student_section_assignments').select('sections(id, name, class_id)').eq('student_id', studentId);
        const mySections = (secRows || []).map(r => r.sections).filter(Boolean);
        const classIds = [...new Set(mySections.map(s => s.class_id))];
        const sectionNameByClassId = {};
        for (const s of mySections) sectionNameByClassId[s.class_id] = s.name;
        const infoBySubject = {};
        if (classIds.length) {
          const { data: tcaRows } = await this.sb
            .from('teacher_class_assignments')
            .select('subject_id, schedule, class_id, classes(name), teachers(users(first_name,last_name))')
            .in('class_id', classIds);
          (tcaRows || []).forEach(row => {
            infoBySubject[row.subject_id] = {
              class_name:   sectionNameByClassId[row.class_id] || row.classes?.name || '',
              schedule:     row.schedule || '',
              teacher_name: row.teachers?.users ? `${row.teachers.users.first_name} ${row.teachers.users.last_name}` : '',
            };
          });
        }

        const rows = data.map(row => ({
          ...row,
          subject_id:   row.subject_id,
          subject_name: row.subjects?.name || "",
          semester:     row.subjects?.semester ?? null,
          class_name:   infoBySubject[row.subject_id]?.class_name || '',
          schedule:     infoBySubject[row.subject_id]?.schedule || '',
          teacher_name: infoBySubject[row.subject_id]?.teacher_name || '',
        }));
        if (semesterFilter) {
          const expectedSemester = this._normalizeSemester(semesterFilter);
          return rows.filter(r => this._normalizeSemester(r.semester) === expectedSemester);
        }
        return rows;
      });
    }

    // Weekly class schedule for the logged-in student — scoped through their
    // ACTUAL section (student_section_assignments), not just "enrolled in the
    // subject", so a student never sees another section's schedule under the
    // same subject/class (same mixing bug fixed earlier for attendance).
    async getStudentWeeklySchedule() {
      return this._cached('student:weeklyschedule', 60_000, async () => {
        const studentId = await this._myStudentId();
        // FIX: teacher_class_assignments has no section_id column and no
        // direct relationship to `sections` — the previous query filtered
        // and embedded on a relationship that doesn't exist, which silently
        // returned nothing every time (the caller wraps this in .catch(()
        // => []), so the failure was invisible — "No schedule for today"
        // showed even when real schedule data existed). Correct path:
        // student_section_assignments.section_id -> sections.class_id ->
        // teacher_class_assignments.class_id.
        const { data: secRows } = await this.sb
          .from('student_section_assignments').select('sections(id, name, class_id)').eq('student_id', studentId);
        const mySections = (secRows || []).map(r => r.sections).filter(Boolean);
        const classIds = [...new Set(mySections.map(s => s.class_id))];
        if (!classIds.length) return [];
        const sectionNameByClassId = {};
        for (const s of mySections) sectionNameByClassId[s.class_id] = s.name;

        const { data: enrollRows } = await this.sb
          .from('student_subject_enrollments').select('subject_id').eq('student_id', studentId);
        const subjectIds = (enrollRows || []).map(r => r.subject_id);
        if (!subjectIds.length) return [];

        const data = this._throwIfError(
          await this.sb.from('teacher_class_assignments')
            .select('*, subjects(id,name), classes(id,name,grade_level), teachers(id, users(first_name,last_name))')
            .in('class_id', classIds)
            .in('subject_id', subjectIds)
        );
        return data.map(row => ({
          subject_id:   row.subject_id,
          subject_name: row.subjects?.name || '',
          section_id:   null,
          section_name: sectionNameByClassId[row.class_id] || row.classes?.name || '',
          grade_level:  row.classes?.grade_level || '',
          schedule:     row.schedule,
          teacher_name: row.teachers?.users ? `${row.teachers.users.first_name} ${row.teachers.users.last_name}` : '',
        }));
      });
    }

    // Used to set the default tab in the My Subjects view.
    async getStudentCurrentSemester() {
      const all = await this.getStudentSubjects();
      const semesters = [...new Set(
        all.map(r => this._normalizeSemester(r.semester)).filter(Boolean)
      )];
      // FIX: previously picked whichever semester sorted highest — so a
      // student enrolled in both 1st and 2nd semester subjects (the normal
      // case for a full school-year enrollment) landed on 2nd Semester by
      // default. Always prefer 1st when the student has any enrollment there.
      if (semesters.includes('1st')) return '1st';
      if (semesters.includes('2nd')) return '2nd';
      return semesters[0] || '1st';
    }

    async getStudentModules(subject_id = null) {
      return this._cached(`student:modules:${subject_id || ""}`, 60_000, async () => {
        const studentId = await this._myStudentId();
        const { data: enrollments } = await this.sb
          .from("student_subject_enrollments").select("subject_id").eq("student_id", studentId);
        const subjectIds = subject_id ? [subject_id] : (enrollments || []).map(e => e.subject_id);
        if (!subjectIds.length) return [];
        const modules = this._throwIfError(
          await this.sb.from("modules").select("*").in("subject_id", subjectIds).eq("is_published", true)
        );
        if (!modules.length) return modules;
        // Mark which of these the student has actually opened — needed to
        // show real completion progress, not just a module count.
        const { data: reads } = await this.sb.from("student_module_reads")
          .select("module_id").eq("student_id", studentId)
          .in("module_id", modules.map(m => m.id));
        const readIds = new Set((reads || []).map(r => r.module_id));
        return modules.map(m => ({ ...m, is_read: readIds.has(m.id) }));
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
          const sub        = subByActivity.get(a.id) || null;
          const isPastDue  = !!(a.due_date && now > new Date(a.due_date));
          const isStarted  = !a.start_date || now >= new Date(a.start_date);
          const alreadySub = !!sub;

          let status;
          if (alreadySub) {
            status = sub.is_graded ? "graded" : "submitted";
          } else if (isPastDue) {
            status = "past_due";
          } else if (!isStarted) {
            status = "not_open";
          } else {
            status = "open";
          }

          // can_answer = true only when activity is open, student hasn't submitted,
          // not past due, and not before start_date
          const canAnswer = status === "open";

          return {
            ...a,
            submission:        sub,
            my_submission:     sub,
            status,
            label:             status === "open"      ? "Open"
                            : status === "graded"    ? "Graded"
                            : status === "submitted" ? "Submitted – Pending Grade"
                            : status === "past_due"  ? "Past Due – No Submission"
                            : "Not Yet Open",
            can_answer:        canAnswer,
            is_past_due:       isPastDue,
            already_submitted: alreadySub,
          };
        });
      });
    }

    async getStudentActivity(id) {
      const activity = this._throwIfError(
        await this.sb.from("activities").select("*").eq("id", id).single()
      );
      const rawQuestions = this._throwIfError(
        await this.sb.from("student_safe_questions")
          .select("*, activity_question_choices(*)")
          .eq("activity_id", id).order("order")
      );
      // Normalize: rename activity_question_choices -> choices so the view can use q.choices
      const questions = (rawQuestions || []).map(q => ({
        ...q,
        choices: (q.activity_question_choices || []).sort((a, b) => a.order - b.order),
      }));
      const studentId = await this._myStudentId();
      const { data: existingSub } = await this.sb
        .from("activity_submissions")
        .select("id, is_graded, score, max_score, grade, submitted_at")
        .eq("activity_id", id)
        .eq("student_id", studentId)
        .maybeSingle();
      const now       = new Date();
      const isPastDue = !!(activity.due_date && now > new Date(activity.due_date));
      const isStarted = !activity.start_date || now >= new Date(activity.start_date);
      const canAnswer = !existingSub && !isPastDue && isStarted && activity.is_published;
      return {
        ...activity,
        questions,
        can_answer:    canAnswer,
        is_past_due:   isPastDue,
        my_submission: existingSub || null,
      };
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
      const res = await this.sb
        .from("activity_submissions")
        .select("*, activity_answers(*)")
        .eq("activity_id", activityId)
        .eq("student_id", studentId)
        .maybeSingle();
      if (res.error) throw new Error(res.error.message);
      if (!res.data) return null;
      return {
        ...res.data,
        // Keep the view independent of Supabase's relationship field name.
        answers: res.data.activity_answers || [],
      };
    }

    async getStudentDashboardStats(semester = null) {
      return this._cached(`student:dashboard:${semester || "all"}`, 20_000, async () =>
        this._throwIfError(await this.sb.rpc("get_student_dashboard_stats", { p_semester: semester }))
      );
    }

    async markModuleRead(moduleId) {
      const result = this._throwIfError(await this.sb.rpc("mark_module_read", { p_module_id: moduleId }));
      this.clearCache("student:dashboard");
      return result;
    }

    async getMyAttendance() {
    return this._cached("student:attendance", 30_000, async () => {
      const studentId = await this._myStudentId();
      const { data, error } = await this.sb.rpc('get_student_attendance_summary', {
        p_student_id: studentId
      });
      if (error) throw new Error(error.message);
      return data; // Already in the required format
    });
  }

    // ── Notifications ─────────────────────────────────────────────────────────

    async getNotifications(limit = 20, offset = 0, unreadOnly = false) {
      const user = this.getCurrentUser();
      if (!user?.id) return [];
      let q = this.sb.from("notifications").select("*")
        .eq("target_user_id", user.id)
        .order("created_at", { ascending: false }).range(offset, offset + limit - 1);
      if (unreadOnly) q = q.eq("is_read", false);
      return this._throwIfError(await q);
    }

    async markNotificationRead(notifId) {
      const user = this.getCurrentUser();
      return this._throwIfError(
        await this.sb.from("notifications").update({ is_read: true }).eq("id", notifId).eq("target_user_id", user.id).select().single()
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
      if (rows.length) {
        const { error } = await this.sb.from("notifications").insert(rows);
        if (error) throw new Error(error.message);
      }
      // FIX: return sent_to count for admin.controller.js
      return { message: `Announcement sent to ${rows.length} user(s).`, sent_to: rows.length };
    }

    // ── Attendance (teacher) ──────────────────────────────────────────────────

    async getAttendanceSections() {
      const teacherId = await this._myTeacherId();
      const data = this._throwIfError(
        await this.sb.from("teacher_class_assignments")
          .select("*, subjects(id, name), classes(id, name, grade_level, school_year), sections(id, name)")
          .eq("teacher_id", teacherId)
      );

      // Group by SECTION (not class) — each real section is its own row, so
      // two sections under one class (e.g. ICT1102 and ICT1103, both under
      // "ICT G11") never share an attendance roster. A teacher_class_assignments
      // row with no section_id yet (pre-migration legacy data) is skipped —
      // re-save that teacher's assignment in Admin > Edit Teacher to pick a
      // specific section instead of a whole class.
      const bySection = new Map();
      for (const row of (data || [])) {
        const sec = row.sections;
        const cls = row.classes;
        if (!sec || !cls) continue;
        if (!bySection.has(sec.id)) {
          bySection.set(sec.id, {
            section_id:   sec.id,
            section_name: sec.name,
            class_id:     cls.id,
            class_name:   cls.name,
            grade_level:  cls.grade_level,
            school_year:  cls.school_year,
            subjects:     [],
          });
        }
        const entry = bySection.get(sec.id);
        if (row.subjects) {
          entry.subjects.push({
            subject_id:   row.subjects.id,
            subject_name: row.subjects.name,
            schedule:     row.schedule,
            assignment_id: row.id,
          });
        }
      }
      return [...bySection.values()];
    }

    async getAttendanceSectionStudents(sectionId, { subjectId = null, term = null } = {}) {
    const { data, error } = await this.sb.rpc('get_teacher_attendance_summary', {
      p_section_id: sectionId,
      p_subject_id: subjectId,
      p_term: term
    });
    if (error) throw new Error(error.message);
    return data; // { total_meetings, students }
  }

    async getAttendanceSessions(sectionId, { subjectId = null, term = null } = {}) {
    const { data, error } = await this.sb.rpc('get_teacher_attendance_sessions', {
      p_section_id: sectionId,
      p_subject_id: subjectId,
      p_term: term
    });
    if (error) throw new Error(error.message);
    return data; // array of session objects
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
          p_section_id: payload.section_id, p_subject_id: payload.subject_id, p_term: payload.term,
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

    async getDescriptiveAnalytics(subjectId = null, term = null, semester = null) {
      const studentId = await this._myStudentId();
      const [grade_progress, attendance_calendar, score_vs_avg, module_progress, subject_radar] = await Promise.all([
        AnalyticsEngine.getGradeProgress(this.sb, studentId, subjectId, term, semester),
        AnalyticsEngine.getAttendanceCalendar(this.sb, studentId, subjectId, null, null, term, semester),
        AnalyticsEngine.getScoreVsClassAverage(this.sb, studentId, subjectId, term, semester),
        AnalyticsEngine.getModuleReadingProgress(this.sb, studentId, subjectId, term, semester),
        AnalyticsEngine.getSubjectRadar(this.sb, studentId, term, semester),
      ]);
      return { grade_progress, attendance_calendar, score_vs_avg, module_progress, subject_radar };
    }

    async getBayesianAnalytics(targetGrade = 90, subjectId = null, term = null, semester = null) {
      const studentId = await this._myStudentId();
      const [predicted_grade, improvement_probability, students_like_you, risk_assessment] = await Promise.all([
        AnalyticsEngine.getPredictedFinalGrade(this.sb, studentId, subjectId, term, semester),
        AnalyticsEngine.getImprovementProbability(this.sb, studentId, targetGrade, subjectId, term, semester),
        AnalyticsEngine.getStudentsLikeYou(this.sb, studentId, subjectId, term, semester),
        AnalyticsEngine.getRiskAssessment(this.sb, studentId, subjectId, term, semester),
      ]);
      return { predicted_grade, improvement_probability, students_like_you, risk_assessment };
    }

    async getPredictedGrade(subjectId = null, term = null, semester = null) {
      return AnalyticsEngine.getPredictedFinalGrade(this.sb, await this._myStudentId(), subjectId, term, semester);
    }

    async getImprovementProbability(targetGrade = 90, subjectId = null, term = null, semester = null) {
      return AnalyticsEngine.getImprovementProbability(this.sb, await this._myStudentId(), targetGrade, subjectId, term, semester);
    }

    async getRiskAssessment(subjectId = null, term = null, semester = null) {
      return AnalyticsEngine.getRiskAssessment(this.sb, await this._myStudentId(), subjectId, term, semester);
    }
  }

  // Global singleton — all controllers reference this as `api`
  const api = new LMSAdminAPI();
