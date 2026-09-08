/* ============================================================
   views/analytics.view.js
   Pure render functions for the Performance Analytics tab.
   Follows the same pattern as student.view.js — returns HTML
   strings only; no direct DOM manipulation.

   Charts are rendered via Chart.js (CDN), loaded lazily inside
   AnalyticsController._postRender().
   ============================================================ */

"use strict";

const ANALYTICS_ICONS = {
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18.5h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M7 15V9M12 15V5M17 15v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  trend: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17 9 12l3 3 7-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 7h4v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  crystal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16a8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6.5 18.5h11M12 16l3.8-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 13.5 7.5 14M17.5 14l1-0.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4V5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 15h4l1.5 2h5L16 15h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 4 9 16H3L12 4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9v5M12 17h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 3v4M16 3v4M3 10h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l5 5v11A2.5 2.5 0 0 1 16.5 22h-9A2.5 2.5 0 0 1 5 19.5v-13A2.5 2.5 0 0 1 7.5 4H7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 3.5V9h5M8.5 13h6M8.5 16.5h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  radar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 7.5 5.5-2.8 9-9.4 0-2.8-9L12 3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m12 3v14.5M4.5 8.5l7.5 3 7.5-3M7.3 17.5 12 11.5l4.7 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
  users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M9 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM16 11a3 3 0 0 0 0-6M17 14.5h1a4 4 0 0 1 4 4V20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  rating: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5V4ZM8 8h8M8 12h8M8 16h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 9.5 17 19 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

const analyticsIcon = (name, className = 'analytics-icon') => `<span class="${className}">${ANALYTICS_ICONS[name]}</span>`;

const AnalyticsView = {

  // ── Shell: the two-sub-tab wrapper ───────────────────────────────────────

  shell(subjectOptions = []) {
    const opts = subjectOptions.map(s =>
      `<option value="${s.subject_id}">${escHtml(s.subject_name)}</option>`
    ).join('');

    return `
      <div class="analytics-header">
        <div>
          <h2 class="analytics-title">${analyticsIcon('chart')}Performance Analytics</h2>
          <p class="analytics-sub">Understand your academic journey with data-driven insights.</p>
        </div>
        <div class="analytics-filters">
          <select id="analytics-term-filter" class="analytics-select" onchange="AnalyticsController.onTermChange(this.value)">
            <option value="">All Terms</option>
            <option value="1st">1st Term</option>
            <option value="2nd">2nd Term</option>
            <option value="3rd">3rd Term</option>
            <option value="4th">4th Term</option>
          </select>
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
          ${analyticsIcon('trend', 'analytics-tab-icon')}Descriptive Analysis
        </button>
        <button class="analytics-tab" data-tab="bayesian"
          onclick="AnalyticsController.switchTab('bayesian', this)">
          ${analyticsIcon('crystal', 'analytics-tab-icon')}Bayesian Analysis
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
        <div class="analytics-empty-icon">${ANALYTICS_ICONS.inbox}</div>
        <div class="analytics-empty-title">Nothing to show yet</div>
        <div class="analytics-empty-sub">${escHtml(message)}</div>
      </div>`;
  },

  // ── Error state ───────────────────────────────────────────────────────────

  error(msg = 'Could not load analytics. Please try again.') {
    return `
      <div class="analytics-empty">
        <div class="analytics-empty-icon">${ANALYTICS_ICONS.warning}</div>
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
            <div class="analytics-card-title">${analyticsIcon('trend')}My Grade Progress</div>
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
            <div class="analytics-card-title">${analyticsIcon('calendar')}My Attendance Calendar</div>
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
            <div class="analytics-card-title">${analyticsIcon('chart')}Activity Score vs Class Average</div>
            <div class="analytics-card-sub">How you compare to your peers</div>
          </div>
          ${score_vs_avg.data.length
            ? `<div class="chart-wrapper"><canvas id="chart-score-vs-avg"></canvas></div>`
            : AnalyticsView.empty('Class average data will appear once activities are graded.')
          }
        </div>

        <!-- 4. Module Reading Progress — Progress Bars -->
        <div class="analytics-card analytics-module-progress-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('file')}Module Reading Progress</div>
            <div class="analytics-card-sub">Learning engagement with course materials</div>
          </div>
          ${AnalyticsView._moduleProgress(module_progress)}
        </div>

        <!-- 5. Subject Performance — Colored Comparison Chart -->
        <div class="analytics-card analytics-card-wide analytics-subject-performance-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('chart')}Subject Performance Overview</div>
            <div class="analytics-card-sub">Average performance by subject</div>
          </div>
          ${subject_radar.axes.length >= 3
            ? `<div class="subject-radar-legend">${subject_radar.axes.map((axis, index) => `<span class="subject-radar-legend-item"><i style="background:${['#8B1E3F', '#1B998B', '#2D6CDF', '#F28E2B', '#7B2CBF', '#0081A7', '#C99700', '#D1495B', '#3A5A40', '#6A4C93', '#E76F51', '#264653'][index % 12]}"></i>${escHtml(axis.subject_name)}</span>`).join('')}</div><div class="chart-wrapper chart-wrapper-subject-performance"><canvas id="chart-subject-radar"></canvas></div>`
            : AnalyticsView.empty('Enroll in at least 3 subjects to see the subject comparison.')
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
              <div class="mod-subject-name" title="${escHtml(s.subject_name || `Subject ${s.subject_id}`)}">
                ${escHtml(s.subject_name || `Subject ${s.subject_id}`)}
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
        : `<p class="mod-remaining" style="color:var(--green)">${ANALYTICS_ICONS.check} All modules read!</p>`
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
            <div class="analytics-card-title">${analyticsIcon('target')}Predicted Final Grade</div>
            <div class="analytics-card-sub">Academic 75% · Attendance 15% · Module Progress 10%</div>
          </div>
          ${AnalyticsView._predictedGrade(predicted_grade)}
        </div>

        <!-- 2. Grade Improvement Probability -->
        <div class="analytics-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('trend')}Grade Improvement Probability</div>
            <div class="analytics-card-sub">Chance of reaching your target grade</div>
          </div>
          ${AnalyticsView._improvementProb(improvement_probability)}
        </div>

        <!-- 3. Students Like You -->
        <div class="analytics-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('users')}Students Like You</div>
            <div class="analytics-card-sub">Anonymous comparison with similar engagement profiles</div>
          </div>
          ${AnalyticsView._studentsLikeYou(students_like_you)}
        </div>

        <!-- 4. Overall Performance Rating -->
        <div class="analytics-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('rating')}Overall Performance Rating</div>
            <div class="analytics-card-sub">Academic 75% · Attendance 15% · Module Progress 10%</div>
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
    const color = grade >= 90 ? 'var(--green)'
      : grade >= 85 ? 'var(--green-mid)'
      : grade >= 80 ? 'var(--blue)'
      : grade >= 75 ? 'var(--yellow)'
      : grade >= 70 ? 'var(--orange)'
      : 'var(--red)';
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
        <span class="gauge-ci-label">Estimated Range</span>
        <span class="gauge-ci-range">${data.range_low}% – ${data.range_high}%</span>
      </div>
      <div class="gauge-meta">Based on ${data.n_observations} graded activities &middot; Current academic avg ${data.current_avg ?? '—'}%</div>
      ${data.supporting_factors && data.supporting_factors.length
        ? `<ul class="risk-factors-list" style="margin-top:8px">${data.supporting_factors.map(f => `<li>${escHtml(f)}</li>`).join('')}</ul>`
        : ''}`;
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
      ${data.credible_low !== undefined
        ? `<div class="gauge-meta">90% credible interval: ${data.credible_low}%–${data.credible_high}% · based on ${data.evidence_count} of your own graded activit${data.evidence_count === 1 ? 'y' : 'ies'} at this target (class rate: ${data.class_rate_at_target}%)</div>`
        : ''}
      <div class="gauge-meta">Predicted grade ${data.predicted_grade}% · Gap to target: ${Math.max(0, Math.round((data.target_grade - data.predicted_grade) * 10) / 10)}%</div>
      ${data.above_class_average_probability !== undefined
        ? `<div class="gauge-meta">${data.above_class_average_probability}% probability your true rate at this target beats the class average</div>`
        : ''}
      ${data.recommendation ? `<p class="gauge-meta" style="margin-top:6px"><strong>Recommendation:</strong> ${escHtml(data.recommendation)}</p>` : ''}`;
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
          <div class="peer-profile-val">${data.engagement_score}%</div>
          <div class="peer-profile-key">Engagement Score</div>
        </div>
        <div class="peer-profile-item">
          <div class="peer-profile-val">${profile.attendance_rate !== null ? profile.attendance_rate + '%' : 'No data yet'}</div>
          <div class="peer-profile-key">Attendance</div>
        </div>
        <div class="peer-profile-item">
          <div class="peer-profile-val">${profile.module_completion !== null ? profile.module_completion + '%' : 'No data yet'}</div>
          <div class="peer-profile-key">Modules Read</div>
        </div>
      </div>
      <p class="gauge-meta">Engagement Score = Attendance×40% + Modules×60% (academic score not included) · Compared with ${data.peer_count} anonymous students with similar engagement</p>`;
  },

  _riskAssessment(data) {
    if (!data || data.performance_score === null || data.performance_score === undefined) {
      return AnalyticsView.empty('Performance data will appear once enough activity, attendance, and module signals are recorded.');
    }

    // Colors follow the Objective §5 rating bands exactly:
    //   90-100 Excellent (Green) · 85-89 Very Good (Light Green) ·
    //   80-84 Good (Blue) · 75-79 Fair (Yellow) ·
    //   70-74 Needs Improvement (Orange) · <70 At Risk (Red)
    const colorMap = {
      excellent:          'var(--green)',
      very_good:          'var(--green-mid)',
      good:               'var(--blue)',
      fair:               'var(--yellow)',
      needs_improvement:  'var(--orange)',
      at_risk:            'var(--red)',
    };
    const bgMap = {
      excellent:          'var(--green-light)',
      very_good:          'var(--green-mid-light)',
      good:               'var(--blue-light)',
      fair:               'var(--yellow-light)',
      needs_improvement:  'var(--orange-light)',
      at_risk:            'var(--red-light)',
    };
    const color = colorMap[data.color] || '#888';
    const bg    = bgMap[data.color]    || '#f5f5f5';
    const bd = data.breakdown;

    // Weighted formula, spelled out plainly for teachers/panelists:
    //   Performance Score = Academic×75% + Attendance×15% + Modules×10%
    //
    // All three rows are always shown, even when a component has no data
    // yet (e.g. no attendance sessions recorded so far) — hiding a row
    // silently would make it look like that factor doesn't count at all,
    // when really its weight was fairly redistributed across the known
    // components (Objective §5's "don't red-flag on missing data" rule).
    // The formula line at the bottom only sums components that actually
    // had data, so the displayed math still matches performance_score exactly.
    const allRows = [
      ['Academic Performance', bd.academic],
      ['Attendance',           bd.attendance],
      ['Module Progress',      bd.modules],
    ];
    const formulaRows = allRows.filter(([, part]) => part.value !== null);

    return `
      <div class="risk-badge" style="background:${bg};border:2px solid ${color}">
        <span class="risk-emoji">${data.emoji}</span>
        <span class="risk-label" style="color:${color}">${data.performance_score} — ${data.rating}</span>
      </div>

      <div class="risk-signals">
        ${allRows.map(([label, part]) => {
          const val = part.value;
          if (val === null) {
            return `
              <div class="risk-signal-row">
                <span class="risk-signal-label">${label} (${Math.round(part.weight * 100)}% weight)</span>
                <div class="risk-signal-bar-wrap">
                  <div class="risk-signal-bar" style="width:100%;background:var(--gray-100)"></div>
                </div>
                <span class="risk-signal-pct" style="color:var(--gray-400)">No data yet</span>
              </div>`;
          }
          const c = val >= 80 ? 'var(--green)' : val >= 70 ? 'var(--yellow)' : 'var(--red)';
          return `
            <div class="risk-signal-row">
              <span class="risk-signal-label">${label} (${Math.round(part.weight * 100)}% weight)</span>
              <div class="risk-signal-bar-wrap">
                <div class="risk-signal-bar" style="width:${Math.min(val,100)}%;background:${c}"></div>
              </div>
              <span class="risk-signal-pct" style="color:${c}">${val}%</span>
            </div>`;
        }).join('')}
      </div>

      ${formulaRows.length < allRows.length
        ? `<p class="gauge-meta" style="font-style:italic">Weight for components with no data yet is redistributed proportionally across the rest, so this student isn't penalized for something not yet measurable.</p>`
        : ''}

      <p class="gauge-meta">Score = ${formulaRows.map(([l, p]) => `${l.split(' ')[0]}×${Math.round(p.weight*100)}%`).join(' + ')} = <strong>${data.performance_score}</strong> (${data.rating})</p>

      <div class="risk-factors">
        <div class="risk-factors-title">Contributing Factors</div>
        <ul class="risk-factors-list">
          ${data.factors.map(f => `<li>${escHtml(f)}</li>`).join('')}
        </ul>
      </div>`;
  },

};
