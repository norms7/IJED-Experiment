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

  // ── Shell: analytics and grading details tabs ────────────────────────────

  shell(subjectOptions = [], currentSemester = '1st', currentTerm = null, currentSubject = null) {
    const opts = subjectOptions.map(s =>
      `<option value="${s.subject_id}" ${String(s.subject_id) === String(currentSubject) ? 'selected' : ''}>${escHtml(s.subject_name)}</option>`
    ).join('');

    return `
      <div class="analytics-header">
        <div>
          <h2 class="analytics-title">${analyticsIcon('chart')}Performance Analytics</h2>
          <p class="analytics-sub">See your grades, progress, and attendance.</p>
        </div>
        <div class="analytics-filters">
          <select id="analytics-semester-filter" class="analytics-select" onchange="AnalyticsController.onSemesterChange(this.value)">
            <option value="1st" ${currentSemester === '1st' ? 'selected' : ''}>1st Semester</option>
            <option value="2nd" ${currentSemester === '2nd' ? 'selected' : ''}>2nd Semester</option>
          </select>
          <select id="analytics-term-filter" class="analytics-select" onchange="AnalyticsController.onTermChange(this.value)">
            <option value="" ${!currentTerm ? 'selected' : ''}>All Terms</option>
            <option value="1st" ${currentTerm === '1st' ? 'selected' : ''}>1st Term</option>
            <option value="2nd" ${currentTerm === '2nd' ? 'selected' : ''}>2nd Term</option>
            <option value="3rd" ${currentTerm === '3rd' ? 'selected' : ''}>3rd Term</option>
            <option value="4th" ${currentTerm === '4th' ? 'selected' : ''}>4th Term</option>
          </select>
          <select id="analytics-subject-filter" class="analytics-select" onchange="AnalyticsController.onSubjectChange(this.value)">
            <option value="">All Subjects</option>
            ${opts}
          </select>
        </div>
      </div>

      <div class="analytics-tabs">
        <button class="analytics-tab active" data-tab="performance"
          onclick="AnalyticsController.switchTab('performance', this)">
          ${analyticsIcon('trend', 'analytics-tab-icon')}Performance Analytics
        </button>
        <button class="analytics-tab" data-tab="grading-details"
          onclick="AnalyticsController.switchTab('grading-details', this)">
          ${analyticsIcon('crystal', 'analytics-tab-icon')}Grading Details
        </button>
      </div>

      <div id="analytics-panel-performance" class="analytics-panel">
        ${AnalyticsView.performanceSkeleton()}
      </div>
      <div id="analytics-panel-grading-details" class="analytics-panel hidden">
        ${AnalyticsView.gradingDetailsSkeleton()}
      </div>`;
  },

  // ── Skeletons ─────────────────────────────────────────────────────────────

  performanceSkeleton() {
    return `
      <div class="analytics-grid">
        ${[1,2,3,4].map(() => `
          <div class="analytics-card">
            <div class="skeleton-title"></div>
            <div class="skeleton-chart"></div>
          </div>`).join('')}
      </div>`;
  },

  gradingDetailsSkeleton() {
    return `
      <div class="analytics-grid">
        ${[1,2,3].map(() => `
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
  // PERFORMANCE ANALYTICS PANEL
  // ════════════════════════════════════════════════════════════════════════════

  performancePanel(data, bayesData) {
    const { grade_progress, attendance_calendar, module_progress, subject_radar } = data;
    const { predicted_grade, improvement_probability } = bayesData;

    return `
      <div class="analytics-grid performance-analytics-grid">

        <div class="analytics-card analytics-summary-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('target')}Estimated Final Grade (current standing)</div>
          </div>
          ${AnalyticsView._predictedGrade(predicted_grade)}
        </div>

        <div class="analytics-card analytics-summary-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('trend')}Chance to Hit Target Next Time</div>
          </div>
          ${AnalyticsView._improvementProb(improvement_probability)}
        </div>

        <div class="analytics-card analytics-module-progress-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('file')}Module Reading Progress</div>
            <div class="analytics-card-sub">Modules you've read</div>
          </div>
          ${AnalyticsView._moduleProgress(module_progress)}
        </div>

        <div class="analytics-card analytics-card-wide">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('trend')}My Grade Progress</div>
            <div class="analytics-card-sub">Your scores by activity</div>
          </div>
          ${grade_progress.data.length
            ? `<div class="chart-wrapper"><canvas id="chart-grade-progress"></canvas></div>`
            : AnalyticsView.empty('Submit and get graded on activities to see your progress.')
          }
        </div>

        <div class="analytics-card analytics-attendance-card analytics-card-wide">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('calendar')}My Attendance Calendar</div>
            <div class="analytics-card-sub">Your class days</div>
          </div>
          <div class="att-legend">
            <span class="att-dot att-present"></span>Present
            <span class="att-dot att-absent"></span>Absent
            <span class="att-dot att-excused"></span>Excused
            <span class="att-dot att-no-class"></span>No Class
          </div>
          <div class="att-calendar-layout">
            ${AnalyticsView._attendanceCalendar(attendance_calendar)}
            ${AnalyticsView._attendanceSummary(attendance_calendar.summary)}
          </div>
        </div>

        <div class="analytics-card analytics-card-wide analytics-subject-performance-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('chart')}Subject Performance Overview</div>
            <div class="analytics-card-sub">Average score for each subject</div>
          </div>
          ${subject_radar.axes.length
            ? `<div class="subject-radar-legend">${subject_radar.axes.map((axis, index) => `<span class="subject-radar-legend-item"><i style="background:${['#8B1E3F', '#1B998B', '#2D6CDF', '#F28E2B', '#7B2CBF', '#0081A7', '#C99700', '#D1495B', '#3A5A40', '#6A4C93', '#E76F51', '#264653'][index % 12]}"></i>${escHtml(axis.subject_name)}</span>`).join('')}</div>`
            : `<p class="subject-chart-note">No scores yet. Your chart will fill in as activities are graded.</p>`
          }
          <div class="chart-wrapper chart-wrapper-subject-performance"><canvas id="chart-subject-radar"></canvas></div>
        </div>

      </div>`;
  },

  gradingDetailsPanel(data) {
    const prediction = data.predicted_grade || {};
    const components = prediction.components || {};
    const parts = [
      { key: 'academic', label: 'Academic Score', weight: 75, formula: 'Points earned ÷ points possible × 100' },
      { key: 'attendance', label: 'Attendance Score', weight: 15, formula: '(Present + 0.5 × Late) ÷ Class sessions × 100' },
      { key: 'modules', label: 'Module Score', weight: 10, formula: 'Modules read ÷ Published modules × 100' },
    ];
    const availableWeight = parts.reduce((sum, part) =>
      Number.isFinite(components[part.key]) ? sum + part.weight : sum, 0);
    const weightedParts = parts.map(part => {
      const value = Number.isFinite(components[part.key]) ? components[part.key] : null;
      const effectiveWeight = value === null || !availableWeight ? 0 : part.weight / availableWeight;
      return { ...part, value, effectiveWeight };
    });
    const formula = weightedParts
      .filter(part => part.value !== null)
      .map(part => `${(part.effectiveWeight * 100).toFixed(1)}% × ${part.value.toFixed(1)}`)
      .join(' + ');
    const probability = data.improvement_probability || {};

    return `
      <div class="grading-details">
        <section class="analytics-card grading-overview-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('target')}Your Current Grade</div>
            <div class="analytics-card-sub">An estimate based on your available scores</div>
          </div>
          ${prediction.predicted_grade == null
            ? AnalyticsView.empty('More graded work is needed for an estimate.')
            : `<div class="grading-estimate">
                <strong>${prediction.predicted_grade}%</strong>
                <span>Estimated range: ${prediction.range_low}%–${prediction.range_high}%</span>
                <span>${prediction.n_observations} graded activities</span>
              </div>`
          }
          <div class="grading-weighted-formula">
            <strong>Weighted score</strong>
            <span>${formula ? `${formula} = ${prediction.predicted_grade}%` : 'Scores will appear when data is available.'}</span>
          </div>
          ${availableWeight > 0 && availableWeight < 100
            ? `<p class="grading-note">Missing scores are not counted as zero. Their weights are shared by the scores available.</p>`
            : ''}
        </section>

        <section class="analytics-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('chart')}Building Blocks</div>
            <div class="analytics-card-sub">How each score is calculated</div>
          </div>
          <div class="grading-block-list">
            ${weightedParts.map(part => `
              <div class="grading-block">
                <div class="grading-block-heading">
                  <strong>${part.label}</strong>
                  <span>${part.value === null ? 'No data yet' : `${part.value.toFixed(1)}%`}</span>
                </div>
                <div class="grading-block-track" role="progressbar" aria-label="${part.label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${part.value === null ? 0 : Math.round(part.value)}">
                  <span style="width:${part.value === null ? 0 : Math.max(0, Math.min(100, part.value))}%"></span>
                </div>
                <div class="grading-block-meta">
                  <span>${part.formula}</span>
                  <span>${part.value === null
                    ? `Base weight: ${part.weight}%`
                    : `${(part.effectiveWeight * 100).toFixed(1)}% of grade${part.effectiveWeight !== part.weight / 100 ? ` (base ${part.weight}%)` : ''}`
                  }</span>
                </div>
              </div>`).join('')}
          </div>
        </section>

        <section class="analytics-card grading-bands-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('rating')}Score Guide</div>
            <div class="analytics-card-sub">What each score range means</div>
          </div>
          <div class="grading-bands">
            ${[
              ['90 and above', 'Excellent'],
              ['85–89.99', 'Very Good'],
              ['80–84.99', 'Good'],
              ['75–79.99', 'Fair'],
              ['70–74.99', 'Needs Improvement'],
              ['Below 70', 'At Risk'],
            ].map(([score, rating]) => `<div><span>${score}</span><strong>${rating}</strong></div>`).join('')}
          </div>
        </section>

        <section class="analytics-card">
          <div class="analytics-card-header">
            <div class="analytics-card-title">${analyticsIcon('crystal')}Next Activity Estimate</div>
            <div class="analytics-card-sub">How likely you are to reach your target</div>
          </div>
          ${probability.probability == null
            ? AnalyticsView.empty('More graded activities are needed.')
            : `<div class="grading-probability">
                <strong>${probability.probability}%</strong>
                <span>Chance to score ${probability.target_grade}% or higher</span>
              </div>
              ${AnalyticsView._bayesianFactors(probability)}`
          }
        </section>
      </div>`;
  },

  _bayesianFactors(data) {
    const number = value => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
    const display = (value, digits = 0) => {
      const parsed = number(value);
      return parsed === null ? '—' : parsed.toFixed(digits);
    };
    const ownGradedCount = number(data.graded_activity_count) || 0;
    const ownMissingCount = number(data.missing_count) || 0;
    const peerCount = (number(data.class_successes) || 0) + (number(data.class_failures) || 0);
    const recommendation = ownGradedCount === 0 && ownMissingCount > 0
      ? 'This estimate includes eligible missing activities as failures. Graded evidence is not available yet.'
      : ownGradedCount === 0
        ? 'This estimate uses peer results because you do not have graded scores yet.'
      : data.probability >= 70
        ? 'You are in a good position. Keep up your effort.'
        : data.probability >= 40
          ? 'Keep practicing to improve your chance.'
          : 'Review past work and ask for help where you need it.';
    const confidenceText = data.low_confidence
      ? `Low confidence · ${display(data.graded_activity_count)} graded activities; missing activities do not count toward this threshold`
      : `At least 3 graded activities · ${display(data.graded_activity_count)} graded`;

    return `
      <div class="bayesian-factor-list">
        <p class="grading-note">This estimates your chance of scoring ${display(data.target_grade)}% or higher on your next activity. It is separate from your estimated final grade.</p>
        ${data.prediction_unavailable ? '<p class="grading-note">The descriptive final-grade prediction is unavailable; this Bayesian estimate was calculated independently.</p>' : ''}
        <div class="bayesian-factor-row">
          <strong>Your graded results</strong>
          <span>${display(data.my_successes)} successes · ${display(data.graded_failure_count)} failures · ${display(data.graded_activity_count)} graded</span>
        </div>
        <div class="bayesian-factor-row">
          <strong>Class results</strong>
          <span>${display(data.class_successes)} successes · ${display(data.class_failures)} failures (including missing) · ${peerCount} total</span>
        </div>
        <div class="bayesian-factor-row">
          <strong>Class hit rate</strong>
          <span>${peerCount ? `${display(data.class_rate_at_target)}% reached the target` : 'No peer observations yet'}</span>
        </div>
        <div class="bayesian-factor-row">
          <strong>Possible chance range</strong>
          <span>${display(data.credible_low)}%–${display(data.credible_high)}%</span>
        </div>
        <div class="bayesian-factor-row">
          <strong>Chance you reach the target more often than the class</strong>
          <span>${display(data.above_class_average_probability)}%</span>
        </div>
        <div class="bayesian-factor-row">
          <strong>Missing activities</strong>
          <span>${display(data.missing_count)} · eligible overdue/undated missing activities count once as failures</span>
        </div>
        <div class="bayesian-factor-row">
          <strong>Total Bayesian observations</strong>
          <span>${display(data.evidence_count)} · includes graded results and eligible missing failures</span>
        </div>
        <div class="bayesian-factor-row">
          <strong>How steady is this estimate?</strong>
          <span>${confidenceText}</span>
        </div>
        <p class="bayesian-recommendation"><strong>Next step:</strong> ${escHtml(recommendation)}</p>
        <details class="bayesian-explanation">
          <summary>How do we get this estimate?</summary>
          <p>We start with the Jeffreys-smoothed peer rate, then update the Beta prior with your own successes and failures. A score at or above the target is a success. An eligible past-due or undated published activity with no submission counts as a failure; submitted but ungraded and future unsubmitted activities are excluded.</p>
          <p>The possible range shows uncertainty, not a guarantee. Low confidence means fewer than 3 graded activities; missing activities are reported separately and do not count as graded observations.</p>
        </details>
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
    const visible = months.slice(-4);

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
        <div class="mod-overall-bar-wrap" role="progressbar" aria-label="Overall module progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${totals.pct}">
          <div class="mod-overall-bar" style="width:${totals.pct}%;background:${overallColor}"></div>
        </div>
        <span class="mod-overall-label">${totals.pct}% <span>${totals.read}/${totals.total} read</span></span>
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
                <div class="mod-bar" role="progressbar" aria-label="${escHtml(s.subject_name || `Subject ${s.subject_id}`)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.completion_pct}" style="width:${s.completion_pct}%;background:${c}"></div>
              </div>
              <span class="mod-pct" style="color:${c}">${s.completion_pct}%</span>
              <span class="mod-count">${s.modules_read}/${s.modules_total}</span>
            </div>`;
        }).join('')}
      </div>
      ${totals.total - totals.read > 0
        ? `<p class="mod-remaining">${totals.total - totals.read} left to read</p>`
        : `<p class="mod-remaining" style="color:var(--green)">${ANALYTICS_ICONS.check} All done!</p>`
      }`;
  },

  // ── Grade metric renderers ─────────────────────────────────────────────────

  _predictedGrade(data) {
    if (!data || data.predicted_grade == null) {
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
    const R = 60;
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
        <div class="gauge-label">Current estimate</div>
      </div>
      <div class="gauge-ci">
        <span class="gauge-ci-label">Estimated range</span>
        <span class="gauge-ci-range">${data.range_low}% – ${data.range_high}%</span>
      </div>
      <div class="gauge-meta">${data.n_observations} graded activities</div>`;
  },

  _improvementProb(data) {
    if (!data || data.probability == null) {
      return AnalyticsView.empty('Not enough graded activities yet.');
    }

    const prob = data.probability;
    const color = prob >= 70 ? 'var(--green)' : prob >= 45 ? '#f59e0b' : 'var(--red)';

    return `
      <div class="improv-target-row">
        <span class="improv-label">Target Grade</span>
        <div class="improv-target-control">
          <button aria-label="Lower target by 5" onclick="AnalyticsController.adjustTarget(-5)" class="improv-btn">−</button>
          <span id="improv-target-display" class="improv-target-val">${data.target_grade}%</span>
          <button aria-label="Raise target by 5" onclick="AnalyticsController.adjustTarget(+5)" class="improv-btn">+</button>
        </div>
      </div>
      <div class="improv-meter-wrap">
        <div class="improv-meter-bar" role="progressbar" aria-label="Chance to hit target" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${prob}" style="width:${prob}%;background:${color};transition:width .6s ease"></div>
      </div>
      <div class="improv-prob-val" style="color:${color}">${prob}%</div>
      <div class="improv-prob-label">Chance to score ${data.target_grade}% or higher next time</div>`;
  },

};