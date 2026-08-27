/* ============================================================
   views/student.view.js
   Pure render functions for Student role — returns HTML strings only.
   No direct DOM manipulation; controllers handle that.
   ============================================================ */

"use strict";

const StudentView = {

  /**
   * Render the student dashboard.
   * @param {object} user  - current user session object
   * @param {object|null} stats - result from api.getStudentDashboardStats(), or null while loading
   * @param {Array}  subjects  - result from api.getStudentSubjects()
   * @param {Array}  recentGrades - graded ActivitySubmissions (with _activity + _subject attached)
   */
  dashboard(user, stats = null, subjects = [], recentGrades = []) {
    const firstName = escHtml((user.full_name || user.name || 'Student').split(' ')[0]);

    /* ── Stat card values (show skeleton dashes while loading) ─────────── */
    const enrolledVal  = stats ? stats.enrolled_subjects : '—';
    const modulesVal   = stats ? `${stats.modules.done}/${stats.modules.total}` : '—/—';
    const activitiesVal = stats ? `${stats.activities.done}/${stats.activities.total}` : '—/—';
    const avgVal       = stats ? `${stats.average_score}%` : '—%';

    /* Progress bar widths (capped 0–100) */
    const modPct  = stats && stats.modules.total   ? Math.min(100, Math.round(stats.modules.done   / stats.modules.total   * 100)) : 0;
    const actPct  = stats && stats.activities.total ? Math.min(100, Math.round(stats.activities.done / stats.activities.total * 100)) : 0;

    /* Average score colour */
    const avgNum  = stats ? stats.average_score : 0;
    const avgColor = avgNum >= 90 ? '#22c55e' : avgNum >= 75 ? '#f59e0b' : '#ef4444';

    /* ── Subject list ──────────────────────────────────────────────────── */
    const NAMED = {
      'Mathematics':        { color: '#8b1a2e', icon: '➕' },
      'Science':            { color: '#2e6b3e', icon: '🔬' },
      'English':            { color: '#1a4a8a', icon: '📖' },
      'Filipino':           { color: '#c04a00', icon: '🇵🇭' },
      'MAPEH':              { color: '#6a0dad', icon: '🎨' },
      'Araling Panlipunan': { color: '#0d6e8a', icon: '🌐' },
      'TLE':                { color: '#7a5500', icon: '🔧' },
    };
    const subjectHTML = subjects.length
      ? subjects.map((s, i) => {
          const info = NAMED[s.subject_name] || { color: '#555', icon: '📚' };
          return `
            <div class="db-subject-item" style="display:flex;align-items:center;gap:12px;padding:9px 10px;margin:4px 0;border-radius:10px;border-left:3px solid ${info.color};background:linear-gradient(90deg,${info.color}12 0%,transparent 80%);transition:background .18s;">
              <div style="width:36px;height:36px;border-radius:9px;background:${info.color};display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0;box-shadow:0 2px 6px ${info.color}44">${info.icon}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#1a1a2e">${escHtml(s.subject_name)}</div>
                <div style="font-size:11px;color:var(--gray-400);margin-top:1px">${escHtml(s.class_name || '—')}</div>
              </div>
              <span style="font-size:16px;color:${info.color};opacity:.45;flex-shrink:0">›</span>
            </div>`;
        }).join('')
      : `<p class="text-muted text-sm" style="padding:12px 0">No subjects enrolled yet</p>`;

    /* ── Recent grades list ────────────────────────────────────────────── */
    const gradesHTML = recentGrades.length
      ? recentGrades.slice(0, 6).map(sub => {
          if (!sub.is_graded || sub.score === null) {
            return `
              <div style="display:flex;align-items:center;gap:12px;padding:9px 10px;margin:4px 0;border-radius:10px;border-left:3px solid #d1d5db;background:#fafafa;">
                <div style="width:36px;height:36px;border-radius:50%;border:2px solid #e5e7eb;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;color:#aaa;font-weight:700">?</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#1a1a2e">${escHtml(sub._activity || '?')}</div>
                  <div style="font-size:11px;color:var(--gray-400);margin-top:1px">${escHtml(sub._subject || '?')}</div>
                </div>
                <span class="badge badge-gray" style="font-size:10px;flex-shrink:0">Pending</span>
              </div>`;
          }
          const pct  = sub.max_score > 0 ? Math.round((sub.score ?? 0) / sub.max_score * 100) : 0;
          const gc   = pct >= 90 ? 'badge-green' : pct >= 75 ? 'badge-gold' : 'badge-red';
          const gl   = pct >= 90 ? 'Excellent'  : pct >= 75 ? 'Passing'    : 'Needs Work';
          const ringColor = pct >= 90 ? '#22c55e' : pct >= 75 ? '#f59e0b' : '#ef4444';
          const ringBg    = pct >= 90 ? '#e6f4ea'  : pct >= 75 ? '#fff8e1'  : '#fde8ec';
          const borderCol = pct >= 90 ? '#22c55e'  : pct >= 75 ? '#f59e0b'  : '#ef4444';
          return `
            <div style="display:flex;align-items:center;gap:12px;padding:9px 10px;margin:4px 0;border-radius:10px;border-left:3px solid ${borderCol};background:linear-gradient(90deg,${borderCol}10 0%,transparent 80%);">
              <div style="width:36px;height:36px;border-radius:50%;border:2.5px solid ${ringColor};background:${ringBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;font-weight:800;color:${ringColor}">${pct}%</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#1a1a2e">${escHtml(sub._activity || '?')}</div>
                <div style="font-size:11px;color:var(--gray-400);margin-top:1px">${escHtml(sub._subject || '?')} · ${sub.score}/${sub.max_score}</div>
              </div>
              <span class="badge ${gc}" style="font-size:10px;flex-shrink:0">${gl}</span>
            </div>`;
        }).join('')
      : `<p class="text-muted text-sm" style="padding:12px 0">No activity submissions yet</p>`;

    return `
      <div class="welcome-banner">
        <div class="welcome-text">
          <div class="welcome-title">Hi, ${firstName}! 🎓</div>
          <div class="welcome-sub">Keep learning — every step forward counts!</div>
        </div>
        <div class="welcome-emoji">📖</div>
      </div>

      <div class="stat-grid mb-4">

        <!-- Enrolled Subjects -->
        <div class="stat-card">
          <div class="stat-icon" style="background:#fde8ec">📚</div>
          <div>
            <div class="stat-value">${enrolledVal}</div>
            <div class="stat-label">Enrolled Subjects</div>
          </div>
        </div>

        <!-- Modules progress -->
        <div class="stat-card" style="flex-direction:column;align-items:flex-start;gap:8px">
          <div style="display:flex;align-items:center;gap:12px;width:100%">
            <div class="stat-icon" style="background:#e6f4ea;flex-shrink:0">📄</div>
            <div style="flex:1">
              <div class="stat-value">${modulesVal}</div>
              <div class="stat-label">Modules Read</div>
            </div>
          </div>
          <div style="width:100%;height:6px;background:var(--gray-100);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${modPct}%;background:#22c55e;border-radius:3px;transition:width .4s ease"></div>
          </div>
        </div>

        <!-- Activities progress -->
        <div class="stat-card" style="flex-direction:column;align-items:flex-start;gap:8px">
          <div style="display:flex;align-items:center;gap:12px;width:100%">
            <div class="stat-icon" style="background:#fff0e6;flex-shrink:0">📋</div>
            <div style="flex:1">
              <div class="stat-value">${activitiesVal}</div>
              <div class="stat-label">Activities Done</div>
            </div>
          </div>
          <div style="width:100%;height:6px;background:var(--gray-100);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${actPct}%;background:#f59e0b;border-radius:3px;transition:width .4s ease"></div>
          </div>
        </div>

        <!-- Average score -->
        <div class="stat-card">
          <div class="stat-icon" style="background:#e8f0fa">📊</div>
          <div>
            <div class="stat-value" style="color:${avgColor}">${avgVal}</div>
            <div class="stat-label">Average Score</div>
          </div>
        </div>

      </div>

      <div class="dashboard-panels">
        <div class="card">
          <div class="card-header" style="border-bottom:1px solid var(--gray-100);padding-bottom:10px">
            <span class="card-title" style="display:flex;align-items:center;gap:7px">
              <span style="font-size:16px">📚</span> My Subjects
              ${subjects.length ? `<span style="font-size:11px;font-weight:500;color:var(--gray-400);margin-left:2px">${subjects.length} enrolled</span>` : ''}
            </span>
          </div>
          <div class="card-body" style="padding:4px 10px 8px">${subjectHTML}</div>
        </div>
        <div class="card">
          <div class="card-header" style="border-bottom:1px solid var(--gray-100);padding-bottom:10px">
            <span class="card-title" style="display:flex;align-items:center;gap:7px">
              <span style="font-size:16px">🏆</span> Recent Grades
              ${recentGrades.length ? `<span style="font-size:11px;font-weight:500;color:var(--gray-400);margin-left:2px">${Math.min(recentGrades.length,6)} latest</span>` : ''}
            </span>
          </div>
          <div class="card-body" style="padding:4px 10px 8px">${gradesHTML}</div>
        </div>
      </div>`;
  },

  mySubjects(apiSubjects = null, apiModules = [], apiActivities = [], currentSem = null) {
    if (apiSubjects === null) {
      return `
        <div class="section-header">
          <div class="section-header-left"><h2>My Subjects</h2><p>All enrolled subjects this term</p></div>
          <div class="search-box"><span>🔍</span><input type="text" id="global-search" placeholder="Search subjects…" /></div>
        </div>
        <div class="subject-list" id="student-subjects-list">
          <div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-title">Loading subjects…</div></div>
        </div>`;
    }

    const sem = currentSem || 1;

    const semesterTabs = `
      <div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;">
        <button onclick="DashboardController.loadSection('my-subjects',{semester:1})"
          style="padding:7px 20px;border-radius:20px;border:2px solid var(--maroon,#7b1c1c);
                 background:${sem===1?'var(--maroon,#7b1c1c)':'transparent'};
                 color:${sem===1?'#fff':'var(--maroon,#7b1c1c)'};
                 font-weight:600;font-size:13px;cursor:pointer;transition:all .2s;">
          📘 1st Semester
        </button>
        <button onclick="DashboardController.loadSection('my-subjects',{semester:2})"
          style="padding:7px 20px;border-radius:20px;border:2px solid var(--maroon,#7b1c1c);
                 background:${sem===2?'var(--maroon,#7b1c1c)':'transparent'};
                 color:${sem===2?'#fff':'var(--maroon,#7b1c1c)'};
                 font-weight:600;font-size:13px;cursor:pointer;transition:all .2s;">
          📗 2nd Semester
        </button>
        <span style="align-self:center;font-size:12px;color:#9ca3af;margin-left:4px;">
          ${sem===1?'1st':'2nd'} Semester subjects
        </span>
      </div>`;

    const PALETTE = [
      { color: '#8b1a2e', icon: '➕' }, { color: '#2e6b3e', icon: '🔬' },
      { color: '#1a4a8a', icon: '📖' }, { color: '#c04a00', icon: '🇵🇭' },
      { color: '#6a0dad', icon: '🎨' }, { color: '#0d6e8a', icon: '🌐' },
      { color: '#7a5500', icon: '📐' }, { color: '#3d3d3d', icon: '📚' },
    ];
    const NAMED = {
      'Mathematics':        { color: '#8b1a2e', icon: '➕' },
      'Science':            { color: '#2e6b3e', icon: '🔬' },
      'English':            { color: '#1a4a8a', icon: '📖' },
      'Filipino':           { color: '#c04a00', icon: '🇵🇭' },
      'MAPEH':              { color: '#6a0dad', icon: '🎨' },
      'Araling Panlipunan': { color: '#0d6e8a', icon: '🌐' },
      'TLE':                { color: '#7a5500', icon: '🔧' },
    };
    const TERM_ORDER  = ['1st Term', '2nd Term', '3rd Term', '4th Term'];
    const TERM_LABELS = { '1st': '1st Term', '2nd': '2nd Term', '3rd': '3rd Term', '4th': '4th Term' };
    const API_BASE    = 'https://ijed-hcj-1.onrender.com';

    if (!apiSubjects || !apiSubjects.length) {
      return `
        <div class="section-header">
          <div class="section-header-left"><h2>My Subjects</h2><p>${sem === 1 ? '1st' : '2nd'} Semester</p></div>
        </div>
        ${semesterTabs}
        <div class="empty-state" style="margin-top:40px">
          <div class="empty-state-icon">📭</div>
          <div class="empty-state-title">No Subjects for ${sem === 1 ? '1st' : '2nd'} Semester</div>
          <div class="empty-state-desc">You have no enrolled subjects for this semester. Try switching semesters above, or contact your admin.</div>
        </div>`;
    }

    const modulesBySubjectTerm = {};
    (apiModules || []).forEach(m => {
      const sid  = m.subject_id;
      const term = TERM_LABELS[m.term || ''] || (m.term ? m.term + ' Term' : 'Other');
      if (!modulesBySubjectTerm[sid]) modulesBySubjectTerm[sid] = {};
      if (!modulesBySubjectTerm[sid][term]) modulesBySubjectTerm[sid][term] = [];
      modulesBySubjectTerm[sid][term].push(m);
    });

    const activitiesBySubjectTerm = {};
    (apiActivities || []).forEach(a => {
      const sid  = a.subject_id;
      const term = TERM_LABELS[a.term || ''] || (a.term ? a.term + ' Term' : 'Other');
      if (!activitiesBySubjectTerm[sid]) activitiesBySubjectTerm[sid] = {};
      if (!activitiesBySubjectTerm[sid][term]) activitiesBySubjectTerm[sid][term] = [];
      activitiesBySubjectTerm[sid][term].push(a);
    });

    function buildTermContent(subjectId) {
      const mByTerm  = modulesBySubjectTerm[subjectId]    || {};
      const aByTerm  = activitiesBySubjectTerm[subjectId] || {};
      const allTerms = [...new Set([...Object.keys(mByTerm), ...Object.keys(aByTerm)])];
      allTerms.sort((a, b) => {
        const ia = TERM_ORDER.indexOf(a), ib = TERM_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

      if (!allTerms.length) {
        return `<div class="subject-accordion-empty">
          <span style="font-size:28px;opacity:.4">📭</span>
          <p>No modules or activities posted yet for this subject.</p>
        </div>`;
      }

      const TYPE_MAP = { quiz:'Quiz', long_quiz:'Long Quiz', task_performance:'Task Perf.', exam:'Exam', lab_exercise:'Lab', assignment:'Assignment', other:'Other' };

      return allTerms.map(term => {
        const modules   = mByTerm[term]  || [];
        const activites = aByTerm[term]  || [];

        const moduleRows = modules.map(m => {
          const hasFile = !!m.file_url;
          const resolvedUrl = m.file_url && m.file_url.startsWith('http') ? m.file_url : `${API_BASE}${m.file_url}`;
          return `<div class="accordion-content-item">
            <span class="acc-item-icon">📄</span>
            <span class="acc-item-label">${escHtml(m.title)}${m.description ? '<span class="acc-item-desc">' + escHtml(m.description) + '</span>' : ''}</span>
            ${hasFile
              ? `<a class="btn btn-xs btn-primary" href="${escHtml(resolvedUrl)}" target="_blank" rel="noopener" onclick="StudentController.trackModuleRead(${m.id})">Open 📖</a>`
              : `<span class="btn btn-xs btn-outline" style="opacity:.45;cursor:default;pointer-events:none">No file</span>`}
          </div>`;
        }).join('');

        const actRows = activites.map(a => {
          const typeLabel   = TYPE_MAP[a.activity_type] || a.activity_type || 'Activity';
          const statusColor = { open:'#2e6b3e', graded:'#1a4a8a', submitted:'#6a0dad', past_due:'#c00', not_open:'#888' }[a.status] || '#666';
          const statusLabel = a.status_label || a.status || '';
          const dueStr      = a.due_date
            ? new Date(a.due_date).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})
            : '';
          return `<div class="accordion-content-item">
            <span class="acc-item-icon">📝</span>
            <span class="acc-item-label">${escHtml(a.title || a.activity_type)}
              <span class="acc-item-desc">${escHtml(typeLabel)}${dueStr ? ' · Due: ' + dueStr : ''}</span>
            </span>
            <span style="font-size:11px;font-weight:600;color:${statusColor};white-space:nowrap">${escHtml(statusLabel)}</span>
          </div>`;
        }).join('');

        return `<div class="accordion-term-section">
          <div class="accordion-term-heading">
            <span class="acc-term-badge">${escHtml(term)}</span>
            <span class="acc-term-counts">${modules.length} module${modules.length !== 1 ? 's' : ''} · ${activites.length} activit${activites.length !== 1 ? 'ies' : 'y'}</span>
          </div>
          ${modules.length  ? '<div class="acc-section-label">📚 Modules</div>'    + moduleRows : ''}
          ${activites.length ? '<div class="acc-section-label">📝 Activities</div>' + actRows    : ''}
        </div>`;
      }).join('');
    }

    const cards = apiSubjects.map((s, idx) => {
      const style  = NAMED[s.subject_name] || PALETTE[idx % PALETTE.length];
      const sid    = s.subject_id;
      const mCount = (apiModules    || []).filter(m => m.subject_id === sid).length;
      const aCount = (apiActivities || []).filter(a => a.subject_id === sid).length;

      return `
        <div class="student-subject-card" data-searchable data-subject-id="${sid}">
          <div class="student-subject-card-header">
            <div style="width:44px;height:44px;border-radius:10px;background:${style.color};display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">${style.icon}</div>
            <div class="subject-info" style="flex:1">
              <div class="subject-name">${escHtml(s.subject_name)}</div>
              <div class="subject-teacher">
                Class: <strong>${escHtml(s.class_name || '—')}</strong>
                <span style="margin-left:10px;font-size:11px;color:var(--gray-400)">
                  ${mCount} module${mCount !== 1 ? 's' : ''} · ${aCount} activit${aCount !== 1 ? 'ies' : 'y'}
                </span>
              </div>
            </div>
            <span class="accordion-chevron" style="font-size:18px;color:var(--gray-400);transition:transform .25s;flex-shrink:0">▾</span>
          </div>
          <div class="subject-accordion-body" style="max-height:0;overflow:hidden;transition:max-height .3s ease">
            <div class="subject-accordion-inner">
              ${buildTermContent(sid)}
            </div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="section-header">
        <div class="section-header-left">
          <h2>My Subjects</h2>
          <p>${apiSubjects.length} subject${apiSubjects.length !== 1 ? 's' : ''} · ${sem === 1 ? '1st' : '2nd'} Semester · click to expand</p>
        </div>
        <div class="search-box"><span>🔍</span><input type="text" id="global-search" placeholder="Search subjects…" /></div>
      </div>
      ${semesterTabs}
      <div class="subject-list" id="student-subjects-list">${cards}</div>`;
  },

  modules(apiModules = null) {
    if (apiModules === null) {
      return `<div class="section-header"><div class="section-header-left"><h2>Learning Modules</h2><p id="module-count">Loading…</p></div><div class="search-box"><span>🔍</span><input type="text" id="global-search" placeholder="Search modules…" /></div></div><div class="module-grid" id="student-module-grid"><div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-title">Loading modules…</div></div></div>`;
    }

    const SUBJECT_STYLES = {
      'Mathematics': { color: '#8b0020', icon: '➕' },
      'Science':     { color: '#2e6b3e', icon: '🔬' },
      'English':     { color: '#1a4a8a', icon: '📖' },
      'Filipino':    { color: '#c04a00', icon: '🇵🇭' },
      'MAPEH':       { color: '#6a0dad', icon: '🎨' },
    };
    const API_BASE = 'https://ijed-hcj-1.onrender.com';

    const cards = apiModules.map(m => {
      const style     = SUBJECT_STYLES[m._subject_name] || { color: 'var(--maroon)', icon: '📚' };
      const termLabel = m.term ? `${m.term} Term` : '';
      const meta      = [termLabel, m.file_name ? `📎 ${escHtml(m.file_name)}` : ''].filter(Boolean).join(' · ');
      const hasFile   = !!m.file_url;
      const resolvedUrl = m.file_url && m.file_url.startsWith('http') ? m.file_url : `${API_BASE}${m.file_url}`;
      return `<div class="module-card" data-searchable>
        <div class="module-card-header">
          <div class="module-card-subject" style="color:${style.color}">${style.icon} ${escHtml(m._subject_name || '?')}</div>
          <div class="module-card-title">${escHtml(m.title)}</div>
          <div class="module-card-desc">${escHtml(m.description || '')}</div>
        </div>
        <div class="module-card-footer">
          <span class="module-card-meta">${meta || 'No attachment'}</span>
          ${hasFile
            ? `<a class="btn btn-xs btn-primary" href="${escHtml(resolvedUrl)}" target="_blank" rel="noopener" onclick="StudentController.trackModuleRead(${m.id})">Open 📖</a>`
            : `<span class="btn btn-xs btn-outline" style="opacity:.5;cursor:default">No file</span>`}
        </div>
      </div>`;
    }).join('');

    const grid = cards || `<div class="empty-state"><div class="empty-state-icon">📚</div><div class="empty-state-title">No modules available</div><div class="empty-state-desc">Your teacher has not uploaded any modules yet.</div></div>`;
    return `
      <div class="section-header">
        <div class="section-header-left"><h2>Learning Modules</h2><p id="module-count">${apiModules.length} module(s) available</p></div>
        <div class="search-box"><span>🔍</span><input type="text" id="global-search" placeholder="Search modules…" /></div>
      </div>
      <div class="module-grid" id="student-module-grid">${grid}</div>`;
  },

  /** Loading skeleton shown while API fetches activity list */
  activitiesLoading() {
    return `
      <div class="section-header">
        <div class="section-header-left"><h2>Activities &amp; Quizzes</h2><p id="act-student-count">Loading…</p></div>
        <div class="search-box"><span>🔍</span><input type="text" id="global-search" placeholder="Search activities…" oninput="StudentController._filterActivities(this.value)" /></div>
      </div>
      <div id="student-activity-list">
        <div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-title">Loading activities…</div></div>
      </div>`;
  },

  /** Full student activities table from API data */
  activities(apiActivities) {
    const TYPE_LABELS = { quiz:'Quiz', long_quiz:'Long Quiz', task_performance:'Task Performance', exam:'Exam', lab_exercise:'Lab Exercise', assignment:'Assignment', other:'Other' };
    const FMT_LABELS  = { multiple_choice:'Multiple Choice', checkbox:'Checkbox', enumeration:'Enumeration', freeform:'Free-form', assignment:'Assignment', hybrid:'Hybrid' };

    const _fmtDate = d => d ? new Date(d).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—';
    const _fmtTime = d => d ? new Date(d).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '';
    const _fmtFull = d => d ? `${_fmtDate(d)}<br><span style="color:var(--gray-500);font-size:11px">${_fmtTime(d)}</span>` : '—';

    if (!apiActivities || !apiActivities.length) {
      return `
        <div class="section-header">
          <div class="section-header-left"><h2>Activities &amp; Quizzes</h2><p>No activities yet</p></div>
        </div>
        <div class="empty-state" style="margin-top:40px">
          <div class="empty-state-icon">📭</div>
          <div class="empty-state-title">No Activities Yet</div>
          <div class="empty-state-sub">Your teacher hasn't posted any activities for your subjects yet. Check back later!</div>
        </div>`;
    }

    const rows = apiActivities.map(a => {
      const typeLabel = TYPE_LABELS[a.activity_type] || a.activity_type;
      const fmtLabel  = FMT_LABELS[a.format_type]   || a.format_type;
      // Normalize submission — API may return it nested or flat.
      // IMPORTANT: backend may return submission: null even when already submitted
      // (already_submitted: true / status: "submitted" / can_answer: false are the real signals).
      const rawSub = a.submission || a.my_submission || null;
      // past_due activities have can_answer=false but were never submitted —
      // exclude them so we don't build a fake sub stub that shows a View button.
      const isAlreadySubmitted =
        a.already_submitted === true ||
        a.status === 'submitted'     ||
        a.status === 'graded'        ||
        (a.can_answer === false && a.status !== 'past_due' && a.is_past_due !== true);

      const sub = rawSub
        ? {
            submitted_at: rawSub.submitted_at || rawSub.created_at || null,
            is_graded:    rawSub.is_graded != null ? rawSub.is_graded : (rawSub.graded || false),
            score:        rawSub.score     != null ? rawSub.score     : (rawSub.total_score ?? null),
            max_score:    rawSub.max_score != null ? rawSub.max_score : (a.max_score ?? null),
            grade:        rawSub.grade     != null ? rawSub.grade     : (rawSub.letter_grade ?? null),
            remarks:      rawSub.remarks   != null ? rawSub.remarks   : (rawSub.feedback ?? null),
          }
        : isAlreadySubmitted
          // Build a minimal stub so the row renders as "submitted" even when
          // the backend omits the full submission object.
          ? {
              submitted_at: null,
              is_graded:    a.status === 'graded',
              score:        null,
              max_score:    a.max_score ?? null,
              grade:        null,
              remarks:      null,
            }
          : null;

      const isPastDue = a.is_past_due === true;
      // Trust can_answer from the backend exclusively — do NOT fall back to
      // "no submission object" because the backend can return submission: null
      // even for already-submitted activities.
      const canAnswer = a.can_answer === true;

      const typeIcon   = `<div style="width:32px;height:32px;background:var(--rose-tint);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">📝</div>`;
      const gradingTag = a.grading_mode === 'auto'
        ? `<span class="badge badge-gold" style="font-size:10px">⚡ Auto</span>`
        : `<span class="badge badge-gray" style="font-size:10px">✏️ Manual</span>`;

      const _statusMap = {
        graded:    ['badge-green',  '✅ Graded'],
        submitted: ['badge-blue',   '📤 Submitted'],
        past_due:  ['badge-danger', '⛔ Past Due'],
        not_open:  ['badge-gray',   '🔒 Not Yet Open'],
        open:      ['badge-maroon', '🟢 Open'],
      };
      const [_sCls, _sLbl] = _statusMap[a.status] || ['badge-maroon', '🟢 Open'];
      const statusBadge = `<span class="badge ${_sCls}" style="font-size:10px">${_sLbl}</span>`;

      const assignmentCell = `
        <td style="padding:14px 16px">
          <div style="display:flex;align-items:flex-start;gap:10px">
            ${typeIcon}
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--maroon);margin-bottom:3px">${escHtml(a.title)}</div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
                <span class="badge badge-maroon" style="font-size:10px">${escHtml(typeLabel)}</span>
                <span class="badge badge-blue"   style="font-size:10px">${escHtml(fmtLabel)}</span>
                ${gradingTag}
                ${statusBadge}
              </div>
            </div>
          </div>
        </td>`;

      const startCell = `<td style="padding:14px 12px;font-size:12px;color:var(--gray-600);white-space:nowrap">${_fmtFull(a.start_date)}</td>`;
      const dueStyle  = isPastDue && !sub ? 'color:#c0392b;font-weight:600' : 'color:var(--gray-600)';
      const dueCell   = `<td style="padding:14px 12px;font-size:12px;${dueStyle};white-space:nowrap">${_fmtFull(a.due_date)}</td>`;
      const pctCell   = `<td style="padding:14px 12px;font-size:12px;color:var(--gray-600);text-align:center">${a.max_score != null ? a.max_score + ' pts' : '—'}</td>`;

      const submittedCell = sub
        ? `<td style="padding:14px 12px;text-align:center"><span style="color:#2e6b3e;font-size:18px" title="Submitted ${sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : ''}">✓</span></td>`
        : `<td style="padding:14px 12px;text-align:center"><span style="color:var(--gray-400);font-size:16px">—</span></td>`;

      let gradedCell = '';
      // Consider graded if: is_graded flag is true OR score is already available
      const effectivelyGraded = sub && (sub.is_graded || sub.score != null);
      if (!sub) {
        gradedCell = `<td style="padding:14px 12px;text-align:center"><span style="color:var(--gray-400);font-size:16px">—</span></td>`;
      } else if (effectivelyGraded) {
        gradedCell = `<td style="padding:14px 12px;text-align:center"><span style="color:#2e6b3e;font-size:18px">✓</span></td>`;
      } else {
        gradedCell = `<td style="padding:14px 12px;text-align:center"><span style="color:#c0392b;font-size:18px" title="Awaiting grade">✗</span></td>`;
      }

      let scoreCell = '';
      const effectiveMaxScore = sub?.max_score ?? a.max_score ?? null;
      if (!sub) {
        scoreCell = isPastDue
          ? `<td style="padding:14px 12px;text-align:center"><div style="font-size:13px;font-weight:600;color:#c0392b">0 / ${effectiveMaxScore ?? '?'}</div><div style="font-size:10px;color:#c0392b">No submission</div></td>`
          : `<td style="padding:14px 12px;text-align:center;font-size:13px;color:var(--gray-400)">— / ${effectiveMaxScore ?? '?'}</td>`;
      } else if (sub.score != null) {
        // Show score whether graded manually or auto — score present means it's been evaluated
        const pct = effectiveMaxScore ? Math.round(sub.score / effectiveMaxScore * 100) : 0;
        const scoreColor = sub.is_graded ? '#1a1a2e' : '#c04a00';
        scoreCell = `<td style="padding:14px 12px;text-align:center"><div style="font-size:13px;font-weight:700;color:${scoreColor}">${sub.score} / ${effectiveMaxScore ?? '?'}</div><div style="font-size:11px;color:var(--gray-500)">${pct}%</div></td>`;
      } else {
        scoreCell = `<td style="padding:14px 12px;text-align:center;font-size:13px;color:var(--gray-500)">? / ${effectiveMaxScore ?? '?'}<br><span style="font-size:10px">Pending</span></td>`;
      }

      let gradeCell = '';
      if (sub && sub.grade) {
        // Show grade — works for both numeric (1.00–5.00) and letter grades
        const numGrade = parseFloat(sub.grade);
        const isPassing = !isNaN(numGrade) ? numGrade <= 3.00 : ['A','B','C','Excellent','Very Good','Good','Passing'].includes(sub.grade);
        const gradeColor = isPassing ? '#2e6b3e' : '#c0392b';
        const gradeBg    = isPassing ? '#e6f4ea' : '#fde8ec';
        gradeCell = `<td style="padding:14px 12px;text-align:center"><span style="display:inline-block;padding:3px 10px;border-radius:6px;background:${gradeBg};color:${gradeColor};font-weight:700;font-size:13px">${escHtml(String(sub.grade))}</span></td>`;
      } else if (sub && sub.score != null && sub.max_score != null) {
        // Backend did not return a grade string — compute it from score
        const pct = Math.round(sub.score / sub.max_score * 100);
        const gradeColor = pct >= 75 ? '#2e6b3e' : '#c0392b';
        const gradeBg    = pct >= 75 ? '#e6f4ea' : '#fde8ec';
        const gradeLabel = pct >= 97 ? '1.00' : pct >= 94 ? '1.25' : pct >= 91 ? '1.50'
                        : pct >= 88 ? '1.75' : pct >= 85 ? '2.00' : pct >= 82 ? '2.25'
                        : pct >= 79 ? '2.50' : pct >= 76 ? '2.75' : pct >= 75 ? '3.00' : '5.00';
        gradeCell = `<td style="padding:14px 12px;text-align:center"><span style="display:inline-block;padding:3px 10px;border-radius:6px;background:${gradeBg};color:${gradeColor};font-weight:700;font-size:13px">${gradeLabel}</span></td>`;
      } else if (sub && !sub.is_graded) {
        gradeCell = `<td style="padding:14px 12px;text-align:center;font-size:13px;color:var(--gray-400)">Pending</td>`;
      } else {
        gradeCell = `<td style="padding:14px 12px;text-align:center;font-size:13px;color:var(--gray-400)">—</td>`;
      }

      let actionCell = '';
      // A real submission has a submitted_at timestamp or a score.
      // A stub (isAlreadySubmitted fallback) has both as null — don't show View for those.
      const hasRealSubmission = sub && (sub.submitted_at != null || sub.score != null || rawSub != null);
      if (hasRealSubmission) {
        // Already submitted — show View
        actionCell = `<td style="padding:14px 12px;text-align:center"><button class="btn btn-outline btn-xs" onclick="StudentController.viewResult(${a.id})">👁 View</button></td>`;
      } else if (canAnswer) {
        actionCell = `<td style="padding:14px 12px;text-align:center"><button class="btn btn-primary btn-xs" onclick="StudentController.openActivity(${a.id})">✏️ Start</button></td>`;
      } else if (isPastDue) {
        actionCell = `<td style="padding:14px 12px;text-align:center"><button class="btn btn-outline btn-xs" style="border-color:#c0392b;color:#c0392b" onclick="StudentController.openActivity(${a.id})">👁 View</button></td>`;
      } else {
        actionCell = `<td style="padding:14px 12px;text-align:center"><span style="color:var(--gray-400);font-size:12px">—</span></td>`;
      }

      const rowBg = sub && sub.is_graded ? '' : (isPastDue && !sub ? 'background:#fffafa' : '');
      return `
        <tr data-searchable style="${rowBg}">
          ${assignmentCell}${startCell}${dueCell}${pctCell}${submittedCell}${gradedCell}${scoreCell}${gradeCell}${actionCell}
        </tr>`;
    }).join('');

    return `
      <div class="section-header">
        <div class="section-header-left"><h2>Activities &amp; Quizzes</h2><p id="act-student-count">${apiActivities.length} activity(s)</p></div>
        <div class="search-box"><span>🔍</span><input type="text" id="global-search" placeholder="Search activities…" oninput="StudentController._filterActivities(this.value)" /></div>
      </div>
      <div class="table-wrap" style="margin-top:8px;border:1px solid var(--gray-200);border-radius:12px;overflow-x:auto;overflow-y:visible;background:white;box-shadow:0 1px 4px rgba(0,0,0,.05);-webkit-overflow-scrolling:touch">
        <table class="activity-table">
          <thead>
            <tr>
              <th style="text-align:left">Assignment</th>
              <th style="text-align:left">Start</th>
              <th style="text-align:left">Due</th>
              <th style="text-align:center">Points</th>
              <th style="text-align:center">Submitted</th>
              <th style="text-align:center">Graded</th>
              <th style="text-align:center">Score</th>
              <th style="text-align:center">Grade</th>
              <th style="text-align:center">Action</th>
            </tr>
          </thead>
          <tbody id="student-activity-list">${rows}</tbody>
        </table>
      </div>`;
  },

  /** Activity answering screen */
  activityAnswerSheet(activity) {
    const _fmtDate = d => d ? new Date(d).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

    const questions = (activity.questions || []).map((q, idx) => {
      let answerWidget = '';
      if (q.question_type === 'multiple_choice') {
        const letters = ['A','B','C','D','E','F'];
        const choices = q.choices.map((c, ci) => `
          <input type="radio" id="q_${q.id}_${ci}" name="q_${q.id}" value="${ci}" />
          <label class="quiz-choice-card" for="q_${q.id}_${ci}">
            <span class="quiz-choice-letter">${letters[ci] || ci + 1}</span>
            <span class="quiz-choice-text">${escHtml(c.choice_text)}</span>
          </label>`).join('');
        answerWidget = `<div class="quiz-choice-group" style="margin-top:10px">${choices}</div>`;
      } else if (q.question_type === 'checkbox') {
        const choices = q.choices.map((c, ci) => `
          <input type="checkbox" id="q_${q.id}_${ci}" name="q_${q.id}" value="${ci}" />
          <label class="quiz-choice-card" for="q_${q.id}_${ci}">
            <span class="quiz-choice-letter">✓</span>
            <span class="quiz-choice-text">${escHtml(c.choice_text)}</span>
          </label>`).join('');
        answerWidget = `<div class="quiz-choice-group" style="margin-top:10px">${choices}</div><small style="color:var(--gray-500);font-size:11px">Select all that apply.</small>`;
      } else if (q.question_type === 'fill_blank' || q.question_type === 'enumeration') {
        answerWidget = `<input type="text" id="q_${q.id}" class="form-control" placeholder="Type your answer here…" style="margin-top:10px" />`;
      } else {
        answerWidget = `<textarea id="q_${q.id}" class="form-control" rows="4" placeholder="Write your answer here…" style="margin-top:10px;resize:vertical"></textarea>`;
      }

      return `
        <div class="activity-card" style="border:1px solid var(--gray-200);border-radius:10px;padding:18px 20px;background:white;margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
            <div style="font-size:13px;font-weight:700;color:var(--maroon)">Question ${idx + 1}</div>
            <span class="badge badge-gold">${q.points} pt${q.points !== 1 ? 's' : ''}</span>
          </div>
          <div style="font-size:14px;font-weight:600;color:#1a1a2e;line-height:1.5">${escHtml(q.question_text)}</div>
          ${answerWidget}
        </div>`;
    }).join('');

    const totalPts = (activity.questions || []).reduce((s, q) => s + q.points, 0);

    return `
      <div style="max-width:720px;margin:0 auto">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
          <button class="btn btn-ghost btn-sm" onclick="DashboardController.loadSection('activities')">← Back</button>
          <div>
            <h2 style="margin:0;font-size:18px">${escHtml(activity.title)}</h2>
            <div style="font-size:12px;color:var(--gray-500)">⏰ Due: ${_fmtDate(activity.due_date)} · 🎯 ${totalPts} pts total</div>
          </div>
        </div>
        ${activity.instructions ? `
          <div style="padding:14px 16px;background:#fff9e6;border:1px solid #f0c040;border-radius:8px;margin-bottom:20px;font-size:13px;color:#7a5c00">
            <strong>📌 Instructions:</strong> ${escHtml(activity.instructions)}
          </div>` : ''}
        <div id="answer-sheet-questions">${questions || '<div class="empty-state"><div class="empty-state-title">No questions found.</div></div>'}</div>
        ${activity.questions && activity.questions.length ? `
          <div style="position:sticky;bottom:0;background:white;border-top:1px solid var(--gray-200);padding:14px 0;display:flex;justify-content:flex-end;gap:10px;margin-top:8px">
            <button class="btn btn-outline" onclick="DashboardController.loadSection('activities')">Cancel</button>
            <button class="btn btn-primary" id="submit-activity-btn" onclick="StudentController.confirmSubmit(${activity.id})">📤 Submit Activity</button>
          </div>` : ''}
      </div>`;
  },

  /** Result screen after submitting or viewing past submission */
  activityResult(activity, result) {
    const _fmtDate = d => d ? new Date(d).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
    const pct      = result.max_score ? Math.round(result.score / result.max_score * 100) : null;

    const answerMap = {};
    (result.answers || []).forEach(a => { answerMap[a.question_id] = a; });

    const questions = (activity.questions || []).map((q, idx) => {
      const ans        = answerMap[q.id];
      const correctIcon = ans ? (ans.is_correct === true ? '✅' : ans.is_correct === false ? '❌' : '📝') : '—';
      const ptsEarned  = ans ? (ans.points_earned ?? '?') : 0;

      let answerDisplay = '—';
      if (ans && ans.answer_value != null) {
        if (q.question_type === 'multiple_choice' || q.question_type === 'checkbox') {
          try {
            const idxs   = q.question_type === 'checkbox' ? JSON.parse(ans.answer_value) : [parseInt(ans.answer_value)];
            const labels = idxs.map(i => q.choices[i]?.choice_text || `Choice ${i}`);
            answerDisplay = labels.join(', ');
          } catch { answerDisplay = ans.answer_value; }
        } else {
          answerDisplay = ans.answer_value;
        }
      }

      const rowBg = ans ? (ans.is_correct === true ? '#e6f4ea' : ans.is_correct === false ? '#fde8ec' : '#fff9e6') : '';

      return `
        <div style="border:1px solid var(--gray-200);border-radius:10px;padding:14px 18px;background:${rowBg || 'white'};margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="font-size:13px;font-weight:700;color:var(--maroon)">Q${idx + 1} ${correctIcon}</div>
            <span class="badge badge-gold">${ptsEarned} / ${q.points} pt${q.points !== 1 ? 's' : ''}</span>
          </div>
          <div style="font-size:13px;font-weight:600;color:#1a1a2e;margin:6px 0">${escHtml(q.question_text)}</div>
          <div style="font-size:13px;color:#444">Your answer: <em>${escHtml(answerDisplay)}</em></div>
        </div>`;
    }).join('');

    return `
      <div style="max-width:720px;margin:0 auto">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
          <button class="btn btn-ghost btn-sm" onclick="DashboardController.loadSection('activities')">← Back to Activities</button>
        </div>
        <div style="padding:24px;background:white;border:1px solid var(--gray-200);border-radius:12px;margin-bottom:20px;text-align:center">
          <div style="font-size:36px;margin-bottom:8px">${result.is_graded || result.score != null ? '🏆' : '⏳'}</div>
          <div style="font-size:clamp(15px,4vw,20px);font-weight:700;color:#1a1a2e;margin-bottom:4px;word-break:break-word">${escHtml(activity.title)}</div>
          ${result.is_graded || result.score != null ? `
            <div style="font-size:32px;font-weight:800;color:var(--maroon);margin:10px 0">${result.score} <span style="font-size:18px;color:#888">/ ${result.max_score} pts</span></div>
            <div style="font-size:15px;color:#555">${pct}% · Grade: <strong>${result.grade || '—'}</strong></div>
            ${result.remarks ? `<div style="margin-top:6px;font-size:13px;color:#666">📝 ${escHtml(result.remarks)}</div>` : ''}
          ` : `
            <div style="font-size:14px;color:#1a4a8a;margin-top:8px">Submitted on ${_fmtDate(result.submitted_at)}</div>
            <div style="font-size:13px;color:#888;margin-top:4px">Your work is with your teacher for review. Grade will be posted once evaluated.</div>
          `}
        </div>
        ${activity.questions && activity.questions.length ? `
          <div style="font-size:14px;font-weight:700;color:#1a1a2e;margin-bottom:12px">Answer Review</div>
          ${questions}
        ` : ''}
      </div>`;
  },

  // ── My Grades shell (shown while loading) ────────────────────────────────
  myGrades() {
    return `
      <div class="section-header">
        <div class="section-header-left">
          <h2>📊 My Grades</h2>
          <p id="my-grades-count">Loading…</p>
        </div>
        <div class="search-box">
          <span>🔍</span>
          <input type="text" id="global-search" placeholder="Search activities…" />
        </div>
      </div>
      <div id="my-grades-wrap">
        <div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-title">Loading grades…</div></div>
      </div>`;
  },

  // ── My Grades populated table ─────────────────────────────────────────────
  myGradesTable(activities, subjectMap) {
    // Filter to only submitted/graded ones
    const graded = activities.filter(a => a.submission !== null && a.submission !== undefined);

    const countEl = document.getElementById('my-grades-count');

    if (!graded.length) {
      if (countEl) countEl.textContent = 'No graded activities yet';
      return `
        <div class="empty-state" style="margin-top:20px">
          <div class="empty-state-icon">📭</div>
          <div class="empty-state-title">No Grades Yet</div>
          <div class="empty-state-sub">Your submitted activities will appear here once your teacher grades them.</div>
        </div>`;
    }

    // Compute summary stats
    let totalEarned = 0, totalPossible = 0, gradedCount = 0;
    graded.forEach(a => {
      const sub = a.submission;
      if (sub && sub.score != null && sub.max_score != null) {
        totalEarned   += sub.score;
        totalPossible += sub.max_score;
        gradedCount++;
      }
    });
    const overallPct  = totalPossible > 0 ? Math.round(totalEarned / totalPossible * 100) : null;
    const overallGrade = overallPct !== null ? StudentView._toPhGrade(overallPct) : '—';
    const gradeColor  = overallPct === null ? 'var(--gray-400)'
      : overallPct >= 75 ? '#16a34a' : overallPct >= 60 ? '#d97706' : '#dc2626';

    if (countEl) countEl.textContent = `${graded.length} submission(s) · ${gradedCount} graded`;

    const TYPE_LABELS = {
      quiz: 'Quiz', long_quiz: 'Long Quiz', task_performance: 'Task Performance',
      exam: 'Exam', lab_exercise: 'Lab Exercise', assignment: 'Assignment', other: 'Other',
    };

    const rows = graded.map(a => {
      const sub        = a.submission;
      const subjectName = subjectMap[a.subject_id] || '—';
      const typeLabel  = TYPE_LABELS[a.activity_type] || a.activity_type || '—';
      const term       = a.term ? `${a.term} Term` : '—';

      // Score / pct
      const score    = sub.score;
      const maxScore = sub.max_score ?? a.max_score;
      const pct      = score != null && maxScore ? Math.round(score / maxScore * 100) : null;
      const pctColor = pct === null ? 'var(--gray-400)' : pct >= 75 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
      const pctBadge = pct !== null
        ? `<span class="badge ${pct >= 75 ? 'badge-green' : pct >= 60 ? 'badge-gold' : 'badge-danger'}" style="font-size:11px">${pct}%</span>`
        : `<span class="badge badge-gray" style="font-size:11px">Pending</span>`;

      // PH grade
      const phGrade = pct !== null ? StudentView._toPhGrade(pct) : '—';
      const phColor = phGrade === '—' ? 'var(--gray-400)'
        : parseFloat(phGrade) <= 1.75 ? '#16a34a'
        : parseFloat(phGrade) <= 2.75 ? '#d97706'
        : '#dc2626';

      // Remarks
      const remarks = sub.remarks || '—';

      // Date
      const dateStr = sub.submitted_at
        ? new Date(sub.submitted_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—';

      // Graded status
      const gradedBadge = sub.is_graded || score != null
        ? `<span class="badge badge-green" style="font-size:10px">✅ Graded</span>`
        : `<span class="badge badge-gold" style="font-size:10px">⏳ Pending</span>`;

      return `<tr data-searchable>
        <td>
          <div style="font-weight:600;font-size:13px;color:var(--maroon)">${escHtml(a.title)}</div>
          <div style="font-size:11px;color:var(--gray-400);margin-top:2px">${escHtml(typeLabel)} · ${escHtml(term)}</div>
        </td>
        <td><span class="badge badge-maroon" style="font-size:11px">${escHtml(subjectName)}</span></td>
        <td style="text-align:center;font-weight:600">
          ${score !== null && score !== undefined ? `${score}<span style="color:var(--gray-400)">/${maxScore ?? '?'}</span>` : `<span style="color:var(--gray-400)">—/${maxScore ?? '?'}</span>`}
        </td>
        <td style="text-align:center">${pctBadge}</td>
        <td style="text-align:center;font-weight:700;color:${phColor};font-size:14px">${escHtml(String(phGrade))}</td>
        <td>${gradedBadge}</td>
        <td style="font-size:12px;color:var(--gray-500)">${escHtml(remarks)}</td>
        <td style="font-size:12px;color:var(--gray-500)">${escHtml(dateStr)}</td>
      </tr>`;
    }).join('');

    return `
      <!-- Summary strip -->
      <div class="grades-stats-row">
        <div class="stat-card" style="flex:1;min-width:0;padding:clamp(10px,2vw,16px)">
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px">Submissions</div>
          <div style="font-size:clamp(16px,4vw,22px);font-weight:700;color:var(--maroon)">${graded.length}</div>
        </div>
        <div class="stat-card" style="flex:1;min-width:0;padding:clamp(10px,2vw,16px)">
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px">Graded</div>
          <div style="font-size:clamp(16px,4vw,22px);font-weight:700;color:var(--maroon)">${gradedCount}</div>
        </div>
        <div class="stat-card" style="flex:1;min-width:0;padding:clamp(10px,2vw,16px)">
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px">Overall Score</div>
          <div style="font-size:clamp(16px,4vw,22px);font-weight:700;color:${gradeColor}">
            ${overallPct !== null ? overallPct + '%' : '—'}
          </div>
        </div>
        <div class="stat-card" style="flex:1;min-width:0;padding:clamp(10px,2vw,16px)">
          <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px">Overall Grade</div>
          <div style="font-size:clamp(16px,4vw,22px);font-weight:700;color:${gradeColor}">${escHtml(String(overallGrade))}</div>
        </div>
      </div>

      ${(() => {
        const isMobile = window.innerWidth <= 600;

        if (!isMobile) {
          return `
            <div class="card">
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th style="white-space:nowrap">Activity</th>
                      <th style="white-space:nowrap">Subject</th>
                      <th style="white-space:nowrap;text-align:center">Score</th>
                      <th style="white-space:nowrap;text-align:center">%</th>
                      <th style="white-space:nowrap;text-align:center">Grade</th>
                      <th style="white-space:nowrap">Status</th>
                      <th style="white-space:nowrap">Remarks</th>
                      <th style="white-space:nowrap">Submitted</th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>
              </div>
            </div>`;
        }

        // Mobile card layout
        return `<div style="display:flex;flex-direction:column;gap:10px">
          ${graded.map(a => {
            const sub         = a.submission;
            const subjectName = subjectMap[a.subject_id] || '—';
            const typeLabel   = ({ quiz:'Quiz', long_quiz:'Long Quiz', task_performance:'Task Performance',
              exam:'Exam', lab_exercise:'Lab Exercise', assignment:'Assignment', other:'Other' })[a.activity_type] || a.activity_type || '—';
            const term        = a.term ? `${a.term} Term` : '—';
            const score       = sub.score;
            const maxScore    = sub.max_score ?? a.max_score;
            const pct         = score != null && maxScore ? Math.round(score / maxScore * 100) : null;
            const phGrade     = pct !== null ? StudentView._toPhGrade(pct) : '—';
            const phColor     = phGrade === '—' ? 'var(--gray-400)' : parseFloat(phGrade) <= 1.75 ? '#16a34a' : parseFloat(phGrade) <= 2.75 ? '#d97706' : '#dc2626';
            const dateStr     = sub.submitted_at
              ? new Date(sub.submitted_at).toLocaleDateString('en-PH', { month:'short', day:'numeric', year:'numeric' })
              : '—';
            const statusBadge = sub.is_graded || score != null
              ? `<span class="badge badge-green" style="font-size:10px">✅ Graded</span>`
              : `<span class="badge badge-gold" style="font-size:10px">⏳ Pending</span>`;
            const pctBadge = pct !== null
              ? `<span class="badge ${pct >= 75 ? 'badge-green' : pct >= 60 ? 'badge-gold' : 'badge-danger'}" style="font-size:11px">${pct}%</span>`
              : `<span class="badge badge-gray" style="font-size:11px">Pending</span>`;
            const rowStyle = 'display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #f3f4f6;font-size:13px';
            const labelStyle = 'color:var(--gray-400);font-size:11px;text-transform:uppercase;letter-spacing:.4px';
            return `
              <div style="background:#fff;border:1px solid #f0e8e8;border-radius:10px;padding:14px 16px;box-shadow:0 1px 4px rgba(0,0,0,.05)">
                <div style="font-weight:700;font-size:14px;color:var(--maroon);margin-bottom:2px">${escHtml(a.title)}</div>
                <div style="font-size:11px;color:var(--gray-400);margin-bottom:10px">${escHtml(typeLabel)} · ${escHtml(term)}</div>
                <div style="${rowStyle}">
                  <span style="${labelStyle}">Subject</span>
                  <span><span class="badge badge-maroon" style="font-size:11px">${escHtml(subjectName)}</span></span>
                </div>
                <div style="${rowStyle}">
                  <span style="${labelStyle}">Score</span>
                  <span style="font-weight:600;color:var(--maroon)">
                    ${score !== null && score !== undefined ? `${score}<span style="color:var(--gray-400)">/${maxScore ?? '?'}</span>` : `<span style="color:var(--gray-400)">—/${maxScore ?? '?'}</span>`}
                  </span>
                </div>
                <div style="${rowStyle}">
                  <span style="${labelStyle}">Percentage</span>
                  <span>${pctBadge}</span>
                </div>
                <div style="${rowStyle}">
                  <span style="${labelStyle}">Final Grade</span>
                  <span style="font-weight:700;font-size:16px;color:${phColor}">${escHtml(String(phGrade))}</span>
                </div>
                <div style="${rowStyle}">
                  <span style="${labelStyle}">Status</span>
                  <span>${statusBadge}</span>
                </div>
                ${sub.remarks && sub.remarks !== '—' ? `
                <div style="${rowStyle}">
                  <span style="${labelStyle}">Remarks</span>
                  <span style="font-size:12px;color:var(--gray-500);text-align:right;max-width:65%">${escHtml(sub.remarks)}</span>
                </div>` : ''}
                <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:13px">
                  <span style="${labelStyle}">Submitted</span>
                  <span style="font-size:12px;color:var(--gray-500)">${escHtml(dateStr)}</span>
                </div>
              </div>`;
          }).join('')}
        </div>`;
      })()}

      <!-- Grade scale legend -->
      <div style="margin-top:14px;padding:12px 16px;background:var(--gray-50);border-radius:var(--radius);border:1px solid var(--gray-100);font-size:11px;color:var(--gray-500)">
        <strong style="color:var(--gray-600)">Grade Scale (DepEd):</strong>
        1.00 (97-100%) · 1.25 (93-96%) · 1.50 (89-92%) · 1.75 (85-88%) · 2.00 (81-84%) ·
        2.25 (77-80%) · 2.50 (73-76%) · 2.75 (69-72%) · 3.00 (65-68%) · 5.00 (&lt;65%)
      </div>`;
  },

  // ── DepEd grade transmutation (reused from teacher side) ─────────────────
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

  // ── Attendance loading skeleton ────────────────────────────────────────────
  attendanceLoading() {
    return `
      <div class="section-header">
        <div class="section-header-left">
          <h2>📋 My Attendance</h2>
          <p>Loading…</p>
        </div>
      </div>
      <div class="empty-state" style="margin-top:40px">
        <div class="empty-state-icon">⏳</div>
        <div class="empty-state-title">Loading attendance records…</div>
      </div>`;
  },

  // ── Attendance full view ───────────────────────────────────────────────────
  /**
   * @param {Array} data  - result of api.getMyAttendance()
   *   Each item: { subject_name, class_name, terms[], totals }
   *   terms[]: { term, present, absent, late, excused, total }
   *   totals:  { present, absent, late, excused, total }
   */
  attendance(data) {
    if (!data || !data.length) {
      return `
        <div class="section-header">
          <div class="section-header-left"><h2>📋 My Attendance</h2><p>No records found</p></div>
        </div>
        <div class="empty-state" style="margin-top:40px">
          <div class="empty-state-icon">📭</div>
          <div class="empty-state-title">No Attendance Records Yet</div>
          <div class="empty-state-sub">Your teacher hasn't recorded any attendance sessions for your subjects yet.</div>
        </div>`;
    }

    // Helper: status pill colour
    function _statusBg(status) {
      return status === 'present' ? '#e6f4ea'
           : status === 'late'    ? '#fff8e1'
           : status === 'excused' ? '#e8f0fe'
           :                        '#fde8ec'; // absent
    }
    function _statusColor(status) {
      return status === 'present' ? '#2e6b3e'
           : status === 'late'    ? '#a05c00'
           : status === 'excused' ? '#1a4a8a'
           :                        '#c0392b';
    }

    // Helper: attendance rate bar
    function _rateBar(present, total) {
      if (!total) return '<span style="color:#aaa;font-size:12px">No sessions yet</span>';
      const pct = Math.round(present / total * 100);
      const barColor = pct >= 75 ? '#2e6b3e' : pct >= 50 ? '#a05c00' : '#c0392b';
      const textColor = pct >= 75 ? '#2e6b3e' : pct >= 50 ? '#a05c00' : '#c0392b';
      return `
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:6px;background:#eee;border-radius:4px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${barColor};border-radius:4px;transition:width .4s"></div>
          </div>
          <span style="font-size:12px;font-weight:700;color:${textColor};white-space:nowrap">${pct}%</span>
        </div>`;
    }

    // Helper: stat badge
    function _badge(value, status) {
      const bg  = _statusBg(status);
      const col = _statusColor(status);
      const labels = { present:'Present', absent:'Absent', late:'Late', excused:'Excused' };
      return `
        <div style="text-align:center;padding:6px 10px;background:${bg};border-radius:8px;min-width:56px">
          <div style="font-size:18px;font-weight:800;color:${col}">${value}</div>
          <div style="font-size:10px;color:${col};opacity:.8;margin-top:1px">${labels[status]}</div>
        </div>`;
    }

    const cards = data.map(subject => {
      const { subject_name, class_name, terms, totals } = subject;
      const hasData = totals.total > 0;

      // Per-term breakdown rows
      const termRows = terms.length
        ? terms.map(t => {
            const termPct = t.total ? Math.round(t.present / t.total * 100) : null;
            return `
              <tr style="border-top:1px solid #f0f0f0">
                <td style="padding:8px 12px;font-size:12px;font-weight:600;color:#555;white-space:nowrap">${escHtml(t.term)} Term</td>
                <td style="padding:8px 12px;text-align:center">
                  <span style="display:inline-block;padding:2px 8px;border-radius:5px;background:${_statusBg('present')};color:${_statusColor('present')};font-size:12px;font-weight:700">${t.present}</span>
                </td>
                <td style="padding:8px 12px;text-align:center">
                  <span style="display:inline-block;padding:2px 8px;border-radius:5px;background:${_statusBg('absent')};color:${_statusColor('absent')};font-size:12px;font-weight:700">${t.absent}</span>
                </td>
                <td style="padding:8px 12px;text-align:center">
                  <span style="display:inline-block;padding:2px 8px;border-radius:5px;background:${_statusBg('late')};color:${_statusColor('late')};font-size:12px;font-weight:700">${t.late}</span>
                </td>
                <td style="padding:8px 12px;text-align:center">
                  <span style="display:inline-block;padding:2px 8px;border-radius:5px;background:${_statusBg('excused')};color:${_statusColor('excused')};font-size:12px;font-weight:700">${t.excused}</span>
                </td>
                <td style="padding:8px 12px;text-align:center;font-size:12px;color:#666">${t.total}</td>
                <td style="padding:8px 16px;min-width:120px">${termPct !== null ? _rateBar(t.present, t.total) : '<span style="color:#aaa;font-size:11px">—</span>'}</td>
              </tr>`;
          }).join('')
        : `<tr><td colspan="7" style="padding:12px 16px;text-align:center;font-size:13px;color:#aaa">No sessions recorded yet</td></tr>`;

      const overallPct = totals.total ? Math.round(totals.present / totals.total * 100) : null;

      return `
        <div style="border:1px solid var(--gray-200);border-radius:12px;background:white;
                    box-shadow:0 1px 4px rgba(0,0,0,.05);overflow:hidden;margin-bottom:16px">

          <!-- Card header -->
          <div style="padding:14px 20px;background:var(--rose-tint,#fdf6f7);
                      border-bottom:1px solid var(--gray-200);
                      display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <div>
              <div style="font-size:15px;font-weight:700;color:var(--maroon,#6b0f1a)">${escHtml(subject_name)}</div>
              <div style="font-size:12px;color:var(--gray-500,#888);margin-top:2px">📚 ${escHtml(class_name)}</div>
            </div>
            ${hasData ? `
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                ${_badge(totals.present, 'present')}
                ${_badge(totals.absent,  'absent')}
                ${_badge(totals.late,    'late')}
                ${_badge(totals.excused, 'excused')}
              </div>` : ''}
          </div>

          <!-- Overall rate bar -->
          ${hasData ? `
          <div style="padding:10px 20px;border-bottom:1px solid #f5f5f5;display:flex;align-items:center;gap:12px">
            <span style="font-size:12px;color:#777;white-space:nowrap">Overall Attendance</span>
            <div style="flex:1">${_rateBar(totals.present, totals.total)}</div>
            <span style="font-size:11px;color:#aaa;white-space:nowrap">${totals.present}/${totals.total} sessions</span>
          </div>` : ''}

          <!-- Per-term table -->
          <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
            <table style="width:100%;border-collapse:collapse;min-width:480px">
              <thead>
                <tr style="background:#fafafa">
                  <th style="padding:8px 12px;text-align:left;font-size:11px;color:#999;font-weight:600;border-bottom:1px solid #eee;white-space:nowrap">TERM</th>
                  <th style="padding:8px 12px;text-align:center;font-size:11px;color:#2e6b3e;font-weight:600;border-bottom:1px solid #eee;white-space:nowrap">PRESENT</th>
                  <th style="padding:8px 12px;text-align:center;font-size:11px;color:#c0392b;font-weight:600;border-bottom:1px solid #eee;white-space:nowrap">ABSENT</th>
                  <th style="padding:8px 12px;text-align:center;font-size:11px;color:#a05c00;font-weight:600;border-bottom:1px solid #eee;white-space:nowrap">LATE</th>
                  <th style="padding:8px 12px;text-align:center;font-size:11px;color:#1a4a8a;font-weight:600;border-bottom:1px solid #eee;white-space:nowrap">EXCUSED</th>
                  <th style="padding:8px 12px;text-align:center;font-size:11px;color:#666;font-weight:600;border-bottom:1px solid #eee;white-space:nowrap">TOTAL</th>
                  <th style="padding:8px 16px;text-align:left;font-size:11px;color:#666;font-weight:600;border-bottom:1px solid #eee;white-space:nowrap">ATTENDANCE RATE</th>
                </tr>
              </thead>
              <tbody>${termRows}</tbody>
            </table>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="section-header">
        <div class="section-header-left">
          <h2>📋 My Attendance</h2>
          <p>${data.length} subject${data.length !== 1 ? 's' : ''}</p>
        </div>
      </div>
      <div style="margin-top:12px">${cards}</div>
      <p style="margin-top:4px;font-size:11px;color:#bbb;text-align:center">
        This is a read-only view of attendance recorded by your teacher. Contact your teacher for any discrepancies.
      </p>`;
  },
};