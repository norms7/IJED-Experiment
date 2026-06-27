/* ============================================================
   views/analytics.view.js
   Pure render functions for the Performance Analytics tab.
   Follows the same pattern as student.view.js — returns HTML
   strings only; no direct DOM manipulation.

   Charts are rendered via Chart.js (CDN), loaded lazily inside
   AnalyticsController._postRender().
   ============================================================ */

"use strict";

const AnalyticsView = {

  // ── Shell: the two-sub-tab wrapper ───────────────────────────────────────

  shell(subjectOptions = []) {
    const opts = subjectOptions.map(s =>
      `<option value="${s.subject_id}">${escHtml(s.subject_name)}</option>`
    ).join('');

    return `
      <div class="analytics-header">
        <div>
          <h2 class="analytics-title">📊 Performance Analytics</h2>
          <p class="analytics-sub">Understand your academic journey with data-driven insights.</p>
        </div>
        <div class="analytics-filters">
          <select id="analytics-subject-filter" class="analytics-select" onchange="AnalyticsController.onSubjectChange(this.value)">
            <option value="">All Subjects</option>
            ${opts}
          </select>
        </div>
      </div>

      <!-- Sub-tab navigation -->
      <div class="analytics-tabs">
        <button class="analytics-tab active" data-tab="descriptive"
          onclick="AnalyticsController.switchTab('descriptive', this)">
          📈 Descriptive Analysis
        </button>
        <button class="analytics-tab" data-tab="bayesian"
          onclick="AnalyticsController.switchTab('bayesian', this)">
          🔮 Bayesian Analysis
        </button>
      </div>

      <!-- Tab panels -->
      <div id="analytics-panel-descriptive" class="analytics-panel">
        ${AnalyticsView.descriptiveSkeleton()}
      </div>
      <div id="analytics-panel-bayesian" class="analytics-panel hidden">
        ${AnalyticsView.bayesianSkeleton()}
      </div>`;
  },

  // ── Skeletons ─────────────────────────────────────────────────────────────

  descriptiveSkeleton() {
    return `
      <div class="analytics-grid">
        ${[1,2,3,4,5].map(() => `
          <div class="analytics-card">
            <div class="skeleton-title"></div>
            <div class="skeleton-chart"></div>
          </div>`).join('')}
      </div>`;
  },

  bayesianSkeleton() {
    return `
      <div class="analytics-grid">
        ${[1,2,3,4].map(() => `
          <div class="analytics-card">
            <div class="skeleton-title"></div>
            <div class="skeleton-chart"></div>
          </div>`).join('')}
      </div>`;
  },

  // ── Empty state ───────────────────────────────────────────────────────────

  empty(message = 'No data available yet. Complete some activities to see your analytics.') {
    return `
      <div class="analytics-empty">
        <div class="analytics-empty-icon">📭</div>
        <div class="analytics-empty-title">Nothing to show yet</div>
        <div class="analytics-empty-sub">${escHtml(message)}</div>
      </div>`;
  },

  // ── Error state ───────────────────────────────────────────────────────────

  error(msg = 'Could not load analytics. Please try again.') {
    return `
      <div class="analytics-empty">
        <div class="analytics-empty-icon">⚠️</div>
        <div class="analytics-empty-title">Something went wrong</div>
        <div class="analytics-empty-sub">${escHtml(msg)}</div>
        <button class="btn btn-sm btn-outline" style="margin-top:12px"
          onclick="AnalyticsController.reload()">Try Again</button>
      </div>`;
  },

  // ════════════════════════════════════════════════════════════════════════════
  // DESCRIPTIVE PANEL
  // ════════════════════════════════════════════════════════════════════════════

  descriptivePanel(data, subjectMap = {}) {
    const { grade_progress, attendance_calendar, score_vs_avg, module_progress, subject_radar } = data;

    return `
      <div class="analytics-grid">

        <!-- 1. Grade Progress — Line Chart -->
        <div class="analytics-card analytics-card-wide">
          <div class="analytics-card-header">
            <div class="analytics-card-title">📈 My Grade Progress</div>
            <div class="analytics-card-sub">Score trends over time</div>
          </div>
          ${grade_progress.data.length
            ? `<div class="chart-wrapper"><canvas id="chart-grade-progress"></canvas></div>`
            : AnalyticsView.empty('Submit and get graded on activities to see your progress.')
          }
        </div>

        <!-- 2. Attendance Calendar — Heatmap -->
        <div class="analytics-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">🗓️ My Attendance Calendar</div>
            <div class="analytics-card-sub">Daily attendance patterns</div>
          </div>
          <div class="att-legend">
            <span class="att-dot att-present"></span>Present
            <span class="att-dot att-absent"></span>Absent
            <span class="att-dot att-excused"></span>Excused
            <span class="att-dot att-no-class"></span>No Class
          </div>
          ${AnalyticsView._attendanceCalendar(attendance_calendar)}
          ${AnalyticsView._attendanceSummary(attendance_calendar.summary)}
        </div>

        <!-- 3. Score vs Class Average — Bar Chart -->
        <div class="analytics-card analytics-card-wide">
          <div class="analytics-card-header">
            <div class="analytics-card-title">📊 Activity Score vs Class Average</div>
            <div class="analytics-card-sub">How you compare to your peers</div>
          </div>
          ${score_vs_avg.data.length
            ? `<div class="chart-wrapper"><canvas id="chart-score-vs-avg"></canvas></div>`
            : AnalyticsView.empty('Class average data will appear once activities are graded.')
          }
        </div>

        <!-- 4. Module Reading Progress — Progress Bars -->
        <div class="analytics-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">📄 Module Reading Progress</div>
            <div class="analytics-card-sub">Learning engagement with course materials</div>
          </div>
          ${AnalyticsView._moduleProgress(module_progress)}
        </div>

        <!-- 5. Subject Radar — Radar Chart -->
        <div class="analytics-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">🕸️ Subject Performance Overview</div>
            <div class="analytics-card-sub">Strengths and areas for growth</div>
          </div>
          ${subject_radar.axes.length >= 3
            ? `<div class="chart-wrapper chart-wrapper-sm"><canvas id="chart-subject-radar"></canvas></div>`
            : AnalyticsView.empty('Enroll in at least 3 subjects to see the radar chart.')
          }
        </div>

      </div>`;
  },

  _attendanceCalendar(att) {
    if (!att || !att.calendar || Object.keys(att.calendar).length === 0) {
      return AnalyticsView.empty('No attendance sessions recorded yet.');
    }

    // Group by month
    const byMonth = {};
    for (const [dateStr, status] of Object.entries(att.calendar)) {
      const d = new Date(dateStr + 'T00:00:00');
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = {};
      byMonth[key][d.getDate()] = status;
    }

    const months = Object.keys(byMonth).sort();
    // Show last 3 months
    const visible = months.slice(-3);

    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const DAY_LABELS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

    const statusClass = {
      present:  'att-present',
      absent:   'att-absent',
      excused:  'att-excused',
      late:     'att-late',
      no_class: 'att-no-class',
    };

    return `<div class="att-months-wrapper">` + visible.map(mk => {
      const [yr, mo] = mk.split('-').map(Number);
      const firstDay = new Date(yr, mo - 1, 1).getDay();
      const daysInMonth = new Date(yr, mo, 0).getDate();
      const dayMap = byMonth[mk] || {};

      let cells = DAY_LABELS.map(d => `<div class="att-day-label">${d}</div>`).join('');
      // Empty cells before first day
      for (let i = 0; i < firstDay; i++) cells += `<div class="att-cell att-empty"></div>`;
      for (let d = 1; d <= daysInMonth; d++) {
        const st = dayMap[d] || '';
        const cls = statusClass[st] || 'att-future';
        const title = st ? `${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}: ${st.replace('_',' ')}` : '';
        cells += `<div class="att-cell ${cls}" title="${title}">${d}</div>`;
      }

      return `
        <div class="att-month">
          <div class="att-month-label">${MONTH_NAMES[mo-1]} ${yr}</div>
          <div class="att-grid">${cells}</div>
        </div>`;
    }).join('') + `</div>`;
  },

  _attendanceSummary(summary) {
    if (!summary) return '';
    const total = (summary.present || 0) + (summary.absent || 0) + (summary.late || 0) + (summary.excused || 0);
    const rate = total > 0 ? Math.round(((summary.present || 0) / total) * 100) : 0;
    const rateColor = rate >= 80 ? 'var(--green)' : rate >= 60 ? '#f59e0b' : 'var(--red)';
    return `
      <div class="att-summary">
        <div class="att-summary-rate" style="color:${rateColor}">${rate}%</div>
        <div class="att-summary-label">Attendance Rate</div>
        <div class="att-summary-pills">
          <span class="att-pill att-present">${summary.present || 0} Present</span>
          <span class="att-pill att-absent">${summary.absent || 0} Absent</span>
          <span class="att-pill att-excused">${summary.excused || 0} Excused</span>
        </div>
      </div>`;
  },

  _moduleProgress(data) {
    if (!data || !data.subjects || data.subjects.length === 0) {
      return AnalyticsView.empty('No published modules found for your subjects.');
    }

    const subjects = data.subjects;
    const totals = data.totals;
    const overallColor = totals.pct >= 80 ? 'var(--green)' : totals.pct >= 50 ? '#f59e0b' : 'var(--red)';

    return `
      <div class="mod-overall">
        <div class="mod-overall-bar-wrap">
          <div class="mod-overall-bar" style="width:${totals.pct}%;background:${overallColor}"></div>
        </div>
        <span class="mod-overall-label">${totals.pct}% overall (${totals.read}/${totals.total} modules)</span>
      </div>
      <div class="mod-list">
        ${subjects.map(s => {
          const c = s.completion_pct >= 80 ? 'var(--green)' : s.completion_pct >= 50 ? '#f59e0b' : 'var(--red)';
          return `
            <div class="mod-subject-row">
              <div class="mod-subject-name" title="Subject ID ${s.subject_id}">
                Subject ${s.subject_id}
              </div>
              <div class="mod-bar-wrap">
                <div class="mod-bar" style="width:${s.completion_pct}%;background:${c}"></div>
              </div>
              <span class="mod-pct" style="color:${c}">${s.completion_pct}%</span>
              <span class="mod-count">${s.modules_read}/${s.modules_total}</span>
            </div>`;
        }).join('')}
      </div>
      ${totals.total - totals.read > 0
        ? `<p class="mod-remaining">${totals.total - totals.read} module(s) remaining</p>`
        : `<p class="mod-remaining" style="color:var(--green)">✅ All modules read!</p>`
      }`;
  },

  // ════════════════════════════════════════════════════════════════════════════
  // BAYESIAN PANEL
  // ════════════════════════════════════════════════════════════════════════════

  bayesianPanel(data) {
    const { predicted_grade, improvement_probability, students_like_you, risk_assessment } = data;

    return `
      <div class="analytics-grid">

        <!-- 1. Predicted Final Grade — Gauge -->
        <div class="analytics-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">🎯 Predicted Final Grade</div>
            <div class="analytics-card-sub">Bayesian estimate based on current performance</div>
          </div>
          ${AnalyticsView._predictedGrade(predicted_grade)}
        </div>

        <!-- 2. Grade Improvement Probability -->
        <div class="analytics-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">📈 Grade Improvement Probability</div>
            <div class="analytics-card-sub">Chance of reaching your target grade</div>
          </div>
          ${AnalyticsView._improvementProb(improvement_probability)}
        </div>

        <!-- 3. Students Like You -->
        <div class="analytics-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">👥 Students Like You</div>
            <div class="analytics-card-sub">Anonymous comparison with similar engagement profiles</div>
          </div>
          ${AnalyticsView._studentsLikeYou(students_like_you)}
        </div>

        <!-- 4. Risk Assessment -->
        <div class="analytics-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">🚦 Academic Risk Assessment</div>
            <div class="analytics-card-sub">Early warning indicators</div>
          </div>
          ${AnalyticsView._riskAssessment(risk_assessment)}
        </div>

      </div>`;
  },

  _predictedGrade(data) {
    if (!data || data.predicted_grade === null) {
      return AnalyticsView.empty('Submit more graded activities to generate a prediction.');
    }

    const grade = data.predicted_grade;
    const color = grade >= 90 ? 'var(--green)' : grade >= 75 ? '#f59e0b' : 'var(--red)';
    const arc = Math.min(grade / 100, 1);

    // SVG gauge
    const R = 60, CX = 80, CY = 80;
    const arcLen = Math.PI * R;
    const dashOffset = arcLen * (1 - arc);

    return `
      <div class="gauge-wrapper">
        <svg width="160" height="100" viewBox="0 0 160 100" class="gauge-svg">
          <!-- Track arc -->
          <path d="M20,80 A${R},${R} 0 0,1 140,80"
            fill="none" stroke="var(--gray-100)" stroke-width="14" stroke-linecap="round"/>
          <!-- Value arc -->
          <path d="M20,80 A${R},${R} 0 0,1 140,80"
            fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"
            stroke-dasharray="${arcLen}"
            stroke-dashoffset="${dashOffset}"
            style="transition:stroke-dashoffset .8s ease"/>
        </svg>
        <div class="gauge-value" style="color:${color}">${grade}%</div>
        <div class="gauge-label">Predicted Grade</div>
      </div>
      <div class="gauge-ci">
        <span class="gauge-ci-label">95% Credible Range</span>
        <span class="gauge-ci-range">${data.range_low}% – ${data.range_high}%</span>
      </div>
      <div class="gauge-meta">Based on ${data.n_observations} graded activities &middot; Current avg ${data.current_avg}%</div>`;
  },

  _improvementProb(data) {
    if (!data || data.probability === null) {
      return AnalyticsView.empty('Not enough graded activities yet.');
    }

    const prob = data.probability;
    const color = prob >= 70 ? 'var(--green)' : prob >= 45 ? '#f59e0b' : 'var(--red)';

    return `
      <div class="improv-target-row">
        <span class="improv-label">Target Grade</span>
        <div class="improv-target-control">
          <button onclick="AnalyticsController.adjustTarget(-5)" class="improv-btn">−</button>
          <span id="improv-target-display" class="improv-target-val">${data.target_grade}%</span>
          <button onclick="AnalyticsController.adjustTarget(+5)" class="improv-btn">+</button>
        </div>
      </div>
      <div class="improv-meter-wrap">
        <div class="improv-meter-bar" style="width:${prob}%;background:${color};transition:width .6s ease"></div>
      </div>
      <div class="improv-prob-val" style="color:${color}">${prob}%</div>
      <div class="improv-prob-label">${data.label} — probability of reaching ${data.target_grade}%</div>
      <div class="gauge-meta">Based on ${data.n_observations} activities · ${data.successes} hit the target so far</div>`;
  },

  _studentsLikeYou(data) {
    if (!data || data.percentile === null) {
      return AnalyticsView.empty('Comparison data will appear once more activity is recorded.');
    }

    const pct = data.percentile;
    const color = pct >= 75 ? 'var(--green)' : pct >= 50 ? '#f59e0b' : 'var(--red)';
    const profile = data.my_profile;

    return `
      <div class="peer-percentile">
        <div class="peer-pct-ring" style="border-color:${color}">
          <span class="peer-pct-val" style="color:${color}">${pct}<sup style="font-size:14px">th</sup></span>
          <span class="peer-pct-sub">percentile</span>
        </div>
      </div>
      <p class="peer-message">${escHtml(data.message)}</p>
      <div class="peer-profile-grid">
        <div class="peer-profile-item">
          <div class="peer-profile-val">${profile.attendance_rate}%</div>
          <div class="peer-profile-key">Attendance</div>
        </div>
        <div class="peer-profile-item">
          <div class="peer-profile-val">${profile.module_completion}%</div>
          <div class="peer-profile-key">Modules Read</div>
        </div>
        <div class="peer-profile-item">
          <div class="peer-profile-val">${profile.avg_score}%</div>
          <div class="peer-profile-key">Avg Score</div>
        </div>
      </div>
      <p class="gauge-meta">Compared with ${data.peer_count} anonymous students with similar engagement</p>`;
  },

  _riskAssessment(data) {
    if (!data || !data.risk_level || data.risk_level === 'Unknown') {
      return AnalyticsView.empty('Risk data will appear once enough performance signals are recorded.');
    }

    const colorMap = { 'Low Risk': 'var(--green)', 'Moderate Risk': '#f59e0b', 'High Risk': 'var(--red)' };
    const bgMap    = { 'Low Risk': 'var(--green-light)', 'Moderate Risk': '#fff8e1', 'High Risk': 'var(--red-light)' };
    const color = colorMap[data.risk_level] || '#888';
    const bg    = bgMap[data.risk_level]    || '#f5f5f5';

    const signals = data.signals;

    return `
      <div class="risk-badge" style="background:${bg};border:2px solid ${color}">
        <span class="risk-emoji">${data.emoji}</span>
        <span class="risk-label" style="color:${color}">${data.risk_level}</span>
      </div>

      <div class="risk-signals">
        ${[
          ['Attendance',         signals.attendance_rate,    80],
          ['Module Completion',  signals.module_completion,  60],
          ['Activity Completion',signals.activity_completion,70],
          ['Average Score',      signals.avg_score,          75],
        ].map(([label, val, threshold]) => {
          const c = val >= threshold ? 'var(--green)' : val >= threshold * 0.75 ? '#f59e0b' : 'var(--red)';
          return `
            <div class="risk-signal-row">
              <span class="risk-signal-label">${label}</span>
              <div class="risk-signal-bar-wrap">
                <div class="risk-signal-bar" style="width:${Math.min(val,100)}%;background:${c}"></div>
              </div>
              <span class="risk-signal-pct" style="color:${c}">${val}%</span>
            </div>`;
        }).join('')}
      </div>

      <div class="risk-factors">
        <div class="risk-factors-title">Contributing Factors</div>
        <ul class="risk-factors-list">
          ${data.factors.map(f => `<li>${escHtml(f)}</li>`).join('')}
        </ul>
      </div>`;
  },

};
