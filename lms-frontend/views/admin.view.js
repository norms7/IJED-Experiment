/* ============================================================
   views/admin.view.js
   Pure render functions for Admin role — returns HTML strings only.
   No direct DOM manipulation; controllers handle that.
   ============================================================ */

"use strict";

const AdminView = {

  help(user) {
    const isTeacher = user?.role === 'teacher';
    const isStudent = user?.role === 'student';
    const faqTitle = isTeacher ? 'Teacher Frequently Asked Questions' : isStudent ? 'Student Frequently Asked Questions' : 'Frequently Asked Questions';
    const faqItems = isTeacher ? [
      ['How do I open my subjects?', 'Open My Subjects from the sidebar to view the classes and subjects assigned to you.'],
      ['How do I upload modules?', 'Open Modules and use the available module action to add learning materials for your assigned classes.'],
      ['How do I create activities?', 'Open Activities to create instructions, questions, due dates, and scores for your students.'],
      ['How do I record attendance?', 'Open Attendance, select a class and subject, then record the attendance for the session.'],
      ['How do I view student grades?', 'Open Grades to review student submissions, scores, and grade information for your classes.'],
    ] : isStudent ? [
      ['How do I sign in?', 'Enter your LMS email and password on the sign-in page, then select Sign In.'],
      ['How do I open my subjects?', 'Open My Subjects from the sidebar to view the classes and subjects connected to your account.'],
      ['How do I use modules and activities?', 'Open Modules to read learning materials. Open Activities to answer questions and submit work when available.'],
      ['Where can I see my grades and attendance?', 'Use My Grades and Attendance from the sidebar to review your academic records.'],
      ['How do I update my profile?', 'Open Settings from the sidebar to update your available profile information and preferences.'],
    ] : [
      ['How do I sign in?', 'Enter your LMS email and password on the sign-in page, then select Sign In.'],
      ['How do I manage users?', 'Open Manage Users to view accounts, update user details, and manage teacher and student records.'],
      ['How do I use the calendar?', 'Open Calendar from the sidebar to review dates, events, deadlines, and announcements.'],
      ['How do I update my profile?', 'Open Settings from the sidebar to update your available profile information and preferences.'],
    ];
    const faqHtml = faqItems.map(([question, answer], index) => `
            <details ${index === 0 ? 'open' : ''} style="padding:${index === 0 ? '0 0 14px' : '14px 0'};border-bottom:1px solid var(--gray-100);">
              <summary style="cursor:pointer;font-weight:600;color:var(--maroon-dark);">${question}</summary>
              <p class="text-sm text-muted" style="margin:8px 0 0;">${answer}</p>
            </details>`).join('');
    return `
      <div class="section-header">
        <div class="section-header-left"><h2>Help</h2><p>Find answers and support for using the LMS</p></div>
      </div>
      <div class="help-grid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:start;gap:20px;max-width:none;">
        <div class="card">
          <div class="card-header"><span class="card-title">${faqTitle}</span></div>
          <div class="card-body">
            ${faqHtml}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Contact Support</span></div>
          <div class="card-body">
            <div class="form-group"><div class="form-label">School/LMS Administrator</div><div>School LMS Administrator</div></div>
            <div class="form-group"><div class="form-label">Support Email</div><div>support@ijla.edu</div></div>
            <div class="form-group"><div class="form-label">Office Contact</div><div>Contact the school office during operating hours.</div></div>
            <div class="form-group"><div class="form-label">Office Hours</div><div>Monday to Friday, 8:00 AM to 5:00 PM</div></div>
            <div class="form-group" style="margin-bottom:0"><div class="form-label">Urgent Issues</div><div>For urgent account or safety concerns, contact the school office directly.</div></div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Report a Problem</span></div>
          <div class="card-body">
            <div class="form-group"><label class="form-label" for="help-problem-type">Problem Type</label>
              <select class="form-control" id="help-problem-type">
                <option value="">Select a problem type</option>
                <option>Login issue</option>
                <option>Activities or modules</option>
                <option>Grades</option>
                <option>Attendance</option>
                <option>Calendar</option>
                <option>Profile/settings</option>
                <option>Other</option>
              </select></div>
            <div class="form-group"><label class="form-label" for="help-problem-description">Description</label>
              <textarea class="form-control" id="help-problem-description" rows="4" placeholder="Describe the problem"></textarea></div>
            <div class="form-group"><label class="form-label" for="help-problem-screenshot">Screenshot (optional)</label>
              <input class="form-control" type="file" id="help-problem-screenshot" accept="image/*" /></div>
            <div class="form-group"><label class="form-label" for="help-contact">Contact Information</label>
              <input class="form-control" id="help-contact" placeholder="Email or phone number" /></div>
            <button class="btn btn-primary" type="button">Submit Report</button>
          </div>
        </div>
      </div>`;
  },

  /** Main admin dashboard – expects stats object from API */
  dashboard(user, stats = null) {
    if (!stats) {
      return `
        <div class="welcome-banner">
          <div class="welcome-text">
            <div class="welcome-title">Good day, ${escHtml(user.name?.split(' ')[0] || 'Admin')}! 👋</div>
            <div class="welcome-sub">Loading dashboard data...</div>
          </div>
          <div class="welcome-emoji">👨‍💼</div>
        </div>
        <div class="stat-grid mb-4">
          <div class="stat-card"><div class="stat-icon" style="background:#fde8ec">👥</div><div><div class="stat-value">—</div><div class="stat-label">Total Users</div></div></div>
          <div class="stat-card"><div class="stat-icon" style="background:#e6f4ea">👩‍🏫</div><div><div class="stat-value">—</div><div class="stat-label">Teachers</div></div></div>
          <div class="stat-card"><div class="stat-icon" style="background:#fff0e6">🎓</div><div><div class="stat-value">—</div><div class="stat-label">Students</div></div></div>
          <div class="stat-card"><div class="stat-icon" style="background:#e8f0fa">📄</div><div><div class="stat-value">—</div><div class="stat-label">Modules</div></div></div>
          <div class="stat-card"><div class="stat-icon" style="background:#fde8ec">📝</div><div><div class="stat-value">—</div><div class="stat-label">Activities</div></div></div>
        </div>
        <div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-title">Loading...</div></div>`;
    }

    const totalUsers  = stats.total_users     || 0;
    const teachers    = stats.total_teachers  || 0;
    const students    = stats.total_students  || 0;
    const modules     = stats.total_modules   || 0;
    const activities  = stats.total_activities || 0;
    const recentUsers = stats.recent_users    || [];

    return `
      <div class="welcome-banner">
        <div class="welcome-text">
          <div class="welcome-title">Good day, ${escHtml(user.name?.split(' ')[0] || 'Admin')}! 👋</div>
          <div class="welcome-sub">Here's an overview of the IJED Learning Management System.</div>
        </div>
        <div class="welcome-emoji">👨‍💼</div>
      </div>

      <div class="stat-grid mb-4">
        ${this._statCard('👥', '#fde8ec', totalUsers,  'Total Users')}
        ${this._statCard('👩‍🏫', '#e6f4ea', teachers,   'Teachers')}
        ${this._statCard('🎓', '#fff0e6', students,    'Students')}
        ${this._statCard('📄', '#e8f0fa', modules,     'Modules')}
        ${this._statCard('📝', '#fde8ec', activities,  'Activities')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;flex-wrap:wrap;">
        <div class="card" style="order:1;">
          <div class="card-header"><span class="card-title">Recent Users</span></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Name</th><th>Role</th><th>Joined</th></tr></thead>
              <tbody>
                ${recentUsers.map(u => `
                  <tr>
                    <td><strong>${escHtml(u.full_name)}</strong></td>
                    <td><span class="badge badge-maroon">${escHtml(u.role?.name || u.role)}</span></td>
                    <td class="text-sm text-muted">${fmtDate(u.created_at)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="3" class="text-muted text-center">No users yet</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card" style="order:4;">
          <div class="card-header"><span class="card-title">Quick Actions</span></div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:10px;">
            <button class="btn btn-primary w-full" style="justify-content:center" onclick="AdminController.openAddUser()">➕ Add New User</button>
            <button class="btn btn-outline w-full" style="justify-content:center" onclick="DashboardController.loadSection('manage-teachers')">👩‍🏫 Manage Teachers</button>
            <button class="btn btn-outline w-full" style="justify-content:center" onclick="DashboardController.loadSection('manage-students')">🎓 Manage Students</button>
            <button class="btn btn-outline w-full" style="justify-content:center" onclick="DashboardController.loadSection('manage-users')">👥 All Users</button>
            <button class="btn btn-outline w-full" style="justify-content:center;border-color:var(--maroon);color:var(--maroon)" onclick="AdminController.openAnnouncement()">📢 Send Announcement</button>
          </div>
        </div>
      </div>

      <!-- Announcement Modal -->
      <div id="announcement-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;align-items:center;justify-content:center;">
        <div style="background:#fff;border-radius:var(--radius);padding:28px;width:440px;max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,.18)">
          <h3 style="margin:0 0 16px;color:var(--maroon-dark)">📢 Send Announcement</h3>
          <div style="margin-bottom:12px">
            <label class="form-label">Send To</label>
            <select id="announce-target" class="form-control">
              <option value="all">Everyone</option>
              <option value="teachers">Teachers only</option>
              <option value="students">Students only</option>
            </select>
          </div>
          <div style="margin-bottom:12px">
            <label class="form-label">Title</label>
            <input id="announce-title" class="form-control" placeholder="Announcement title…" maxlength="200"/>
          </div>
          <div style="margin-bottom:20px">
            <label class="form-label">Message</label>
            <textarea id="announce-msg" class="form-control" rows="4" placeholder="Write your announcement here…" style="resize:vertical"></textarea>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button class="btn btn-outline" onclick="AdminController.closeAnnouncement()">Cancel</button>
            <button class="btn btn-primary" onclick="AdminController.sendAnnouncement()">Send 📢</button>
          </div>
        </div>
      </div>`;
  },

  _statCard(icon, bg, value, label) {
    return `<div class="stat-card">
      <div class="stat-icon" style="background:${bg}">${icon}</div>
      <div><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>
    </div>`;
  },

  /* ── Unified Manage Users shell (data loaded in controller) ── */
  manageUsers() {
    return `
      <div class="um-page">
        <div class="um-header">
          <div>
            <h2 style="margin:0;font-size:22px;color:var(--maroon-dark)">Manage Users</h2>
            <p id="um-stats" style="margin:4px 0 0;color:var(--gray-400);font-size:13px">Loading...</p>
          </div>
          <div class="um-header-actions">
            <button class="btn btn-outline btn-sm" onclick="AdminController.exportCSV('all')">⬇ Export Students</button>
            <button class="btn btn-outline btn-sm" onclick="AdminController.openImportStudents()">⬆ Import Students</button>
            <button class="btn btn-primary" onclick="AdminController.openAddUser()">➕ Add User</button>
          </div>
        </div>
        <div class="um-tabs" id="um-tabs">
          <button class="um-tab active" data-tab="all">All Users (<span id="tab-all-count">0</span>)</button>
          <button class="um-tab" data-tab="teachers">👩‍🏫 Teachers (<span id="tab-teachers-count">0</span>)</button>
          <button class="um-tab" data-tab="students">🎓 Students (<span id="tab-students-count">0</span>)</button>
          <button class="um-tab" data-tab="sections">🏫 Sections (<span id="tab-sections-count">0</span>)</button>
          <button class="um-tab" data-tab="audit">📋 Audit Log</button>
        </div>
        <div id="um-pane-all"></div>
        <div id="um-pane-teachers" style="display:none"></div>
        <div id="um-pane-students" style="display:none"></div>
        <div id="um-pane-sections" style="display:none"></div>
        <div id="um-pane-audit" style="display:none"></div>
      </div>`;
  },

  /* ── All Users pane ── */
  _allUsersPane(users) {
    if (!users.length) return '<div class="empty-state"><div class="empty-state-icon">👥</div><div class="empty-state-title">No users found</div></div>';
    const rows = users.map(u => {
      const roleTag = `<span class="badge badge-${u.role?.name === 'teacher' ? 'blue' : u.role?.name === 'student' ? 'green' : 'maroon'}">${u.role?.name || u.role}</span>`;
      const extra = u.role?.name === 'teacher' ? '—' : (u.student_number || '—');
      return `<tr data-searchable>
        <td><strong>${escHtml(u.full_name)}</strong></td>
        <td class="text-sm">${escHtml(u.email)}</td>
        <td>${roleTag}</td>
        <td class="text-sm">${extra}</td>
        <td class="text-sm text-muted">${fmtDate(u.created_at)}</td>
        <td><span class="badge ${u.is_active ? 'badge-green' : 'badge-red'}">${u.is_active ? 'Active' : 'Inactive'}</span></td>
        <td>
          <div class="actions-cell">
            <button class="btn btn-xs btn-outline" onclick="AdminController.openEditUser(${u.id})">✏️ Edit</button>
            <button class="btn btn-xs btn-danger" onclick="AdminController.deleteUser(${u.id})">🗑 Remove</button>
          </div>
         </td>
       </tr>`;
    }).join('');

    return `
      <div class="um-toolbar">
        <div class="search-box"><span>🔍</span><input type="text" id="global-search" placeholder="Search by name, email…"/></div>
        <select class="form-control" style="width:140px" onchange="AdminController._filterRole(this.value)">
          <option value="">All Roles</option><option value="teacher">Teacher</option><option value="student">Student</option>
        </select>
        <select class="form-control" style="width:140px" onchange="AdminController._filterStatus(this.value)">
          <option value="">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
      </div>
      <div class="card table-card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>LRN / ID</th><th>Joined</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody id="user-table-body">${rows}</tbody>
          </table>
        </div>
      </div>`;
  },

  /* ── Teachers pane ── */
  _teachersPane(teachers) {
    if (!teachers.length) return '<div class="empty-state"><div class="empty-state-icon">👩‍🏫</div><div class="empty-state-title">No teachers yet</div></div>';
    const cards = teachers.map(t => this._teacherCard(t)).join('');
    return `
      <div class="um-toolbar">
        <div class="search-box"><span>🔍</span><input type="text" placeholder="Search teachers…" oninput="AdminController._filterCards(this.value,'teacher-card')"/></div>
        <button class="btn btn-primary" onclick="AdminController.openAddUser('teacher')">➕ Add Teacher</button>
      </div>
      <div class="teacher-grid">${cards}</div>`;
  },

  /* ── Teacher card ── */
  _teacherCard(t) {
    const fullName = `${t.user.first_name} ${t.user.last_name}`;
    const email    = t.user.email;
    const isActive = t.user.is_active;
    const initials = fullName.split(' ').map(n => n[0] || '').join('').slice(0,2).toUpperCase() || '?';
    let assignmentsHtml = '';
    let schRows = '';
    if (t.class_assignments && t.class_assignments.length) {
      assignmentsHtml = t.class_assignments.map(a => `
        <div class="assignment-item">
          <div class="assignment-subject">📘 ${escHtml(a.subject.name)}</div>
          <div class="assignment-class">🏫 ${escHtml(a.class_.name)} (${escHtml(a.class_.grade_level || '')})</div>
          <div class="assignment-schedule">⏰ ${a.schedule || 'No schedule'}</div>
        </div>
      `).join('');
      schRows = t.class_assignments.map(a => `
        <div class="sch-row">
          <span class="sch-info" style="font-size:12px">
            <strong>${escHtml(a.subject.name)}</strong> · ${escHtml(a.class_.name)} · ${escHtml(a.schedule || 'No schedule')}
          </span>
        </div>
      `).join('');
    } else {
      assignmentsHtml = '<div class="text-muted">No subjects assigned</div>';
      schRows = '<div class="text-muted">No schedule</div>';
    }
    return `
      <div class="teacher-card ${isActive ? '' : 'card-inactive'}">
        <div class="teacher-card-header">
          <div class="teacher-avatar">${initials}</div>
          <div class="teacher-info">
            <div class="teacher-name">${escHtml(fullName)}</div>
            <div class="teacher-email">${escHtml(email)}</div>
            <span class="badge ${isActive ? 'badge-green' : 'badge-red'}">${isActive ? 'Active' : 'Inactive'}</span>
          </div>
          <div class="teacher-actions">
            <button class="btn btn-xs btn-outline" onclick="AdminController.openEditUser(${t.user.id})">✏️ Edit</button>
            <button class="btn btn-xs btn-danger" onclick="AdminController.deleteUser(${t.user.id})">🗑</button>
          </div>
        </div>
        <div class="teacher-card-body">
          <div class="teacher-section-label">📚 ASSIGNMENTS</div>
          <div class="assignments-list">${assignmentsHtml}</div>
          <div class="teacher-section-label" style="margin-top:10px">📅 WEEKLY SCHEDULE</div>
          <div class="sch-list">${schRows}</div>
        </div>
      </div>`;
  },

  /* ── Students pane ── */
  _studentsPane(students, sections) {
    if (!students.length) return '<div class="empty-state"><div class="empty-state-icon">🎓</div><div class="empty-state-title">No students yet</div></div>';

    const sectionMap = {};
    sections.forEach(sec => { sectionMap[sec.id] = sec.name; });

    const bySection = {};
    students.forEach(s => {
      const sectionId = s.section_assignments?.[0]?.section_id || 'unassigned';
      if (!bySection[sectionId]) bySection[sectionId] = [];
      bySection[sectionId].push(s);
    });

    const sectionBlocks = Object.keys(bySection).map(sectionId => {
      const grp = bySection[sectionId];
      const sectionName = sectionId === 'unassigned' ? 'Unassigned' : (sectionMap[sectionId] || 'Unknown Section');
      const rows = grp.map(s => {
        const fullName = `${s.user.first_name} ${s.user.last_name}`;
        const lrn = s.student_number || '—';
        return `<tr data-searchable>
          <td><strong>${escHtml(fullName)}</strong></td>
          <td class="text-sm">${escHtml(s.user.email)}</td>
          <td class="text-sm">${escHtml(lrn)}</td>
          <td class="text-sm">${escHtml(sectionName)}</td>
          <td class="text-sm"><span class="badge ${s.user.is_active ? 'badge-green' : 'badge-red'}">${s.user.is_active ? 'Active' : 'Inactive'}</span></td>
          <td class="actions-cell">
            <button class="btn btn-xs btn-outline" onclick="AdminController.openEditUser(${s.user.id})">✏️ Edit</button>
            <button class="btn btn-xs btn-primary" onclick="AdminController.openEnrollSubjects(${s.id}, '${escHtml(fullName)}')">📚 Subjects</button>
            <button class="btn btn-xs btn-danger" onclick="AdminController.deleteUser(${s.user.id})">🗑</button>
          </td>
        </tr>`;
      }).join('');
      return `
        <div class="section-block">
          <div class="section-block-header">
            <span class="section-block-title">🏫 ${escHtml(sectionName)}</span>
            <span class="section-block-count">${grp.length} student${grp.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>LRN</th><th>Section</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    }).join('');
    return `
      <div class="um-toolbar">
        <div class="search-box"><span>🔍</span><input type="text" id="student-search" placeholder="Search students…" oninput="AdminController._filterStudents(this.value)"/></div>
        <button class="btn btn-primary" onclick="AdminController.openAddUser('student')">➕ Add Student</button>
        <button class="btn btn-outline btn-sm" onclick="AdminController.openImportStudents()">⬆ Import</button>
        <button class="btn btn-outline btn-sm" onclick="AdminController.exportCSV('student')">⬇ Export</button>
      </div>
      <div id="student-section-blocks">${sectionBlocks}</div>`;
  },

  /* ── Sections pane ── */
  _sectionsPane(sections) {
    if (!sections || !sections.length) {
      return '<div class="empty-state"><div class="empty-state-icon">🏫</div><div class="empty-state-title">No sections yet</div><button class="btn btn-primary mt-3" onclick="AdminController.openAddSection()">➕ Add Section</button></div>';
    }
    const rows = sections.map(sec => `
      <tr>
        <td><strong>${escHtml(sec.name)}</strong> (Class ID: ${sec.class_id})</td>
        <td class="text-sm">—</td>
        <td class="text-sm">—</td>
        <td class="text-sm">—</td>
        <td class="text-sm">—</td>
        <td class="text-sm text-muted">—</td>
        <td class="actions-cell">
          <button class="btn btn-xs btn-outline" onclick="AdminController.openEditSection(${sec.id})">✏️ Edit</button>
          <button class="btn btn-xs btn-danger" onclick="AdminController.deleteSection(${sec.id})">🗑</button>
        </td>
      </tr>
    `).join('');
    return `
      <div class="um-toolbar"><button class="btn btn-primary" onclick="AdminController.openAddSection()">➕ Add Section</button></div>
      <div class="card table-card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Section</th><th>Room</th><th>Adviser</th><th>Students</th><th>School Year</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  },

  /* ── Audit Log pane ──
     NOTE: there is no real audit_log table or API yet — this was left over
     from a pre-Supabase mock-data prototype that referenced `auditModel`/
     `userModel` globals which no longer exist. That undefined reference was
     crashing on every Manage Users page load (not just when viewing this
     tab), because dashboard.controller.js renders every pane eagerly up
     front. This now fails safely with a placeholder instead. Building a
     real audit trail (new table + logging calls on create/update/delete/
     import actions) is a separate feature to build when needed. */
  _auditPane() {
    return `<div class="empty-state">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-title">Audit log isn't set up yet</div>
      <div class="empty-state-sub">This needs a dedicated audit table and logging hooks on admin actions — ask to have it built when you're ready.</div>
    </div>`;
  },

  /* ── Redirect helpers (for legacy nav items) ── */
  manageTeachers() {
    AdminController._pendingTab = 'teachers';
    return this.manageUsers();
  },
  manageStudents() {
    AdminController._pendingTab = 'students';
    return this.manageUsers();
  },

  settings(user) {
    const isAdmin = user.role === 'admin';
    const contact = Storage.get(`ijed_profile_contact_${user.id}`) || {};
    const savedImage = Storage.get(`ijed_profile_image_${user.id}`);
    const initials = (user.name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const imageStyle = savedImage
      ? `background-image:url("${savedImage}");background-size:cover;background-position:center;`
      : 'background:linear-gradient(135deg,var(--maroon-light),var(--maroon-mid));';
    return `
      <div class="section-header">
        <div class="section-header-left"><h2>Settings</h2><p>Manage your profile and account preferences</p></div>
      </div>
      <div class="settings-grid" style="display:grid;grid-template-columns:repeat(${isAdmin ? 3 : 4},minmax(0,1fr));align-items:start;gap:20px;max-width:none;">
        <div class="card" style="order:1;">
          <div class="card-header"><span class="card-title">Profile Information</span></div>
          <div class="card-body">
            <div class="form-group">
              <label class="form-label">Profile Image</label>
              <div style="display:flex;align-items:center;gap:12px;">
                <div id="settings-image-preview" style="width:56px;height:56px;flex:0 0 56px;border-radius:50%;display:flex;align-items:center;justify-content:center;${imageStyle}color:#fff;font-weight:700;overflow:hidden;">${savedImage ? '' : escHtml(initials)}</div>
                <div>
                  <label class="btn btn-outline btn-sm" for="settings-image">Choose Image</label>
                  <input id="settings-image" type="file" accept="image/png,image/jpeg,image/webp" onchange="App.previewProfileImage(this)" style="display:none;" />
                </div>
              </div>
            </div>
            <div class="form-group"><label class="form-label">Full Name</label>
              <input class="form-control" id="settings-name" value="${escHtml(user.name)}" /></div>
            <div class="form-group"><label class="form-label">LMS Email Address</label>
              <input class="form-control" type="email" id="settings-email" value="${escHtml(user.email)}" readonly /></div>
            ${isAdmin ? '' : `<div class="form-group"><label class="form-label">Personal Email</label>
              <input class="form-control" type="email" id="settings-personal-email" value="${escHtml(contact.personalEmail || '')}" placeholder="you@example.com" /></div>
            <div class="form-group"><label class="form-label">Phone Number</label>
              <input class="form-control" type="tel" id="settings-phone" value="${escHtml(contact.phoneNumber || '')}" placeholder="e.g. 09XXXXXXXXX" maxlength="30" /></div>`}
            <button class="btn btn-primary" onclick="AdminController.saveSettings()">Save Changes</button>
          </div>
        </div>
        <div class="card" style="order:${isAdmin ? 3 : 4};grid-column:${isAdmin ? 3 : 4};grid-row:1;">
          <div class="card-header"><span class="card-title">Change Password</span></div>
          <div class="card-body">
            <div class="form-group"><label class="form-label">New Password</label>
              <input class="form-control" type="password" id="settings-pw" placeholder="Enter new password" /></div>
            <div class="form-group"><label class="form-label">Confirm Password</label>
              <input class="form-control" type="password" id="settings-pw2" placeholder="Confirm new password" /></div>
            <button class="btn btn-primary" onclick="AdminController.changePassword()">Update Password</button>
          </div>
        </div>
        ${isAdmin ? '' : `<div class="card" style="order:2;grid-column:2;grid-row:1;">
          <div class="card-header"><span class="card-title">Location</span></div>
          <div class="card-body">
            <div class="form-group"><label class="form-label">Address Line 1</label>
              <input class="form-control" id="settings-address-line1" value="${escHtml(contact.addressLine1 || '')}" /></div>
            <div class="form-group"><label class="form-label">Address Line 2</label>
              <input class="form-control" id="settings-address-line2" value="${escHtml(contact.addressLine2 || '')}" /></div>
            <div class="form-group"><label class="form-label">City</label>
              <input class="form-control" id="settings-city" value="${escHtml(contact.city || '')}" /></div>
            <div class="form-group"><label class="form-label">State/Province</label>
              <input class="form-control" id="settings-state" value="${escHtml(contact.state || '')}" /></div>
            <div class="form-group"><label class="form-label">Zip/Postal Code</label>
              <input class="form-control" id="settings-postal-code" value="${escHtml(contact.postalCode || '')}" /></div>
            <button class="btn btn-primary" onclick="AdminController.saveSettings()">Save Changes</button>
          </div>
        </div>`}
        <div class="settings-side-stack" style="display:flex;flex-direction:column;gap:20px;min-width:0;grid-column:${isAdmin ? 2 : 3};grid-row:1;">
        <div class="card">
          <div class="card-header"><span class="card-title">Notifications</span></div>
          <div class="card-body">
            <label style="display:flex;align-items:center;gap:10px;margin-top:18px;cursor:pointer;">
              <input type="checkbox" checked style="accent-color:var(--maroon);" />
              <span style="font-size:13px;">Audio Notifications</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;margin-top:14px;cursor:pointer;">
              <input type="checkbox" checked style="accent-color:var(--maroon);" />
              <span style="font-size:13px;">Remind me about deadlines</span>
            </label>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Appearance</span></div>
          <div class="card-body">
            <div class="form-group"><label class="form-label" for="settings-theme">Default Theme</label>
              <select class="form-control" id="settings-theme" onchange="DarkMode.setTheme(this.value)">
                <option value="system" ${DarkMode.getTheme() === 'system' ? 'selected' : ''}>System default</option>
                <option value="light" ${DarkMode.getTheme() === 'light' ? 'selected' : ''}>Light</option>
                <option value="dark" ${DarkMode.getTheme() === 'dark' ? 'selected' : ''}>Dark</option>
              </select>
            </div>
          </div>
        </div>
        </div>
      </div>`;
  },
};