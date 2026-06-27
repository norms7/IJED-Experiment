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
      { id: "dashboard", icon: "🏠", label: "Dashboard" },
      { id: "manage-users", icon: "👥", label: "Manage Users" },
      { id: "calendar", icon: "📅", label: "Calendar" },
      { id: "settings", icon: "⚙️", label: "Settings" },
    ],
    teacher: [
      { id: "dashboard", icon: "🏠", label: "Dashboard" },
      { id: "my-subjects", icon: "📚", label: "My Subjects" },
      { id: "modules", icon: "📄", label: "Modules" },
      { id: "activities", icon: "📝", label: "Activities" },
      { id: "grades", icon: "📊", label: "Grades" },
      { id: "attendance", icon: "🗓️", label: "Attendance" },
      { id: "calendar", icon: "📅", label: "Calendar" },
    ],
    student: [
      { id: "dashboard", icon: "🏠", label: "Dashboard" },
      { id: "my-subjects", icon: "📚", label: "My Subjects" },
      { id: "modules", icon: "📄", label: "Modules" },
      { id: "activities", icon: "📋", label: "Activities" },
      { id: "my-grades", icon: "📊", label: "My Grades" },
      { id: "attendance", icon: "🗓️", label: "Attendance" },
      { id: "calendar", icon: "📅", label: "Calendar" },
      {
        id: "performance-analytics",
        icon: "📊",
        label: "Performance Analytics",
      },
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
  loadSection(sectionId) {
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
    this._postRender(sectionId);
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
    if (role === "admin") {
      if (id === "manage-users") return AdminView.manageUsers();
      if (id === "settings") return AdminView.settings(user);
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
      if (id === "modules") return StudentView.modules(null);
      if (id === "activities") return StudentView.activitiesLoading();
      if (id === "my-grades") return StudentView.myGrades();
      if (id === "attendance") return StudentView.attendanceLoading();
      if (id === "performance-analytics")
        return '<div id="analytics-shell-loading" style="padding:24px;text-align:center;color:var(--gray-400)">Loading analytics…</div>';
    }
    return `<div class="empty-state"><div class="empty-state-icon">🚧</div><div class="empty-state-title">Section Coming Soon</div></div>`;
  },

  /** After rendering shell, fetch real data and wire up event handlers */
  async _postRender(sectionId) {
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
    if (sectionId === "my-subjects" && role === "student") {
      Loader.start();
      area.innerHTML = Loader.skeleton("list");
      Loader.init();
      try {
        const [subjects, modules, activities] = await Promise.all([
          api.getStudentSubjects(),
          api.getStudentModules(),
          api.getStudentActivities(),
        ]);
        area.innerHTML = StudentView.mySubjects(subjects, modules, activities);
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
    if (sectionId === "modules" && role === "student") {
      Loader.start();
      area.innerHTML = Loader.skeleton("list");
      Loader.init();
      const filterSubjectId = window._filterSubjectId || null;
      delete window._filterSubjectId;
      try {
        const [subjects, modules] = await Promise.all([
          api.getStudentSubjects(),
          api.getStudentModules(filterSubjectId),
        ]);
        const subjectMap = {};
        subjects.forEach((s) => {
          subjectMap[s.subject_id] = s.subject_name;
        });
        modules.forEach((m) => {
          m._subject_name = subjectMap[m.subject_id] || "Unknown";
        });
        area.innerHTML = StudentView.modules(modules);
        if (filterSubjectId) {
          const subjectName = subjectMap[filterSubjectId];
          if (subjectName)
            Toast.show(`Showing modules for: ${subjectName}`, "info");
        }
        this._attachSearch();
      } catch (err) {
        console.error("Student modules error:", err.message);
        Toast.show("Failed to load modules: " + err.message, "error");
      } finally {
        Loader.done();
      }
      return;
    }

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
          AdminView._sectionsPane(sections);
        document.getElementById("um-pane-audit").innerHTML =
          AdminView._auditPane();

        const TAB_IDS = ["all", "teachers", "students", "sections", "audit"];
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
