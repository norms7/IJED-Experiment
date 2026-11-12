/* ============================================================
   controllers/gradebook.controller.js
   Digital Gradebook — Teacher role only.
   Per-subject grading: each subject has its own activities,
   modules, and attendance — never combined across subjects.
   ============================================================ */

"use strict";

const GradebookController = {

  // ── State ─────────────────────────────────────────────────────────────────
  _subjects:          [],   // all subjects for this teacher
  _currentSectionId:  null, // the actual section being graded — never mixed with sibling sections
  _currentSubjectId:  null, // active subject filter
  _currentName:       '',
  _currentSemester:   '1st',
  _currentTerm:       '1st',
  _classSubjects:     [],   // subjects for the open section
  _allStudents:       [],   // students in this section (fetched once)
  _subjectCache:      {},   // subjectId → { activities, modules, attendance }
  _reportCardDraftSignatures: {},
  _lastExportData:    null,
  _publishModalData:  null,
  _publishLoadRequestId: 0,
  _renderRequestId:   0,
  _adviserSections:   [],
  _adviserSectionIds: new Set(),
  _adviserRows:       [],
  _adviserStudents:   [],
  _adviserStudentId:  'all',
  _adviserSemester:   '1st',
  _adviserSectionId:  null,
  _adviserSectionName:'',

  // ── Entry: load sections list ─────────────────────────────────────────────
  async loadSections() {
    const wrap = document.getElementById('gradebook-sections-wrap');
    try {
      const [subjects, adviserSections] = await Promise.all([
        api.getMySubjects(),
        api.getMyAdviserSections(),
      ]);
      this._subjects = subjects || [];
      this._adviserSections = adviserSections || [];
      this._adviserSectionIds = new Set(this._adviserSections.map(section => section.section_id));

      const sectionCount = new Set([
        ...(subjects || []).map(s => s.section_id),
        ...this._adviserSections.map(section => section.section_id),
      ]).size;
      const countEl = document.getElementById('grade-count');
      if (countEl) countEl.textContent = `${sectionCount} section(s) assigned`;

      if (wrap) {
        wrap.innerHTML = TeacherView.gradebookSectionsList(subjects, this._adviserSections);
        DashboardController._attachSearch();
      }

      // Async student counts per section — SECTION, not whole class, so two
      // sections under one class (e.g. ICT1102 and ICT1103 under "ICT G11")
      // each get their own accurate count instead of a merged total.
      const sectionIds = [...new Set([
        ...(subjects || []).map(s => s.section_id),
        ...this._adviserSections.map(section => section.section_id),
      ])];
      sectionIds.forEach(sectionId => {
        api.getSectionStudents(sectionId)
          .then(students => {
            const el = document.getElementById(`student-count-${sectionId}`);
            if (el) {
              el.textContent = `${students.length} student${students.length !== 1 ? 's' : ''}`;
              el.className = 'badge badge-green';
            }
          })
          .catch(() => {
            const el = document.getElementById(`student-count-${sectionId}`);
            if (el) { el.textContent = '—'; el.className = 'badge badge-gray'; }
          });
      });

    } catch (err) {
      console.error('[Gradebook] loadSections error:', err);
      if (wrap) wrap.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">${LMS_ICONS.warning}</div>
        <div class="empty-state-title">Failed to load sections</div>
        <div class="empty-state-sub">${escHtml(err.message)}</div>
      </div>`;
      Toast.show('Failed to load gradebook: ' + err.message, 'error');
    }
  },

  // ── Open a section → show first subject by default ────────────────────────
  async openSection(sectionId, sectionName) {
    this._renderRequestId++;
    this._lastExportData = null;
    this._currentSectionId = sectionId;
    this._currentName      = sectionName;
    this._subjectCache     = {};   // clear cache on new section
    this._allStudents      = [];

    const area = document.getElementById('content-area');
    if (!area) return;

    area.innerHTML = `
      <div class="section-header">
        <div class="section-header-left">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn btn-ghost btn-sm" onclick="DashboardController.loadSection('grades')" style="padding:4px 8px">← Back</button>
            <div><h2>${escHtml(sectionName)}</h2><p>Loading gradebook…</p></div>
          </div>
        </div>
      </div>
      <div class="empty-state"><div class="empty-state-icon">${LMS_ICONS.loading}</div><div class="empty-state-title">Building gradebook…</div></div>`;

    try {
      // Resolve subjects for this section
      let sectionSubjects = this._subjects.filter(s => s.section_id === sectionId);
      if (sectionSubjects.length === 0) {
        const allSubjects = await api.getMySubjects().catch(() => []);
        this._subjects     = allSubjects;
        sectionSubjects     = allSubjects.filter(s => s.section_id === sectionId);
      }
      this._classSubjects = sectionSubjects;
      if (sectionSubjects.length === 0) {
        area.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">${LMS_ICONS.clipboard}</div>
          <div class="empty-state-title">No subjects found for this section</div>
          <button class="btn btn-primary mt-3" onclick="DashboardController.loadSection('grades')">← Back</button>
        </div>`;
        return;
      }

      // Fetch students once for this section
      this._allStudents = await api.getSectionStudents(sectionId).catch(() => []);

      // Default: first subject, first term
      this._currentSemester = '1st';
      let semesterSubjects = this._subjectsForSemester(this._currentSemester);
      if (!semesterSubjects.length) {
        this._currentSemester = '2nd';
        semesterSubjects = this._subjectsForSemester(this._currentSemester);
      }
      this._currentSubjectId = semesterSubjects[0]?.subject_id || sectionSubjects[0].subject_id;
      this._currentTerm      = '1st';

      await this._renderSubjectGrades();

    } catch (err) {
      console.error('[Gradebook] openSection error:', err);
      Toast.show('Failed to load gradebook: ' + err.message, 'error');
      area.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">${LMS_ICONS.warning}</div>
        <div class="empty-state-title">Error loading gradebook</div>
        <div class="empty-state-sub">${escHtml(err.message)}</div>
        <button class="btn btn-primary mt-3" onclick="DashboardController.loadSection('grades')">← Back</button>
      </div>`;
    }
  },

  // ── Called when teacher changes subject or term dropdown ──────────────────
  async onFilterChange() {
    const subSel  = document.getElementById('gb-subject-select');
    const termSel = document.getElementById('gb-term-select');
    if (subSel)  this._currentSubjectId = parseInt(subSel.value, 10);
    if (termSel) this._currentTerm      = termSel.value;
    await this._renderSubjectGrades();
  },

  _subjectsForSemester(semester) {
    const normalize = value => {
      const term = String(value || '').trim().toLowerCase();
      return ['2', '2nd', 'second', '2nd semester', 'second semester'].includes(term)
        ? '2nd'
        : '1st';
    };
    return this._classSubjects.filter(subject => normalize(subject.subject_semester) === semester);
  },

  async _getTermGradeData(subjectId, sectionId, term) {
    const cacheKey = `${subjectId}_${term}`;
    let cached = this._subjectCache[cacheKey];
    if (!cached) {
      const [activities, modules, attendance, moduleReadsData] = await Promise.all([
        api.getTeacherActivities({ subject_id: subjectId, section_id: sectionId, term }),
        api.getMyModules(subjectId, term, sectionId),
        api.getAttendanceSectionStudents(sectionId, { subjectId, term }),
        api.getClassModuleReads(subjectId, sectionId, term),
      ]);
      const activitiesWithSubs = await Promise.all(
        activities.filter(activity => activity.is_published === true).map(async activity => {
          const submissions = await api.getActivitySubmissions(activity.id);
          if (!Array.isArray(submissions)) {
            throw new Error(`Invalid submissions response for activity ${activity.id}.`);
          }
          return { ...activity, _submissions: submissions };
        }),
      );
      cached = {
        activities: activitiesWithSubs,
        modules: modules.filter(module => module.is_published === true),
        attendance,
        moduleReads: moduleReadsData.module_reads || {},
        readModuleIds: moduleReadsData.read_module_ids || {},
      };
      this._subjectCache[cacheKey] = cached;
    }

    const attendanceByStudent = {};
    (cached.attendance.students || []).forEach(student => {
      attendanceByStudent[student.id] = student;
    });
    const students = this._allStudents.map(student => {
      const attendance = attendanceByStudent[student.id];
      return {
        ...student,
        _modulesRead: cached.moduleReads[student.id] ?? 0,
        _readModuleIds: cached.readModuleIds[student.id] || [],
        _attPresent: attendance?.present ?? 0,
        _attLate: attendance?.late ?? 0,
        _attTotal: (attendance?.present ?? 0) + (attendance?.absent ?? 0) + (attendance?.late ?? 0),
      };
    });
    return { ...cached, students };
  },

  async onSemesterChange() {
    const semesterSelect = document.getElementById('gb-semester-select');
    if (!semesterSelect) return;
    this._currentSemester = semesterSelect.value;
    const semesterSubjects = this._subjectsForSemester(this._currentSemester);
    const subjectSelect = document.getElementById('gb-subject-select');
    if (subjectSelect) {
      subjectSelect.innerHTML = semesterSubjects.length
        ? semesterSubjects.map(subject =>
          `<option value="${subject.subject_id}">${escHtml(subject.subject_name)}</option>`,
        ).join('')
        : '<option value="">No subjects assigned</option>';
    }
    if (!semesterSubjects.length) {
      this._currentSubjectId = null;
      this._lastExportData = null;
      await this._renderSubjectGrades();
      return;
    }
    this._currentSubjectId = semesterSubjects[0].subject_id;
    if (subjectSelect) subjectSelect.value = String(this._currentSubjectId);
    await this._renderSubjectGrades();
  },

  async publishAllGrades() {
    const data = this._lastExportData;
    if (!data) {
      Toast.show('Gradebook data is not available. Reload the page and try again.', 'error');
      return;
    }

    const requestId = ++this._publishLoadRequestId;
    Modal.show(
      'Publish Report Card Grades',
      `<div class="empty-state" style="padding:28px">
        <div class="empty-state-icon">${LMS_ICONS.loading}</div>
        <div class="empty-state-title">Loading grades for all four terms…</div>
      </div>`,
      '<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>',
      {
        wide: true,
        onClose: () => {
          if (requestId === this._publishLoadRequestId) this._publishLoadRequestId++;
        },
      },
    );
    try {
      const termData = await Promise.all(['1st', '2nd', '3rd', '4th'].map(async term => [
        term,
        await this._getTermGradeData(data.subjectId, data.sectionId, term),
      ]));
      if (requestId !== this._publishLoadRequestId) return;
      const termGrades = Object.fromEntries(termData.map(([term, grades]) => [
        term,
        new Map(grades.students.map(student => [
          student.id,
          TeacherView.gradebookScores(student, grades.activities, grades.modules),
        ])),
      ]));
      this._publishModalData = {
        ...data,
        termGrades,
        currentTerm: data.term,
      };

      const studentRows = data.students.map(student => {
        const fullName = `${student.user?.first_name || ''} ${student.user?.last_name || ''}`.trim()
          || `Student #${student.id}`;
        const studentNumber = student.student_number || student.student_profile?.student_number;
        const grades = ['1st', '2nd', '3rd', '4th'].map(term => termGrades[term].get(student.id));
        const hasAnyGrade = grades.some(scores => scores?.initialGrade != null);
        const termCells = grades.map(scores => {
          const grade = scores?.initialGrade;
          return `<span style="display:inline-block;min-width:38px;text-align:center" title="${grade == null ? 'No calculated grade' : `${grade.toFixed(2)}%`}">${grade == null ? '—' : grade.toFixed(2)}</span>`;
        }).join('');
        return `<label style="display:grid;grid-template-columns:24px minmax(150px,1fr) repeat(4,minmax(45px,auto));align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--gray-100);cursor:${hasAnyGrade ? 'pointer' : 'not-allowed'};opacity:${hasAnyGrade ? '1' : '.6'}">
          <input class="gb-publish-student" type="checkbox" value="${student.id}" ${hasAnyGrade ? 'checked' : 'disabled'} onchange="GradebookController.updatePublishSelection()" style="accent-color:var(--maroon);width:16px;height:16px">
          <span style="min-width:0">
            <span style="display:block;font-weight:600">${escHtml(fullName)}</span>
            <span style="font-size:11px;color:var(--gray-400)">${studentNumber ? `Student no. ${escHtml(studentNumber)}` : ''}</span>
          </span>
          ${termCells}
        </label>`;
      }).join('');
      const body = `
        <p style="font-size:13px;color:var(--gray-500);margin:0 0 12px">
          Choose students for ${escHtml(data.subjectName)}. By default, all students with calculated grades in any term are selected.
        </p>
        <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--gray-50);border-radius:8px;margin-bottom:8px;font-size:13px;font-weight:600;cursor:pointer">
          <input id="gb-publish-all-terms" type="checkbox" checked onchange="GradebookController.togglePublishTerms(this.checked)" style="accent-color:var(--maroon);width:16px;height:16px">
          Publish all 4 terms
          <span style="font-weight:400;color:var(--gray-400)">— uncheck to publish only ${escHtml(data.term)} Term</span>
        </label>
        <div style="display:grid;grid-template-columns:24px minmax(150px,1fr) repeat(4,minmax(45px,auto));gap:8px;padding:8px 12px;font-size:10px;font-weight:700;color:var(--gray-500);text-transform:uppercase">
          <input id="gb-publish-select-all" type="checkbox" checked onchange="GradebookController.togglePublishSelection(this.checked)" aria-label="Select all eligible students" style="accent-color:var(--maroon);width:16px;height:16px">
          <span>Student</span><span style="text-align:center">1st</span><span style="text-align:center">2nd</span><span style="text-align:center">3rd</span><span style="text-align:center">4th</span>
        </div>
        <div id="gb-publish-student-list" style="max-height:min(50vh,420px);overflow-y:auto;border:1px solid var(--gray-100);border-radius:8px">
          ${studentRows}
        </div>
        <div id="gb-publish-selection-count" style="font-size:12px;color:var(--gray-500);margin-top:10px"></div>`;
      Modal.show(
        'Publish Report Card Grades',
        body,
        `<button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
         <button class="btn btn-primary" id="gb-publish-confirm" onclick="GradebookController.publishSelectedGrades()">Publish</button>`,
        { wide: true, onClose: () => { this._publishModalData = null; } },
      );
      this.updatePublishSelection();
    } catch (err) {
      if (requestId !== this._publishLoadRequestId) return;
      console.error('[Gradebook] failed loading term grades for publishing:', err);
      Modal.close();
      Toast.show('Could not load all term grades: ' + err.message, 'error');
    }
  },

  updatePublishSelection() {
    const data = this._publishModalData;
    if (!data) return;
    const publishAllTerms = document.getElementById('gb-publish-all-terms')?.checked ?? true;
    const eligibleTerms = publishAllTerms ? ['1st', '2nd', '3rd', '4th'] : [data.currentTerm];
    const checkboxes = [...document.querySelectorAll('#gb-publish-student-list .gb-publish-student')];
    let selectedCount = 0;
    let gradeCount = 0;
    checkboxes.forEach(checkbox => {
      const studentId = Number(checkbox.value);
      const hasGrade = eligibleTerms.some(term =>
        data.termGrades[term].get(studentId)?.initialGrade != null,
      );
      checkbox.disabled = !hasGrade;
      if (!hasGrade) checkbox.checked = false;
      if (checkbox.checked && hasGrade) {
        selectedCount++;
        gradeCount += eligibleTerms.filter(term =>
          data.termGrades[term].get(studentId)?.initialGrade != null,
        ).length;
      }
    });
    const selectAll = document.getElementById('gb-publish-select-all');
    const eligibleCheckboxes = checkboxes.filter(checkbox => !checkbox.disabled);
    const selectedEligibleCount = eligibleCheckboxes.filter(checkbox => checkbox.checked).length;
    if (selectAll) {
      selectAll.disabled = eligibleCheckboxes.length === 0;
      selectAll.checked = eligibleCheckboxes.length > 0 && selectedEligibleCount === eligibleCheckboxes.length;
      selectAll.indeterminate = selectedEligibleCount > 0 && selectedEligibleCount < eligibleCheckboxes.length;
    }
    const count = document.getElementById('gb-publish-selection-count');
    if (count) {
      count.textContent = `${selectedCount} student${selectedCount === 1 ? '' : 's'} selected · ${gradeCount} term grade${gradeCount === 1 ? '' : 's'} to publish`;
    }
    const button = document.getElementById('gb-publish-confirm');
    if (button) {
      button.disabled = gradeCount === 0;
      button.textContent = `Publish ${gradeCount} Grade${gradeCount === 1 ? '' : 's'}`;
    }
  },

  togglePublishTerms(publishAllTerms) {
    const data = this._publishModalData;
    if (!data) return;
    const eligibleTerms = publishAllTerms ? ['1st', '2nd', '3rd', '4th'] : [data.currentTerm];
    document.querySelectorAll('#gb-publish-student-list .gb-publish-student').forEach(checkbox => {
      const studentId = Number(checkbox.value);
      const hasGrade = eligibleTerms.some(term =>
        data.termGrades[term].get(studentId)?.initialGrade != null,
      );
      checkbox.disabled = !hasGrade;
      checkbox.checked = hasGrade;
    });
    this.updatePublishSelection();
  },

  togglePublishSelection(checked) {
    document.querySelectorAll('#gb-publish-student-list .gb-publish-student:not(:disabled)')
      .forEach(checkbox => { checkbox.checked = checked; });
    this.updatePublishSelection();
  },

  async publishSelectedGrades() {
    const data = this._publishModalData;
    if (!data) {
      Modal.close();
      Toast.show('Publishing selection is no longer available. Open the window again.', 'error');
      return;
    }
    const selectedIds = new Set(
      [...document.querySelectorAll('#gb-publish-student-list .gb-publish-student:checked')]
        .map(checkbox => Number(checkbox.value)),
    );
    const terms = document.getElementById('gb-publish-all-terms')?.checked
      ? ['1st', '2nd', '3rd', '4th']
      : [data.currentTerm];
    const updates = [];
    selectedIds.forEach(studentId => {
      const student = data.students.find(item => item.id === studentId);
      if (!student) return;
      terms.forEach(term => {
        const scores = data.termGrades[term].get(studentId);
        if (scores?.initialGrade != null) updates.push({ student, term, scores });
      });
    });
    if (!updates.length) {
      Toast.show('Select at least one student with a calculated grade.', 'warning');
      return;
    }

    const button = document.getElementById('gb-publish-confirm');
    if (button) {
      button.disabled = true;
      button.textContent = 'Publishing…';
    }
    let published = 0;
    const failures = [];
    for (const { student, term, scores } of updates) {
      try {
        await api.publishStudentReportCardGrade({
          studentId: student.id,
          subjectId: data.subjectId,
          sectionId: data.sectionId,
          semester: data.semester,
          term,
          activityPct: scores.activityPct,
          attendancePct: scores.attendancePct,
          modulePct: scores.modulePct,
          isPublished: true,
        });
        published++;
      } catch (err) {
        failures.push({ student, term });
        console.error(`[Gradebook] bulk publish failed for student ${student.id}, ${term} Term:`, err);
      }
    }

    if (document.getElementById('gb-publish-confirm')) Modal.close();
    if (failures.length) {
      const failedNames = failures
        .slice(0, 3)
        .map(({ student, term }) =>
          `${student.user?.first_name || ''} ${student.user?.last_name || ''}`.trim() + ` (${term})`,
        )
        .join(', ');
      Toast.show(
        `Published ${published} of ${updates.length} grades. Failed for ${failures.length}: ${failedNames}${failures.length > 3 ? ', …' : ''}.`,
        published ? 'warning' : 'error',
      );
    } else {
      Toast.show(`Published ${published} report-card grades across ${terms.length} term${terms.length === 1 ? '' : 's'}.`, 'success');
    }
    if (
      this._currentSectionId === data.sectionId
      && this._currentSubjectId === data.subjectId
      && this._currentSemester === data.semester
      && this._currentTerm === data.currentTerm
    ) {
      await this._renderSubjectGrades();
    }
  },

  async openAdviserReportCard(sectionId, sectionName) {
    const requestId = ++this._renderRequestId;
    this._adviserSectionId = sectionId;
    this._adviserSectionName = sectionName;
    this._adviserStudentId = 'all';
    this._adviserSemester = '1st';
    const area = document.getElementById('content-area');
    if (!area) return;
    area.innerHTML = `<div class="empty-state" style="padding:48px">
      <div class="empty-state-icon">${LMS_ICONS.loading}</div>
      <div class="empty-state-title">Loading adviser report card…</div>
    </div>`;
    try {
      [this._adviserRows, this._adviserStudents] = await Promise.all([
        api.getAdviserReportCard(sectionId, this._adviserSemester),
        api.getSectionStudents(sectionId),
      ]);
      if (requestId !== this._renderRequestId) return;
      area.innerHTML = TeacherView.adviserReportCard(
        sectionName,
        sectionId,
        this._adviserSemester,
        this._adviserRows,
        this._adviserStudents,
        this._adviserStudentId,
      );
    } catch (err) {
      if (requestId !== this._renderRequestId) return;
      console.error('[Gradebook] adviser report card load error:', err);
      area.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">${LMS_ICONS.warning}</div>
        <div class="empty-state-title">Could not load adviser report card</div>
        <div class="empty-state-sub">${escHtml(err.message)}</div>
        <button class="btn btn-primary mt-3" onclick="DashboardController.loadSection('grades')">Back to Grades</button>
      </div>`;
      Toast.show('Could not load adviser report card: ' + err.message, 'error');
    }
  },

  async onAdviserSemesterChange() {
    const semester = document.getElementById('adviser-report-semester')?.value;
    if (!semester || !this._adviserSectionId) return;
    const requestId = ++this._renderRequestId;
    this._adviserSemester = semester;
    try {
      this._adviserRows = await api.getAdviserReportCard(this._adviserSectionId, semester);
      if (requestId !== this._renderRequestId) return;
      const area = document.getElementById('content-area');
      if (area) area.innerHTML = TeacherView.adviserReportCard(
        this._adviserSectionName,
        this._adviserSectionId,
        semester,
        this._adviserRows,
        this._adviserStudents,
        this._adviserStudentId,
      );
    } catch (err) {
      if (requestId !== this._renderRequestId) return;
      console.error('[Gradebook] adviser report card semester change error:', err);
      Toast.show('Could not load report card semester: ' + err.message, 'error');
    }
  },

  onAdviserStudentChange() {
    const select = document.getElementById('adviser-report-student');
    if (!select) return;
    this._adviserStudentId = select.value || 'all';
    const area = document.getElementById('content-area');
    if (area) area.innerHTML = TeacherView.adviserReportCard(
      this._adviserSectionName,
      this._adviserSectionId,
      this._adviserSemester,
      this._adviserRows,
      this._adviserStudents,
      this._adviserStudentId,
    );
  },

  async exportAdviserReportCards() {
    const students = new Map();
    (this._adviserStudents || []).forEach(student => {
      students.set(String(student.id), {
        id: student.id,
        name: `${student.user?.first_name || ''} ${student.user?.last_name || ''}`.trim()
          || `Student #${student.id}`,
        studentNumber: student.student_number || '',
        records: [],
      });
    });
    (this._adviserRows || []).forEach(row => {
      const studentKey = String(row.student_id);
      if (!students.has(studentKey)) {
        students.set(studentKey, {
          id: row.student_id,
          name: row.student_name || `Student #${row.student_id}`,
          studentNumber: row.student_number || '',
          records: [],
        });
      }
      students.get(studentKey).records.push(row);
    });

    const allStudents = [...students.values()].sort((a, b) => a.name.localeCompare(b.name));
    const selectedStudents = this._adviserStudentId === 'all'
      ? allStudents
      : allStudents.filter(student => String(student.id) === String(this._adviserStudentId));
    if (!selectedStudents.length) {
      Toast.show('No report cards are available to export.', 'error');
      return;
    }

    try {
      await this._ensureSheetJS();
      const XLSX = window.XLSX;
      const workbook = XLSX.utils.book_new();
      const schoolYear = this._adviserRows?.[0]?.school_year || '—';
      const usedSheetNames = new Set();

      selectedStudents.forEach((student, studentIndex) => {
        const subjectRows = student.records.length
          ? student.records.map(record => {
            const termGrades = [
              record.first_term_grade,
              record.second_term_grade,
              record.third_term_grade,
              record.fourth_term_grade,
            ];
            const finalGrade = termGrades.every(value => value != null)
              ? termGrades.reduce((sum, value) => sum + Number(value), 0) / termGrades.length
              : '';
            return [
              record.subject_name || 'Subject',
              ...termGrades.map(value => value == null ? '' : Number(value)),
              finalGrade,
            ];
          })
          : [['No enrolled subjects or report-card grades', '', '', '', '', '']];
        const worksheetRows = [
          ['INFANT JESUS LEARNING ACADEMY'],
          ['STUDENT REPORT CARD'],
          [],
          ['Student Name', student.name, '', 'Student Number', student.studentNumber || '—', ''],
          ['School Year', schoolYear, '', 'Semester', `${this._adviserSemester} Semester`, ''],
          [],
          ['Subject', '1st Term', '2nd Term', '3rd Term', '4th Term', 'Final Grade'],
          ...subjectRows,
          [],
          ['Final grade is the average of all four term grades and is shown only when all four are available.'],
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(worksheetRows);
        worksheet['!cols'] = [
          { wch: 36 }, { wch: 16 }, { wch: 16 },
          { wch: 16 }, { wch: 16 }, { wch: 16 },
        ];
        worksheet['!margins'] = {
          left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2,
        };
        worksheet['!rows'] = [];
        worksheet['!rows'][0] = { hpt: 26 };
        worksheet['!rows'][1] = { hpt: 22 };
        worksheet['!rows'][2] = { hpt: 10 };
        worksheet['!rows'][5] = { hpt: 10 };
        worksheet['!rows'][6] = { hpt: 24 };
        const noteRow = worksheetRows.length - 1;
        worksheet['!merges'] = [
          { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
          { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
          { s: { r: 3, c: 1 }, e: { r: 3, c: 2 } },
          { s: { r: 3, c: 4 }, e: { r: 3, c: 5 } },
          { s: { r: 4, c: 1 }, e: { r: 4, c: 2 } },
          { s: { r: 4, c: 4 }, e: { r: 4, c: 5 } },
          { s: { r: noteRow, c: 0 }, e: { r: noteRow, c: 5 } },
        ];
        const firstGradeRow = 7;
        const lastGradeRow = firstGradeRow + subjectRows.length - 1;
        for (let row = firstGradeRow; row <= lastGradeRow; row++) {
          for (let column = 1; column <= 5; column++) {
            const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
            if (cell && typeof cell.v === 'number') cell.z = '0.00';
          }
        }

        const baseSheetName = String(student.name || `Student ${studentIndex + 1}`)
          .replace(/[\\/?*[\]:]/g, '')
          .trim() || `Student ${studentIndex + 1}`;
        let sheetName = baseSheetName.slice(0, 31);
        if (usedSheetNames.has(sheetName.toLowerCase())) {
          const suffix = `_${student.id || studentIndex + 1}`;
          sheetName = `${baseSheetName.slice(0, 31 - suffix.length)}${suffix}`;
        }
        usedSheetNames.add(sheetName.toLowerCase());
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      });

      const slug = value => String(value || 'all')
        .replace(/[^a-z0-9_-]+/gi, '_')
        .replace(/^_+|_+$/g, '') || 'all';
      const studentLabel = this._adviserStudentId === 'all'
        ? 'all-students'
        : selectedStudents[0].name;
      const date = new Date().toISOString().slice(0, 10);
      const fileName = `Report_Cards_${slug(this._adviserSectionName)}_${slug(this._adviserSemester)}_${slug(studentLabel)}_${date}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      Toast.show(`Exported: ${fileName}`, 'success');
    } catch (err) {
      console.error('[Gradebook] adviser report card export error:', err);
      Toast.show('Could not export report cards: ' + err.message, 'error');
    }
  },

  async _saveReportCardDrafts(students, context) {
    const activeSubject = this._subjectsForSemester(context.semester)
      .find(subject => subject.subject_id === context.subjectId);
    if (!activeSubject) return;

    const updates = students
      .map(student => {
        const scores = TeacherView.gradebookScores(student, context.activities, context.modules);
        if (scores.initialGrade === null) return null;
        const values = {
          studentId: student.id,
          subjectId: context.subjectId,
          sectionId: context.sectionId,
          semester: context.semester,
          term: context.term,
          activityPct: scores.activityPct,
          attendancePct: scores.attendancePct,
          modulePct: scores.modulePct,
          isPublished: false,
        };
        const key = `${student.id}:${context.sectionId}:${context.subjectId}:${activeSubject.subject_school_year || ''}:${context.semester}:${context.term}`;
        const signature = JSON.stringify([
          values.activityPct,
          values.attendancePct,
          values.modulePct,
        ]);
        if (this._reportCardDraftSignatures[key] === signature) return null;
        return { key, signature, values };
      })
      .filter(Boolean);
    if (!updates.length) return;

    const results = await Promise.allSettled(updates.map(async update => {
      await api.publishStudentReportCardGrade(update.values);
      this._reportCardDraftSignatures[update.key] = update.signature;
    }));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) {
      failures.forEach(result => console.error('[Gradebook] report-card draft save error:', result.reason));
      Toast.show(`Could not save ${failures.length} report-card draft grade(s).`, 'error');
    }
  },

  // ── Core: fetch data for current subject+term and re-render table ─────────
  async _renderSubjectGrades() {
    const area = document.getElementById('content-area');
    if (!area) return;

    const requestId = ++this._renderRequestId;
    const subjectId = this._currentSubjectId;
    const term      = this._currentTerm;
    const semester  = this._currentSemester;
    const subjectsForSemester = this._subjectsForSemester(semester);
    const filterSummary = document.getElementById('gb-filter-summary');
    if (!subjectId || !subjectsForSemester.some(subject => subject.subject_id === subjectId)) {
      const wrap = document.getElementById('gb-table-wrap');
      if (filterSummary) filterSummary.textContent = `No subjects are assigned for ${semester} Semester.`;
      if (wrap) wrap.innerHTML = `<div class="empty-state" style="padding:40px">
        <div class="empty-state-title">No subjects are assigned for ${escHtml(semester)} Semester.</div>
      </div>`;
      return;
    }
    const selectedSubject = subjectsForSemester.find(subject => subject.subject_id === subjectId);
    if (filterSummary) {
      filterSummary.innerHTML = `Showing <strong>${escHtml(semester)} Semester</strong> grades for <strong style="color:var(--maroon)">${escHtml(selectedSubject.subject_name || '')}</strong> — <strong>${escHtml(this._currentTerm)} Term</strong>`;
    }
    const cacheKey  = `${subjectId}_${term}`;

    // Show loading state in the table only (keep header/dropdowns intact)
    const tableWrap = document.getElementById('gb-table-wrap');
    if (tableWrap) {
      tableWrap.innerHTML = `<div class="empty-state" style="padding:40px">
        <div class="empty-state-icon">${LMS_ICONS.loading}</div>
        <div class="empty-state-title">Loading grades…</div>
      </div>`;
    } else {
      // First render — paint the full shell including dropdowns
      area.innerHTML = TeacherView.gradebookSection(
        this._currentName,
        this._classSubjects,
        subjectId,
        semester,
        term,
        this._allStudents,
        [],    // activities — loading
        [],    // modules    — loading
        { students: [], total_meetings: 0 },
        [],
        this._adviserSectionIds.has(this._currentSectionId),
        true,  // loading flag
      );
      DashboardController._attachSearch();
    }

    try {
      // Use cache if already fetched
      let cached = this._subjectCache[cacheKey];
      if (!cached) {
        const [activities, modules, attendance, moduleReadsData] = await Promise.all([
          api.getTeacherActivities({ subject_id: subjectId, section_id: this._currentSectionId, term }),
          api.getMyModules(subjectId, term, this._currentSectionId),
          api.getAttendanceSectionStudents(this._currentSectionId, { subjectId, term }),
          api.getClassModuleReads(subjectId, this._currentSectionId, term),
        ]);

        // Fetch submissions per activity
        const activitiesWithSubs = await Promise.all(
          activities.filter(act => act.is_published === true).map(act =>
            api.getActivitySubmissions(act.id)
              .then(subs => {
                if (!Array.isArray(subs)) throw new Error(`Invalid submissions response for activity ${act.id}.`);
                return { ...act, _submissions: subs };
              })
          )
        );
        const publishedModules = modules.filter(module => module.is_published === true);

        cached = {
          activities: activitiesWithSubs, modules: publishedModules, attendance,
          moduleReads: moduleReadsData.module_reads || {},
          readModuleIds: moduleReadsData.read_module_ids || {},
        };
        this._subjectCache[cacheKey] = cached;
      }

      const { activities, modules, attendance, moduleReads, readModuleIds } = cached;
      const activeSubject = subjectsForSemester.find(subject => subject.subject_id === subjectId);
      const reportCards = await api.getTeacherReportCardGrades({
        sectionId: this._currentSectionId,
        subjectId,
        semester,
        schoolYear: activeSubject.subject_school_year || '',
      });
      if (requestId !== this._renderRequestId) return;

      // Annotate students with attendance and module reads for this subject+term
      const attMap   = {};
      (attendance.students || []).forEach(s => { attMap[s.id] = s; });

      const studentsAnnotated = this._allStudents.map(stu => ({
        ...stu,
        _modulesRead: moduleReads[stu.id] ?? 0,
        _readModuleIds: readModuleIds[stu.id] || [],
        _attPresent:  attMap[stu.id]?.present ?? 0,
        _attLate:     attMap[stu.id]?.late ?? 0,
        _attTotal:    (attMap[stu.id]?.present ?? 0) +
                      (attMap[stu.id]?.absent ?? 0) +
                      (attMap[stu.id]?.late ?? 0),
      }));

      this._lastExportData = {
        sectionName:  this._currentName,
        subjectName:  activeSubject?.subject_name || '',
        subjectId,
        sectionId: this._currentSectionId,
        semester,
        term,
        students:     studentsAnnotated,
        activities,
        modules,
        reportCards,
      };

      // Full re-render
      area.innerHTML = TeacherView.gradebookSection(
        this._currentName,
        this._classSubjects,
        subjectId,
        semester,
        term,
        studentsAnnotated,
        activities,
        modules,
        attendance,
        reportCards,
        this._adviserSectionIds.has(this._currentSectionId),
        false,
      );
      DashboardController._attachSearch();
      this._saveReportCardDrafts(studentsAnnotated, {
        subjectId,
        sectionId: this._currentSectionId,
        semester,
        term,
        activities,
        modules,
      }).catch(err => {
        console.error('[Gradebook] report-card draft preparation error:', err);
        Toast.show('Could not prepare report-card draft grades: ' + err.message, 'error');
      });

    } catch (err) {
      if (requestId !== this._renderRequestId) return;
      console.error('[Gradebook] _renderSubjectGrades error:', err);
      Toast.show('Failed to load subject grades: ' + err.message, 'error');
      const currentTable = document.getElementById('gb-table-wrap');
      if (currentTable) {
        currentTable.innerHTML = `<div class="empty-state" style="padding:40px">
          <div class="empty-state-icon">${LMS_ICONS.warning}</div>
          <div class="empty-state-title">Could not load gradebook data</div>
          <div class="empty-state-sub">${escHtml(err.message)}</div>
          <button class="btn btn-primary mt-3" onclick="GradebookController.onFilterChange()">Retry</button>
        </div>`;
      }
    }
  },

  // ── Per-student breakdown modal ───────────────────────────────────────────
  viewStudentBreakdown(studentId, studentName) {
    if (!this._lastExportData) { Toast.show('No gradebook loaded', 'error'); return; }
    const { activities, modules, subjectName, term, students } = this._lastExportData;
    const readIds = new Set(students?.find(s => s.id === studentId)?._readModuleIds || []);

    const TYPE_LABELS = { quiz:'Quiz', long_quiz:'Long Quiz', task_performance:'Task Performance',
      exam:'Exam', lab_exercise:'Lab Exercise', assignment:'Assignment', other:'Other' };

    const actCards = activities.map(act => {
      const sub      = act._submissions?.find(s => s.student_id === studentId);
      const score    = sub?.is_graded && sub?.score != null ? sub.score : null;
      const maxScore = sub?.max_score > 0 ? sub.max_score : (act.max_score ?? 0);
      const pct      = score !== null && maxScore > 0 ? Math.round(score / maxScore * 100) : null;
      const statusBadge = !sub
        ? `<span class="badge badge-gray" style="font-size:10px">Not submitted</span>`
        : !sub.is_graded
          ? `<span class="badge badge-gold" style="font-size:10px">Pending grade</span>`
          : `<span class="badge badge-green" style="font-size:10px">Graded</span>`;
      const pctBadge = pct !== null
        ? `<span class="badge ${pct >= 75 ? 'badge-green' : 'badge-danger'}" style="font-size:10px">${pct}%</span>`
        : '—';
      const typeLabel = TYPE_LABELS[act.activity_type] || act.activity_type || '—';
      return `
        <div style="background:var(--gray-50,#faf9f9);border:1px solid var(--gray-100,#f0e8e8);border-radius:8px;padding:10px 12px;margin-bottom:8px">
          <div style="font-weight:600;font-size:13px;color:var(--maroon);margin-bottom:6px">${escHtml(act.title)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:4px">
            <span style="color:var(--gray-400);font-size:11px;text-transform:uppercase;letter-spacing:.3px">Type</span>
            <span><span class="badge badge-maroon" style="font-size:10px">${escHtml(typeLabel)}</span></span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:4px">
            <span style="color:var(--gray-400);font-size:11px;text-transform:uppercase;letter-spacing:.3px">Score</span>
            <span style="font-weight:700;color:var(--maroon)">${score !== null ? `${score}/${maxScore}` : `—/${maxScore}`}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;margin-bottom:4px">
            <span style="color:var(--gray-400);font-size:11px;text-transform:uppercase;letter-spacing:.3px">%</span>
            <span>${pctBadge}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px">
            <span style="color:var(--gray-400);font-size:11px;text-transform:uppercase;letter-spacing:.3px">Status</span>
            <span>${statusBadge}</span>
          </div>
        </div>`;
    }).join('') || '<div style="color:var(--gray-400);font-size:13px;text-align:center;padding:12px">No activities</div>';

    const modCards = modules.map(mod => {
      const wasRead = readIds.has(mod.id);
      const badge = wasRead
        ? `<span class="badge badge-green" style="font-size:10px">Read</span>`
        : `<span class="badge badge-gray" style="font-size:10px">Not read</span>`;
      return `
      <div style="background:var(--gray-50,#faf9f9);border:1px solid var(--gray-100,#f0e8e8);border-radius:8px;padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;font-weight:600;color:var(--maroon)">${escHtml(mod.title)}</span>
        ${badge}
      </div>`;
    }).join('') || '<div style="color:var(--gray-400);font-size:13px;text-align:center;padding:12px">No modules</div>';

    const body = `
      <div style="font-weight:600;font-size:15px;margin-bottom:4px;color:var(--maroon)">${lmsIcon('clipboard')} ${escHtml(studentName)}</div>
      <div style="font-size:12px;color:var(--gray-400);margin-bottom:14px">${escHtml(subjectName)} · ${escHtml(term)} Term</div>
      <div style="margin-bottom:8px;font-size:12px;font-weight:600;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px">Activities</div>
      <div style="margin-bottom:16px">${actCards}</div>
      <div style="margin-bottom:8px;font-size:12px;font-weight:600;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px">Modules</div>
      <div>${modCards}</div>`;

    Modal.show(`Student Breakdown`, body,
      `<button class="btn btn-ghost" onclick="Modal.close()">Close</button>`
    );
  },

  // ── Excel Export — scoped to current subject + term ───────────────────────
  async exportSection() {
    const data = this._lastExportData;
    if (!data) { Toast.show('No gradebook data to export.', 'error'); return; }

    try {
      await this._ensureSheetJS();
    } catch (e) {
      Toast.show('Could not load Excel library: ' + e.message, 'error');
      return;
    }

    const { sectionName, subjectName, term, students, activities, modules } = data;

    const headerRow = [
      'Student Name', 'LRN / Student No.',
      `Activities Submitted (/${activities.length})`, 'Activity Score %',
      `Modules (/${modules.length})`, 'Attendance Present', 'Eligible Meetings (excused excluded)', 'Attendance % (Present+Late×0.5)',
      'Initial Grade (75/15/10 %)', 'Transmuted Grade (DepEd)', 'Passing Status',
    ];

    const dataRows = students.map(stu => {
      const studentId  = stu.id;
      const fullName   = `${stu.user?.first_name || ''} ${stu.user?.last_name || ''}`.trim() || `Student #${studentId}`;
      const studentNum = stu.student_number || '';

      const stuSubs = activities.reduce((acc, act) => {
        const sub = act._submissions?.find(s => s.student_id === studentId);
        if (sub) acc.push({ act, sub });
        return acc;
      }, []);

      const readCount     = stu._modulesRead ?? 0;
      const attPresent    = stu._attPresent ?? 0;
      const attTotal      = stu._attTotal   ?? 0;
      const { activityPct, attendancePct, initialGrade, transmutedGrade } =
        TeacherView.gradebookScores(stu, activities, modules);

      return [
        fullName, studentNum, stuSubs.length,
        activityPct   !== null ? activityPct   / 100 : '',
        readCount,
        attPresent, attTotal,
        attendancePct !== null ? attendancePct / 100 : '',
        initialGrade !== null ? initialGrade / 100 : '',
        transmutedGrade ?? '',
        transmutedGrade === null ? '' : transmutedGrade >= 75 ? 'Passing' : 'Below passing',
      ];
    });

    // Activity breakdown sheet
    const actHeaderRow = [
      'Student Name', 'LRN / Student No.',
      ...activities.map(a => a.title),
      'Total Earned', 'Total Possible', 'Activity %',
    ];
    const actDataRows = students.map(stu => {
      const studentId  = stu.id;
      const fullName   = `${stu.user?.first_name || ''} ${stu.user?.last_name || ''}`.trim();
      const studentNum = stu.student_number || '';
      let totalEarned = 0, totalPossible = 0;
      const scores = activities.map(act => {
        const sub = act._submissions?.find(s => s.student_id === studentId);
        if (sub?.is_graded && sub?.score != null) {
          const maxScore = sub.max_score > 0 ? sub.max_score : act.max_score;
          totalEarned += sub.score;
          totalPossible += maxScore > 0 ? maxScore : 0;
          return `${sub.score}/${maxScore}`;
        }
        return '';
      });
      return [fullName, studentNum, ...scores, totalEarned || '', totalPossible || '',
        totalPossible > 0 ? totalEarned / totalPossible : ''];
    });

    const XLSX = window.XLSX;
    const wb   = XLSX.utils.book_new();

    const ws1 = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    ws1['!cols'] = [{ wch:28 },{ wch:18 },{ wch:20 },{ wch:16 },{ wch:18 },{ wch:14 },{ wch:14 },{ wch:24 },{ wch:22 },{ wch:22 },{ wch:18 }];
    for (let r = 1; r <= dataRows.length; r++) {
      [3, 7, 8].forEach(c => {
        const cell = XLSX.utils.encode_cell({ r, c });
        if (ws1[cell] && ws1[cell].v !== '') ws1[cell].z = '0.00%';
      });
    }
    XLSX.utils.book_append_sheet(wb, ws1, 'Grade Summary');

    const ws2 = XLSX.utils.aoa_to_sheet([actHeaderRow, ...actDataRows]);
    ws2['!cols'] = [{ wch:28 },{ wch:18 }, ...activities.map(() => ({ wch:16 })), { wch:14 },{ wch:14 },{ wch:14 }];
    const lastCol = actHeaderRow.length - 1;
    for (let r = 1; r <= actDataRows.length; r++) {
      const cell = XLSX.utils.encode_cell({ r, c: lastCol });
      if (ws2[cell] && ws2[cell].v !== '') ws2[cell].z = '0.00%';
    }
    XLSX.utils.book_append_sheet(wb, ws2, 'Activity Breakdown');

    const ws3 = XLSX.utils.aoa_to_sheet([
      ['DepEd Transmutation — DepEd Order No. 8, s. 2015'],
      ['Formula note', 'The Initial Grade is the shared 75/15/10 current-standing percentage. Missing components are omitted and remaining weights are proportionally redistributed.'],
      ['If Initial Grade >= 60', 'Transmuted Grade = min(100, 75 + floor((Initial Grade - 60) / 1.6 + 1e-9))'],
      ['If Initial Grade < 60', 'Transmuted Grade = min(100, 60 + floor(Initial Grade / 4 + 1e-9))'],
      ['Passing mark', '75'],
      [],
      ['Initial Grade', 'Expected Transmuted Grade'],
      [100, 100], [98.4, 99], [75, 84], [61.6, 76],
      [60, 75], [59.99, 74], [4, 61], [0, 60],
    ]);
    ws3['!cols'] = [{ wch:42 },{ wch:100 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'DepEd Transmutation');

    const safeName = `${sectionName}_${subjectName}_${term}`.replace(/[^a-z0-9]/gi, '_');
    const fileName = `Gradebook_${safeName}_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    Toast.show(`Exported: ${fileName}`, 'success');
  },

  _ensureSheetJS() {
    return new Promise((resolve, reject) => {
      if (window.XLSX) { resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload  = resolve;
      s.onerror = () => reject(new Error('Failed to load SheetJS.'));
      document.head.appendChild(s);
    });
  },
};
