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
  _currentClassId:    null,
  _currentSubjectId:  null, // active subject filter
  _currentName:       '',
  _currentTerm:       '1st',
  _classSubjects:     [],   // subjects for the open class
  _allStudents:       [],   // students in this class (fetched once)
  _subjectCache:      {},   // subjectId → { activities, modules, attendance }
  _lastExportData:    null,

  // ── Entry: load sections list ─────────────────────────────────────────────
  async loadSections() {
    const wrap = document.getElementById('gradebook-sections-wrap');
    try {
      const subjects = await api.getMySubjects();
      this._subjects = subjects || [];

      const sectionCount = new Set((subjects || []).map(s => s.class_id)).size;
      const countEl = document.getElementById('grade-count');
      if (countEl) countEl.textContent = `${sectionCount} section(s) assigned`;

      if (wrap) {
        wrap.innerHTML = TeacherView.gradebookSectionsList(subjects);
        DashboardController._attachSearch();
      }

      // Async student counts per section
      const classIds = [...new Set((subjects || []).map(s => s.class_id))];
      classIds.forEach(classId => {
        api.getClassStudents(classId)
          .then(students => {
            const el = document.getElementById(`student-count-${classId}`);
            if (el) {
              el.textContent = `${students.length} student${students.length !== 1 ? 's' : ''}`;
              el.className = 'badge badge-green';
            }
          })
          .catch(() => {
            const el = document.getElementById(`student-count-${classId}`);
            if (el) { el.textContent = '—'; el.className = 'badge badge-gray'; }
          });
      });

    } catch (err) {
      console.error('[Gradebook] loadSections error:', err);
      if (wrap) wrap.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <div class="empty-state-title">Failed to load sections</div>
        <div class="empty-state-sub">${escHtml(err.message)}</div>
      </div>`;
      Toast.show('Failed to load gradebook: ' + err.message, 'error');
    }
  },

  // ── Open a class → show first subject by default ──────────────────────────
  async openSection(classId, sectionName) {
    this._currentClassId  = classId;
    this._currentName     = sectionName;
    this._subjectCache    = {};   // clear cache on new class
    this._allStudents     = [];

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
      <div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-title">Building gradebook…</div></div>`;

    try {
      // Resolve subjects for this class
      let classSubjects = this._subjects.filter(s => s.class_id === classId);
      if (classSubjects.length === 0) {
        const allSubjects = await api.getMySubjects().catch(() => []);
        this._subjects    = allSubjects;
        classSubjects     = allSubjects.filter(s => s.class_id === classId);
      }
      this._classSubjects = classSubjects;

      if (classSubjects.length === 0) {
        area.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <div class="empty-state-title">No subjects found for this class</div>
          <button class="btn btn-primary mt-3" onclick="DashboardController.loadSection('grades')">← Back</button>
        </div>`;
        return;
      }

      // Fetch students once for this class
      this._allStudents = await api.getClassStudents(classId).catch(() => []);

      // Default: first subject, first term
      this._currentSubjectId = classSubjects[0].subject_id;
      this._currentTerm      = '1st';

      await this._renderSubjectGrades();

    } catch (err) {
      console.error('[Gradebook] openSection error:', err);
      Toast.show('Failed to load gradebook: ' + err.message, 'error');
      area.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
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

  // ── Core: fetch data for current subject+term and re-render table ─────────
  async _renderSubjectGrades() {
    const area = document.getElementById('content-area');
    if (!area) return;

    const subjectId = this._currentSubjectId;
    const term      = this._currentTerm;
    const cacheKey  = `${subjectId}_${term}`;

    // Show loading state in the table only (keep header/dropdowns intact)
    const tableWrap = document.getElementById('gb-table-wrap');
    if (tableWrap) {
      tableWrap.innerHTML = `<div class="empty-state" style="padding:40px">
        <div class="empty-state-icon">⏳</div>
        <div class="empty-state-title">Loading grades…</div>
      </div>`;
    } else {
      // First render — paint the full shell including dropdowns
      area.innerHTML = TeacherView.gradebookSection(
        this._currentName,
        this._classSubjects,
        subjectId,
        term,
        this._allStudents,
        [],    // activities — loading
        [],    // modules    — loading
        { students: [], total_meetings: 0 },
        true,  // loading flag
      );
      DashboardController._attachSearch();
    }

    try {
      // Use cache if already fetched
      let cached = this._subjectCache[cacheKey];
      if (!cached) {
        const [activities, modules, attendance, moduleReadsData] = await Promise.all([
          api.getTeacherActivities({ subject_id: subjectId }).catch(() => []),
          api.getMyModules(subjectId).catch(() => []),
          api.getAttendanceSectionStudents(this._currentClassId, { subjectId, term }).catch(() => ({ students: [], total_meetings: 0 })),
          api.getClassModuleReads(this._currentClassId).catch(() => ({ module_reads: {}, total_modules: 0 })),
        ]);

        // Fetch submissions per activity
        const activitiesWithSubs = await Promise.all(
          activities.map(act =>
            api.getActivitySubmissions(act.id)
              .then(subs => ({ ...act, _submissions: Array.isArray(subs) ? subs : [] }))
              .catch(() => ({ ...act, _submissions: [] }))
          )
        );

        cached = { activities: activitiesWithSubs, modules, attendance, moduleReads: moduleReadsData.module_reads || {} };
        this._subjectCache[cacheKey] = cached;
      }

      const { activities, modules, attendance, moduleReads } = cached;

      // Annotate students with attendance and module reads for this subject+term
      const attMap   = {};
      const attTotal = attendance.total_meetings || 0;
      (attendance.students || []).forEach(s => { attMap[s.id] = s; });

      const studentsAnnotated = this._allStudents.map(stu => ({
        ...stu,
        _modulesRead: moduleReads[stu.id] ?? 0,
        _attPresent:  attMap[stu.id]?.present ?? 0,
        _attTotal:    attTotal,
      }));

      this._lastExportData = {
        sectionName:  this._currentName,
        subjectName:  this._classSubjects.find(s => s.subject_id === subjectId)?.subject_name || '',
        term,
        students:     studentsAnnotated,
        activities,
        modules,
      };

      // Full re-render
      area.innerHTML = TeacherView.gradebookSection(
        this._currentName,
        this._classSubjects,
        subjectId,
        term,
        studentsAnnotated,
        activities,
        modules,
        attendance,
        false,
      );
      DashboardController._attachSearch();

    } catch (err) {
      console.error('[Gradebook] _renderSubjectGrades error:', err);
      Toast.show('Failed to load subject grades: ' + err.message, 'error');
    }
  },

  // ── Per-student breakdown modal ───────────────────────────────────────────
  viewStudentBreakdown(studentId, studentName) {
    if (!this._lastExportData) { Toast.show('No gradebook loaded', 'error'); return; }
    const { activities, modules, subjectName, term } = this._lastExportData;

    const TYPE_LABELS = { quiz:'Quiz', long_quiz:'Long Quiz', task_performance:'Task Performance',
      exam:'Exam', lab_exercise:'Lab Exercise', assignment:'Assignment', other:'Other' };

    const actCards = activities.map(act => {
      const sub      = act._submissions?.find(s => s.student_id === studentId);
      const score    = sub?.is_graded && sub?.score != null ? sub.score : null;
      const maxScore = act.max_score ?? 0;
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

    const modCards = modules.map(mod => `
      <div style="background:var(--gray-50,#faf9f9);border:1px solid var(--gray-100,#f0e8e8);border-radius:8px;padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;font-weight:600;color:var(--maroon)">${escHtml(mod.title)}</span>
        <span class="badge badge-gray" style="font-size:10px">—</span>
      </div>`
    ).join('') || '<div style="color:var(--gray-400);font-size:13px;text-align:center;padding:12px">No modules</div>';

    const body = `
      <div style="font-weight:600;font-size:15px;margin-bottom:4px;color:var(--maroon)">📋 ${escHtml(studentName)}</div>
      <div style="font-size:12px;color:var(--gray-400);margin-bottom:14px">${escHtml(subjectName)} · ${escHtml(term)} Quarter</div>
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
      `Modules (/${modules.length})`, 'Attendance Present', 'Attendance Total', 'Attendance %',
      'Overall %', 'Final Grade (PH)',
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

      let totalEarned = 0, totalPossible = 0;
      stuSubs.forEach(({ act, sub }) => {
        if (sub.is_graded && sub.score != null && act.max_score) {
          totalEarned   += sub.score;
          totalPossible += act.max_score;
        }
      });

      const activityPct   = totalPossible > 0 ? Math.round(totalEarned / totalPossible * 100) : null;
      const readCount     = stu._modulesRead ?? 0;
      const modulePct     = modules.length > 0 ? Math.round((readCount / modules.length) * 100) : 0;
      const attPresent    = stu._attPresent ?? 0;
      const attTotal      = stu._attTotal   ?? 0;
      const attendancePct = attTotal > 0 ? Math.round((attPresent / attTotal) * 100) : null;

      let overallPct = null;
      if (activityPct !== null || attendancePct !== null) {
        overallPct = Math.round(
          (activityPct  ?? 0) * 0.60 +
           modulePct          * 0.30 +
          (attendancePct ?? 0) * 0.10
        );
      }

      return [
        fullName, studentNum, stuSubs.length,
        activityPct   !== null ? activityPct   / 100 : '',
        readCount,
        attPresent, attTotal,
        attendancePct !== null ? attendancePct / 100 : '',
        overallPct    !== null ? overallPct    / 100 : '',
        overallPct    !== null ? TeacherView._toPhGrade(overallPct) : '',
      ];
    });

    // Activity breakdown sheet
    const actHeaderRow = [
      'Student Name', 'LRN / Student No.',
      ...activities.map(a => `${a.title} (/${a.max_score ?? '?'})`),
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
          totalEarned += sub.score; totalPossible += act.max_score ?? 0;
          return sub.score;
        }
        return '';
      });
      return [fullName, studentNum, ...scores, totalEarned || '', totalPossible || '',
        totalPossible > 0 ? totalEarned / totalPossible : ''];
    });

    const XLSX = window.XLSX;
    const wb   = XLSX.utils.book_new();

    const ws1 = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    ws1['!cols'] = [{ wch:28 },{ wch:18 },{ wch:20 },{ wch:16 },{ wch:18 },{ wch:14 },{ wch:14 },{ wch:14 },{ wch:14 },{ wch:16 }];
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
      ['Final Grade','Range','Description'],
      ['1.00','97–100%','Excellent'],['1.25','93–96%','Very Good'],['1.50','89–92%','Good'],
      ['1.75','85–88%','Above Average'],['2.00','81–84%','Average'],['2.25','77–80%','Below Average'],
      ['2.50','73–76%','Passing'],['2.75','69–72%','Conditional'],['3.00','65–68%','Barely Passing'],
      ['5.00','Below 65%','Failed'],[],
      ['Formula:','',''],
      ['Overall % = (Activity% × 60%) + (Module Read% × 30%) + (Attendance% × 10%)','',''],
    ]);
    ws3['!cols'] = [{ wch:14 },{ wch:16 },{ wch:20 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Grade Scale');

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