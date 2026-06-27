/* ============================================================
   views/admin.view.js
   Pure render functions for Admin role — returns HTML strings only.
   No direct DOM manipulation; controllers handle that.
   ============================================================ */

"use strict";

const AdminView = {

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
        <div class="card">
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

        <div class="card">
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
            <button class="btn btn-outline btn-sm" onclick="AdminController.exportCSV('all')">⬇ Export CSV</button>
            <button class="btn btn-outline btn-sm" onclick="AdminController.openImportCSV()">⬆ Import CSV</button>
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

  /* ── Audit Log pane ── */
  _auditPane() {
    const logs = auditModel.getRecent(100);
    if (!logs.length) return `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">No audit records yet</div></div>`;
    const actionColor = { CREATE:'#2e6b3e', UPDATE:'#1a4a8a', DELETE:'#b71c1c', ASSIGN:'#c04a00', IMPORT:'#6a0dad' };
    const rows = logs.map(l => {
      const admin = userModel.getById(l.adminId);
      const dt    = new Date(l.timestamp);
      const fmt   = dt.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) + ' ' + dt.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});
      const col   = actionColor[l.action] || '#666';
      return `<tr>
        <td><span class="tag" style="background:${col}20;color:${col};border:1px solid ${col}40;font-size:11px;font-weight:700">${l.action}</span></td>
        <td class="text-sm">${escHtml(l.entity)}</td>
        <td class="text-sm">${escHtml(l.details)}</td>
        <td class="text-sm">${admin ? escHtml(admin.name) : 'System'}</td>
        <td class="text-sm text-muted">${fmt}</td>
      </tr>`;
    }).join('');
    return `
      <div class="um-toolbar">
        <div class="search-box"><span>🔍</span><input type="text" placeholder="Search logs…" oninput="AdminController._filterTable(this.value,'audit-body')"/></div>
        <button class="btn btn-outline btn-sm" onclick="AdminController.clearAuditLog()">🗑 Clear Log</button>
      </div>
      <div class="card table-card">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Action</th><th>Entity</th><th>Details</th><th>Admin</th><th>Timestamp</th></tr></thead>
            <tbody id="audit-body">${rows}</tbody>
          </table>
        </div>
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
    return `
      <div class="section-header">
        <div class="section-header-left"><h2>Settings</h2><p>Manage your account preferences</p></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:820px;">
        <div class="card">
          <div class="card-header"><span class="card-title">Profile Information</span></div>
          <div class="card-body">
            <div class="form-group"><label class="form-label">Full Name</label>
              <input class="form-control" id="settings-name" value="${escHtml(user.name)}" /></div>
            <div class="form-group"><label class="form-label">Email Address</label>
              <input class="form-control" id="settings-email" value="${escHtml(user.email)}" /></div>
            <button class="btn btn-primary" onclick="AdminController.saveSettings()">Save Changes</button>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Change Password</span></div>
          <div class="card-body">
            <div class="form-group"><label class="form-label">New Password</label>
              <input class="form-control" type="password" id="settings-pw" placeholder="Enter new password" /></div>
            <div class="form-group"><label class="form-label">Confirm Password</label>
              <input class="form-control" type="password" id="settings-pw2" placeholder="Confirm new password" /></div>
            <button class="btn btn-primary" onclick="AdminController.changePassword()">Update Password</button>
          </div>
        </div>
      </div>`;
  },
};