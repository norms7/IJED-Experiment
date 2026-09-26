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
    ['all', 'teachers', 'students', 'sections', 'transfer', 'audit'].forEach(t => {
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

  async loadAuditLog() {
    const pane = document.getElementById('um-pane-audit');
    if (!pane) return;
    pane.innerHTML = AdminView._auditPane(null);
    try {
      const logs = await api.getAuditLogs(100);
      pane.innerHTML = AdminView._auditPane(logs);
    } catch (err) {
      pane.innerHTML = `<div class="empty-state"><div class="empty-state-icon">${ADMIN_ICONS.warning}</div><div class="empty-state-title">Could not load audit history</div><div class="empty-state-sub">${escHtml(err.message)}</div><button class="btn btn-primary mt-3" onclick="AdminController.loadAuditLog()">Retry</button></div>`;
    }
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
          <label class="form-label" style="font-weight: 600;">${ADMIN_ICONS.book} Subjects & Classes (at least one)</label>
          <div id="teacher-assignments-container">
            <div class="assignment-row" data-index="0" style="margin-bottom: 16px; border: 1px solid var(--gray-200); border-radius: var(--radius-sm); padding: 12px;">
              <div class="form-row">
                <div class="form-group">
                  <label class="form-label">Subject *</label>
                  <select class="form-control assignment-subject" data-index="0">
                    <option value="">— Select Section First —</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Section *</label>
                  <select class="form-control assignment-class" data-index="0">
                    <option value="">— Select Section —</option>
                    ${sectionOpts.replace('<option value="">— Select Section —</option>', '')}
                  </select>
                </div>
              </div>
              <div class="form-row schedule-row">
                <div class="form-group">
                  <label class="form-label">Days</label>
                  <select class="form-control assignment-days">
                    <option value="">— Days —</option>
                    <option>MWF</option>
                    <option>TTh</option>
                    <option>MTuWThF</option>
                    <option>MTuTh</option>
                    <option>WThF</option>
                    <option>Sat</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Time</label>
                  <select class="form-control assignment-time">
                    <option value="">— Time —</option>
                    <option>7:00-8:00 AM</option>
                    <option>8:00-9:00 AM</option>
                    <option>9:00-10:00 AM</option>
                    <option>10:00-11:00 AM</option>
                    <option>11:00 AM-12:00 PM</option>
                    <option>12:00-1:00 PM</option>
                    <option>1:00-2:00 PM</option>
                    <option>2:00-3:00 PM</option>
                    <option>3:00-4:00 PM</option>
                    <option>4:00-5:00 PM</option>
                    <option>5:00-6:00 PM</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Room</label>
                  <select class="form-control assignment-room">
                    <option value="">— Room —</option>
                    <option>Room 101</option>
                    <option>Room 102</option>
                    <option>Room 103</option>
                    <option>Room 104</option>
                    <option>Room 201</option>
                    <option>Room 202</option>
                    <option>Room 203</option>
                    <option>Room 204</option>
                    <option>ICT Lab 1</option>
                    <option>ICT Lab 2</option>
                    <option>ICT Lab 3</option>
                    <option>Science Lab</option>
                    <option>AVR</option>
                    <option>Library</option>
                    <option>Online / Virtual</option>
                  </select>
                </div>
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
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Grade Level</label>
            <select class="form-control" id="f-grade-level" onchange="AdminController._filterSections()">
              <option value="">— Select Grade —</option>
              <option value="11">Grade 11</option>
              <option value="12">Grade 12</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Semester</label>
            <select class="form-control" id="f-semester">
              <option value="">— Select Semester —</option>
              <option value="1">1st Semester</option>
              <option value="2">2nd Semester</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Strand</label>
            <select class="form-control" id="f-strand" onchange="AdminController._filterSections()">
              <option value="">— Select Strand —</option>
              <option value="ICT">ICT</option>
              <option value="ABM">ABM</option>
              <option value="HUMSS">HUMSS</option>
              <option value="STEM">STEM</option>
              <option value="GAS">GAS</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Assign Section <span style="font-size:11px;color:#888">(optional)</span></label>
            <select class="form-control" id="f-section-id">
              <option value="">— Select Strand & Grade First —</option>
            </select>
          </div>
        </div>
      </div>`,
      `<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
       <button class="btn btn-primary" id="btn-save-user" onclick="AdminController.saveNewUser()">Add User</button>`,
      { closeOnBackdrop: false }
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
        newRow.querySelectorAll('select').forEach(el => { el.value = ''; });
        newRow.querySelector('.assignment-subject').innerHTML = '<option value="">— Select Section First —</option>';
        const removeBtn = newRow.querySelector('.remove-assignment-btn');
        if (removeBtn) removeBtn.style.display = 'inline-block';
        container.appendChild(newRow);
        refreshRemoveButtons();
      };

      // Filter subjects by strand+grade when section changes
      const _filterSubjects = async (classSelect, subjectSelect) => {
        const opt = classSelect.options[classSelect.selectedIndex];
        const sectionName = opt ? opt.text : '';
        const strand = sectionName.replace(/\d.*/, '').toUpperCase();
        const gradeMatch = sectionName.match(/(\d{2})/);
        const grade = gradeMatch ? gradeMatch[1] : null;
        const allSubjects = await api.getSubjects();
        const filtered = allSubjects.filter(s => {
          if (!grade || !strand) return true;
          const n = s.name.toUpperCase();
          return n.includes(strand + ' G' + grade) || n.includes('G' + grade + ' CORE');
        });
        subjectSelect.innerHTML = '<option value="">— Select Subject —</option>' +
          filtered.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
      };

      container.addEventListener('change', (e) => {
        if (e.target.classList.contains('assignment-class')) {
          const row = e.target.closest('.assignment-row');
          _filterSubjects(e.target, row.querySelector('.assignment-subject'));
        }
      });

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
      const classes = Array.isArray(data) ? data : (data.items || []);
      sel.innerHTML = '<option value="">— Skip for now —</option>' +
        classes.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
    } catch (e) { /* silent */ }
  },

  // Filter sections by strand + grade for student assignment
  async _filterSections() {
    const strand = (document.getElementById('f-strand')?.value || '').toUpperCase();
    const grade  = document.getElementById('f-grade-level')?.value || '';
    const secSel = document.getElementById('f-section-id');
    if (!secSel) return;

    if (!strand || !grade) {
      secSel.innerHTML = '<option value="">— Select Strand & Grade First —</option>';
      return;
    }

    secSel.innerHTML = '<option value="">Loading…</option>';

    try {
      // Query DB directly — filter by grade_level column, then filter by strand prefix
      const gradeLabel = grade === '11' ? 'Grade 11' : 'Grade 12';
      const { data, error } = await api.sb
        .from('classes')
        .select('id, name, grade_level')
        .eq('is_active', true)
        .eq('grade_level', gradeLabel);

      if (error) throw new Error(error.message);

      const matched = (data || []).filter(c => c.name.toUpperCase().startsWith(strand));

      if (!matched.length) {
        secSel.innerHTML = `<option value="">No ${strand} sections for Grade ${grade} found</option>`;
        return;
      }

      secSel.innerHTML = '<option value="">— Select Section —</option>' +
        matched.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
    } catch (err) {
      console.error('_filterSections error:', err);
      secSel.innerHTML = '<option value="">Error loading sections</option>';
    }
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
          const sectionId = row.querySelector('.assignment-class').value;
          const days      = row.querySelector('.assignment-days')?.value || '';
          const time      = row.querySelector('.assignment-time')?.value || '';
          const room      = row.querySelector('.assignment-room')?.value || '';
          const schedule  = [days, time, room ? `(${room})` : ''].filter(Boolean).join(' ') || null;
          if (subjectId && sectionId) assignments.push({ subjectId: parseInt(subjectId), sectionId: parseInt(sectionId), schedule });
        });
        if (assignments.length === 0) {
          Toast.show('Please add at least one subject & section assignment.', 'error');
          if (btn) btn.disabled = false;
          return;
        }
        for (const a of assignments) {
          const { data: secRow } = await api.sb.from('sections').select('class_id').eq('id', a.sectionId).single();
          await api.assignTeacherToClass({ teacher_id: teacherProfile.id, class_id: secRow.class_id, section_id: a.sectionId, subject_id: a.subjectId, schedule: a.schedule });
        }
        Toast.show(`${assignments.length} subject(s)/section(s) assigned.`, 'info');
      }

      if (role === 'student') {
        const lrn             = document.getElementById('f-lrn').value.trim();
        const guardian        = document.getElementById('f-guardian').value.trim();
        const guardianContact = document.getElementById('f-guardian-contact').value.trim();
        const strand          = (document.getElementById('f-strand')?.value || '').toUpperCase();
        const grade           = document.getElementById('f-grade-level')?.value || '';
        const semesterNum     = parseInt(document.getElementById('f-semester')?.value || '0');
        // Subjects store semester as '1st'/'2nd' strings, not the form's
        // raw 1/2 -- comparing the two directly (as this used to) meant
        // matchSem was always false whenever a semester was actually
        // selected, so this auto-enroll step silently enrolled nobody.
        const semester         = semesterNum === 1 ? '1st' : semesterNum === 2 ? '2nd' : '';
        const classId         = document.getElementById('f-section-id').value;

        const studentProfile  = await api.createStudentProfile({
          user_id:          newUser.id,
          student_number:   lrn             || null,
          guardian_name:    guardian        || null,
          guardian_contact: guardianContact || null,
          contact_number:   null,
        });

        if (classId) {
          // Find or create a section under the selected class
          let { data: existingSections } = await api.sb.from('sections')
            .select('id').eq('class_id', parseInt(classId)).limit(1);
          let sectionId;
          if (existingSections && existingSections.length > 0) {
            sectionId = existingSections[0].id;
          } else {
            // Auto-create a default section for this class
            const className = document.getElementById('f-section-id')
              .options[document.getElementById('f-section-id').selectedIndex]?.text || 'Main';
            const { data: newSection } = await api.sb.from('sections')
              .insert({ name: className, class_id: parseInt(classId) })
              .select('id').single();
            sectionId = newSection?.id;
          }
          if (sectionId) {
            await api.assignStudentToSection({ student_id: studentProfile.id, section_id: sectionId });
            Toast.show('Section assigned!', 'info');
          }

          // Auto-enroll in strand + core subjects for their grade AND semester
          if (strand && grade) {
            const allSubjects = await api.getSubjects();
            const strandSubjects = allSubjects.filter(s => {
              const n = s.name.toUpperCase();
              const matchStrand = n.includes(strand + ' G' + grade);
              const matchCore   = n.includes('G' + grade + ' CORE');
              const matchSem    = !semester || s.semester === semester;
              return (matchStrand || matchCore) && matchSem;
            });
            if (strandSubjects.length > 0) {
              await api.enrollStudentSubjects(studentProfile.id, strandSubjects.map(s => s.id));
              const semLabel = semester || '';
              Toast.show(`Enrolled in ${strandSubjects.length} subject(s) for ${strand} Grade ${grade}${semLabel ? ' ' + semLabel + ' Sem' : ''}.`, 'info');
            }
          }
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
    try {
      const user   = await api.getUser(id);
      const role   = user.role.name;
      window._editUserRole = role;
      let teacherProfile = null;
      let subjects = [], classes = [], sections = [], existingAssignments = [];

      if (role === 'teacher') {
        teacherProfile = await api.getTeacherByUserId(id);
        const [subjectsRes, classesRes, sectionsRes] = await Promise.all([api.getSubjects(), api.getClasses(), api.getSections()]);
        subjects = subjectsRes.items || (Array.isArray(subjectsRes) ? subjectsRes : []);
        classes  = classesRes.items  || (Array.isArray(classesRes)  ? classesRes  : []);
        sections = sectionsRes.items || (Array.isArray(sectionsRes) ? sectionsRes : []);
        existingAssignments = teacherProfile?.class_assignments || [];
      }

      let extraFields = '';
      if (role === 'teacher') {
        const subjectOpts = subjects.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
        const sectionOpts = sections.map(sec => `<option value="${sec.id}">${escHtml(sec.name)}</option>`).join('');
        let assignmentsHtml = '';
        existingAssignments.forEach((ass, idx) => {
          assignmentsHtml += `
            <div class="assignment-row" data-assignment-id="${ass.id}">
              <div class="form-row">
                <div class="form-group"><label>Subject *</label><select class="form-control edit-assignment-subject" data-idx="${idx}"><option value="">— Select Subject —</option>${subjects.map(s => `<option value="${s.id}" ${s.id === ass.subject_id ? 'selected' : ''}>${escHtml(s.name)}</option>`).join('')}</select></div>
                <div class="form-group"><label>Section *</label><select class="form-control edit-assignment-class" data-idx="${idx}"><option value="">— Select Section —</option>${sections.map(sec => `<option value="${sec.id}" ${sec.id === ass.section_id ? 'selected' : ''}>${escHtml(sec.name)}</option>`).join('')}</select></div>
              </div>
              <div class="form-group"><label>Schedule (optional)</label><input type="text" class="form-control edit-assignment-schedule" value="${escHtml(ass.schedule || '')}" placeholder="e.g. MWF 8:00-9:00 (Room 201)"></div>
              <button type="button" class="btn btn-xs btn-danger remove-existing-assignment" data-id="${ass.id}">✕ Remove</button>
              <hr>
            </div>`;
        });
        if (!existingAssignments.length) {
          assignmentsHtml = `<div class="assignment-row" data-original="false"><div class="form-row"><div class="form-group"><label>Subject *</label><select class="form-control edit-assignment-subject"><option value="">— Select Subject —</option>${subjectOpts}</select></div><div class="form-group"><label>Section *</label><select class="form-control edit-assignment-class"><option value="">— Select Section —</option>${sectionOpts}</select></div></div><div class="form-group"><label>Schedule (optional)</label><input type="text" class="form-control edit-assignment-schedule" placeholder="e.g. MWF 8:00-9:00 (Room 201)"></div><button type="button" class="btn btn-xs btn-danger remove-assignment-btn" style="display:none;">✕ Remove</button><hr></div>`;
        }
        extraFields = `
          <hr><h4>Teacher Details</h4>
          <div class="form-row"><div class="form-group"><label>Employee ID</label><input class="form-control" id="e-empid" value="${escHtml(teacherProfile?.employee_id || '')}" /></div><div class="form-group"><label>Specialization</label><input class="form-control" id="e-spec" value="${escHtml(teacherProfile?.specialization || '')}" /></div></div>
          <div class="form-group"><label class="form-label" style="font-weight:600;">${ADMIN_ICONS.book} Subjects & Classes</label><div id="edit-assignments-container">${assignmentsHtml}</div><button type="button" id="add-edit-assignment-btn" class="btn btn-outline btn-sm">${ADMIN_ICONS.plus} Add Another Subject & Class</button></div>`;
      }

      if (role === 'student') {
        const studentProfile = user.student_profile || {};
        extraFields = `<hr><h4>Student Details</h4><div class="form-row"><div class="form-group"><label>LRN</label><input class="form-control" id="e-lrn" value="${escHtml(studentProfile.student_number || '')}" /></div><div class="form-group"><label>Guardian Name</label><input class="form-control" id="e-guardian" value="${escHtml(studentProfile.guardian_name || '')}" /></div></div><div class="form-row"><div class="form-group"><label>Guardian Contact</label><input class="form-control" id="e-guardian-contact" value="${escHtml(studentProfile.guardian_contact || '')}" /></div><div class="form-group"><label>Contact Number</label><input class="form-control" id="e-contact" value="${escHtml(studentProfile.contact_number || '')}" /></div></div>`;
      }

      Modal.show(`Edit User — ${escHtml(user.first_name)} ${escHtml(user.last_name)}`, `
        <div class="form-group"><label>Email</label><input class="form-control" id="e-email" value="${escHtml(user.email)}" /></div>
        <div class="form-group"><label>Status</label><select class="form-control" id="e-active"><option value="1" ${user.is_active ? 'selected' : ''}>Active</option><option value="0" ${!user.is_active ? 'selected' : ''}>Inactive</option></select></div>
        <div class="form-group"><label>New Password (leave blank to keep)</label><input class="form-control" id="e-password" type="password" placeholder="Min. 8 chars + 1 number" /></div>
        <div class="form-row"><div class="form-group"><label>First Name</label><input class="form-control" id="e-fname" value="${escHtml(user.first_name)}" /></div><div class="form-group"><label>Last Name</label><input class="form-control" id="e-lname" value="${escHtml(user.last_name)}" /></div></div>
        ${extraFields}
      `, `<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button><button class="btn btn-primary" id="btn-edit-user" onclick="AdminController.saveEditUser(${id})">Save Changes</button>`,
        { closeOnBackdrop: false });

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
            const sectionId    = classSelect.value;
            const schedule     = scheduleInput?.value.trim() || '';
            if (!subjectId || !sectionId) {
              Toast.show('Each assignment must have a subject and a section.', 'error');
              if (btn) btn.disabled = false;
              return;
            }
            const { data: secRow } = await api.sb.from('sections').select('class_id').eq('id', parseInt(sectionId)).single();
            const assignmentId = row.getAttribute('data-assignment-id');
            if (assignmentId) {
              currentAssignmentIds.push(parseInt(assignmentId));
              await api.updateTeacherAssignment(assignmentId, { class_id: secRow.class_id, section_id: parseInt(sectionId), subject_id: parseInt(subjectId), schedule: schedule || null });
            } else {
              await api.assignTeacherToClass({ teacher_id: teacherId, class_id: secRow.class_id, section_id: parseInt(sectionId), subject_id: parseInt(subjectId), schedule: schedule || null });
            }
          }
          const toDelete = originalIds.filter(id => !currentAssignmentIds.includes(id));
          for (const delId of toDelete) await api.deleteTeacherAssignment(delId);
          if (toDelete.length) Toast.show(`${toDelete.length} assignment(s) removed.`, 'info');
        }
        delete window._editTeacherId;
        delete window._editTeacherOriginalAssignmentIds;
      }
      if (window._editUserRole === 'student' && user.student_profile) {
        await api.updateStudentProfile(user.student_profile.id, {
          student_number: document.getElementById('e-lrn')?.value.trim() || null,
          guardian_name: document.getElementById('e-guardian')?.value.trim() || null,
          guardian_contact: document.getElementById('e-guardian-contact')?.value.trim() || null,
          contact_number: document.getElementById('e-contact')?.value.trim() || null,
        });
      }
      Modal.close();
      delete window._editUserRole;
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
    if (!confirm(`Deactivate "User #${id}"?\n\nThis disables their login but keeps all records.`)) return;
    try {
      await api.deleteUser(id);
      Toast.show(`✅ User deactivated.`, 'info');
      DashboardController.loadSection(DashboardController.currentSection);
    } catch (err) {
      Toast.show(`❌ Error: ${err.message}`, 'error');
    }
  },

  /* ── Transfer / Promote Students ─────────────────────────── */

  async onTransferFromSectionChange(sectionId) {
    const wrap = document.getElementById('transfer-roster-wrap');
    if (!wrap) return;
    if (!sectionId) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = '<div class="text-center" style="padding:20px;color:var(--gray-400)">Loading students…</div>';
    try {
      const students = await api.getSectionStudents(parseInt(sectionId));
      this._transferFromStudents = students; // keep for confirmation summary
      wrap.innerHTML = AdminView._transferRoster(students);
    } catch (err) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-state-title">Failed to load students</div><div class="empty-state-sub">${escHtml(err.message)}</div></div>`;
    }
  },

  _toggleAllTransferStudents(checked) {
    document.querySelectorAll('.transfer-student-cb').forEach(cb => { cb.checked = checked; });
    this._updateTransferCount();
  },

  _updateTransferCount() {
    const total   = document.querySelectorAll('.transfer-student-cb').length;
    const checked = document.querySelectorAll('.transfer-student-cb:checked').length;
    const countEl = document.getElementById('transfer-selected-count');
    if (countEl) countEl.textContent = `${checked} selected`;
    const allBox = document.getElementById('transfer-select-all');
    if (allBox) allBox.checked = checked === total && total > 0;
  },

  async confirmTransfer() {
    const fromSel = document.getElementById('transfer-from-section');
    const toSel   = document.getElementById('transfer-to-section');
    const fromId  = parseInt(fromSel?.value);
    const toId    = parseInt(toSel?.value);
    const studentIds = [...document.querySelectorAll('.transfer-student-cb:checked')].map(cb => parseInt(cb.value));

    if (!fromId)  { Toast.show('Pick a "From Section" first.', 'error'); return; }
    if (!toId)    { Toast.show('Pick a "To Section" to transfer into.', 'error'); return; }
    if (fromId === toId) { Toast.show('"From" and "To" section must be different.', 'error'); return; }
    if (!studentIds.length) { Toast.show('Select at least one student to transfer.', 'error'); return; }

    const fromName = fromSel.options[fromSel.selectedIndex].text;
    const toName   = toSel.options[toSel.selectedIndex].text;

    if (!confirm(
      `Transfer ${studentIds.length} student(s) from "${fromName}" to "${toName}"?\n\n` +
      `Their section and subjects will move to "${toName}". ` +
      `All existing grades and attendance from "${fromName}" stay exactly as they are — this only changes what they're currently enrolled in.`
    )) return;

    try {
      const result = await api.transferStudents({ studentIds, fromSectionId: fromId, toSectionId: toId });
      Toast.show(
        `✅ Transferred ${result.students_selected} student(s) to "${toName}" ` +
        `(${result.subjects_added} subject enrollment(s) added).`,
        'info'
      );
      // Refresh the roster so transferred students drop off the From-section list
      this.onTransferFromSectionChange(fromId);
    } catch (err) {
      Toast.show(`❌ Transfer failed: ${err.message}`, 'error');
    }
  },

  /* ── Section CRUD ────────────────────────────────────────── */

  _gradeLevelOpts(selected = '') {
    return ['11', '12']
      .map(g => `<option value="${g}" ${String(selected) === g ? 'selected' : ''}>Grade ${g}</option>`)
      .join('');
  },

  async _teacherOpts(selectedId = '') {
    const teachersRes = await api.getTeachers();
    const teachers    = teachersRes.items || (Array.isArray(teachersRes) ? teachersRes : []);
    const opts = teachers.map(t =>
      `<option value="${t.id}" ${t.id === selectedId ? 'selected' : ''}>${escHtml(t.user.first_name)} ${escHtml(t.user.last_name)}</option>`
    ).join('');
    return '<option value="">— No adviser assigned —</option>' + opts;
  },

  async openAddSection() {
    let teacherOpts = '<option value="">Loading teachers…</option>';
    try {
      teacherOpts = await this._teacherOpts();
    } catch (e) {
      teacherOpts = '<option value="">Error loading teachers</option>';
    }
    Modal.show('Add Section', `
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Section Name *</label>
          <input class="form-control" id="new-section-name" placeholder="e.g. ICT1101" />
        </div>
        <div class="form-group">
          <label class="form-label">Grade Level *</label>
          <select class="form-control" id="new-section-grade"><option value="">— Select —</option>${this._gradeLevelOpts()}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Room</label>
          <input class="form-control" id="new-section-room" placeholder="e.g. ICT Lab 1" />
        </div>
        <div class="form-group">
          <label class="form-label">School Year</label>
          <input class="form-control" id="new-section-year" placeholder="e.g. 2026-2027" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Adviser</label>
        <select class="form-control" id="new-section-adviser">${teacherOpts}</select>
      </div>`,
      `<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
       <button class="btn btn-primary" onclick="AdminController.saveNewSection()">Add Section</button>`
    );
  },

  async saveNewSection() {
    const name       = document.getElementById('new-section-name').value.trim();
    const gradeLevel = document.getElementById('new-section-grade').value;
    const room       = document.getElementById('new-section-room').value.trim();
    const schoolYear = document.getElementById('new-section-year').value.trim();
    const adviserId  = document.getElementById('new-section-adviser').value;
    if (!name)       { Toast.show('Section name is required.', 'error'); return; }
    if (!gradeLevel) { Toast.show('Please select a grade level.', 'error'); return; }
    const btn = document.querySelector('#modal-container .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      await api.createSection({
        name,
        grade_level: gradeLevel,
        school_year: schoolYear || null,
        room: room || null,
        adviser_id: adviserId ? parseInt(adviserId) : null,
      });
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
      const section     = await api.getSection(id);
      const teacherOpts = await this._teacherOpts(section.adviser_id);
      Modal.show('Edit Section', `
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Section Name *</label>
            <input class="form-control" id="edit-section-name" value="${escHtml(section.name)}" />
          </div>
          <div class="form-group">
            <label class="form-label">Grade Level *</label>
            <select class="form-control" id="edit-section-grade"><option value="">— Select —</option>${this._gradeLevelOpts(section.grade_level)}</select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Room</label>
            <input class="form-control" id="edit-section-room" value="${escHtml(section.room || '')}" placeholder="e.g. ICT Lab 1" />
          </div>
          <div class="form-group">
            <label class="form-label">School Year</label>
            <input class="form-control" id="edit-section-year" value="${escHtml(section.school_year || '')}" placeholder="e.g. 2026-2027" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Adviser</label>
          <select class="form-control" id="edit-section-adviser">${teacherOpts}</select>
        </div>`,
        `<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
         <button class="btn btn-primary" onclick="AdminController.saveEditSection(${id})">Save Changes</button>`
      );
    } catch (err) {
      Toast.show(`Could not load section: ${err.message}`, 'error');
    }
  },

  async saveEditSection(id) {
    const name       = document.getElementById('edit-section-name').value.trim();
    const gradeLevel = document.getElementById('edit-section-grade').value;
    const room       = document.getElementById('edit-section-room').value.trim();
    const schoolYear = document.getElementById('edit-section-year').value.trim();
    const adviserId  = document.getElementById('edit-section-adviser').value;
    if (!name)       { Toast.show('Section name is required.', 'error'); return; }
    if (!gradeLevel) { Toast.show('Please select a grade level.', 'error'); return; }
    const btn = document.querySelector('#modal-container .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      await api.updateSection(id, {
        name,
        grade_level: gradeLevel,
        school_year: schoolYear || null,
        room: room || null,
        adviser_id: adviserId ? parseInt(adviserId) : null,
      });
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
    loadingModal.innerHTML = `<div style="background:#fff;border-radius:12px;padding:32px;min-width:320px;text-align:center;"><div style="font-size:24px;margin-bottom:8px">${ADMIN_ICONS.book}</div><p style="color:#888">Loading subjects…</p></div>`;
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
          <div><h3 style="margin:0;color:#1a1a2e">${ADMIN_ICONS.book} Enroll in Subjects</h3><p style="margin:4px 0 0;color:#888;font-size:13px">${escHtml(studentName)}</p></div>
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
  clearAuditLog()             { /* legacy */ },
  saveSettings() {
    const user = DashboardController.currentUser;
    const name = document.getElementById('settings-name')?.value.trim() || '';
    const personalEmail = document.getElementById('settings-personal-email')?.value.trim() || '';
    const phoneNumber = document.getElementById('settings-phone')?.value.trim() || '';
    const location = {
      addressLine1: document.getElementById('settings-address-line1')?.value.trim() || '',
      addressLine2: document.getElementById('settings-address-line2')?.value.trim() || '',
      city: document.getElementById('settings-city')?.value.trim() || '',
      state: document.getElementById('settings-state')?.value.trim() || '',
      postalCode: document.getElementById('settings-postal-code')?.value.trim() || '',
    };
    if (!name) { Toast.show('Full name is required.', 'error'); return; }
    if (personalEmail && !Validate.email(personalEmail)) return;
    if (phoneNumber && !/^[0-9+()\-\s]{7,30}$/.test(phoneNumber)) {
      Toast.show('Please enter a valid phone number.', 'error');
      return;
    }
    user.name = name;
    user.full_name = name;
    Storage.set(`ijed_profile_contact_${user.id}`, { personalEmail, phoneNumber, ...location });
    Storage.set('ijla_session', user);
    Storage.set('lms_user', user);
    document.getElementById('sb-username').textContent = name;
    App.populateProfileDropdown(user);
    Toast.show('Profile information saved on this device.', 'success');
  },
  changePassword() {
    Toast.show('Password changes require backend access and are not available yet.', 'info');
  },
  _filterBySection(secId)     { /* legacy */ },

  /* ── Bulk Student Import / Export ────────────────────────────────────────
     Excel template columns (row 1 = headers, exact match required):
       First Name | Last Name | Email | LRN | Grade Level | Strand |
       Section | School Year | Semester | Guardian Name | Guardian Contact |
       Contact Number
     Grouping/placement: rows are grouped by (School Year + Grade + Strand +
     Section); each group is placed into the matching Class + Section,
     auto-creating them if they don't exist yet — same find-or-create pattern
     the single "Add Student" form already uses. Class names are generated
     as "<STRAND> G<grade>" (e.g. "ICT G11") to stay consistent with the
     existing strand/grade subject-matching logic in openAddUser().
     Passwords: auto-generated as "<LastName>_<LRN>" (e.g. "Dancalan_179741")
     — hashing is handled entirely by Supabase Auth server-side; nothing
     here ever sees or stores a plain-text password beyond this one request.
     Duplicates (matched by Email OR LRN already existing): the student's
     account is left untouched — only their section placement and subject
     enrollment are updated to match the file.
  ───────────────────────────────────────────────────────────────────────── */

  _STUDENT_TEMPLATE_HEADERS: [
    'First Name', 'Last Name', 'Email', 'LRN', 'Grade Level', 'Strand',
    'Section', 'School Year', 'Semester', 'Guardian Name', 'Guardian Contact', 'Contact Number',
  ],

  downloadStudentImportTemplate() {
    const headers = this._STUDENT_TEMPLATE_HEADERS;
    const example = [
      'Juan', 'Dancalan', 'juan.dancalan@ijed.test', '179741', '11', 'ICT',
      'A', '2025-2026', '1', 'Maria Dancalan', '09171234567', '09179876543',
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Students');

    const notes = XLSX.utils.aoa_to_sheet([
      ['Column', 'Required?', 'Notes'],
      ['First Name', 'Yes', ''],
      ['Last Name', 'Yes', 'Used in the auto-generated password: LastName_LRN'],
      ['Email', 'Yes', 'Must be unique — used for login'],
      ['LRN', 'Yes', 'Student ID number. Must be unique. Also used in the auto-generated password.'],
      ['Grade Level', 'Yes', 'Just the number, e.g. 11 or 12'],
      ['Strand', 'Yes (if SHS)', 'e.g. ICT, HUMSS, STEM, GAS — leave blank for non-SHS grades'],
      ['Section', 'Yes', 'e.g. A, Rizal — students with the same School Year + Grade + Strand + Section are grouped into the same section automatically'],
      ['School Year', 'Yes', 'e.g. 2025-2026'],
      ['Semester', 'No', '1 or 2 — only affects which semester-specific subjects are auto-enrolled'],
      ['Guardian Name', 'No', ''],
      ['Guardian Contact', 'No', ''],
      ['Contact Number', 'No', "Student's own contact number"],
      [],
      ['Password:', 'Auto-generated as LastName_LRN, e.g. Dancalan_179741. Hashed automatically by Supabase Auth.'],
      ['Existing students:', 'Matched by Email or LRN. Their account is left untouched — only section/subject placement is updated to match this file.'],
    ]);
    notes['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, notes, 'Instructions');

    XLSX.writeFile(wb, 'IJED-LMS_Student_Import_Template.xlsx');
  },

  openImportStudents() {
    Modal.show('Import Students', `
      <div class="form-group">
        <p style="margin-top:0;color:var(--gray-500);font-size:13px">
          Upload an Excel file to bulk-add students and place them into their sections automatically.
          Students already in the system (matched by Email or LRN) will have their section/subject
          placement updated — their account and password are left untouched.
        </p>
        <button class="btn btn-outline btn-sm" onclick="AdminController.downloadStudentImportTemplate()">${ADMIN_ICONS.download} Download Template</button>
      </div>
      <div class="form-group">
        <label>Excel File (.xlsx)</label>
        <input type="file" class="form-control" id="import-students-file" accept=".xlsx,.xls" />
      </div>
      <div id="import-students-progress" style="display:none;margin-top:12px">
        <div class="empty-state-sub">Processing… this may take a moment for large files.</div>
      </div>
      <div id="import-students-results" style="margin-top:12px"></div>
    `, `
      <button class="btn btn-ghost" onclick="Modal.close()">Close</button>
      <button class="btn btn-primary" id="import-students-submit" onclick="AdminController.processImportStudents()">Import</button>
    `);
  },

  async processImportStudents() {
    const fileInput = document.getElementById('import-students-file');
    const file = fileInput?.files?.[0];
    if (!file) { Toast.show('Please choose an Excel file first.', 'error'); return; }

    const submitBtn = document.getElementById('import-students-submit');
    const progressEl = document.getElementById('import-students-progress');
    const resultsEl  = document.getElementById('import-students-results');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Importing…'; }
    if (progressEl) progressEl.style.display = '';
    if (resultsEl) resultsEl.innerHTML = '';

    try {
      const rows = await this._readStudentExcelFile(file);
      if (!rows.length) throw new Error('No data rows found in the file.');

      const result = await this._runStudentImport(rows);
      this._renderImportResults(result);
      DashboardController.loadSection(DashboardController.currentSection);
    } catch (err) {
      Toast.show(`❌ Import failed: ${err.message}`, 'error');
    } finally {
      if (progressEl) progressEl.style.display = 'none';
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Import'; }
    }
  },

  _readStudentExcelFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          resolve(raw.map((r, i) => ({ ...this._normalizeImportRow(r), _rowNum: i + 2 })));
        } catch (err) {
          reject(new Error('Could not read this file — is it a valid .xlsx export?'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read the file.'));
      reader.readAsArrayBuffer(file);
    });
  },

  _normalizeImportRow(r) {
    // Tolerate header casing/spacing differences (e.g. "first name", "LRN ")
    const get = (...keys) => {
      for (const k of keys) {
        for (const rk of Object.keys(r)) {
          if (rk.trim().toLowerCase() === k.toLowerCase()) {
            const v = r[rk];
            return typeof v === 'string' ? v.trim() : v;
          }
        }
      }
      return '';
    };
    return {
      firstName: get('First Name'),
      lastName:  get('Last Name'),
      email:     get('Email'),
      lrn:       String(get('LRN') || '').trim(),
      grade:     String(get('Grade Level') || '').trim(),
      strand:    String(get('Strand') || '').trim().toUpperCase(),
      section:   get('Section'),
      schoolYear: get('School Year'),
      semester:  String(get('Semester') || '').trim(),
      guardianName: get('Guardian Name'),
      guardianContact: get('Guardian Contact'),
      contactNumber: get('Contact Number'),
    };
  },

  _generateStudentPassword(lastName, lrn) {
    return `${lastName}_${lrn}`;
  },

  async _runStudentImport(rows) {
    const created = [], updated = [], errors = [];

    // ── 1. Validate every row up front, before creating anything ──────────
    const valid = [];
    const seenEmails = new Set(), seenLrns = new Set();
    for (const row of rows) {
      const missing = [];
      if (!row.firstName) missing.push('First Name');
      if (!row.lastName)  missing.push('Last Name');
      if (!row.email)     missing.push('Email');
      if (!row.lrn)        missing.push('LRN');
      if (!row.grade)      missing.push('Grade Level');
      if (!row.section)    missing.push('Section');
      if (!row.schoolYear) missing.push('School Year');
      if (missing.length) {
        errors.push({ row: row._rowNum, reason: `Missing: ${missing.join(', ')}` });
        continue;
      }
      const emailKey = row.email.toLowerCase();
      if (seenEmails.has(emailKey) || seenLrns.has(row.lrn)) {
        errors.push({ row: row._rowNum, reason: `Duplicate Email or LRN within this file (already listed on an earlier row).` });
        continue;
      }
      seenEmails.add(emailKey);
      seenLrns.add(row.lrn);
      valid.push(row);
    }
    if (!valid.length) return { created, updated, errors };

    // ── 2. Resolve/create one Class+Section per unique (year, grade, strand, section) group ──
    const groupKey = (r) => `${r.schoolYear}|${r.grade}|${r.strand}|${r.section}`.toLowerCase();
    const groups = new Map();
    for (const r of valid) {
      const k = groupKey(r);
      if (!groups.has(k)) groups.set(k, { schoolYear: r.schoolYear, grade: r.grade, strand: r.strand, section: r.section, rows: [] });
      groups.get(k).rows.push(r);
    }

    const sectionIdByGroup = new Map();
    const [allClasses, allSections, allSubjects] = await Promise.all([
      api.sb.from('classes').select('*').eq('is_active', true).then(r => r.data || []),
      api.sb.from('sections').select('*').then(r => r.data || []),
      api.getSubjects(),
    ]);

    for (const [key, g] of groups.entries()) {
      try {
        const sectionId = await this._resolveClassAndSection(g, allClasses, allSections);
        sectionIdByGroup.set(key, sectionId);
      } catch (err) {
        for (const r of g.rows) errors.push({ row: r._rowNum, reason: `Could not resolve section: ${err.message}` });
      }
    }

    // ── 3. Look up existing students by email OR LRN in one query each ────
    const emails = valid.map(r => r.email.toLowerCase());
    const lrns = valid.map(r => r.lrn);
    const [existingByEmail, existingByLrn] = await Promise.all([
      api.sb.from('users').select('id, email, students(id, student_number)').in('email', emails).then(r => r.data || []),
      api.sb.from('students').select('id, student_number, user_id, users(email)').in('student_number', lrns).then(r => r.data || []),
    ]);
    const userByEmail = new Map(existingByEmail.map(u => [u.email.toLowerCase(), u]));
    const studentByLrn = new Map(existingByLrn.map(s => [s.student_number, s]));

    // ── 4. Process each row ────────────────────────────────────────────
    let processed = 0;
    const progressEl = document.getElementById('import-students-progress');
    for (const row of valid) {
      processed++;
      if (progressEl) progressEl.querySelector('.empty-state-sub').textContent =
        `Processing ${processed} of ${valid.length}…`;

      const key = groupKey(row);
      const sectionId = sectionIdByGroup.get(key);
      if (!sectionId) continue; // already recorded as an error above

      try {
        const existingUser = userByEmail.get(row.email.toLowerCase());
        const existingStudentByLrn = studentByLrn.get(row.lrn);

        if (existingUser || existingStudentByLrn) {
          // ── Update path: leave account untouched, refresh placement only ──
          const studentId = existingUser?.students?.[0]?.id ?? existingStudentByLrn?.id;
          if (!studentId) {
            errors.push({ row: row._rowNum, reason: 'Matched an existing account but no student profile was found for it — skipped.' });
            continue;
          }
          await api.sb.from('student_section_assignments').delete().eq('student_id', studentId);
          await api.assignStudentToSection({ student_id: studentId, section_id: sectionId });

          const subjectIds = this._matchStrandSubjects(allSubjects, row.strand, row.grade, row.semester);
          if (subjectIds.length) await api.enrollStudentSubjects(studentId, subjectIds);

          updated.push({ row: row._rowNum, name: `${row.firstName} ${row.lastName}`, email: row.email });
        } else {
          // ── Create path: new auth account + profile + placement ──────────
          const password = this._generateStudentPassword(row.lastName, row.lrn);
          if (password.length < 8 || !/\d/.test(password)) {
            errors.push({ row: row._rowNum, reason: `Generated password "${password}" is too short or has no digit (need 8+ characters, incl. at least one digit) — check the LRN value.` });
            continue;
          }
          const newUser = await api.createUser({
            email: row.email, password,
            first_name: row.firstName, last_name: row.lastName,
            role_id: this._STUDENT_ROLE_ID,
          });
          const studentProfile = await api.createStudentProfile({
            user_id: newUser.id,
            student_number: row.lrn,
            contact_number: row.contactNumber || null,
            guardian_name: row.guardianName || null,
            guardian_contact: row.guardianContact || null,
          });
          await api.assignStudentToSection({ student_id: studentProfile.id, section_id: sectionId });

          const subjectIds = this._matchStrandSubjects(allSubjects, row.strand, row.grade, row.semester);
          if (subjectIds.length) await api.enrollStudentSubjects(studentProfile.id, subjectIds);

          created.push({ row: row._rowNum, name: `${row.firstName} ${row.lastName}`, email: row.email, password });
        }
      } catch (err) {
        errors.push({ row: row._rowNum, reason: err.message });
      }
    }

    return { created, updated, errors };
  },

  // Matches the hardcoded role map already used by saveNewUser() elsewhere
  // in this controller ({ admin: 1, teacher: 2, student: 3 }). Kept as its
  // own constant here — if that map ever changes, update this too.
  _STUDENT_ROLE_ID: 3,

  _matchStrandSubjects(allSubjects, strand, grade, semester) {
    if (!strand || !grade) return [];
    // Subjects store semester as '1st'/'2nd' strings. CSV import data can
    // arrive as "1", "1st", "First", etc. -- normalize to the same format
    // the database actually uses instead of parseInt()'ing it, which
    // silently matched nothing since subjects.semester was never a number.
    const semStr = String(semester || '').trim().toLowerCase();
    const sem = ['1', '1st', 'first'].includes(semStr) ? '1st'
              : ['2', '2nd', 'second'].includes(semStr) ? '2nd'
              : '';
    return allSubjects.filter(s => {
      const n = s.name.toUpperCase();
      const matchStrand = n.includes(strand + ' G' + grade);
      const matchCore   = n.includes('G' + grade + ' CORE');
      const matchSem    = !sem || s.semester === sem;
      return (matchStrand || matchCore) && matchSem;
    }).map(s => s.id);
  },

  async _resolveClassAndSection(g, allClasses, allSections) {
    // Section-name-first matching, in three tiers. The previous version
    // matched the Class first via exact grade_level/school_year string
    // equality, then looked for a section under it — but that broke
    // completely for real data where grade_level/school_year weren't
    // stored in exactly the format assumed here, silently creating a
    // brand-new duplicate Class + Section every time instead of reusing
    // what already existed (e.g. "ICT1101" ended up as two separate
    // sections under two different classes).
    const wantedSectionName = g.section.trim().toLowerCase();
    const gradeLabel = `Grade ${g.grade}`;
    const strandUpper = (g.strand || '').toUpperCase();

    const classLooselyMatches = (c) => {
      const gradeMatches = c.grade_level === gradeLabel || (c.grade_level || '').includes(String(g.grade));
      const yearMatches  = c.school_year === g.schoolYear;
      const nameMatches  = strandUpper && (c.name || '').toUpperCase().includes(strandUpper);
      return gradeMatches || yearMatches || nameMatches;
    };

    // Tier 1: section with this name, whose class loosely matches grade/year/strand.
    let section = allSections.find(s => {
      if (s.name.trim().toLowerCase() !== wantedSectionName) return false;
      const klass = allClasses.find(c => c.id === s.class_id);
      return klass && classLooselyMatches(klass);
    });

    // Tier 2: same section name anywhere at all — safer than creating an
    // outright duplicate, but flagged here since it could theoretically
    // merge two different sections that happen to share a name across
    // different grades/years. Worth revisiting if that ever comes up.
    if (!section) {
      section = allSections.find(s => s.name.trim().toLowerCase() === wantedSectionName);
    }

    if (section) return section.id;

    // Tier 3: genuinely nothing matches — create a new Class (if needed) + Section.
    const className = g.strand ? `${g.strand} G${g.grade}` : gradeLabel;
    let klass = allClasses.find(classLooselyMatches);

    if (!klass) {
      const { data, error } = await api.sb.from('classes')
        .insert({ name: className, grade_level: gradeLabel, school_year: g.schoolYear, is_active: true })
        .select().single();
      if (error) throw new Error(error.message);
      klass = data;
      allClasses.push(klass);
    }

    const { data, error } = await api.sb.from('sections')
      .insert({ name: g.section, class_id: klass.id })
      .select().single();
    if (error) throw new Error(error.message);
    allSections.push(data);
    return data.id;
  },

  _renderImportResults(result) {
    const { created, updated, errors } = result;
    const el = document.getElementById('import-students-results');
    if (!el) return;

    let html = `<div class="import-summary" style="display:flex;gap:16px;margin-bottom:12px">
      <div>✅ <strong>${created.length}</strong> created</div>
      <div>${ADMIN_ICONS.transfer} <strong>${updated.length}</strong> updated</div>
      <div>❌ <strong>${errors.length}</strong> errors</div>
    </div>`;

    if (created.length) {
      this._lastImportCredentials = created;
      html += `<button class="btn btn-outline btn-sm" onclick="AdminController._downloadCredentials(AdminController._lastImportCredentials)">${ADMIN_ICONS.download} Download Credentials (${created.length})</button>`;
    }

    if (errors.length) {
      html += `<div style="margin-top:12px"><strong style="color:var(--red)">Errors:</strong>
        <ul style="max-height:180px;overflow-y:auto;font-size:13px">
          ${errors.map(e => `<li>Row ${e.row}: ${escHtml(e.reason)}</li>`).join('')}
        </ul></div>`;
    }

    el.innerHTML = html;
    Toast.show(`Import finished: ${created.length} created, ${updated.length} updated, ${errors.length} errors.`, errors.length ? 'warning' : 'success');
  },

  _downloadCredentials(created) {
    const rows = [['Name', 'Email', 'Password'], ...created.map(c => [c.name, c.email, c.password])];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 24 }, { wch: 28 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Credentials');
    XLSX.writeFile(wb, `IJED-LMS_New_Student_Credentials_${new Date().toISOString().slice(0, 10)}.xlsx`);
  },

  async exportCSV(type) {
    try {
      const { data: students, error } = await api.sb
        .from('students')
        .select('student_number, contact_number, guardian_name, guardian_contact, users(first_name, last_name, email), student_section_assignments(sections(name, classes(name, grade_level, school_year)))');
      if (error) throw new Error(error.message);

      const headers = this._STUDENT_TEMPLATE_HEADERS;
      const rows = (students || []).map(s => {
        const sec = s.student_section_assignments?.[0]?.sections;
        const klass = sec?.classes;
        const gradeNum = (klass?.grade_level || '').replace(/[^0-9]/g, '');
        const strand = klass?.name && gradeNum ? klass.name.split(' G' + gradeNum)[0].trim() : '';
        return [
          s.users?.first_name || '', s.users?.last_name || '', s.users?.email || '',
          s.student_number || '', gradeNum, strand, sec?.name || '',
          klass?.school_year || '', '', s.guardian_name || '', s.guardian_contact || '', s.contact_number || '',
        ];
      });

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 2, 14) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Students');
      XLSX.writeFile(wb, `IJED-LMS_Students_Export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      Toast.show(`Export failed: ${err.message}`, 'error');
    }
  },

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
      Toast.show(`${ADMIN_ICONS.megaphone} Announcement sent to ${result.sent_to ?? ''} user(s).`, 'success');
      this.closeAnnouncement();
      document.getElementById('announce-title').value = '';
      document.getElementById('announce-msg').value   = '';
    } catch (err) {
      Toast.show('Failed to send announcement: ' + err.message, 'error');
    }
  },
};
