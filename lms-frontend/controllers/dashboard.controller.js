/* ============================================================
   controllers/dashboard.controller.js
   Manages sidebar navigation, section routing, and content loading.
   Delegates data-fetching to role-specific controllers.
   ============================================================ */

"use strict";

const DashboardController = {
  currentUser: null,
  currentSection: "dashboard",

  /** Navigation menus per role */
  navMenus: {
    admin: [
      { id: "dashboard", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5L12 4l8 6.5V18a2 2 0 0 1-2 2h-3v-7H9v7H6a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>', label: "Dashboard" },
      { id: "manage-users", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="7" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M20 19v-1a4 4 0 0 0-3-3.87" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 4.13a4 4 0 0 1 0 7.75" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', label: "Manage Users" },
      { id: "calendar", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 3v4M16 3v4M3 10h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', label: "Calendar" },
      { id: "settings", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.7v2.1M12 19.2v2.1M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2.7 12h2.1M19.2 12h2.1M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>', label: "Settings" },
    ],
    teacher: [
      { id: "dashboard", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5L12 4l8 6.5V18a2 2 0 0 1-2 2h-3v-7H9v7H6a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>', label: "Dashboard" },
      { id: "my-subjects", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v11.5a2.5 2.5 0 0 1-2.5 2.5H6.5A2.5 2.5 0 0 1 4 17.5z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 8h8M8 12h8M8 16h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', label: "My Subjects" },
      { id: "modules", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H10l2 2h6.5A2.5 2.5 0 0 1 21 10.5v7A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>', label: "Modules" },
      { id: "activities", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 9h8M8 13h8M8 17h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', label: "Activities" },
      { id: "grades", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18V9M12 18V5M19 18v-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M3 18h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', label: "Grades" },
      { id: "attendance", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 3v4M16 3v4M3 10h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8.5 14.5l2 2 5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>', label: "Attendance" },
      { id: "calendar", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 3v4M16 3v4M3 10h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', label: "Calendar" },
      { id: "settings", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.7v2.1M12 19.2v2.1M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2.7 12h2.1M19.2 12h2.1M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>', label: "Settings" },
    ],
    student: [
      { id: "dashboard", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5L12 4l8 6.5V18a2 2 0 0 1-2 2h-3v-7H9v7H6a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>', label: "Dashboard" },
      { id: "my-subjects", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18a2 2 0 0 1 2 2v11.5a2.5 2.5 0 0 1-2.5 2.5H6.5A2.5 2.5 0 0 1 4 17.5z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 8h8M8 12h8M8 16h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', label: "My Subjects" },
      { id: "activities", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 9h8M8 13h8M8 17h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', label: "Activities" },
      { id: "my-grades", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18l5-8 4 5 7-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18" cy="6" r="1.5" fill="currentColor"/><path d="M3 18h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', label: "My Grades" },
      { id: "attendance", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 3v4M16 3v4M3 10h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8.5 14.5l2 2 5-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>', label: "Attendance" },
      { id: "calendar", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 3v4M16 3v4M3 10h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>', label: "Calendar" },
      {
        id: "performance-analytics",
        icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12 3v9h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 15l3-3 2 2 4-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        label: "Performance Analytics",
      },
      { id: "settings", icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.7v2.1M12 19.2v2.1M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2.7 12h2.1M19.2 12h2.1M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>', label: "Settings" },
    ],
  },

  /** Initialize dashboard after login */
  async load(user) {
    if (user.full_name && !user.name) user.name = user.full_name;
    this.currentUser = user;
    const displayName = user.full_name || user.name || "User";
    const initials = displayName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();
    document.getElementById("sb-avatar").textContent = initials;
    document.getElementById("sb-username").textContent = displayName;
    document.getElementById("sb-role").textContent = user.role;
    document.getElementById("topbar-avatar").textContent = initials;
    App.applyProfileImage(user);
    this.buildNav(user.role);
    this.loadSection("dashboard");
  },

  /** Build sidebar navigation based on user role */
  buildNav(role) {
    const nav = document.getElementById("sidebar-nav");
    const items = this.navMenus[role] || [];
    nav.innerHTML =
      `<div class="nav-section-title">Main Menu</div>` +
      items
        .map(
          (item) => `
        <div class="nav-item" data-section="${item.id}"
          onclick="DashboardController.loadSection('${item.id}')">
          <span class="nav-icon">${item.icon}</span>
          <span class="nav-label">${item.label}</span>
        </div>`,
        )
        .join("");
  },

  /** Switch to a named section */
  loadSection(sectionId, opts = {}) {
    this.currentSection = sectionId;
    document
      .querySelectorAll(".nav-item")
      .forEach((el) =>
        el.classList.toggle("active", el.dataset.section === sectionId),
      );
    const role = this.currentUser.role;
    const item = (this.navMenus[role] || []).find((i) => i.id === sectionId);
    document.getElementById("topbar-title").textContent = item
      ? item.label
      : "Dashboard";
    const area = document.getElementById("content-area");
    area.innerHTML = this._render(sectionId);
    // Re-attach the overlay div every time content-area is wiped
    Loader.init();
    this._postRender(sectionId, opts);
  },

  /** Return HTML shell for a section (no data yet) */
  _render(id) {
    const role = this.currentUser.role;
    const user = this.currentUser;
    if (id === "calendar") return CalendarView.render(this.currentUser);
    if (id === "dashboard") {
      if (role === "admin") return AdminView.dashboard(user, null);
      if (role === "teacher") return TeacherView.dashboard(user, null);
      if (role === "student") return StudentView.dashboard(user, null, [], []);
    }
    if (id === "settings") return AdminView.settings(user);
    if (id === "help") return AdminView.help(user);
    if (role === "admin") {
      if (id === "manage-users") return AdminView.manageUsers();
    }
    if (role === "teacher") {
      if (id === "my-subjects") return TeacherView.mySubjects(user, null);
      if (id === "modules") return TeacherView.modules(user, null);
      if (id === "activities") return TeacherView.activities(user);
      if (id === "grades") return TeacherView.grades(user);
      if (id === "attendance") return TeacherView.attendance(user);
    }
    if (role === "student") {
      if (id === "my-subjects") return StudentView.mySubjects();
      // "modules" removed as a standalone page — fully duplicated by the
      // per-subject module listing (with progress bars) already inside
      // My Subjects. Redirect any stale link/bookmark there instead.
      if (id === "modules") return StudentView.mySubjects();
      if (id === "activities") return StudentView.activitiesLoading();
      if (id === "my-grades") return StudentView.myGrades();
      if (id === "attendance") return StudentView.attendanceLoading();
      if (id === "performance-analytics")
        return '<div id="analytics-shell-loading" style="padding:24px;text-align:center;color:var(--gray-400)">Loading analytics…</div>';
    }
    return `<div class="empty-state"><div class="empty-state-icon">🚧</div><div class="empty-state-title">Section Coming Soon</div></div>`;
  },

  /** After rendering shell, fetch real data and wire up event handlers */
  async _postRender(sectionId, opts = {}) {
    const role = this.currentUser.role;
    const user = this.currentUser;
    const area = document.getElementById("content-area");

    // ── Admin Dashboard ─────────────────────────────────────────────────
    if (sectionId === "dashboard" && role === "admin") {
      Loader.start();
      area.innerHTML = Loader.skeleton("dashboard");
      Loader.init();
      try {
        const stats = await api.getDashboardStats();
        area.innerHTML = AdminView.dashboard(user, stats);
        this._attachSearch();
      } catch (err) {
        console.error("Failed to load dashboard stats:", err);
        Toast.show("Could not load dashboard data.", "error");
        area.innerHTML = AdminView.dashboard(user, {
          total_users: 0,
          total_teachers: 0,
          total_students: 0,
          total_modules: 0,
          total_activities: 0,
          recent_users: [],
        });
      } finally {
        Loader.done();
      }
      return;
    }

    // ── Teacher Dashboard ────────────────────────────────────────────────
    if (sectionId === "dashboard" && role === "teacher") {
      Loader.start();
      area.innerHTML = Loader.skeleton("dashboard");
      Loader.init();
      try {
        const subjects = await api.getMySubjects();
        area.innerHTML = TeacherView.dashboard(user, subjects);
        this._attachSearch();
      } catch (err) {
        console.error("Failed to load teacher subjects:", err);
        Toast.show("Could not load dashboard data.", "error");
      } finally {
        Loader.done();
      }
      return;
    }

    // ── Teacher My Subjects ──────────────────────────────────────────────
    if (sectionId === "my-subjects" && role === "teacher") {
      Loader.start();
      area.innerHTML = Loader.skeleton("cards");
      Loader.init();
      try {
        const subjects = await api.getMySubjects();
        area.innerHTML = TeacherView.mySubjects(user, subjects);
        this._attachSearch();
      } catch (err) {
        console.error("Failed to load subjects:", err);
        Toast.show("Could not load subjects.", "error");
      } finally {
        Loader.done();
      }
      return;
    }

    // ── Student Dashboard ────────────────────────────────────────────────
    if (sectionId === "dashboard" && role === "student") {
      Loader.start();
      area.innerHTML = Loader.skeleton("dashboard");
      Loader.init();
      try {
        const [stats, subjects, activities] = await Promise.all([
          api.getStudentDashboardStats(),
          api.getStudentSubjects(),
          api.getStudentActivities(),
        ]);
        const submittedActivities = activities
          .filter((a) => a.submission != null)
          .sort((a, b) => {
            const da = a.submission.submitted_at
              ? new Date(a.submission.submitted_at)
              : 0;
            const db_ = b.submission.submitted_at
              ? new Date(b.submission.submitted_at)
              : 0;
            return db_ - da;
          });
        const seenSubjects = new Set();
        const recentGrades = [];
        for (const a of submittedActivities) {
          if (!seenSubjects.has(a.subject_id)) {
            seenSubjects.add(a.subject_id);
            const subjectName = a.subject_id
              ? (subjects.find((s) => s.subject_id === a.subject_id) || {})
                  .subject_name || "?"
              : "?";
            recentGrades.push({
              score: a.submission.is_graded ? a.submission.score : null,
              max_score: a.submission.max_score,
              is_graded: a.submission.is_graded,
              _activity: a.title,
              _subject: subjectName,
            });
          }
        }
        area.innerHTML = StudentView.dashboard(
          user,
          stats,
          subjects,
          recentGrades,
        );
        this._attachSearch();
      } catch (err) {
        console.error("Failed to load student dashboard:", err);
        Toast.show("Could not load dashboard data.", "error");
        area.innerHTML = StudentView.dashboard(
          user,
          {
            enrolled_subjects: 0,
            modules: { done: 0, total: 0 },
            activities: { done: 0, total: 0 },
            average_score: 0,
          },
          [],
          [],
        );
      } finally {
        Loader.done();
      }
      return;
    }

    // ── Student My Subjects ──────────────────────────────────────────────
    if ((sectionId === "my-subjects" || sectionId === "modules") && role === "student") {
      Loader.start();
      area.innerHTML = Loader.skeleton("list");
      Loader.init();
      try {
        // Detect current semester from enrolled subjects (default to highest)
        const currentSem = opts?.semester ?? (await api.getStudentCurrentSemester());
        const [subjects, modules, activities] = await Promise.all([
          api.getStudentSubjects(currentSem),
          api.getStudentModules(),
          api.getStudentActivities(),
        ]);
        area.innerHTML = StudentView.mySubjects(subjects, modules, activities, currentSem);
        StudentController._attachSubjectAccordion();
        this._attachSearch();
      } catch (err) {
        console.error("Failed to load student subjects:", err);
        Toast.show("Could not load your subjects.", "error");
      } finally {
        Loader.done();
      }
      return;
    }

    // ── Calendar ─────────────────────────────────────────────────────────
    if (sectionId === "calendar") {
      // CalendarView.render() shell is already in the DOM from _render() above.
      // Just start the progress bar and let init() fetch + fill the grid.
      Loader.start();
      CalendarController._selectedDate = null;
      CalendarController.init().finally(() => Loader.done());
      return;
    }

    // ── Teacher Modules ──────────────────────────────────────────────────
    if (sectionId === "modules" && role === "teacher") {
      Loader.start();
      area.innerHTML = Loader.skeleton("list");
      Loader.init();
      try {
        const [subjects, modules] = await Promise.all([
          api.getMySubjects(),
          api.getMyModules(),
        ]);
        const subjectMap = {};
        subjects.forEach((s) => {
          subjectMap[s.subject_id] = s.subject_name;
        });
        modules.forEach((m) => {
          m._subject_name = subjectMap[m.subject_id] || "Unknown";
        });
        area.innerHTML = TeacherView.modules(user, modules);
        this._attachSearch();
      } catch (err) {
        console.error("Modules load error:", err.message);
        Toast.show("Failed to load modules: " + err.message, "error");
      } finally {
        Loader.done();
      }
      return;
    }

    // ── Student Modules ──────────────────────────────────────────────────
    // Removed — fully duplicated the per-subject module listing (now with
    // progress bars) already shown inside My Subjects. Routing above
    // redirects any stale "modules" link there instead.

    // ── Student My Grades ────────────────────────────────────────────────
    if (sectionId === "my-grades" && role === "student") {
      Loader.start();
      area.innerHTML = Loader.skeleton("grades");
      Loader.init();
      try {
        const [activities, subjects] = await Promise.all([
          api.getStudentActivities(),
          api.getStudentSubjects(),
        ]);
        const subjectMap = {};
        (subjects || []).forEach((s) => {
          subjectMap[s.subject_id] = s.subject_name;
        });
        area.innerHTML = StudentView.myGrades();
        Loader.init();
        const wrap = document.getElementById("my-grades-wrap");
        if (wrap) {
          wrap.innerHTML = StudentView.myGradesTable(
            activities || [],
            subjectMap,
          );
          this._attachSearch();
        }
      } catch (err) {
        console.error("[MyGrades]", err);
        const wrap = document.getElementById("my-grades-wrap");
        if (wrap)
          wrap.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-title">Failed to load grades</div>
          <div class="empty-state-sub">${escHtml(err.message)}</div>
        </div>`;
        Toast.show("Failed to load grades: " + err.message, "error");
      } finally {
        Loader.done();
      }
      return;
    }

    // ── Student Activities ───────────────────────────────────────────────
    if (sectionId === "activities" && role === "student") {
      Loader.start();
      // StudentController.loadActivities handles its own skeleton/render
      StudentController.loadActivities().finally(() => Loader.done());
      return;
    }

    // ── Student Attendance ───────────────────────────────────────────────
    if (sectionId === "attendance" && role === "student") {
      Loader.start();
      StudentController.loadAttendance().finally(() => Loader.done());
      return;
    }

    // ── Student Performance Analytics ───────────────────────────────────────
    if (sectionId === "performance-analytics" && role === "student") {
      Loader.start();
      try {
        await AnalyticsController.load();
      } catch (err) {
        console.error("Failed to load analytics:", err);
        Toast.show("Could not load analytics.", "error");
      } finally {
        Loader.done();
      }
      return;
    }

    // ── Teacher Activities ───────────────────────────────────────────────
    if (sectionId === "activities" && role === "teacher") {
      Loader.start();
      area.innerHTML = Loader.skeleton("list");
      Loader.init();
      try {
        const [activities, subjects] = await Promise.all([
          api.getTeacherActivities(),
          api.getMySubjects(),
        ]);
        const subjectMap = {};
        subjects.forEach((s) => {
          subjectMap[s.subject_id] = s.subject_name;
        });
        activities.forEach((a) => {
          a._subject_name = subjectMap[a.subject_id] || "Unknown";
        });
        area.innerHTML = TeacherView.activities(user, activities);
        this._attachSearch();
      } catch (err) {
        console.error("Activities load error:", err.message);
        Toast.show("Failed to load activities: " + err.message, "error");
      } finally {
        Loader.done();
      }
      return;
    }

    // ── Teacher Grades → Digital Gradebook ──────────────────────────────
    if (sectionId === "grades" && role === "teacher") {
      Loader.start();
      area.innerHTML = TeacherView.grades(user);
      Loader.init();
      GradebookController.loadSections().finally(() => Loader.done());
      return;
    }

    // ── Teacher Attendance ───────────────────────────────────────────────
    if (sectionId === "attendance" && role === "teacher") {
      Loader.start();
      area.innerHTML = TeacherView.attendance(user);
      Loader.init();
      AttendanceController.loadSections().finally(() => Loader.done());
      return;
    }

    // ── Admin Manage Users ───────────────────────────────────────────────
    if (sectionId === "manage-users") {
      Loader.start();
      area.innerHTML = Loader.skeleton("table");
      Loader.init();
      try {
        const [usersRes, teachersRes, studentsRes, sectionsRes] =
          await Promise.all([
            api.getUsers({ page: 1, page_size: 100 }),
            api.getTeachers(),
            api.getStudents(),
            api.getSections(),
          ]);

        const allUsers = Array.isArray(usersRes)
          ? usersRes
          : usersRes.items || [];
        const teachers = Array.isArray(teachersRes)
          ? teachersRes
          : teachersRes.items || [];
        const students = Array.isArray(studentsRes)
          ? studentsRes
          : studentsRes.items || [];
        const sections = Array.isArray(sectionsRes)
          ? sectionsRes
          : sectionsRes.items || [];

        // Restore the full manage-users shell first
        area.innerHTML = AdminView.manageUsers();
        Loader.init();

        const activeUsers = allUsers.filter((u) => u.is_active).length;
        const statsEl = document.getElementById("um-stats");
        if (statsEl)
          statsEl.innerHTML = `${activeUsers} active · ${teachers.length} teachers · ${students.length} students`;

        document.getElementById("tab-all-count").textContent = allUsers.length;
        document.getElementById("tab-teachers-count").textContent =
          teachers.length;
        document.getElementById("tab-students-count").textContent =
          students.length;
        document.getElementById("tab-sections-count").textContent =
          sections.length;

        document.getElementById("um-pane-all").innerHTML =
          AdminView._allUsersPane(allUsers);
        document.getElementById("um-pane-teachers").innerHTML =
          AdminView._teachersPane(teachers);
        document.getElementById("um-pane-students").innerHTML =
          AdminView._studentsPane(students, sections);
        document.getElementById("um-pane-sections").innerHTML =
          AdminView._sectionsPane(sections, students);
        document.getElementById("um-pane-transfer").innerHTML =
          AdminView._transferPane(sections);
        document.getElementById("um-pane-audit").innerHTML =
          AdminView._auditPane();

        const TAB_IDS = ["all", "teachers", "students", "sections", "transfer", "audit"];
        TAB_IDS.forEach((t) => {
          const pane = document.getElementById(`um-pane-${t}`);
          if (pane) pane.style.display = t === "all" ? "" : "none";
          const btn = document.querySelector(`.um-tab[data-tab="${t}"]`);
          if (btn) btn.classList.toggle("active", t === "all");
        });

        document.querySelectorAll(".um-tab").forEach((tab) => {
          tab.removeEventListener("click", tab._handler);
          const handler = () => {
            const targetTab = tab.getAttribute("data-tab");
            if (!targetTab) return;
            TAB_IDS.forEach((t) => {
              const pane = document.getElementById(`um-pane-${t}`);
              if (pane) pane.style.display = t === targetTab ? "" : "none";
              const btn = document.querySelector(`.um-tab[data-tab="${t}"]`);
              if (btn) btn.classList.toggle("active", t === targetTab);
            });
          };
          tab.addEventListener("click", handler);
          tab._handler = handler;
        });

        if (AdminController._pendingTab) {
          AdminController._switchTab(AdminController._pendingTab);
          AdminController._pendingTab = null;
        }
      } catch (err) {
        console.error("Failed to load manage users data:", err);
        Toast.show("Could not load user data from server.", "error");
      } finally {
        Loader.done();
      }
      return;
    }

    this._attachSearch();
  },

  /** Wire up live search on the global search input */
  _attachSearch() {
    const searchInput = document.getElementById("global-search");
    if (searchInput) {
      const fresh = searchInput.cloneNode(true);
      searchInput.parentNode.replaceChild(fresh, searchInput);
      fresh.addEventListener("input", (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll("[data-searchable]").forEach((row) => {
          row.style.display = row.textContent.toLowerCase().includes(q)
            ? ""
            : "none";
        });
      });
    }
  },
};