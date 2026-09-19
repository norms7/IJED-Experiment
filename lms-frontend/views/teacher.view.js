/* ============================================================
   views/teacher.view.js
   Pure render functions for Teacher role — returns HTML strings only.
   No direct DOM manipulation; controllers handle that.
   ============================================================ */

"use strict";

// Self-contained copy of calendar.controller.js's _parseScheduleDays() —
// see student.view.js for why this file owns its own copy instead of
// depending on that other file's function being available.
function _teacherViewParseScheduleDays(scheduleStr) {
  if (!scheduleStr) return [];
  const m = String(scheduleStr).match(/^[A-Za-z]+/);
  if (!m) return [];
  const s = m[0];
  const tokenMap = [
    ['Sun', 0], ['Sat', 6], ['Tue', 2], ['Thu', 4], ['Mon', 1], ['Wed', 3], ['Fri', 5],
    ['Su', 0], ['Sa', 6], ['Th', 4], ['Tu', 2],
    ['M', 1], ['W', 3], ['F', 5],
    ['T', 2],
  ];
  const days = [];
  let i = 0;
  while (i < s.length) {
    let matched = false;
    for (const [tok, dow] of tokenMap) {
      if (s.slice(i, i + tok.length).toLowerCase() === tok.toLowerCase()) {
        if (!days.includes(dow)) days.push(dow);
        i += tok.length;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
  return days;
}

const TEACHER_SUBJECT_STYLES = {
  'Mathematics': { color: '#8b0020', icon: LMS_ICONS.calculator },
  'Science':     { color: '#2e6b3e', icon: LMS_ICONS.beaker },
  'English':     { color: '#1a4a8a', icon: LMS_ICONS.bookOpen },
  'Filipino':    { color: '#c04a00', icon: LMS_ICONS.globe },
  'MAPEH':       { color: '#6a0dad', icon: LMS_ICONS.palette },
};

const TeacherView = {

  dashboard(user, subjects = null, dashboardData = {}) {
    if (!subjects) {
      return `<div class="teacher-dashboard-loading"><div class="teacher-dashboard-hero"><div><p>Teacher workspace</p><h1>Loading your teaching day…</h1></div>${LMS_ICONS.school}</div><div class="empty-state"><div class="empty-state-icon">${LMS_ICONS.loading}</div><div class="empty-state-title">Loading dashboard data…</div></div>`;
    }

    const firstName = escHtml((user.full_name || user.name || 'Teacher').split(' ')[0]);
    const modules = Array.isArray(dashboardData.modules) ? dashboardData.modules : [];
    const activities = Array.isArray(dashboardData.activities) ? dashboardData.activities : [];
    const students = Array.isArray(dashboardData.students) ? dashboardData.students : [];
    const now = new Date();
    const todayLabel = now.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });
    const todaySubjects = subjects.filter(subject => {
      const days = _teacherViewParseScheduleDays(subject.schedule);
      return days.includes(now.getDay());
    });
    const publishedModules = modules.filter(module => module.is_published).length;
    const publishedActivities = activities.filter(activity => activity.is_published).length;
    const pendingGrades = activities.reduce((count, activity) => count + Number(activity.pending_submission_count || 0), 0);
    const dueActivities = activities
      .filter(activity => activity.due_date && activity.is_published)
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
      .slice(0, 5);
    const formatDate = value => new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    const scheduleHTML = todaySubjects.length
      ? todaySubjects.map(subject => `<div class="teacher-dashboard-list-row"><div class="teacher-dashboard-row-icon teacher-dashboard-row-icon--blue">${LMS_ICONS.clock}</div><div class="teacher-dashboard-row-main"><strong>${escHtml(subject.subject_name || 'Class')}</strong><span>${escHtml(subject.section_name || subject.class_name || 'Assigned section')}</span></div><div class="teacher-dashboard-row-meta">${escHtml(subject.schedule || 'Time not set')}<small>${escHtml(subject.grade_level || 'Today')}</small></div></div>`).join('')
      : `<div class="teacher-dashboard-empty"><span>${LMS_ICONS.clock}</span><div><strong>No classes scheduled today</strong><p>Use the time to prepare materials or review submissions.</p></div></div>`;
    const dueHTML = dueActivities.length
      ? dueActivities.map(activity => {
          const due = new Date(activity.due_date);
          const isPast = due < now;
          return `<div class="teacher-dashboard-list-row"><div class="teacher-dashboard-row-icon ${isPast ? 'teacher-dashboard-row-icon--red' : 'teacher-dashboard-row-icon--gold'}">${LMS_ICONS.calendar}</div><div class="teacher-dashboard-row-main"><strong>${escHtml(activity.title || 'Untitled activity')}</strong><span>${escHtml(activity._subject_name || 'Unknown subject')} · ${Number(activity.submission_count || 0)} submitted</span></div><div class="teacher-dashboard-row-meta ${isPast ? 'is-urgent' : ''}">${formatDate(activity.due_date)}<small>${isPast ? 'Past due' : 'Due date'}</small></div></div>`;
        }).join('')
      : `<div class="teacher-dashboard-empty"><span>${LMS_ICONS.calendar}</span><div><strong>No published deadlines</strong><p>Published activities with due dates will appear here.</p></div></div>`;
    const subjectHTML = subjects.length
      ? subjects.map((subject, index) => {
          const style = TEACHER_SUBJECT_STYLES[subject.subject_name] || { color: ['#7b1830', '#39717a', '#9a6a12', '#76506a'][index % 4], icon: LMS_ICONS.bookOpen };
          const subjectModules = modules.filter(module => module.subject_id === subject.subject_id);
          const subjectActivities = activities.filter(activity => activity.subject_id === subject.subject_id);
          return `<article class="teacher-dashboard-subject"><div class="teacher-dashboard-subject-icon" style="--teacher-accent:${style.color}">${style.icon}</div><div class="teacher-dashboard-subject-main"><strong>${escHtml(subject.subject_name || 'Untitled subject')}</strong><span>${escHtml(subject.section_name || subject.class_name || 'Assigned section')} · ${escHtml(subject.schedule || 'No schedule')}</span><div class="teacher-dashboard-subject-meta"><span>${subjectModules.length} module${subjectModules.length === 1 ? '' : 's'}</span><span>${subjectActivities.length} activit${subjectActivities.length === 1 ? 'y' : 'ies'}</span></div></div><button class="btn btn-xs btn-outline" onclick="DashboardController.loadSection('activities')">Open activities</button></article>`;
        }).join('')
      : `<div class="teacher-dashboard-empty"><span>${LMS_ICONS.bookOpen}</span><div><strong>No subjects assigned</strong><p>Contact your administrator to get teaching assignments.</p></div></div>`;

    return `<section class="teacher-dashboard-hero"><div><p class="teacher-dashboard-kicker">${todayLabel} · Teacher workspace</p><h1>Good day, ${firstName}.</h1><p>Stay ahead of your classes, resources, deadlines, and grading workload.</p></div><div class="teacher-dashboard-hero-mark">${LMS_ICONS.school}</div><div class="teacher-dashboard-hero-actions"><button class="btn btn-primary btn-sm" onclick="DashboardController.loadSection('activities')">${LMS_ICONS.plus} Create activity</button><button class="btn btn-outline btn-sm" onclick="DashboardController.loadSection('attendance')">${LMS_ICONS.clipboard} Take attendance</button></div></section>

      <div class="teacher-dashboard-stat-grid"><div class="teacher-dashboard-stat"><span class="teacher-dashboard-stat-icon teacher-dashboard-stat-icon--maroon">${LMS_ICONS.bookOpen}</span><div><strong>${subjects.length}</strong><span>Assigned subjects</span></div></div><div class="teacher-dashboard-stat"><span class="teacher-dashboard-stat-icon teacher-dashboard-stat-icon--blue">${LMS_ICONS.users}</span><div><strong>${students.length}</strong><span>Students reached</span></div></div><div class="teacher-dashboard-stat"><span class="teacher-dashboard-stat-icon teacher-dashboard-stat-icon--green">${LMS_ICONS.file}</span><div><strong>${publishedModules}</strong><span>Published modules</span></div></div><div class="teacher-dashboard-stat"><span class="teacher-dashboard-stat-icon teacher-dashboard-stat-icon--gold">${LMS_ICONS.edit}</span><div><strong>${pendingGrades}</strong><span>Need grading</span></div></div></div>

      <div class="teacher-dashboard-focus-grid"><section class="card teacher-dashboard-focus-card teacher-dashboard-focus-card--schedule"><div class="teacher-dashboard-card-heading"><div><span class="teacher-dashboard-eyebrow">Your timetable</span><h2>Schedule for today</h2></div><span class="teacher-dashboard-heading-icon">${LMS_ICONS.clock}</span></div><div class="teacher-dashboard-list">${scheduleHTML}</div><button class="teacher-dashboard-text-link" onclick="DashboardController.loadSection('calendar')">Open calendar <span>→</span></button></section><section class="card teacher-dashboard-focus-card teacher-dashboard-focus-card--due"><div class="teacher-dashboard-card-heading"><div><span class="teacher-dashboard-eyebrow">Planning view</span><h2>Activity deadlines</h2></div><span class="teacher-dashboard-heading-icon">${LMS_ICONS.calendar}</span></div><div class="teacher-dashboard-list">${dueHTML}</div><button class="teacher-dashboard-text-link" onclick="DashboardController.loadSection('activities')">Manage activities <span>→</span></button></section></div>

      <section class="card teacher-dashboard-subjects-card"><div class="teacher-dashboard-card-heading"><div><span class="teacher-dashboard-eyebrow">Teaching load</span><h2>My subjects and sections</h2></div><button class="btn btn-outline btn-sm" onclick="DashboardController.loadSection('my-subjects')">View details</button></div><div class="teacher-dashboard-subject-list">${subjectHTML}</div></section>`;
  },

  mySubjects(user, subjects = null) {
    if (!subjects) return `<div class="empty-state"><div class="empty-state-icon">${LMS_ICONS.loading}</div><div class="empty-state-title">Loading subjects…</div></div>`;
    if (subjects.length === 0) return `<div class="empty-state"><div class="empty-state-icon">${LMS_ICONS.book}</div><div class="empty-state-title">No subjects assigned</div></div>`;
    const subjectFallbackColors = ['#7b1830', '#9a6a12', '#39717a', '#b16a32', '#76506a'];
    const rows = subjects.map((sub, index) => {
      const style = TEACHER_SUBJECT_STYLES[sub.subject_name] || {
        color: subjectFallbackColors[index % subjectFallbackColors.length],
      };
      return `
      <div class="subject-item" data-searchable>
        <div class="subject-color-dot" style="background:${style.color}"></div>
        <div style="width:30px;height:30px;color:${style.color};display:inline-flex;align-items:center;justify-content:center">${LMS_ICONS.book}</div>
        <div class="subject-info">
          <div class="subject-name">${escHtml(sub.subject_name)}</div>
          <div class="subject-teacher">${escHtml(sub.section_name)} · ${sub.schedule ? escHtml(sub.schedule) : 'No schedule'}</div>
        </div>
        <div class="subject-actions">
          <button class="btn btn-xs btn-outline" onclick="TeacherController.viewStudentsForSubject(${sub.subject_id}, ${sub.class_id}, '${escHtml(sub.subject_name)}')">${lmsIcon('users')} Students</button>
          <button class="btn btn-xs btn-outline" onclick="TeacherController.openAddModuleForSubject(${sub.subject_id}, ${sub.class_id})">${lmsIcon('upload')} Upload</button>
          <button class="btn btn-xs btn-primary" onclick="DashboardController.loadSection('modules')">${lmsIcon('clipboard')} Activities</button>
        </div>
      </div>
    `;
    }).join('');
    return `
      <div class="section-header">
        <div class="section-header-left"><h2>My Subjects</h2><p>Subjects assigned to you</p></div>
      </div>
      <div class="subject-list">${rows}</div>`;
  },

  modules(user, apiModules = null) {
    if (apiModules === null) {
      return `
        <div class="section-header">
          <div class="section-header-left"><h2>Modules</h2><p id="module-count">Loading…</p></div>
          <div class="section-header-right teacher-resource-header-actions"><div class="search-box"><span>${LMS_ICONS.search}</span><input type="text" id="global-search" placeholder="Search modules…" /></div><button class="btn btn-primary" onclick="TeacherController.openAddModule()">${lmsIcon('plus')} Add Module</button></div>
        </div>
        <div class="module-grid" id="teacher-module-grid"><div class="empty-state"><div class="empty-state-icon">${LMS_ICONS.loading}</div><div class="empty-state-title">Loading modules…</div></div></div>`;
    }

    const SUBJECT_STYLES = TEACHER_SUBJECT_STYLES;
    const TERM_ORDER = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };
    const termLabel = (t) => t ? `${t} Term` : 'No Term Set';
    const semesterLabel = (s) => s === 1 || s === '1' ? '1st Semester' : s === 2 || s === '2' ? '2nd Semester' : 'No Semester Set';

    const card = (m) => {
      const hasFile = !!m.file_url;
      const fileBtn = hasFile
        ? `<a class="btn btn-xs btn-primary" href="${escHtml(m.file_url)}" target="_blank" rel="noopener">${lmsIcon('fileOpen')} Open PDF</a>`
        : `<span class="btn btn-xs btn-outline" style="opacity:.5;cursor:default">No file</span>`;
      const meta = m.file_name ? `${lmsIcon('attachment')} ${escHtml(m.file_name)}` : '';
      return `<div class="module-card" data-searchable>
        <div class="module-card-header">
          <div class="module-card-title">${escHtml(m.title)}</div>
          <div class="module-card-desc">${escHtml(m.description || '')}</div>
        </div>
        <div class="module-card-footer">
          <span class="module-card-meta">${meta || 'No file attached'}</span>
          <div class="flex gap-1">${fileBtn}<button class="btn btn-xs btn-danger" onclick="TeacherController.deleteModule(${m.id})">${lmsIcon('trash')}</button></div>
        </div>
      </div>`;
    };

    // ── Group: subject_name -> semester -> term -> [modules] ──
    const bySubject = {};
    apiModules.forEach(m => {
      const subj = m._subject_name || 'Unknown';
      bySubject[subj] = bySubject[subj] || {};
      const sem = semesterLabel(m._semester);
      bySubject[subj][sem] = bySubject[subj][sem] || {};
      const term = m.term || null;
      bySubject[subj][sem][term] = bySubject[subj][sem][term] || [];
      bySubject[subj][sem][term].push(m);
    });

    const subjectNames = Object.keys(bySubject).sort();
    const groupsHTML = subjectNames.map(subj => {
      const style = SUBJECT_STYLES[subj] || { color: 'var(--maroon)', icon: LMS_ICONS.book };
      const semesterKeys = Object.keys(bySubject[subj]).sort(); // "1st Semester" < "2nd Semester" < "No Semester Set" alphabetically works here
      const semestersHTML = semesterKeys.map(sem => {
        const termKeys = Object.keys(bySubject[subj][sem]).sort((a, b) => {
          const av = a === 'null' ? 99 : (TERM_ORDER[a] || 98);
          const bv = b === 'null' ? 99 : (TERM_ORDER[b] || 98);
          return av - bv;
        });
        const termsHTML = termKeys.map(term => {
          const mods = bySubject[subj][sem][term];
          return `<div class="module-term-group" data-searchable-group>
            <div class="module-term-badge">${termLabel(term === 'null' ? null : term)} <span class="module-term-count">${mods.length}</span></div>
            <div class="module-grid">${mods.map(card).join('')}</div>
          </div>`;
        }).join('');
        return `<div class="module-semester-group" data-searchable-group>
          <div class="module-semester-label">${sem}</div>
          ${termsHTML}
        </div>`;
      }).join('');
      return `<div class="module-subject-group" data-searchable-group>
        <h3 class="module-subject-heading" style="color:${style.color}"><span class="module-subject-icon">${style.icon}</span>${escHtml(subj)}</h3>
        ${semestersHTML}
      </div>`;
    }).join('');

    const grid = groupsHTML || `<div class="empty-state"><div class="empty-state-icon">${LMS_ICONS.file}</div><div class="empty-state-title">No modules yet</div><button class="btn btn-primary" onclick="TeacherController.openAddModule()">Add Module</button></div>`;
    return `
      <div class="section-header">
        <div class="section-header-left"><h2>Modules</h2><p id="module-count">${apiModules.length} module(s) uploaded</p></div>
        <div class="section-header-right teacher-resource-header-actions"><div class="search-box"><span>${LMS_ICONS.search}</span><input type="text" id="global-search" placeholder="Search modules…" /></div><button class="btn btn-primary" onclick="TeacherController.openAddModule()">${lmsIcon('plus')} Add Module</button></div>
      </div>
      <div id="teacher-module-grid">${grid}</div>`;
  },

  activities(user, apiActivities = null) {
    const TYPE_LABELS = {
      quiz:             'Quiz',
      long_quiz:        'Long Quiz',
      task_performance: 'Task Performance',
      exam:             'Exam',
      lab_exercise:     'Laboratory Exercise',
      assignment:       'Assignment',
      other:            'Other',
    };
    const FORMAT_LABELS = {
      multiple_choice: 'Multiple Choice',
      checkbox:        'Checkbox',
      enumeration:     'Fill in Blank',
      freeform:        'Essay',
      assignment:      'Assignment',
      hybrid:          'Hybrid',
    };
    const TYPE_ICONS = {
      quiz: 'clipboard', long_quiz: 'clipboard', task_performance: 'target',
      exam: 'file', lab_exercise: 'beaker', assignment: 'file', other: 'file'
    };
    const FORMAT_ICONS = {
      multiple_choice: 'target', checkbox: 'check', enumeration: 'file',
      freeform: 'pen', assignment: 'clipboard', hybrid: 'transfer'
    };

    if (apiActivities === null) {
      return `
        <div class="section-header">
          <div class="section-header-left"><h2>Activities & Quizzes</h2><p id="act-count">Loading…</p></div>
          <div class="section-header-right teacher-activity-header-actions">
            <div class="search-box"><span>${LMS_ICONS.search}</span><input type="text" id="global-search" placeholder="Search activities…" /></div>
            <button class="btn btn-primary" onclick="TeacherController.openAddActivity()">${lmsIcon('plus')} Create Activity</button>
          </div>
        </div>
        <div id="teacher-activity-grid">
          <div class="empty-state"><div class="empty-state-icon">${LMS_ICONS.loading}</div><div class="empty-state-title">Loading activities…</div></div>
        </div>`;
    }

    if (!apiActivities.length) {
      return `
        <div class="section-header">
          <div class="section-header-left"><h2>Activities & Quizzes</h2><p>0 activities</p></div>
          <button class="btn btn-primary" onclick="TeacherController.openAddActivity()">${lmsIcon('plus')} Create Activity</button>
        </div>
        <div class="empty-state">
          <div class="empty-state-icon">${LMS_ICONS.clipboard}</div>
          <div class="empty-state-title">No activities yet</div>
          <div class="empty-state-sub">Create your first quiz, exam, or assignment for students.</div>
          <button class="btn btn-primary mt-3" onclick="TeacherController.openAddActivity()">${lmsIcon('plus')} Create Activity</button>
        </div>`;
    }

    const cards = apiActivities.map(a => {
      const typeLabel   = TYPE_LABELS[a.activity_type]  || a.activity_type;
      const formatLabel = FORMAT_LABELS[a.format_type]  || a.format_type;
      const typeIcon    = TYPE_ICONS[a.activity_type] || 'file';
      const formatIcon  = FORMAT_ICONS[a.format_type] || 'file';
      const gradeBadge  = a.grading_mode === 'auto'
        ? `<span class="badge badge-green" style="font-size:10px">${lmsIcon('check')} Auto</span>`
        : `<span class="badge badge-gold"  style="font-size:10px">${lmsIcon('pen')} Manual</span>`;
      const dueLabel   = a.due_date   ? `Due: ${new Date(a.due_date).toLocaleDateString()}`     : 'No due date';
      const startLabel = a.start_date ? `Opens: ${new Date(a.start_date).toLocaleDateString()}` : '';
      const qCount     = a.questions?.length ?? 0;
      const maxPts     = a.max_score ?? (a.questions?.reduce((s, q) => s + q.points, 0) ?? 0);
      const pubBadge   = a.is_published
        ? `<span class="badge badge-green" style="font-size:10px">Published</span>`
        : `<span class="badge badge-gray"  style="font-size:10px">Draft</span>`;
      const customType = a.activity_type === 'other' && a.activity_type_custom
        ? ` · ${escHtml(a.activity_type_custom)}` : '';

      return `
        <div class="activity-card" data-searchable style="border:1px solid var(--gray-200);border-radius:10px;padding:16px;background:white;margin-bottom:12px">
          <div class="teacher-activity-layout">
            <div class="teacher-activity-content">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
                <span class="badge badge-maroon" style="font-size:11px">${lmsIcon(typeIcon)}${escHtml(typeLabel)}${escHtml(customType)}</span>
                <span class="badge" style="background:var(--gray-100);color:var(--gray-700);font-size:11px">${lmsIcon(formatIcon)}${escHtml(formatLabel)}</span>
                ${gradeBadge}
                ${pubBadge}
              </div>
              <div style="font-weight:600;font-size:15px;margin-bottom:4px">${escHtml(a.title)}</div>
              ${a.instructions ? `<div style="font-size:12px;color:var(--gray-500);margin-bottom:6px">${escHtml(a.instructions.slice(0,120))}${a.instructions.length > 120 ? '…' : ''}</div>` : ''}
              <div class="teacher-activity-meta">
                <span>${lmsIcon('chart')} ${qCount} question${qCount !== 1 ? 's' : ''} · ${maxPts} pts</span>
                <span>${lmsIcon('calendar')} ${dueLabel}</span>
                <span>${startLabel ? `${lmsIcon('clock')} ${startLabel}` : '—'}</span>
                <span>${lmsIcon('inbox')} ${a.submission_count ?? 0} submitted${a.pending_submission_count ? ` · ${a.pending_submission_count} pending grade` : ''}</span>
              </div>
            </div>
            <div class="teacher-activity-actions">
              <button class="btn btn-xs btn-outline" onclick="TeacherController.openGradeActivity(${a.id})">${lmsIcon('chart')} Submissions</button>
              <button class="btn btn-xs btn-outline" onclick="TeacherController.openEditActivity(${a.id})">${lmsIcon('edit')} Edit</button>
              <button class="btn btn-xs btn-danger"  onclick="TeacherController.deleteActivity(${a.id})">${lmsIcon('trash')} Delete</button>
            </div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="section-header">
        <div class="section-header-left">
          <h2>Activities & Quizzes</h2>
          <p id="act-count">${apiActivities.length} activity(s)</p>
        </div>
        <div class="section-header-right teacher-activity-header-actions">
          <div class="search-box"><span>${LMS_ICONS.search}</span><input type="text" id="global-search" placeholder="Search activities…" /></div>
          <button class="btn btn-primary" onclick="TeacherController.openAddActivity()">${lmsIcon('plus')} Create Activity</button>
        </div>
      </div>
      <div id="teacher-activity-grid">${cards}</div>`;
  },

  // ── Digital Gradebook: Sections List ─────────────────────────────────────
  grades(user) {
    return `
      <div class="section-header">
        <div class="section-header-left">
          <h2>${lmsIcon('chart')} Digital Gradebook</h2>
          <p id="grade-count">Loading sections…</p>
        </div>
        <div class="section-header-right">
          <div class="search-box"><span>${LMS_ICONS.search}</span><input type="text" id="global-search" placeholder="Search sections…" /></div>
        </div>
      </div>
      <div id="gradebook-sections-wrap">
        <div class="empty-state"><div class="empty-state-icon">${LMS_ICONS.loading}</div><div class="empty-state-title">Loading sections…</div></div>
      </div>`;
  },

  // ── Sections list table ───────────────────────────────────────────────────
  gradebookSectionsList(subjects) {
    if (!subjects || subjects.length === 0) {
      return `<div class="empty-state">
        <div class="empty-state-icon">${LMS_ICONS.clipboard}</div>
        <div class="empty-state-title">No sections assigned</div>
        <div class="empty-state-sub">Contact your administrator to get sections assigned.</div>
      </div>`;
    }

    // Group by real SECTION — a class with multiple sections (e.g. "ICT G11"
    // containing both ICT1102 and ICT1103) must never merge their students
    // into one gradebook row (same fix already applied to Attendance).
    const sectionMap = {};
    subjects.forEach(sub => {
      const key = sub.section_id;
      if (!sectionMap[key]) {
        sectionMap[key] = {
          section_id:   sub.section_id,
          section_name: sub.section_name,
          class_id:     sub.class_id,
          class_name:   sub.class_name,
          grade_level:  sub.grade_level,
          subjects:     [],
        };
      }
      sectionMap[key].subjects.push(sub);
    });
    const sections = Object.values(sectionMap);

    const rows = sections.map(sec => `
      <tr data-searchable style="cursor:pointer" onclick="GradebookController.openSection(${sec.section_id}, '${escHtml(sec.section_name)}')">
        <td>
          <div style="font-weight:600;color:var(--maroon)">${escHtml(sec.section_name)}</div>
        </td>
        <td>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            ${sec.subjects.map(s => `<span class="badge badge-maroon" style="font-size:11px">${escHtml(s.subject_name)}</span>`).join('')}
          </div>
        </td>
        <td><span class="badge badge-gray" id="student-count-${sec.section_id}">Loading…</span></td>
        <td>
          <button class="btn btn-xs btn-primary" onclick="event.stopPropagation();GradebookController.openSection(${sec.section_id}, '${escHtml(sec.section_name)}')">
            ${lmsIcon('chart')} View Gradebook
          </button>
        </td>
      </tr>`).join('');

    return `
      <div class="card">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Section</th>
                <th>Subjects Handled</th>
                <th>Students</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  },

  // ── Section Gradebook Detail Page — per-subject, per-term ────────────────
  gradebookSection(sectionName, classSubjects, activeSubjectId, activeTerm, students, activities, modules, attendance, loading = false) {
    const studentCount    = students.length;
    const totalActivities = activities.length;
    const totalModules    = modules.length;
    const attTotal        = attendance?.total_meetings || 0;
    const activeSubject   = classSubjects.find(s => s.subject_id === activeSubjectId) || classSubjects[0] || {};

    // ── Subject dropdown ──────────────────────────────────────────────────
    const subjectOptions = classSubjects.map(s =>
      `<option value="${s.subject_id}" ${s.subject_id === activeSubjectId ? 'selected' : ''}>${escHtml(s.subject_name)}</option>`
    ).join('');

    const termOptions = ['1st', '2nd', '3rd', '4th'].map(t =>
      `<option value="${t}" ${t === activeTerm ? 'selected' : ''}>${t} Term</option>`
    ).join('');

    // ── Per-student grade rows ─────────────────────────────────────────────
    // Objective §4: Overall Score = Academic×75% + Attendance×15% + Module×10%
    // (previously 60/30/10 — stale weights that predate the school standard
    // being applied to the student-facing dashboard. A teacher viewing this
    // table must see the same numbers a student sees on their own
    // Performance Analytics page, or the two screens silently disagree.)
    const WEIGHT_ACTIVITIES = 0.75;
    const WEIGHT_ATTENDANCE = 0.15;
    const WEIGHT_MODULES    = 0.10;

    const rows = loading
      ? `<tr><td colspan="9" class="text-center text-muted" style="padding:40px">${LMS_ICONS.loading} Loading grades…</td></tr>`
      : (students.map(stu => {
          const studentId  = stu.id;
          const fullName   = `${stu.user?.first_name || ''} ${stu.user?.last_name || ''}`.trim() || `Student #${studentId}`;
          const studentNum = stu.student_number || stu.student_profile?.student_number || '—';

          const stuSubs = activities.reduce((acc, act) => {
            const sub = act._submissions?.find(s => s.student_id === studentId);
            if (sub) acc.push({ act, sub });
            return acc;
          }, []);
          const submittedCount = stuSubs.length;

          let totalEarned = 0, totalPossible = 0;
          stuSubs.forEach(({ act, sub }) => {
            const isApplicable = !act.due_date || new Date(act.due_date) <= new Date();
            if (!isApplicable) return;
            if (sub.is_graded && sub.score != null && (sub.max_score || act.max_score) > 0) {
              totalEarned   += sub.score;
              totalPossible += sub.max_score || act.max_score;
            } else if (sub && !sub.is_graded) {
              return;
            }
          });
          activities.forEach(act => {
            const sub = act._submissions?.find(s => s.student_id === studentId);
            const isApplicable = !act.due_date || new Date(act.due_date) <= new Date();
            if (!sub && isApplicable && act.max_score > 0) totalPossible += act.max_score;
          });
          const activityPct   = totalPossible > 0 ? Math.round(totalEarned / totalPossible * 100) : null;
          const readCount     = stu._modulesRead ?? 0;
          const attPresent    = stu._attPresent  ?? 0;
          const attLate       = stu._attLate     ?? 0;
          const stuAttTotal   = stu._attTotal    ?? 0;
          const modulePct     = totalModules > 0 ? Math.round((readCount / totalModules) * 100) : null;
          // Objective §2: Attendance Score = (Present + Late×0.5) / Total × 100
          const attendancePct = stuAttTotal  > 0 ? Math.round(((attPresent + attLate * 0.5) / stuAttTotal) * 100) : null;

          let overallPct = null;
          const components = [
            { value: activityPct, weight: WEIGHT_ACTIVITIES },
            { value: attendancePct, weight: WEIGHT_ATTENDANCE },
            { value: modulePct, weight: WEIGHT_MODULES },
          ].filter(component => component.value !== null);
          const weightTotal = components.reduce((sum, component) => sum + component.weight, 0);
          if (weightTotal) {
            overallPct = Math.round(components.reduce(
              (sum, component) => sum + component.value * (component.weight / weightTotal), 0
            ));
          }

          const finalGrade = overallPct !== null ? TeacherView._toPhGrade(overallPct) : '—';
          const gradeColor = finalGrade === '—' ? 'badge-gray'
            : parseFloat(finalGrade) <= 1.75 ? 'badge-green'
            : parseFloat(finalGrade) <= 2.50 ? 'badge-gold'
            : 'badge-danger';

          const actPctBadge = activityPct !== null
            ? `<span class="badge ${activityPct >= 75 ? 'badge-green' : 'badge-danger'}" style="font-size:11px">${activityPct}%</span>`
            : `<span class="badge badge-gray" style="font-size:11px">—</span>`;

          const attBadge = stuAttTotal > 0
            ? `<span style="font-weight:600">${attPresent}</span><span style="color:var(--gray-400)">${attLate > 0 ? ` +${attLate}L` : ''}/${stuAttTotal}</span>`
            : `<span class="badge badge-gray" style="font-size:11px">—</span>`;

          const overallBadge = overallPct !== null
            ? `<span class="badge ${overallPct >= 75 ? 'badge-green' : overallPct >= 60 ? 'badge-gold' : 'badge-danger'}" style="font-size:11px">${overallPct}%</span>`
            : `<span class="badge badge-gray" style="font-size:11px">—</span>`;

          return `<tr data-searchable>
            <td><div style="font-weight:600">${escHtml(fullName)}</div></td>
            <td style="font-size:13px;color:var(--gray-500)">${escHtml(studentNum)}</td>
            <td style="text-align:center">
              <span style="font-weight:600">${submittedCount}</span>/<span style="color:var(--gray-400)">${totalActivities}</span>
            </td>
            <td style="text-align:center">${actPctBadge}</td>
            <td style="text-align:center">
              <span style="font-weight:600">${readCount}</span>/<span style="color:var(--gray-400)">${totalModules}</span>
            </td>
            <td style="text-align:center">${attBadge}</td>
            <td style="text-align:center">${overallBadge}</td>
            <td style="text-align:center">
              <span class="badge ${gradeColor}" style="font-size:12px;font-weight:700">${escHtml(String(finalGrade))}</span>
            </td>
            <td>
              <button class="btn btn-xs btn-outline" onclick="GradebookController.viewStudentBreakdown(${studentId}, '${escHtml(fullName)}')">${lmsIcon('search')} Details</button>
            </td>
          </tr>`;
        }).join('') || `<tr><td colspan="9" class="text-center text-muted" style="padding:40px">No students enrolled.</td></tr>`);

    return `
      <!-- Header -->
      <div class="section-header">
        <div class="section-header-left">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn btn-ghost btn-sm" onclick="DashboardController.loadSection('grades')" style="padding:4px 8px">← Back</button>
            <div>
              <h2>${escHtml(sectionName)} <span style="font-size:16px;font-weight:400;color:var(--gray-400)">(${studentCount} students)</span></h2>
              <p>Grade Summary · AY ${new Date().getFullYear()}–${new Date().getFullYear() + 1}</p>
            </div>
          </div>
        </div>
        <div class="section-header-right teacher-resource-header-actions">
          <div class="search-box"><span>${LMS_ICONS.search}</span><input type="text" id="global-search" placeholder="Search students…" /></div>
          <button class="btn btn-outline btn-sm" onclick="GradebookController.exportSection()">${lmsIcon('download')} Export Excel</button>
        </div>
      </div>

      <!-- Subject + Term filter (mirrors Attendance UI) -->
      <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
        <select id="gb-subject-select" class="form-control" style="min-width:180px;max-width:260px"
          onchange="GradebookController.onFilterChange()">
          ${subjectOptions}
        </select>
        <select id="gb-term-select" class="form-control" style="min-width:130px;max-width:160px"
          onchange="GradebookController.onFilterChange()">
          ${termOptions}
        </select>
        <span style="font-size:12px;color:var(--gray-400)">
          Showing grades for <strong style="color:var(--maroon)">${escHtml(activeSubject.subject_name || '')}</strong> — <strong>${escHtml(activeTerm)} Term</strong>
        </span>
      </div>

      <!-- Stats bar -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(120px,100%),1fr));gap:10px;margin-bottom:16px">
        <div class="stat-card" style="padding:12px 14px;min-width:0">
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Total Students</div>
          <div style="font-size:clamp(18px,4vw,22px);font-weight:700;color:var(--maroon);line-height:1.2">${studentCount}</div>
        </div>
        <div class="stat-card" style="padding:12px 14px;min-width:0">
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Activities (75%)</div>
          <div style="font-size:clamp(18px,4vw,22px);font-weight:700;color:var(--maroon);line-height:1.2">${totalActivities}</div>
        </div>
        <div class="stat-card" style="padding:12px 14px;min-width:0">
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Attendance (15%)</div>
          <div style="font-size:clamp(14px,3.5vw,18px);font-weight:700;color:var(--maroon);line-height:1.2">${attTotal > 0 ? attTotal + ' mtgs' : '—'}</div>
        </div>
        <div class="stat-card" style="padding:12px 14px;min-width:0">
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Modules (10%)</div>
          <div style="font-size:clamp(18px,4vw,22px);font-weight:700;color:var(--maroon);line-height:1.2">${totalModules}</div>
        </div>
      </div>

      <!-- Grade table -->
      <div class="card">
        <div id="gb-table-wrap" class="table-wrap" style="-webkit-overflow-scrolling:touch">
          <table class="data-table" id="gradebook-table" style="min-width:640px">
            <thead>
              <tr>
                <th style="white-space:nowrap">STUDENT NAME</th>
                <th style="white-space:nowrap">LRN / STUD. NO.</th>
                <th style="text-align:center;white-space:nowrap">ACTS <span style="font-weight:400;font-size:10px;opacity:.75">(SUB/TOT)</span></th>
                <th style="text-align:center;white-space:nowrap">ACT% <span style="font-weight:400;font-size:10px;opacity:.75">(75%)</span></th>
                <th style="text-align:center;white-space:nowrap">MODS <span style="font-weight:400;font-size:10px;opacity:.75">(READ/TOT)</span></th>
                <th style="text-align:center;white-space:nowrap">ATT. <span style="font-weight:400;font-size:10px;opacity:.75">(PRES/TOT)</span></th>
                <th style="text-align:center;white-space:nowrap">OVERALL %</th>
                <th style="text-align:center;white-space:nowrap">FINAL GRADE</th>
                <th style="white-space:nowrap">BREAKDOWN</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>

      <!-- Grade Scale Legend -->
      <div style="margin-top:16px;padding:14px 18px;background:var(--gray-50);border-radius:var(--radius);border:1px solid var(--gray-100);font-size:12px;color:var(--gray-500)">
        <strong style="color:var(--gray-600)">Grade Scale (DepEd Transmutation):</strong>
        1.00 (97-100%) · 1.25 (93-96%) · 1.50 (89-92%) · 1.75 (85-88%) · 2.00 (81-84%) ·
        2.25 (77-80%) · 2.50 (73-76%) · 2.75 (69-72%) · 3.00 (65-68%) · 5.00 (&lt;65% · Failed)
        <br><span style="color:var(--gray-400);margin-top:4px;display:block">
          Formula: (Activity% × 75%) + (Attendance% × 15%) + (Module Read% × 10%)
        </span>
      </div>`;
  },

  // ── PH Grade Transmutation (DepEd) ───────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════
  // ATTENDANCE VIEWS
  // ══════════════════════════════════════════════════════════════════════════

  // ── Page shell ────────────────────────────────────────────────────────────
  attendance() {
    return `
      <div class="section-header">
        <div class="section-header-left">
          <h2>${lmsIcon('calendar')} Attendance Monitoring</h2>
          <p id="att-count">Loading sections…</p>
        </div>
        <div class="search-box">
          <span>${LMS_ICONS.search}</span>
          <input type="text" id="global-search" placeholder="Search sections…" />
        </div>
      </div>
      <div id="att-sections-wrap">
        <div class="empty-state"><div class="empty-state-icon">${LMS_ICONS.loading}</div><div class="empty-state-title">Loading…</div></div>
      </div>`;
  },

  // ── Sections table ────────────────────────────────────────────────────────
  attendanceSectionsList(sections) {
    if (!sections || sections.length === 0) {
      return `<div class="empty-state">
        <div class="empty-state-icon">${LMS_ICONS.clipboard}</div>
        <div class="empty-state-title">No sections assigned</div>
      </div>`;
    }

    const rows = sections.map(sec => {
      const subjectNames = sec.subjects.map(s => s.subject_name).join(', ');
      return `<tr data-searchable style="cursor:pointer"
          onclick="AttendanceController.openSection(${sec.section_id}, '${escHtml(sec.section_name)}')">
        <td>
          <div style="font-weight:600;color:var(--maroon)">${escHtml(sec.section_name)}</div>
          <div style="font-size:12px;color:var(--gray-400)">${escHtml(sec.class_name)}</div>
        </td>
        <td>${escHtml(sec.grade_level || '—')}</td>
        <td style="font-size:12px;color:var(--gray-500)">${escHtml(sec.section_id.toString())}</td>
        <td>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            ${sec.subjects.map(s =>
              `<span class="badge badge-maroon" style="font-size:11px">${escHtml(s.subject_name)}</span>`
            ).join('')}
          </div>
        </td>
        <td style="font-size:12px;color:var(--gray-400)">${escHtml(sec.school_year || '—')}</td>
        <td>
          <button class="btn btn-xs btn-primary"
            onclick="event.stopPropagation();AttendanceController.openSection(${sec.section_id}, '${escHtml(sec.section_name)}')">
            ${lmsIcon('clipboard')} View Attendance
          </button>
        </td>
      </tr>`;
    }).join('');

    const isMobile = window.innerWidth <= 600;

    if (!isMobile) {
      return `
        <div class="card">
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th style="white-space:nowrap">Section</th>
                  <th style="white-space:nowrap">Grade Level</th>
                  <th style="white-space:nowrap">Section ID</th>
                  <th style="white-space:nowrap">Subject(s)</th>
                  <th style="white-space:nowrap">School Year</th>
                  <th style="white-space:nowrap">Action</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    }

    // ── Mobile: card layout ──────────────────────────────────────────────────
    return `
      <div style="display:flex;flex-direction:column;gap:10px">
        ${sections.map(sec => {
          return `
          <div style="background:#fff;border:1px solid #f0e8e8;border-radius:10px;padding:14px 16px;box-shadow:0 1px 4px rgba(0,0,0,.05);cursor:pointer"
               onclick="AttendanceController.openSection(${sec.section_id}, '${escHtml(sec.section_name)}')">
            <div style="font-weight:700;font-size:15px;color:var(--maroon);margin-bottom:2px">${escHtml(sec.section_name)}</div>
            <div style="font-size:12px;color:var(--gray-400);margin-bottom:10px">${escHtml(sec.class_name)}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #f3f4f6;font-size:13px">
              <span style="color:var(--gray-400);font-size:11px;text-transform:uppercase;letter-spacing:.4px">Grade Level</span>
              <span style="font-weight:600;color:#1f2937">${escHtml(sec.grade_level || '—')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #f3f4f6;font-size:13px">
              <span style="color:var(--gray-400);font-size:11px;text-transform:uppercase;letter-spacing:.4px">Section ID</span>
              <span style="font-weight:600;font-size:12px;color:var(--gray-500)">${escHtml(sec.section_id.toString())}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:5px 0;border-bottom:1px solid #f3f4f6;font-size:13px">
              <span style="color:var(--gray-400);font-size:11px;text-transform:uppercase;letter-spacing:.4px;padding-top:2px">Subject(s)</span>
              <span style="display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;max-width:65%">
                ${sec.subjects.map(s => `<span class="badge badge-maroon" style="font-size:11px">${escHtml(s.subject_name)}</span>`).join('')}
              </span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:13px">
              <span style="color:var(--gray-400);font-size:11px;text-transform:uppercase;letter-spacing:.4px">School Year</span>
              <span style="font-weight:600;font-size:12px">${escHtml(sec.school_year || '—')}</span>
            </div>
            <div style="margin-top:10px">
              <button class="btn btn-xs btn-primary" style="width:100%"
                onclick="event.stopPropagation();AttendanceController.openSection(${sec.section_id}, '${escHtml(sec.section_name)}')">
                ${lmsIcon('clipboard')} View Attendance
              </button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  },

  // ── Section student attendance summary ────────────────────────────────────
  attendanceSectionDetail(sectionName, data, subjects, currentSubjectId, currentTerm) {
    const { students, total_meetings } = data;
    const termOptions = ['1st','2nd','3rd','4th'].map(t =>
      `<option value="${t}" ${t === currentTerm ? 'selected' : ''}>${t} Term</option>`
    ).join('');
    const subjOptions = subjects.map(s =>
      `<option value="${s.subject_id}" ${s.subject_id === currentSubjectId ? 'selected' : ''}>${escHtml(s.subject_name)}</option>`
    ).join('');

    const rows = students.map(stu => {
      const pct = total_meetings > 0
        ? Math.round((stu.present / total_meetings) * 100) : null;
      const pctBadge = pct !== null
        ? `<span class="badge ${pct >= 75 ? 'badge-green' : pct >= 60 ? 'badge-gold' : 'badge-danger'}">${pct}%</span>`
        : `<span class="badge badge-gray">—</span>`;
      return `<tr data-searchable>
        <td style="white-space:nowrap;min-width:130px">
          <div style="font-weight:600">${escHtml(stu.full_name || (stu.first_name + ' ' + stu.last_name))}</div>
        </td>
        <td style="font-size:13px;color:var(--gray-500);white-space:nowrap">${escHtml(stu.student_number || '—')}</td>
        <td style="text-align:center;font-weight:600;color:var(--green)">${stu.present}</td>
        <td style="text-align:center;font-weight:600;color:var(--red, #dc2626)">${stu.absent}</td>
        <td style="text-align:center;font-weight:600;color:var(--gold, #d97706)">${stu.late}</td>
        <td style="text-align:center;font-weight:600;color:var(--gray-500)">${stu.excused}</td>
        <td style="text-align:center">${total_meetings}</td>
        <td style="text-align:center">${pctBadge}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="8" class="text-center text-muted" style="padding:40px">No students enrolled.</td></tr>`;

    return `
      <div class="section-header">
        <div class="section-header-left">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn btn-ghost btn-sm"
              onclick="AttendanceController.backToSections()" style="padding:4px 8px">← Back</button>
            <div>
              <h2>${escHtml(sectionName)} <span style="font-size:16px;font-weight:400;color:var(--gray-400)">(${students.length} students)</span></h2>
              <p>Attendance Summary</p>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select id="att-subject-filter" class="form-control" style="width:auto;font-size:13px"
            onchange="AttendanceController.reloadSectionDetail()">
            <option value="">All Subjects</option>
            ${subjOptions}
          </select>
          <select id="att-term-filter" class="form-control" style="width:auto;font-size:13px"
            onchange="AttendanceController.reloadSectionDetail()">
            <option value="">All Terms</option>
            ${termOptions}
          </select>
          <div class="search-box" style="margin:0">
            <span>${LMS_ICONS.search}</span>
            <input type="text" id="global-search" placeholder="Search students…" />
          </div>
          <button class="btn btn-primary btn-sm"
            onclick="AttendanceController.openTakeAttendance()">
            ${lmsIcon('clipboard')} Take Attendance
          </button>
        </div>
      </div>

      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <div class="stat-card" style="flex:1;min-width:120px;padding:12px 16px">
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px">Total Meetings</div>
          <div style="font-size:22px;font-weight:700;color:var(--maroon)">${total_meetings}</div>
        </div>
        <div class="stat-card" style="flex:1;min-width:120px;padding:12px 16px">
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px">Students</div>
          <div style="font-size:22px;font-weight:700;color:var(--maroon)">${students.length}</div>
        </div>
        <div class="stat-card" style="flex:1;min-width:120px;padding:12px 16px">
          <div style="font-size:11px;color:var(--green,#16a34a);text-transform:uppercase;letter-spacing:.5px">Avg Present</div>
          <div style="font-size:22px;font-weight:700;color:var(--green,#16a34a)">
            ${students.length && total_meetings
              ? Math.round(students.reduce((a,s)=>a+s.present,0) / students.length) + '/' + total_meetings
              : '—'}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap" style="overflow-x:auto;-webkit-overflow-scrolling:touch">
          <table class="data-table" style="min-width:580px">
            <thead>
              <tr>
                <th style="white-space:nowrap;min-width:130px">Student Name</th>
                <th style="white-space:nowrap">LRN / Stud. No.</th>
                <th style="text-align:center;color:var(--green,#16a34a);white-space:nowrap">Present</th>
                <th style="text-align:center;color:#dc2626;white-space:nowrap">Absent</th>
                <th style="text-align:center;color:#d97706;white-space:nowrap">Late</th>
                <th style="text-align:center;color:var(--gray-500);white-space:nowrap">Excused</th>
                <th style="text-align:center;white-space:nowrap">Total Meetings</th>
                <th style="text-align:center;white-space:nowrap">Attendance %</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>

      <!-- Session History -->
      <div style="margin-top:20px">
        <div style="font-weight:600;font-size:14px;color:var(--maroon);margin-bottom:10px">${lmsIcon('calendar')} Session History</div>
        <div id="att-sessions-list">
          <div style="color:var(--gray-400);font-size:13px">Loading sessions…</div>
        </div>
      </div>`;
  },

  // ── Session history list ───────────────────────────────────────────────────
  attendanceSessionsList(sessions) {
    if (!sessions || sessions.length === 0) {
      return `<div style="color:var(--gray-400);font-size:13px;padding:12px 0">No sessions recorded yet.</div>`;
    }
    const rows = sessions.map(s => {
      const badge = s.has_class
        ? `<span class="badge badge-green" style="font-size:11px">Class held</span>`
        : `<span class="badge badge-gray" style="font-size:11px">No class</span>`;
      return `<div style="background:var(--gray-50);border-radius:var(--radius);margin-bottom:6px;overflow:hidden">
        <!-- Row 1: date + badges + actions -->
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;flex-wrap:wrap;min-width:0">
          <span style="font-weight:600;color:var(--maroon);white-space:nowrap;font-size:13px">${escHtml(s.session_date)}</span>
          ${badge}
          <span class="badge badge-maroon" style="font-size:10px;white-space:nowrap">${escHtml(s.term)} Term</span>
          <div style="margin-left:auto;display:flex;gap:6px;flex-shrink:0">
            <button class="btn btn-xs btn-outline" onclick="AttendanceController.editSession(${s.id})">${lmsIcon('edit')} Edit</button>
            <button class="btn btn-xs btn-danger" onclick="AttendanceController.deleteSession(${s.id}, '${escHtml(s.session_date)}')">${lmsIcon('trash')}</button>
          </div>
        </div>
        <!-- Row 2: notes (only if present) -->
        ${s.notes ? `<div style="padding:4px 12px 8px;font-size:12px;color:var(--gray-500);word-break:break-word;overflow-wrap:break-word;border-top:1px solid var(--gray-100)">${lmsIcon('file')} ${escHtml(s.notes)}</div>` : ''}
      </div>`;
    }).join('');
    return rows;
  },

  // ── Take Attendance modal body ─────────────────────────────────────────────
  attendanceModal(students, existingSession, subjects = []) {
    const today = new Date().toISOString().slice(0, 10);
    const termOptions = ['1st','2nd','3rd','4th'].map(t =>
      `<option value="${t}" ${(existingSession?.term || '1st') === t ? 'selected' : ''}>${t} Term</option>`
    ).join('');

    const subjectOptions = subjects.map(s =>
      `<option value="${s.subject_id}" ${existingSession?.subject_id === s.subject_id ? 'selected' : ''}>${escHtml(s.subject_name)}</option>`
    ).join('');

    const hasClass = existingSession ? existingSession.has_class : true;

    // Build existing record map if editing
    const existingRecords = {};
    if (existingSession?.records) {
      existingSession.records.forEach(r => { existingRecords[r.student_id] = r.status; });
    }

    const studentRows = students.map(stu => {
      const status = existingRecords[stu.id] || 'present';
      return `<tr>
        <td style="padding:8px 10px;font-size:13px;white-space:nowrap;min-width:140px">
          <div style="font-weight:600">${escHtml(stu.full_name || (stu.first_name + ' ' + stu.last_name))}</div>
        </td>
        <td style="padding:8px 10px;font-size:12px;color:var(--gray-400);white-space:nowrap">${escHtml(stu.student_number || '—')}</td>
        <td style="padding:8px 10px;text-align:center">
          <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:13px">
            <input type="radio" name="att_${stu.id}" value="present"
              ${status === 'present' ? 'checked' : ''}
              style="accent-color:var(--green,#16a34a)"> Present
          </label>
        </td>
        <td style="padding:8px 10px;text-align:center">
          <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:13px">
            <input type="radio" name="att_${stu.id}" value="absent"
              ${status === 'absent' ? 'checked' : ''}
              style="accent-color:#dc2626"> Absent
          </label>
        </td>
        <td style="padding:8px 10px;text-align:center">
          <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:13px">
            <input type="radio" name="att_${stu.id}" value="late"
              ${status === 'late' ? 'checked' : ''}
              style="accent-color:#d97706"> Late
          </label>
        </td>
        <td style="padding:8px 10px;text-align:center">
          <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;font-size:13px">
            <input type="radio" name="att_${stu.id}" value="excused"
              ${status === 'excused' ? 'checked' : ''}
              style="accent-color:var(--gray-500)"> Excused
          </label>
        </td>
      </tr>`;
    }).join('');

    return `
      <!-- Row 0: SUBJECT (if multiple subjects) -->
      ${subjects.length > 0 ? `
      <div style="margin-bottom:12px">
        <label style="font-size:12px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:4px">SUBJECT</label>
        <select id="att-subject" class="form-control">
          ${subjects.length > 1 ? '<option value="">— All Subjects —</option>' : ''}
          ${subjectOptions}
        </select>
      </div>` : ''}
      <!-- Row 1: DATE + TERM -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:4px">DATE</label>
          <input type="date" id="att-date" class="form-control"
            value="${existingSession?.session_date || today}"
            ${existingSession ? 'readonly style="background:var(--gray-50)"' : ''} />
        </div>
        <div>
          <label style="font-size:12px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:4px">TERM</label>
          <select id="att-term" class="form-control">${termOptions}</select>
        </div>
      </div>
      <!-- Row 2: SESSION TYPE (full width, no cramping) -->
      <div style="margin-bottom:16px">
        <label style="font-size:12px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:8px">SESSION TYPE</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;padding:8px 14px;border:1.5px solid var(--rose-tint);border-radius:var(--radius);background:var(--white);transition:border-color .2s">
            <input type="radio" id="att-has-class-yes" name="att_has_class" value="yes"
              ${hasClass ? 'checked' : ''}
              onchange="AttendanceController.toggleHasClass(true)"
              style="accent-color:var(--maroon);width:16px;height:16px"> Class held
          </label>
          <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;padding:8px 14px;border:1.5px solid var(--rose-tint);border-radius:var(--radius);background:var(--white);transition:border-color .2s">
            <input type="radio" id="att-has-class-no" name="att_has_class" value="no"
              ${!hasClass ? 'checked' : ''}
              onchange="AttendanceController.toggleHasClass(false)"
              style="accent-color:var(--maroon);width:16px;height:16px"> No class
          </label>
        </div>
      </div>

      <div>
        <label style="font-size:12px;font-weight:600;color:var(--gray-500);display:block;margin-bottom:4px">NOTES (optional)</label>
        <input type="text" id="att-notes" class="form-control" placeholder="e.g. Holiday, Field trip…"
          value="${escHtml(existingSession?.notes || '')}" />
      </div>

      <div id="att-student-table-wrap" style="margin-top:16px;${!hasClass ? 'display:none' : ''}">
        <div style="font-size:12px;font-weight:600;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
          Students — mark status below
        </div>
        <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <button class="btn btn-xs btn-outline" onclick="AttendanceController.markAll('present')" style="color:var(--green,#16a34a)">${lmsIcon('check')} All Present</button>
          <button class="btn btn-xs btn-outline" onclick="AttendanceController.markAll('absent')" style="color:#dc2626">${lmsIcon('xmark')} All Absent</button>
        </div>
        <div class="table-wrap" style="max-height:380px;overflow-y:auto;overflow-x:auto;-webkit-overflow-scrolling:touch">
          <table style="width:100%;border-collapse:collapse">
            <thead style="position:sticky;top:0;z-index:1">
              <tr style="background:var(--gray-50)">
                <th style="padding:8px 10px;text-align:left;color:var(--maroon);font-size:11px;border-bottom:2px solid var(--rose-mid);white-space:nowrap">Student Name</th>
                <th style="padding:8px 10px;text-align:left;color:var(--maroon);font-size:11px;border-bottom:2px solid var(--rose-mid);white-space:nowrap">LRN / ID</th>
                <th style="padding:8px 10px;text-align:center;color:var(--green,#16a34a);font-size:11px;border-bottom:2px solid var(--rose-mid);white-space:nowrap">Present</th>
                <th style="padding:8px 10px;text-align:center;color:#dc2626;font-size:11px;border-bottom:2px solid var(--rose-mid);white-space:nowrap">Absent</th>
                <th style="padding:8px 10px;text-align:center;color:#d97706;font-size:11px;border-bottom:2px solid var(--rose-mid);white-space:nowrap">Late</th>
                <th style="padding:8px 10px;text-align:center;color:var(--gray-500);font-size:11px;border-bottom:2px solid var(--rose-mid);white-space:nowrap">Excused</th>
              </tr>
            </thead>
            <tbody>${studentRows}</tbody>
          </table>
        </div>
      </div>

      <div id="att-no-class-msg" style="${hasClass ? 'display:none' : ''};margin-top:16px;padding:16px;background:var(--gray-50);border-radius:var(--radius);text-align:center;color:var(--gray-400);font-size:13px">
        ${LMS_ICONS.calendar} No class on this date — this meeting will be counted but no attendance will be recorded.
      </div>`;
  },

  _toPhGrade(pct) {
    if (pct >= 97) return '1.00';
    if (pct >= 93) return '1.25';
    if (pct >= 89) return '1.50';
    if (pct >= 85) return '1.75';
    if (pct >= 81) return '2.00';
    if (pct >= 77) return '2.25';
    if (pct >= 73) return '2.50';
    if (pct >= 69) return '2.75';
    if (pct >= 65) return '3.00';
    return '5.00';
  },
};
