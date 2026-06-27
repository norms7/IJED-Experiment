/* ============================================================
   controllers/attendance.controller.js
   Attendance Monitoring — Teacher role only.

   Flow:
   1. loadSections()        → sections list page
   2. openSection()         → section detail (student summary + session history)
   3. openTakeAttendance()  → Take Attendance modal (create new session)
   4. editSession()         → same modal, pre-filled (update existing session)
   5. deleteSession()       → confirm + delete
   ============================================================ */

"use strict";

const AttendanceController = {

  // ── State ─────────────────────────────────────────────────────────────────
  _sections:        [],   // all sections from API
  _currentClassId:  null,
  _currentName:     '',
  _currentSubjects: [],
  _currentStudents: [],  // raw student objects (id, first_name, last_name, student_number)
  _editingSessionId: null,
  _currentSubjectId: null,
  _currentTerm:      '1st',

  // ── 1. Sections list ──────────────────────────────────────────────────────
  async loadSections() {
    const wrap = document.getElementById('att-sections-wrap');
    try {
      const sections = await api.getAttendanceSections();
      this._sections = sections || [];

      const countEl = document.getElementById('att-count');
      if (countEl) countEl.textContent = `${this._sections.length} section(s) assigned`;

      if (wrap) {
        wrap.innerHTML = TeacherView.attendanceSectionsList(this._sections);
        DashboardController._attachSearch();
      }
    } catch (err) {
      console.error('[Attendance] loadSections:', err);
      if (wrap) wrap.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <div class="empty-state-title">Failed to load sections</div>
        <div class="empty-state-sub">${escHtml(err.message)}</div>
      </div>`;
      Toast.show('Failed to load attendance sections: ' + err.message, 'error');
    }
  },

  // ── 2. Open section detail ─────────────────────────────────────────────────
  async openSection(classId, sectionName) {
    this._currentClassId = classId;
    this._currentName    = sectionName;

    // Re-fetch sections if state is empty (direct navigation)
    if (!this._sections.length) {
      const sections = await api.getAttendanceSections().catch(() => []);
      this._sections = sections;
    }

    const sec = this._sections.find(s => s.class_id === classId);
    this._currentSubjects = sec?.subjects || [];

    // Default: first subject, 1st term
    this._currentSubjectId = this._currentSubjects[0]?.subject_id || null;
    this._currentTerm      = '1st';

    await this._renderSectionDetail();
  },

  // ── Internal: render/re-render section detail ──────────────────────────────
  async _renderSectionDetail() {
    const area = document.getElementById('content-area');
    if (!area) return;

    area.innerHTML = `
      <div class="section-header">
        <div class="section-header-left">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn btn-ghost btn-sm" onclick="AttendanceController.backToSections()" style="padding:4px 8px">← Back</button>
            <div><h2>${escHtml(this._currentName)}</h2><p>Loading attendance data…</p></div>
          </div>
        </div>
      </div>
      <div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-title">Loading…</div></div>`;

    try {
      const [summaryData, sessions] = await Promise.all([
        api.getAttendanceSectionStudents(this._currentClassId, {
          subjectId: this._currentSubjectId,
          term:      this._currentTerm || null,
        }).catch(e => { console.warn('[Attendance] students:', e); return { students: [], total_meetings: 0 }; }),
        api.getAttendanceSessions(this._currentClassId, {
          subjectId: this._currentSubjectId,
          term:      this._currentTerm || null,
        }).catch(() => []),
      ]);

      // Cache plain student list for modal use
      this._currentStudents = summaryData.students || [];

      area.innerHTML = TeacherView.attendanceSectionDetail(
        this._currentName,
        summaryData,
        this._currentSubjects,
        this._currentSubjectId,
        this._currentTerm,
      );

      // Populate session history
      const sessionWrap = document.getElementById('att-sessions-list');
      if (sessionWrap) sessionWrap.innerHTML = TeacherView.attendanceSessionsList(sessions);

      DashboardController._attachSearch();

    } catch (err) {
      console.error('[Attendance] _renderSectionDetail:', err);
      Toast.show('Failed to load section attendance: ' + err.message, 'error');
    }
  },

  // ── Filter change (subject / term dropdowns) ───────────────────────────────
  async reloadSectionDetail() {
    const subjEl = document.getElementById('att-subject-filter');
    const termEl = document.getElementById('att-term-filter');
    this._currentSubjectId = subjEl?.value ? parseInt(subjEl.value) : null;
    this._currentTerm      = termEl?.value || null;
    await this._renderSectionDetail();
  },

  // ── Back to sections list ─────────────────────────────────────────────────
  backToSections() {
    DashboardController.loadSection('attendance');
  },

  // ── 3. Take Attendance modal (new session) ────────────────────────────────
  openTakeAttendance() {
    this._editingSessionId = null;
    this._showAttendanceModal(null);
  },

  // ── 4. Edit existing session ───────────────────────────────────────────────
  async editSession(sessionId) {
    try {
      const session = await api.getAttendanceSession(sessionId);
      this._editingSessionId = sessionId;
      this._showAttendanceModal(session);
    } catch (err) {
      Toast.show('Failed to load session: ' + err.message, 'error');
    }
  },

  // ── Internal: show modal (create or edit) ─────────────────────────────────
  _showAttendanceModal(existingSession) {
    const isEdit  = !!existingSession;
    const title   = isEdit ? '✏️ Edit Attendance Session' : '📝 Take Attendance';
    const body    = TeacherView.attendanceModal(this._currentStudents, existingSession);
    const footer  = `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="AttendanceController.saveAttendance()">
        ${isEdit ? '💾 Update' : '✅ Save Attendance'}
      </button>`;

    Modal.show(title, body, footer);
  },

  // ── Toggle has_class UI ────────────────────────────────────────────────────
  toggleHasClass(hasClass) {
    const tableWrap = document.getElementById('att-student-table-wrap');
    const noClassMsg = document.getElementById('att-no-class-msg');
    if (tableWrap)  tableWrap.style.display  = hasClass ? '' : 'none';
    if (noClassMsg) noClassMsg.style.display = hasClass ? 'none' : '';
  },

  // ── Mark all students with one status ─────────────────────────────────────
  markAll(status) {
    this._currentStudents.forEach(stu => {
      const radio = document.querySelector(`input[name="att_${stu.id}"][value="${status}"]`);
      if (radio) radio.checked = true;
    });
  },

  // ── Save (create or update) ───────────────────────────────────────────────
  async saveAttendance() {
    const dateEl  = document.getElementById('att-date');
    const termEl  = document.getElementById('att-term');
    const notesEl = document.getElementById('att-notes');
    const hasClassRadio = document.querySelector('input[name="att_has_class"]:checked');

    if (!dateEl?.value) { Toast.show('Please select a date.', 'error'); return; }

    const hasClass  = hasClassRadio?.value === 'yes';
    const records   = [];

    if (hasClass) {
      for (const stu of this._currentStudents) {
        const checked = document.querySelector(`input[name="att_${stu.id}"]:checked`);
        records.push({
          student_id: stu.id,
          status:     checked?.value || 'absent',
          remarks:    null,
        });
      }
    }

    const payload = {
      class_id:     this._currentClassId,
      subject_id:   this._currentSubjectId || null,
      term:         termEl?.value || '1st',
      session_date: dateEl.value,
      has_class:    hasClass,
      notes:        notesEl?.value?.trim() || null,
      records,
    };

    try {
      if (this._editingSessionId) {
        await api.updateAttendanceSession(this._editingSessionId, {
          has_class: payload.has_class,
          notes:     payload.notes,
          records:   payload.records,
        });
        Toast.show('Attendance session updated.', 'success');
      } else {
        await api.createAttendanceSession(payload);
        Toast.show('Attendance saved successfully.', 'success');
      }
      Modal.close();
      await this._renderSectionDetail();
    } catch (err) {
      console.error('[Attendance] save:', err);
      Toast.show('Failed to save attendance: ' + (err.message || 'Unknown error'), 'error');
    }
  },

  // ── 5. Delete session ─────────────────────────────────────────────────────
  deleteSession(sessionId, sessionDate) {
    const footer = `
      <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-danger" onclick="AttendanceController._confirmDelete(${sessionId})">
        🗑️ Yes, Delete
      </button>`;
    Modal.show(
      '⚠️ Delete Session',
      `<p>Are you sure you want to delete the attendance session for <strong>${escHtml(sessionDate)}</strong>?</p>
       <p style="color:var(--gray-400);font-size:13px;margin-top:8px">This will permanently remove all attendance records for that day.</p>`,
      footer
    );
  },

  async _confirmDelete(sessionId) {
    try {
      await api.deleteAttendanceSession(sessionId);
      Toast.show('Session deleted.', 'success');
      Modal.close();
      await this._renderSectionDetail();
    } catch (err) {
      Toast.show('Failed to delete session: ' + err.message, 'error');
    }
  },
};