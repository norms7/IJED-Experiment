/* ============================================================
   controllers/admin.controller.js
   All admin actions: user CRUD, teacher assignments,
   section management, and student subject enrollment.
   ============================================================ */

"use strict";

const AdminController = {
  _pendingTab: null,

  /* ── Tab helpers ─────────────────────────────────────────── */

  _switchTab(tab) {
    ['all', 'teachers', 'students', 'sections', 'audit'].forEach(t => {
      const pane = document.getElementById(`um-pane-${t}`);
      const btn  = document.querySelector(`.um-tab[data-tab="${t}"]`);
      if (pane) pane.style.display = t === tab ? '' : 'none';
      if (btn)  btn.classList.toggle('active', t === tab);
    });
  },

  /* ── Filter helpers ──────────────────────────────────────── */

  _filterRole(val) {
    document.querySelectorAll('#user-table-body tr[data-searchable]').forEach(r => {
      const role = r.querySelector('.badge')?.textContent?.toLowerCase() || '';
      r.style.display = (!val || role === val) ? '' : 'none';
    });
  },

  _filterStatus(val) {
    document.querySelectorAll('#user-table-body tr[data-searchable]').forEach(r => {
      const status = r.querySelectorAll('.badge')[1]?.textContent?.toLowerCase() || '';
      r.style.display = (!val || status === val) ? '' : 'none';
    });
  },

  _filterCards(q, cls) {
    document.querySelectorAll('.' + cls).forEach(card => {
      card.style.display = card.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
    });
  },

  _filterStudents(q) {
    document.querySelectorAll('[data-searchable]').forEach(r => {
      r.style.display = r.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
    });
  },

  _filterTable(q, bodyId) {
    document.querySelectorAll(`#${bodyId} tr`).forEach(r => {
      r.style.display = r.textContent.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
    });
  },

  /* ── Add User ────────────────────────────────────────────── */

  async openAddUser(preRole = 'student') {
    let subjectOpts = '<option value="">— Loading subjects… —</option>';
    let sectionOpts = '<option value="">— Loading sections… —</option>';
    let classOpts   = '<option value="">— Loading classes… —</option>';

    try {
      const [subjectsRes, sectionsRes, classesRes] = await Promise.all([
        api.getSubjects(),
        api.getSections(),
        api.getClasses(),
      ]);
      const subjects = subjectsRes.items || (Array.isArray(subjectsRes) ? subjectsRes : []);
      const sections = sectionsRes.items || (Array.isArray(sectionsRes) ? sectionsRes : []);
      const classes  = classesRes.items  || (Array.isArray(classesRes)  ? classesRes  : []);
      subjectOpts = subjects.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('') || '<option value="">No subjects in DB</option>';
      sectionOpts = '<option value="">— Select Section —</option>' + sections.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
      classOpts   = '<option value="">— Skip for now —</option>'   + classes.map(c  => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
    } catch (e) {
      console.warn('Could not load dropdown data:', e.message);
      subjectOpts = '<option value="">Error loading subjects</option>';
      sectionOpts = '<option value="">Error loading sections</option>';
      classOpts   = '<option value="">Error loading classes</option>';
    }

    Modal.show('Add New User', `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Full Name *</label>
          <input class="form-control" id="f-name" placeholder="e.g. Juan dela Cruz" />
        </div>
        <div class="form-group">
          <label class="form-label">Role *</label>
          <select class="form-control" id="f-role" onchange="AdminController._toggleRoleFields()">
            <option value="teacher" ${preRole === 'teacher' ? 'selected' : ''}>Teacher</option>
            <option value="student" ${preRole === 'student' ? 'selected' : ''}>Student</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Email *</label>
          <input class="form-control" id="f-email" type="email" placeholder="user@ijla.edu" />
        </div>
        <div class="form-group">
          <label class="form-label">Password *</label>
          <div style="position:relative">
            <input class="form-control" id="f-password" type="password" placeholder="Min. 8 characters, include a number" style="padding-right:2.8rem" />
            <button type="button" onclick="(function(){var i=document.getElementById('f-password'),b=this;i.type=i.type==='password'?'text':'password';b.innerHTML=i.type==='password'?'&#128065;':'&#128064;';}).call(this)"
              style="position:absolute;right:.6rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:1.1rem;padding:.2rem;color:#888">&#128065;</button>
          </div>
        </div>
      </div>
      <!-- TEACHER FIELDS -->
      <div id="teacher-fields" style="${preRole === 'teacher' ? '' : 'display:none'}">
        <hr style="margin:8px 0;opacity:.2"/>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Employee ID</label>
            <input class="form-control" id="f-empid" placeholder="e.g. EMP-001" />
          </div>
          <div class="form-group">
            <label class="form-label">Specialization</label>
            <input class="form-control" id="f-spec" placeholder="e.g. Science & Math" />
          </div>
        </div>
        <div class="form-group" style="margin-top: 12px;">
          <label class="form-label" style="font-weight: 600;">📚 Subjects & Classes (at least one)</label>
          <div id="teacher-assignments-container">
            <div class="assignment-row" data-index="0" style="margin-bottom: 16px; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); padding: 12px;">
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Subject *</label>
                  <select class="form-control assignment-subject" data-index="0">
                    <option value="">— Select Subject —</option>
                    ${subjectOpts}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Class *</label>
                  <select class="form-control assignment-class" data-index="0">
                    <option value="">— Select Class —</option>
                    ${classOpts}
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Schedule (optional)</label>
                <input type="text" class="form-control assignment-schedule" data-index="0" placeholder="e.g. MWF 8:00-9:00 (Room 201)">
              </div>
              <button type="button" class="btn btn-xs btn-danger remove-assignment-btn" style="display: none;">✕ Remove</button>
            </div>
          </div>
          <button type="button" id="add-assignment-btn" class="btn btn-outline btn-sm" style="margin-top: 4px;">+ Add Another Subject & Class</button>
        </div>
      </div>
      <!-- STUDENT FIELDS -->
      <div id="student-fields" style="${preRole === 'student' ? '' : 'display:none'}">
        <hr style="margin:8px 0;opacity:.2"/>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">LRN (Learner Reference No.)</label>
            <input class="form-control" id="f-lrn" placeholder="12-digit LRN" maxlength="12" />
          </div>
          <div class="form-group">
            <label class="form-label">Guardian Name</label>
            <input class="form-control" id="f-guardian" placeholder="Parent / Guardian" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Guardian Contact</label>
            <input class="form-control" id="f-guardian-contact" placeholder="e.g. 09XXXXXXXXX" />
          </div>
          <div class="form-group">
            <label class="form-label">Assign Section <span style="font-size:11px;color:#888">(optional)</span></label>
            <select class="form-control" id="f-section-id">${sectionOpts}</select>
          </div>
        </div>
      </div>`,
      `<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
       <button class="btn btn-primary" id="btn-save-user" onclick="AdminController.saveNewUser()">Add User</button>`
    );

    // Dynamic assignment rows for teacher
    setTimeout(() => {
      const container = document.getElementById('teacher-assignments-container');
      const addBtn    = document.getElementById('add-assignment-btn');
      if (!container || !addBtn) return;

      const refreshRemoveButtons = () => {
        const rows = container.querySelectorAll('.assignment-row');
        rows.forEach(row => {
          const btn = row.querySelector('.remove-assignment-btn');
          if (btn) btn.style.display = rows.length === 1 ? 'none' : 'inline-block';
        });
      };

      const addRow = () => {
        const firstRow = container.querySelector('.assignment-row');
        const newRow   = firstRow.cloneNode(true);
        const newIndex = container.children.length;
        newRow.setAttribute('data-index', newIndex);
        newRow.querySelectorAll('select, input').forEach(el => {
          if (el.className.includes('assignment-subject') || el.className.includes('assignment-class')) el.value = '';
          else if (el.className.includes('assignment-schedule')) el.value = '';
          if (el.hasAttribute('data-index')) el.setAttribute('data-index', newIndex);
        });
        const removeBtn = newRow.querySelector('.remove-assignment-btn');
        if (removeBtn) removeBtn.style.display = 'inline-block';
        container.appendChild(newRow);
        refreshRemoveButtons();
      };

      container.addEventListener('click', (e) => {
        const btn = e.target.closest('.remove-assignment-btn');
        if (btn) {
          e.preventDefault();
          const row = btn.closest('.assignment-row');
          if (container.children.length > 1) { row.remove(); refreshRemoveButtons(); }
          else Toast.show('At least one assignment is required.', 'warning');
        }
      });
      addBtn.addEventListener('click', addRow);
      refreshRemoveButtons();
    }, 50);
  },

  async _loadClassesDropdown(selectId) {
    try {
      const data = await api.getClasses();
      const sel  = document.getElementById(selectId);
      if (!sel) return;
      sel.innerHTML = '<option value="">— Skip for now —</option>' +
        data.items.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
    } catch (e) { /* silent */ }
  },

  _toggleRoleFields() {
    const role = document.getElementById('f-role').value;
    document.getElementById('teacher-fields').style.display = role === 'teacher' ? '' : 'none';
    document.getElementById('student-fields').style.display = role === 'student' ? '' : 'none';
    if (role === 'teacher') AdminController._loadClassesDropdown('f-class-id');
  },

  async saveNewUser() {
    const name     = document.getElementById('f-name').value.trim();
    const email    = document.getElementById('f-email').value.trim();
    const password = document.getElementById('f-password').value.trim();
    const role     = document.getElementById('f-role').value;

    if (!Validate.required(name, 'Full name')) return;
    if (!Validate.required(email, 'Email'))     return;
    if (!Validate.email(email))                 return;
    if (!Validate.minLength(password, 8, 'Password must be at least 8 characters')) return;
    if (!/\d/.test(password)) { Toast.show('Password must contain at least one number.', 'error'); return; }

    const roleIdMap = { admin: 1, teacher: 2, student: 3 };
    const role_id   = roleIdMap[role];
    const parts      = name.split(' ');
    const first_name = parts[0];
    const last_name  = parts.slice(1).join(' ') || parts[0];

    const btn = document.getElementById('btn-save-user');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
      const newUser = await api.createUser({ email, password, first_name, last_name, role_id });
      Toast.show(`Account created (ID: ${newUser.id}). Setting up ${role} profile…`, 'info');

      if (role === 'teacher') {
        const empId = document.getElementById('f-empid').value.trim();
        const spec  = document.getElementById('f-spec').value.trim();
        const teacherProfile = await api.createTeacherProfile({
          user_id:        newUser.id,
          employee_id:    empId || null,
          specialization: spec  || null,
          contact_number: null,
        });
        const assignments = [];
        document.querySelectorAll('#teacher-assignments-container .assignment-row').forEach(row => {
          const subjectId = row.querySelector('.assignment-subject').value;
          const classId   = row.querySelector('.assignment-class').value;
          const schedule  = row.querySelector('.assignment-schedule').value.trim();
          if (subjectId && classId) assignments.push({ subjectId: parseInt(subjectId), classId: parseInt(classId), schedule: schedule || null });
        });
        if (assignments.length === 0) {
          Toast.show('Please add at least one subject & class assignment.', 'error');
          if (btn) btn.disabled = false;
          return;
        }
        for (const a of assignments) {
          await api.assignTeacherToClass({ teacher_id: teacherProfile.id, class_id: a.classId, subject_id: a.subjectId, schedule: a.schedule });
        }
        Toast.show(`${assignments.length} subject(s)/class(es) assigned.`, 'info');
      }

      if (role === 'student') {
        const lrn             = document.getElementById('f-lrn').value.trim();
        const guardian        = document.getElementById('f-guardian').value.trim();
        const guardianContact = document.getElementById('f-guardian-contact').value.trim();
        const studentProfile  = await api.createStudentProfile({
          user_id:          newUser.id,
          student_number:   lrn             || null,
          guardian_name:    guardian        || null,
          guardian_contact: guardianContact || null,
          contact_number:   null,
        });
        const sectionId = document.getElementById('f-section-id').value;
        if (sectionId) {
          await api.assignStudentToSection({ student_id: studentProfile.id, section_id: parseInt(sectionId) });
          Toast.show('Section assigned!', 'info');
        }
      }

      Modal.close();
      Toast.show(`✅ ${role.charAt(0).toUpperCase() + role.slice(1)} "${name}" added successfully!`, 'success');
      DashboardController.loadSection(DashboardController.currentSection);
    } catch (err) {
      Toast.show(`❌ Error: ${err.message}`, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Add User'; }
    }
  },

  /* ── Edit User ───────────────────────────────────────────── */

  async openEditUser(id) {
    const isLegacy = typeof id === 'string' && id.startsWith('u');
    if (isLegacy) {
      const user = userModel.getById(id);
      if (!user) return;
      Toast.show('This is a demo/seed user. Only name, email, and status can be edited here.', 'warning');
      Modal.show(`Edit User — ${escHtml(user.name)}`, `
        <div class="form-row">
          <div class="form-group"><label>Full Name</label><input class="form-control" id="e-name" value="${escHtml(user.name)}" /></div>
          <div class="form-group"><label>Email</label><input class="form-control" id="e-email" value="${escHtml(user.email)}" /></div>
        </div>
        <div class="form-group"><label>Status</label><select class="form-control" id="e-active"><option value="1" ${user.isActive ? 'selected' : ''}>Active</option><option value="0" ${!user.isActive ? 'selected' : ''}>Inactive</option></select></div>`,
        `<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button><button class="btn btn-primary" onclick="AdminController.saveEditUser('${id}')">Save Changes</button>`
      );
      return;
    }

    try {
      const user   = await api.getUser(id);
      const role   = user.role.name;
      let teacherProfile = null;
      let subjects = [], classes = [], existingAssignments = [];

      if (role === 'teacher') {
        teacherProfile = await api.getTeacherByUserId(id);
        const [subjectsRes, classesRes] = await Promise.all([api.getSubjects(), api.getClasses()]);
        subjects = subjectsRes.items || (Array.isArray(subjectsRes) ? subjectsRes : []);
        classes  = classesRes.items  || (Array.isArray(classesRes)  ? classesRes  : []);
        existingAssignments = teacherProfile?.class_assignments || [];
      }

      let extraFields = '';
      if (role === 'teacher') {
        const subjectOpts = subjects.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
        const classOpts   = classes.map(c  => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
        let assignmentsHtml = '';
        existingAssignments.forEach((ass, idx) => {
          assignmentsHtml += `
            <div class="assignment-row" data-assignment-id="${ass.id}">
              <div class="form-row">
                <div class="form-group"><label>Subject *</label><select class="form-control edit-assignment-subject" data-idx="${idx}"><option value="">— Select Subject —</option>${subjects.map(s => `<option value="${s.id}" ${s.id === ass.subject_id ? 'selected' : ''}>${escHtml(s.name)}</option>`).join('')}</select></div>
                <div class="form-group"><label>Class *</label><select class="form-control edit-assignment-class" data-idx="${idx}"><option value="">— Select Class —</option>${classes.map(c => `<option value="${c.id}" ${c.id === ass.class_id ? 'selected' : ''}>${escHtml(c.name)}</option>`).join('')}</select></div>
              </div>
              <div class="form-group"><label>Schedule (optional)</label><input type="text" class="form-control edit-assignment-schedule" value="${escHtml(ass.schedule || '')}" placeholder="e.g. MWF 8:00-9:00 (Room 201)"></div>
              <button type="button" class="btn btn-xs btn-danger remove-existing-assignment" data-id="${ass.id}">✕ Remove</button>
              <hr>
            </div>`;
        });
        if (!existingAssignments.length) {
          assignmentsHtml = `<div class="assignment-row" data-original="false"><div class="form-row"><div class="form-group"><label>Subject *</label><select class="form-control edit-assignment-subject"><option value="">— Select Subject —</option>${subjectOpts}</select></div><div class="form-group"><label>Class *</label><select class="form-control edit-assignment-class"><option value="">— Select Class —</option>${classOpts}</select></div></div><div class="form-group"><label>Schedule (optional)</label><input type="text" class="form-control edit-assignment-schedule" placeholder="e.g. MWF 8:00-9:00 (Room 201)"></div><button type="button" class="btn btn-xs btn-danger remove-assignment-btn" style="display:none;">✕ Remove</button><hr></div>`;
        }
        extraFields = `
          <hr><h4>Teacher Details</h4>
          <div class="form-row"><div class="form-group"><label>Employee ID</label><input class="form-control" id="e-empid" value="${escHtml(teacherProfile?.employee_id || '')}" /></div><div class="form-group"><label>Specialization</label><input class="form-control" id="e-spec" value="${escHtml(teacherProfile?.specialization || '')}" /></div></div>
          <div class="form-group"><label class="form-label" style="font-weight:600;">📚 Subjects & Classes</label><div id="edit-assignments-container">${assignmentsHtml}</div><button type="button" id="add-edit-assignment-btn" class="btn btn-outline btn-sm">+ Add Another Subject & Class</button></div>`;
      }

      if (role === 'student') {
        extraFields = `<hr><h4>Student Details</h4><div class="form-row"><div class="form-group"><label>LRN</label><input class="form-control" id="e-lrn" value="${escHtml(user.student_number || '')}" /></div><div class="form-group"><label>Guardian Name</label><input class="form-control" id="e-guardian" value="${escHtml(user.guardian_name || '')}" /></div></div><div class="form-row"><div class="form-group"><label>Grade Level</label><input class="form-control" id="e-grade" value="${escHtml(user.grade_level || '')}" /></div><div class="form-group"><label>Section</label><input class="form-control" id="e-section" value="${escHtml(user.section_name || '')}" /></div></div>`;
      }

      Modal.show(`Edit User — ${escHtml(user.first_name)} ${escHtml(user.last_name)}`, `
        <div class="form-group"><label>Email</label><input class="form-control" id="e-email" value="${escHtml(user.email)}" /></div>
        <div class="form-group"><label>Status</label><select class="form-control" id="e-active"><option value="1" ${user.is_active ? 'selected' : ''}>Active</option><option value="0" ${!user.is_active ? 'selected' : ''}>Inactive</option></select></div>
        <div class="form-group"><label>New Password (leave blank to keep)</label><input class="form-control" id="e-password" type="password" placeholder="Min. 8 chars + 1 number" /></div>
        <div class="form-row"><div class="form-group"><label>First Name</label><input class="form-control" id="e-fname" value="${escHtml(user.first_name)}" /></div><div class="form-group"><label>Last Name</label><input class="form-control" id="e-lname" value="${escHtml(user.last_name)}" /></div></div>
        ${extraFields}
      `, `<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button><button class="btn btn-primary" id="btn-edit-user" onclick="AdminController.saveEditUser(${id})">Save Changes</button>`);

      if (role === 'teacher') {
        setTimeout(() => {
          window._editTeacherId = teacherProfile.id;
          const container = document.getElementById('edit-assignments-container');
          if (!container) return;
          const originalIds = Array.from(container.querySelectorAll('.assignment-row[data-assignment-id]')).map(row => parseInt(row.getAttribute('data-assignment-id')));
          window._editTeacherOriginalAssignmentIds = originalIds;

          const refreshRemoveButtons = () => {
            const rows = container.querySelectorAll('.assignment-row');
            rows.forEach(row => {
              const btn = row.querySelector('.remove-existing-assignment, .remove-assignment-btn');
              if (btn) btn.style.display = rows.length === 1 ? 'none' : 'inline-block';
            });
          };
          const addRow = () => {
            const template = container.querySelector('.assignment-row');
            const newRow   = template.cloneNode(true);
            newRow.removeAttribute('data-assignment-id');
            newRow.setAttribute('data-original', 'false');
            newRow.querySelectorAll('select').forEach(sel => sel.value = '');
            newRow.querySelector('.edit-assignment-schedule').value = '';
            const removeBtn = newRow.querySelector('.remove-existing-assignment');
            if (removeBtn) { removeBtn.classList.remove('remove-existing-assignment'); removeBtn.classList.add('remove-assignment-btn'); removeBtn.removeAttribute('data-id'); }
            container.appendChild(newRow);
            refreshRemoveButtons();
          };
          container.addEventListener('click', (e) => {
            const btn = e.target.closest('.remove-existing-assignment, .remove-assignment-btn');
            if (btn) {
              e.preventDefault();
              const row = btn.closest('.assignment-row');
              if (container.children.length > 1) row.remove();
              else Toast.show('At least one assignment is required.', 'warning');
              refreshRemoveButtons();
            }
          });
          document.getElementById('add-edit-assignment-btn')?.addEventListener('click', addRow);
          refreshRemoveButtons();
        }, 50);
      }
    } catch (err) {
      Toast.show(`Could not load user: ${err.message}`, 'error');
    }
  },

  openEditTeacher(id) { this.openEditUser(id); },

  async saveEditUser(id) {
    const isLegacy = typeof id === 'string' && id.startsWith('u');
    if (isLegacy) {
      const user    = userModel.getById(id);
      if (!user) return;
      const updates = {
        name:     document.getElementById('e-name').value.trim(),
        email:    document.getElementById('e-email').value.trim(),
        isActive: document.getElementById('e-active').value === '1',
      };
      if (!Validate.required(updates.name, 'Name'))  return;
      if (!Validate.required(updates.email, 'Email')) return;
      if (!Validate.email(updates.email))             return;
      userModel.update(id, updates);
      Modal.close();
      Toast.show('User updated.', 'success');
      DashboardController.loadSection(DashboardController.currentSection);
      return;
    }

    const email    = document.getElementById('e-email').value.trim();
    const isActive = document.getElementById('e-active').value === '1';
    const password = document.getElementById('e-password')?.value.trim() || '';
    const fname    = document.getElementById('e-fname')?.value.trim() || null;
    const lname    = document.getElementById('e-lname')?.value.trim() || null;
    if (!Validate.email(email)) return;
    if (password && (password.length < 8 || !/\d/.test(password))) {
      Toast.show('Password must be at least 8 characters and contain a number.', 'error');
      return;
    }
    const updates = { email, is_active: isActive };
    if (fname) updates.first_name = fname;
    if (lname) updates.last_name  = lname;
    if (password) updates.password = password;

    const btn = document.getElementById('btn-edit-user');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    try {
      await api.updateUser(id, updates);
      Toast.show('User details updated.', 'info');

      if (window._editTeacherId) {
        const teacherId = window._editTeacherId;
        const empId = document.getElementById('e-empid')?.value.trim() || null;
        const spec  = document.getElementById('e-spec')?.value.trim()  || null;
        if (empId !== undefined || spec !== undefined) {
          const profileUpdates = {};
          if (empId !== undefined) profileUpdates.employee_id    = empId;
          if (spec  !== undefined) profileUpdates.specialization = spec;
          await api.updateTeacherProfile(teacherId, profileUpdates);
          Toast.show('Teacher profile updated.', 'info');
        }
        const container = document.getElementById('edit-assignments-container');
        if (container) {
          const rows = container.querySelectorAll('.assignment-row');
          const currentAssignmentIds = [];
          const originalIds = window._editTeacherOriginalAssignmentIds || [];
          for (const row of rows) {
            const subjectSelect = row.querySelector('.edit-assignment-subject');
            const classSelect   = row.querySelector('.edit-assignment-class');
            const scheduleInput = row.querySelector('.edit-assignment-schedule');
            if (!subjectSelect || !classSelect) continue;
            const subjectId    = subjectSelect.value;
            const classId      = classSelect.value;
            const schedule     = scheduleInput?.value.trim() || '';
            if (!subjectId || !classId) {
              Toast.show('Each assignment must have a subject and a class.', 'error');
              if (btn) btn.disabled = false;
              return;
            }
            const assignmentId = row.getAttribute('data-assignment-id');
            if (assignmentId) {
              currentAssignmentIds.push(parseInt(assignmentId));
              await api.updateTeacherAssignment(assignmentId, { class_id: parseInt(classId), subject_id: parseInt(subjectId), schedule: schedule || null });
            } else {
              await api.assignTeacherToClass({ teacher_id: teacherId, class_id: parseInt(classId), subject_id: parseInt(subjectId), schedule: schedule || null });
            }
          }
          const toDelete = originalIds.filter(id => !currentAssignmentIds.includes(id));
          for (const delId of toDelete) await api.deleteTeacherAssignment(delId);
          if (toDelete.length) Toast.show(`${toDelete.length} assignment(s) removed.`, 'info');
        }
        delete window._editTeacherId;
        delete window._editTeacherOriginalAssignmentIds;
      }
      Modal.close();
      Toast.show('✅ User updated successfully!', 'success');
      DashboardController.loadSection(DashboardController.currentSection);
    } catch (err) {
      console.error('Save error:', err);
      Toast.show(`❌ Error: ${err.message}`, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
    }
  },

  /* ── Delete User ─────────────────────────────────────────── */

  async deleteUser(id) {
    const isLegacy = typeof id === 'string' && id.startsWith('u');
    const label    = isLegacy ? (userModel.getById(id)?.name || id) : `User #${id}`;
    if (!confirm(`Deactivate "${label}"?\n\nThis disables their login but keeps all records.`)) return;
    if (isLegacy) {
      userModel.softDelete(id);
      Toast.show(`"${label}" has been deactivated.`, 'info');
      DashboardController.loadSection(DashboardController.currentSection);
      return;
    }
    try {
      await api.deleteUser(id);
      Toast.show(`✅ User deactivated.`, 'info');
      DashboardController.loadSection(DashboardController.currentSection);
    } catch (err) {
      Toast.show(`❌ Error: ${err.message}`, 'error');
    }
  },

  /* ── Section CRUD ────────────────────────────────────────── */

  async openAddSection() {
    let classOpts = '<option value="">Loading classes…</option>';
    try {
      const classesRes = await api.getClasses();
      const classes    = classesRes.items || (Array.isArray(classesRes) ? classesRes : []);
      classOpts = classes.map(c => `<option value="${c.id}">${escHtml(c.name)} (${escHtml(c.grade_level || '')})</option>`).join('') || '<option value="">No classes available</option>';
    } catch (e) {
      classOpts = '<option value="">Error loading classes</option>';
    }
    Modal.show('Add Section', `
      <div class="form-group">
        <label class="form-label">Section Name *</label>
        <input class="form-control" id="new-section-name" placeholder="e.g. Section A" />
      </div>
      <div class="form-group">
        <label class="form-label">Class *</label>
        <select class="form-control" id="new-section-class">${classOpts}</select>
      </div>`,
      `<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
       <button class="btn btn-primary" onclick="AdminController.saveNewSection()">Add Section</button>`
    );
  },

  async saveNewSection() {
    const name    = document.getElementById('new-section-name').value.trim();
    const classId = document.getElementById('new-section-class').value;
    if (!name)    { Toast.show('Section name is required.', 'error'); return; }
    if (!classId) { Toast.show('Please select a class.', 'error'); return; }
    const btn = document.querySelector('#modal-container .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      await api.createSection({ name, class_id: parseInt(classId) });
      Modal.close();
      Toast.show('Section created successfully!', 'success');
      DashboardController.loadSection('manage-users');
    } catch (err) {
      Toast.show(`Error: ${err.message}`, 'error');
      if (btn) btn.disabled = false;
    }
  },

  async openEditSection(id) {
    try {
      const section    = await api.getSection(id);
      const classesRes = await api.getClasses();
      const classes    = classesRes.items || (Array.isArray(classesRes) ? classesRes : []);
      const classOpts  = classes.map(c => `<option value="${c.id}" ${c.id === section.class_id ? 'selected' : ''}>${escHtml(c.name)} (${escHtml(c.grade_level || '')})</option>`).join('');
      Modal.show('Edit Section', `
        <div class="form-group">
          <label class="form-label">Section Name *</label>
          <input class="form-control" id="edit-section-name" value="${escHtml(section.name)}" />
        </div>
        <div class="form-group">
          <label class="form-label">Class *</label>
          <select class="form-control" id="edit-section-class">${classOpts}</select>
        </div>`,
        `<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
         <button class="btn btn-primary" onclick="AdminController.saveEditSection(${id})">Save Changes</button>`
      );
    } catch (err) {
      Toast.show(`Could not load section: ${err.message}`, 'error');
    }
  },

  async saveEditSection(id) {
    const name    = document.getElementById('edit-section-name').value.trim();
    const classId = document.getElementById('edit-section-class').value;
    if (!name)    { Toast.show('Section name is required.', 'error'); return; }
    if (!classId) { Toast.show('Please select a class.', 'error'); return; }
    const btn = document.querySelector('#modal-container .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      await api.updateSection(id, { name, class_id: parseInt(classId) });
      Modal.close();
      Toast.show('Section updated!', 'success');
      DashboardController.loadSection('manage-users');
    } catch (err) {
      Toast.show(`Error: ${err.message}`, 'error');
      if (btn) btn.disabled = false;
    }
  },

  async deleteSection(id) {
    if (!confirm('Delete this section? Students will remain but lose section assignment.')) return;
    try {
      await api.deleteSection(id);
      Toast.show('Section deleted.', 'info');
      DashboardController.loadSection('manage-users');
    } catch (err) {
      Toast.show(`Error: ${err.message}`, 'error');
    }
  },

  /* ── Student Subject Enrollment ──────────────────────────── */

  async openEnrollSubjects(studentId, studentName) {
    const existing = document.getElementById('enroll-subjects-modal');
    if (existing) existing.remove();
    const loadingModal = document.createElement('div');
    loadingModal.id = 'enroll-subjects-modal';
    loadingModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    loadingModal.innerHTML = `<div style="background:#fff;border-radius:12px;padding:32px;min-width:320px;text-align:center;"><div style="font-size:24px;margin-bottom:8px">📚</div><p style="color:#888">Loading subjects…</p></div>`;
    document.body.appendChild(loadingModal);
    try {
      const [allSubjects, enrolled] = await Promise.all([
        api.getSubjects(),
        api.getStudentSubjectEnrollments(studentId).catch(() => []),
      ]);
      const enrolledIds = new Set(enrolled.map(e => e.subject_id));
      const checkboxes  = allSubjects.map(s =>
        `<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0f0f0;cursor:pointer;">
           <input type="checkbox" id="enroll-subj-${s.id}" value="${s.id}" ${enrolledIds.has(s.id) ? 'checked' : ''} style="width:16px;height:16px;accent-color:#8b1a2e;cursor:pointer;" />
           <span style="font-weight:500">${escHtml(s.name)}</span>
           ${s.description ? `<span style="color:#888;font-size:12px;margin-left:auto">${escHtml(s.description)}</span>` : ''}
         </label>`
      ).join('');
      loadingModal.innerHTML = `<div style="background:#fff;border-radius:12px;padding:28px;width:520px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <div><h3 style="margin:0;color:#1a1a2e">📚 Enroll in Subjects</h3><p style="margin:4px 0 0;color:#888;font-size:13px">${escHtml(studentName)}</p></div>
          <button onclick="document.getElementById('enroll-subjects-modal').remove()" style="border:none;background:none;font-size:20px;cursor:pointer;color:#888;line-height:1;">✕</button>
        </div>
        ${allSubjects.length === 0
          ? `<p style="color:#888;text-align:center;padding:24px 0">No subjects found. Create subjects first.</p>`
          : `<div style="flex:1;overflow-y:auto;padding-right:4px;">${checkboxes}</div>
             <div style="margin-top:16px;padding-top:16px;border-top:1px solid #eee;display:flex;gap:10px;justify-content:flex-end;">
               <button class="btn btn-outline" onclick="document.getElementById('enroll-subjects-modal').remove()">Cancel</button>
               <button class="btn btn-primary" onclick="AdminController.saveEnrollSubjects(${studentId})">💾 Save Enrollment</button>
             </div>`}
      </div>`;
    } catch (err) {
      loadingModal.remove();
      Toast.show('Failed to load subjects: ' + err.message, 'error');
    }
  },

  async saveEnrollSubjects(studentId) {
    const checkboxes = document.querySelectorAll('#enroll-subjects-modal input[type="checkbox"]');
    const subjectIds = [...checkboxes].filter(c => c.checked).map(c => parseInt(c.value));
    const btn = document.querySelector('#enroll-subjects-modal .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const result = await api.enrollStudentSubjects(studentId, subjectIds);
      document.getElementById('enroll-subjects-modal').remove();
      Toast.show(result.message || 'Enrollment saved successfully!', 'success');
      DashboardController.loadSection(DashboardController.currentSection);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Save Enrollment'; }
      Toast.show('Failed to save enrollment: ' + err.message, 'error');
    }
  },

  /* ── Legacy stubs (kept for compatibility) ───────────────── */
  viewStudentProfile(id)      { /* legacy */ },
  openAssignSchedule(tid)     { /* legacy */ },
  saveSchedule(tid)           { /* legacy */ },
  deleteSchedule(sid, tid)    { /* legacy */ },
  viewSectionSchedule(secId)  { /* legacy */ },
  exportCSV(type)             { /* legacy */ },
  openImportCSV()             { /* legacy */ },
  processImportCSV()          { /* legacy */ },
  clearAuditLog()             { /* legacy */ },
  saveSettings()              { /* legacy */ },
  changePassword()            { /* legacy */ },
  _filterBySection(secId)     { /* legacy */ },

  // ── Announcement modal ────────────────────────────────────────────────────
  openAnnouncement() {
    const modal = document.getElementById('announcement-modal');
    if (modal) modal.style.display = 'flex';
  },

  closeAnnouncement() {
    const modal = document.getElementById('announcement-modal');
    if (modal) modal.style.display = 'none';
  },

  async sendAnnouncement() {
    const title  = document.getElementById('announce-title')?.value.trim();
    const msg    = document.getElementById('announce-msg')?.value.trim();
    const target = document.getElementById('announce-target')?.value || 'all';
    if (!title || !msg) {
      Toast.show('Please fill in both title and message.', 'error');
      return;
    }
    try {
      const result = await api.sendAnnouncement(title, msg, target);
      Toast.show(`📢 Announcement sent to ${result.sent_to} user(s).`, 'success');
      this.closeAnnouncement();
      document.getElementById('announce-title').value = '';
      document.getElementById('announce-msg').value   = '';
    } catch (err) {
      Toast.show('Failed to send announcement: ' + err.message, 'error');
    }
  },
};