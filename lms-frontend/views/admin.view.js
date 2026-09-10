/* ============================================================
   views/admin.view.js
   Pure render functions for Admin role — returns HTML strings only.
   No direct DOM manipulation; controllers handle that.
   ============================================================ */

"use strict";

const adminSvg = content => `<svg class="admin-inline-icon" viewBox="0 0 24 24" aria-hidden="true">${content}</svg>`;
const adminStroke = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ADMIN_ICONS = {
  wave: adminSvg('<path d="m4 20 .8-4.1L16.8 4a2.1 2.1 0 0 1 3 3L7.7 18.9 4 20Z" ' + adminStroke + '/><path d="m14.5 6.5 3 3" ' + adminStroke + '/>'),
  admin: adminSvg('<rect x="3.5" y="7" width="17" height="12" rx="2" ' + adminStroke + '/><path d="M8 7V5a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 16 5v2M3.5 11h17M10 11v2h4v-2" ' + adminStroke + '/>'),
  users: adminSvg('<path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M9 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM16 11a3 3 0 0 0 0-6M17 14.5h1a4 4 0 0 1 4 4V20" ' + adminStroke + '/>'),
  teacher: adminSvg('<path d="M4 20V8.5L12 4l8 4.5V20M8 20v-5h8v5M3 20h18M8 9h0M12 9h0M16 9h0" ' + adminStroke + '/>'),
  student: adminSvg('<circle cx="12" cy="7.5" r="3.5" ' + adminStroke + '/><path d="M4.5 20a7.5 7.5 0 0 1 15 0" ' + adminStroke + '/>'),
  file: adminSvg('<path d="M7 3.5h7l5 5v11A2.5 2.5 0 0 1 16.5 22h-9A2.5 2.5 0 0 1 5 19.5v-13A2.5 2.5 0 0 1 7.5 4H7Z" ' + adminStroke + '/><path d="M14 3.5V9h5M8.5 13h6M8.5 16.5h6" ' + adminStroke + '/>'),
  activity: adminSvg('<rect x="4" y="5" width="16" height="15" rx="2.5" ' + adminStroke + '/><path d="M9 3.5v3M15 3.5v3M8 10.5h8M8 14h8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  loading: adminSvg('<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8" stroke-dasharray="18 8" fill="none"/>'),
  plus: adminSvg('<path d="M12 5v14M5 12h14" ' + adminStroke + '/>'),
  megaphone: adminSvg('<path d="m4 13 12 5V6L4 11v2ZM16 9.5l4-2v9l-4-2M6 14l2 5h3l-2-5" ' + adminStroke + '/>'),
  download: adminSvg('<path d="M12 3v12M7 10l5 5 5-5M5 20h14" ' + adminStroke + '/>'),
  upload: adminSvg('<path d="M12 15V3M7 8l5-5 5 5M5 20h14" ' + adminStroke + '/>'),
  school: adminSvg('<path d="M4 20V5.5h16V20M2.5 20h19M8 9h2M14 9h2M8 13h2M14 13h2M8 17h2M14 17h2" ' + adminStroke + '/>'),
  transfer: adminSvg('<path d="M4 7h15M15 3l4 4-4 4M20 17H5M9 13l-4 4 4 4" ' + adminStroke + '/>'),
  audit: adminSvg('<rect x="4" y="4" width="16" height="16" rx="2" ' + adminStroke + '/><path d="M8 9h8M8 13h8M8 17h5" ' + adminStroke + '/>'),
  trash: adminSvg('<path d="M5 7h14M10 11v5M14 11v5M8 7l1 13h6l1-13M9 7l1-3h4l1 3" ' + adminStroke + '/>'),
  search: adminSvg('<circle cx="11" cy="11" r="5.5" ' + adminStroke + '/><path d="m16 16 4 4" ' + adminStroke + '/>'),
  edit: adminSvg('<path d="m4 16.5-.7 3.7 3.7-.7L19 7.5 16.5 5 4 16.5ZM15 6.5l2.5 2.5" ' + adminStroke + '/>'),
  book: adminSvg('<path d="M5 6.8A2.8 2.8 0 0 1 7.8 4H19v13.2A2.8 2.8 0 0 0 16.2 14H7.8A2.8 2.8 0 0 0 5 16.8V6.8ZM5 6.8V18a2 2 0 0 0 2 2h11.5" ' + adminStroke + '/>'),
  clock: adminSvg('<circle cx="12" cy="12" r="8" ' + adminStroke + '/><path d="M12 7.5v4.5l3 2" ' + adminStroke + '/>')
};

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
            <div class="welcome-title">Good day, ${escHtml(user.name?.split(' ')[0] || 'Admin')}! ${ADMIN_ICONS.wave}</div>
            <div class="welcome-sub">Loading dashboard data...</div>
          </div>
          <div class="welcome-emoji">${ADMIN_ICONS.admin}</div>
        </div>
        <div class="stat-grid mb-4">
          <div class="stat-card"><div class="stat-icon" style="background:rgba(139,26,46,0.08);color:#8b1a2e">${ADMIN_ICONS.users}</div><div><div class="stat-value">—</div><div class="stat-label">Total Users</div></div></div>
          <div class="stat-card"><div class="stat-icon" style="background:rgba(107,85,88,0.10);color:#6b5558">${ADMIN_ICONS.teacher}</div><div><div class="stat-value">—</div><div class="stat-label">Teachers</div></div></div>
          <div class="stat-card"><div class="stat-icon" style="background:rgba(59,130,246,0.10);color:#1d4ed8">${ADMIN_ICONS.student}</div><div><div class="stat-value">—</div><div class="stat-label">Students</div></div></div>
          <div class="stat-card"><div class="stat-icon" style="background:rgba(34,197,94,0.10);color:#1f8f4e">${ADMIN_ICONS.file}</div><div><div class="stat-value">—</div><div class="stat-label">Modules</div></div></div>
          <div class="stat-card"><div class="stat-icon" style="background:rgba(245,158,11,0.12);color:#b86b00">${ADMIN_ICONS.activity}</div><div><div class="stat-value">—</div><div class="stat-label">Activities</div></div></div>
        </div>
        <div class="empty-state"><div class="empty-state-icon">${ADMIN_ICONS.loading}</div><div class="empty-state-title">Loading...</div></div>`;
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
          <div class="welcome-title">Good day, ${escHtml(user.name?.split(' ')[0] || 'Admin')}! ${ADMIN_ICONS.wave}</div>
          <div class="welcome-sub">Here's an overview of the IJED Learning Management System.</div>
        </div>
        <div class="welcome-emoji">${ADMIN_ICONS.admin}</div>
      </div>

      <div class="stat-grid mb-4">
        ${this._statCard(ADMIN_ICONS.users, 'rgba(139,26,46,0.08)', totalUsers,  'Total Users')}
        ${this._statCard(ADMIN_ICONS.teacher, 'rgba(107,85,88,0.10)', teachers,   'Teachers')}
        ${this._statCard(ADMIN_ICONS.student, 'rgba(59,130,246,0.10)', students,    'Students')}
        ${this._statCard(ADMIN_ICONS.file, 'rgba(34,197,94,0.10)', modules,     'Modules')}
        ${this._statCard(ADMIN_ICONS.activity, 'rgba(245,158,11,0.12)', activities,  'Activities')}
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
            <button class="btn btn-primary w-full" style="justify-content:center" onclick="AdminController.openAddUser()">${ADMIN_ICONS.plus} Add New User</button>
            <button class="btn btn-outline w-full" style="justify-content:center" onclick="DashboardController.loadSection('manage-teachers')">${ADMIN_ICONS.teacher} Manage Teachers</button>
            <button class="btn btn-outline w-full" style="justify-content:center" onclick="DashboardController.loadSection('manage-students')">${ADMIN_ICONS.student} Manage Students</button>
            <button class="btn btn-outline w-full" style="justify-content:center" onclick="DashboardController.loadSection('manage-users')">${ADMIN_ICONS.users} All Users</button>
            <button class="btn btn-outline w-full" style="justify-content:center;border-color:var(--maroon);color:var(--maroon)" onclick="AdminController.openAnnouncement()">${ADMIN_ICONS.megaphone} Send Announcement</button>
          </div>
        </div>
      </div>

      <!-- Announcement Modal -->
      <div id="announcement-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2000;align-items:center;justify-content:center;">
        <div style="background:#fff;border-radius:var(--radius);padding:28px;width:440px;max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,.18)">
          <h3 style="margin:0 0 16px;color:var(--maroon-dark)">${ADMIN_ICONS.megaphone} Send Announcement</h3>
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
            <button class="btn btn-primary" onclick="AdminController.sendAnnouncement()">${ADMIN_ICONS.megaphone} Send</button>
          </div>
        </div>
      </div>`;
  },

  _statCard(icon, bg, value, label) {
    return `<div class="stat-card">
      <div class="stat-icon" style="background:${bg};${bg.includes('139,26,46') ? 'color:#8b1a2e;' : bg.includes('107,85,88') ? 'color:#6b5558;' : bg.includes('34,197,94') ? 'color:#1f8f4e;' : bg.includes('59,130,246') ? 'color:#1d4ed8;' : bg.includes('245,158,11') ? 'color:#b86b00;' : ''}">${icon}</div>
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
            <button class="btn btn-outline btn-sm" onclick="AdminController.exportCSV('all')">${ADMIN_ICONS.download} Export Students</button>
            <button class="btn btn-outline btn-sm" onclick="AdminController.openImportStudents()">${ADMIN_ICONS.upload} Import Students</button>
            <button class="btn btn-primary" onclick="AdminController.openAddUser()">${ADMIN_ICONS.plus} Add User</button>
          </div>
        </div>
        <div class="um-tabs" id="um-tabs">
          <button class="um-tab active" data-tab="all">All Users (<span id="tab-all-count">0</span>)</button>
          <button class="um-tab" data-tab="teachers">${ADMIN_ICONS.teacher} Teachers (<span id="tab-teachers-count">0</span>)</button>
          <button class="um-tab" data-tab="students">${ADMIN_ICONS.student} Students (<span id="tab-students-count">0</span>)</button>
          <button class="um-tab" data-tab="sections">${ADMIN_ICONS.school} Sections (<span id="tab-sections-count">0</span>)</button>
          <button class="um-tab" data-tab="transfer">${ADMIN_ICONS.transfer} Transfer</button>
          <button class="um-tab" data-tab="audit">${ADMIN_ICONS.audit} Audit Log</button>
        </div>
        <div id="um-pane-all"></div>
        <div id="um-pane-teachers" style="display:none"></div>
        <div id="um-pane-students" style="display:none"></div>
        <div id="um-pane-sections" style="display:none"></div>
        <div id="um-pane-transfer" style="display:none"></div>
        <div id="um-pane-audit" style="display:none"></div>
      </div>`;
  },

  /* ── All Users pane ── */
  _allUsersPane(users) {
    if (!users.length) return `<div class="empty-state"><div class="empty-state-icon">${ADMIN_ICONS.users}</div><div class="empty-state-title">No users found</div></div>`;
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
            <button class="btn btn-xs btn-outline" onclick="AdminController.openEditUser(${u.id})">${ADMIN_ICONS.edit} Edit</button>
            <button class="btn btn-xs btn-danger" onclick="AdminController.deleteUser(${u.id})">${ADMIN_ICONS.trash} Remove</button>
          </div>
         </td>
       </tr>`;
    }).join('');

    return `
      <div class="um-toolbar">
        <div class="search-box"><span>${ADMIN_ICONS.search}</span><input type="text" id="global-search" placeholder="Search by name, email…"/></div>
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
    if (!teachers.length) return `<div class="empty-state"><div class="empty-state-icon">${ADMIN_ICONS.teacher}</div><div class="empty-state-title">No teachers yet</div></div>`;
    const cards = teachers.map(t => this._teacherCard(t)).join('');
    return `
      <div class="um-toolbar">
        <div class="search-box"><span>${ADMIN_ICONS.search}</span><input type="text" placeholder="Search teachers…" oninput="AdminController._filterCards(this.value,'teacher-card')"/></div>
        <button class="btn btn-primary" onclick="AdminController.openAddUser('teacher')">${ADMIN_ICONS.plus} Add Teacher</button>
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
          <div class="assignment-subject">${ADMIN_ICONS.book} ${escHtml(a.subject.name)}</div>
          <div class="assignment-class">${ADMIN_ICONS.school} ${escHtml(a.class_.name)} (${escHtml(a.class_.grade_level || '')})</div>
          <div class="assignment-schedule">${ADMIN_ICONS.clock} ${a.schedule || 'No schedule'}</div>
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
            <button class="btn btn-xs btn-outline" onclick="AdminController.openEditUser(${t.user.id})">${ADMIN_ICONS.edit} Edit</button>
            <button class="btn btn-xs btn-danger" onclick="AdminController.deleteUser(${t.user.id})">${ADMIN_ICONS.trash}</button>
          </div>
        </div>
        <div class="teacher-card-body">
          <div class="teacher-section-label">${ADMIN_ICONS.book} ASSIGNMENTS</div>
          <div class="assignments-list">${assignmentsHtml}</div>
          <div class="teacher-section-label" style="margin-top:10px">📅 WEEKLY SCHEDULE</div>
          <div class="sch-list">${schRows}</div>
        </div>
      </div>`;
  },

  /* ── Students pane ── */
  _studentsPane(students, sections) {
    if (!students.length) return `<div class="empty-state"><div class="empty-state-icon">${ADMIN_ICONS.student}</div><div class="empty-state-title">No students yet</div></div>`;

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
            <button class="btn btn-xs btn-outline" onclick="AdminController.openEditUser(${s.user.id})">${ADMIN_ICONS.edit} Edit</button>
            <button class="btn btn-xs btn-primary" onclick="AdminController.openEnrollSubjects(${s.id}, '${escHtml(fullName)}')">${ADMIN_ICONS.book} Subjects</button>
            <button class="btn btn-xs btn-danger" onclick="AdminController.deleteUser(${s.user.id})">${ADMIN_ICONS.trash}</button>
          </td>
        </tr>`;
      }).join('');
      return `
        <div class="section-block">
          <div class="section-block-header">
            <span class="section-block-title">${ADMIN_ICONS.school} ${escHtml(sectionName)}</span>
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
        <div class="search-box"><span>${ADMIN_ICONS.search}</span><input type="text" id="student-search" placeholder="Search students…" oninput="AdminController._filterStudents(this.value)"/></div>
        <button class="btn btn-primary" onclick="AdminController.openAddUser('student')">${ADMIN_ICONS.plus} Add Student</button>
        <button class="btn btn-outline btn-sm" onclick="AdminController.openImportStudents()">${ADMIN_ICONS.upload} Import</button>
        <button class="btn btn-outline btn-sm" onclick="AdminController.exportCSV('student')">${ADMIN_ICONS.download} Export</button>
      </div>
      <div id="student-section-blocks">${sectionBlocks}</div>`;
  },

  /* ── Sections pane ── */
  _sectionsPane(sections, students = []) {
    if (!sections || !sections.length) {
      return `<div class="empty-state"><div class="empty-state-icon">${ADMIN_ICONS.school}</div><div class="empty-state-title">No sections yet</div><button class="btn btn-primary mt-3" onclick="AdminController.openAddSection()">${ADMIN_ICONS.plus} Add Section</button></div>`;
    }
    // Count students currently assigned to each section.
    const countBySection = {};
    students.forEach(s => {
      (s.section_assignments || []).forEach(sa => {
        countBySection[sa.section_id] = (countBySection[sa.section_id] || 0) + 1;
      });
    });
    const rows = sections.map(sec => {
      const adviserName = sec.adviser?.user
        ? `${escHtml(sec.adviser.user.first_name)} ${escHtml(sec.adviser.user.last_name)}`
        : '—';
      const studentCount = countBySection[sec.id] || 0;
      return `
      <tr>
        <td><strong>${escHtml(sec.name)}</strong>${sec.grade_level ? ` <span class="text-sm text-muted">(Grade ${escHtml(sec.grade_level)})</span>` : ''}</td>
        <td class="text-sm">${escHtml(sec.room || '—')}</td>
        <td class="text-sm">${adviserName}</td>
        <td class="text-sm">${studentCount}</td>
        <td class="text-sm">${escHtml(sec.school_year || '—')}</td>
        <td class="actions-cell">
          <button class="btn btn-xs btn-outline" onclick="AdminController.openEditSection(${sec.id})">${ADMIN_ICONS.edit} Edit</button>
          <button class="btn btn-xs btn-danger" onclick="AdminController.deleteSection(${sec.id})">${ADMIN_ICONS.trash}</button>
        </td>
      </tr>`;
    }).join('');
    return `
      <div class="um-toolbar"><button class="btn btn-primary" onclick="AdminController.openAddSection()">${ADMIN_ICONS.plus} Add Section</button></div>
      <div class="card table-card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Section</th><th>Room</th><th>Adviser</th><th>Students</th><th>School Year</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  },

  /* ── Transfer / Promote Students pane ──
     Moves finished students from one section to the next (e.g. ICT1101 ->
     ICT1201). Grades/attendance history stays with the old section —
     only current section + subject enrollment moves. Whole-section by
     default (all checked), but every student can be individually
     unchecked, since not everyone moves up at the same time. */
  _transferPane(sections) {
    if (!sections || !sections.length) {
      return `<div class="empty-state"><div class="empty-state-icon">${ADMIN_ICONS.transfer}</div><div class="empty-state-title">No sections yet</div><div class="empty-state-sub">Create sections first under the Sections tab.</div></div>`;
    }
    const sectionOpts = sections.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
    return `
      <div class="card" style="padding:20px;max-width:720px">
        <h3 style="margin:0 0 6px;color:var(--maroon-dark)">${ADMIN_ICONS.transfer} Transfer / Promote Students</h3>
        <p style="margin:0 0 18px;font-size:13px;color:var(--gray-400)">
          Move students from one section to the next at the end of a school year.
          Their grades and attendance stay exactly as they were — only their current
          section and subjects move forward. Not everyone has to move: uncheck
          anyone who's repeating or staying behind before transferring.
        </p>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">From Section *</label>
            <select id="transfer-from-section" class="form-control" onchange="AdminController.onTransferFromSectionChange(this.value)">
              <option value="">— Select Section —</option>
              ${sectionOpts}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">To Section *</label>
            <select id="transfer-to-section" class="form-control">
              <option value="">— Select Section —</option>
              ${sectionOpts}
            </select>
          </div>
        </div>
        <div id="transfer-roster-wrap" style="margin-top:16px"></div>
      </div>`;
  },

  /* ── Transfer pane: student roster checklist for the chosen From section ── */
  _transferRoster(students) {
    if (!students.length) {
      return '<div class="empty-state" style="padding:24px"><div class="empty-state-title">No students in this section</div></div>';
    }
    const rows = students.map(s => `
      <tr>
        <td style="width:36px"><input type="checkbox" class="transfer-student-cb" value="${s.id}" checked onchange="AdminController._updateTransferCount()"></td>
        <td>${escHtml((s.user?.first_name || '') + ' ' + (s.user?.last_name || ''))}</td>
        <td class="text-sm text-muted">${escHtml(s.student_number || '—')}</td>
      </tr>`).join('');
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="transfer-select-all" checked onchange="AdminController._toggleAllTransferStudents(this.checked)">
          Select all (${students.length})
        </label>
        <span id="transfer-selected-count" style="font-size:12px;color:var(--gray-400)">${students.length} selected</span>
      </div>
      <div class="card table-card" style="max-height:340px;overflow-y:auto">
        <table class="data-table">
          <tbody>${rows}</tbody>
        </table>
      </div>
      <button class="btn btn-primary" style="margin-top:14px" onclick="AdminController.confirmTransfer()">${ADMIN_ICONS.transfer} Transfer Selected Students</button>
    `;
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
      <div class="empty-state-icon">${ADMIN_ICONS.audit}</div>
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

  settings(user, profile = null) {
    const role = profile?.role || user.role || 'user';
    const isStudent = role === 'student';
    const isTeacher = role === 'teacher';
    const details = profile?.profile_details || {};
    const roleProfile = isStudent ? (profile?.student || {}) : (profile?.teacher || {});
    const savedImage = profile?.avatar_url || user.avatar_url || Storage.get(`ijed_profile_image_${user.id}`);
    const name = profile?.full_name || user.full_name || user.name || 'User';
    const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const imageStyle = savedImage ? `background-image:url("${escHtml(savedImage)}");background-size:cover;background-position:center;` : 'background:linear-gradient(135deg,var(--maroon-light),var(--maroon-mid));';
    const sections = (roleProfile.sections || []).map(section => `${section.name || '—'} (${section.classes?.name || '—'})`).join(', ') || 'Not assigned';
    const subjects = isStudent ? (roleProfile.subjects || []).map(subject => subject.name).filter(Boolean) : [];
    const subjectsHTML = subjects.length
      ? `<ul class="profile-subject-list">${subjects.map(subject => `<li>${escHtml(subject)}</li>`).join('')}</ul>`
      : '<span class="profile-detail-empty">Not enrolled</span>';
    const teacherAssignments = isTeacher ? ((roleProfile.assignments || []).map(assignment => `${assignment.subject_name || '—'} · ${assignment.section_name || assignment.class_name || '—'}`).join(', ') || 'Not assigned') : '';
    const infoRows = isStudent ? `
      <div class="profile-readonly-grid"><div><span>Student number</span><strong>${escHtml(roleProfile.student_number || 'Not set')}</strong></div><div><span>Year level</span><strong>${escHtml(roleProfile.sections?.[0]?.classes?.grade_level || 'Not assigned')}</strong></div><div><span>Section</span><strong>${escHtml(sections)}</strong></div><div><span>School year</span><strong>${escHtml(roleProfile.sections?.[0]?.classes?.school_year || 'Not assigned')}</strong></div><div><span>Subjects</span><strong>${subjectsHTML}</strong></div><div><span>Guardian</span><strong>${escHtml(roleProfile.guardian_name || 'Not set')}</strong></div><div><span>Status</span><strong>${profile?.is_active === false ? 'Inactive' : 'Active'}</strong></div></div>` : isTeacher ? `
      <div class="profile-readonly-grid"><div><span>Employee ID</span><strong>${escHtml(roleProfile.employee_id || 'Not set')}</strong></div><div><span>Specialization</span><strong>${escHtml(roleProfile.specialization || 'Not set')}</strong></div><div><span>Teaching assignments</span><strong>${escHtml(teacherAssignments)}</strong></div><div><span>Status</span><strong>${profile?.is_active === false ? 'Inactive' : 'Active'}</strong></div></div>` : `
      <div class="profile-readonly-grid"><div><span>Account role</span><strong>${escHtml(role)}</strong></div><div><span>Status</span><strong>${profile?.is_active === false ? 'Inactive' : 'Active'}</strong></div></div>`;
    return `
      <div class="section-header"><div class="section-header-left"><h2>Profile Settings</h2><p>Your account details and contact preferences</p></div></div>
      <div class="profile-settings-layout">
        <section class="card profile-settings-card profile-settings-identity"><div class="card-header"><span class="card-title">Profile information</span><span class="profile-readonly-label">Read only</span></div><div class="card-body">
          <div class="profile-settings-summary"><div id="settings-image-preview" class="profile-settings-avatar" style="${imageStyle}">${savedImage ? '' : escHtml(initials)}</div><div><h3>${escHtml(name)}</h3><p>${escHtml((role || '').replace(/^./, letter => letter.toUpperCase()))} · ${escHtml(profile?.email || user.email || '—')}</p><button class="btn btn-outline btn-sm" type="button" onclick="AdminController.chooseProfilePicture()">${lmsIcon('upload')} Change picture</button><input id="settings-picture-input" type="file" accept="image/png,image/jpeg,image/webp" hidden onchange="AdminController.uploadProfilePicture(this)" /></div></div>
          <div class="profile-readonly-fields"><div class="form-group"><label class="form-label">Full name</label><input class="form-control" value="${escHtml(name)}" readonly /></div><div class="form-group"><label class="form-label">LMS email</label><input class="form-control" value="${escHtml(profile?.email || user.email || '')}" readonly /></div></div>${infoRows}
        </div></section>
        <section class="card profile-settings-card"><div class="card-header"><span class="card-title">Contact preferences</span><span class="profile-editable-label">Editable</span></div><div class="card-body"><div class="form-group"><label class="form-label" for="settings-address">Address</label><textarea class="form-control" id="settings-address" rows="3" placeholder="Your current address">${escHtml(details.address || '')}</textarea></div><div class="form-group"><label class="form-label" for="settings-phone">Number</label><input class="form-control" type="tel" id="settings-phone" value="${escHtml(roleProfile.contact_number || details.phone || '')}" placeholder="09XXXXXXXXX" maxlength="30" /></div><div class="form-group"><label class="form-label" for="settings-social">Social</label><input class="form-control" id="settings-social" value="${escHtml(details.social || '')}" placeholder="Facebook, Messenger, or other handle" /></div><button class="btn btn-primary" onclick="AdminController.saveSettings()">${lmsIcon('save')} Save contact details</button></div></section>
        <section class="card profile-settings-card"><div class="card-header"><span class="card-title">Change password</span><span class="profile-editable-label">Editable</span></div><div class="card-body"><p class="profile-settings-help">Choose a strong password with at least 8 characters and one number.</p><div class="form-group"><label class="form-label" for="settings-pw">New password</label><input class="form-control" type="password" id="settings-pw" autocomplete="new-password" /></div><div class="form-group"><label class="form-label" for="settings-pw2">Confirm password</label><input class="form-control" type="password" id="settings-pw2" autocomplete="new-password" /></div><button class="btn btn-primary" onclick="AdminController.changePassword()">${lmsIcon('save')} Update password</button></div></section>
      </div>`;
  },
};