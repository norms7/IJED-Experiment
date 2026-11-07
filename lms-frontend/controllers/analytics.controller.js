/* ============================================================
   controllers/analytics.controller.js
   Handles the Performance Analysis tab.

   Responsibilities:
     • Load subject list for the filter dropdown
     • Fetch and cache descriptive + Bayesian data
     • Render chart canvases via Chart.js
     • Handle tab switching (Performance Analysis / Grading Details)
     • Handle subject filter changes
     • Manage target-grade slider for improvement probability

   Dependencies:
     • AnalyticsView (views/analytics.view.js)
     • api            (assets/js/lms-admin-api.js, with analytics additions)
     • Chart.js       (loaded lazily from CDN — see _ensureChartJs)
   ============================================================ */

"use strict";

const AnalyticsController = {

  // ── State ─────────────────────────────────────────────────────────────────

  _currentTab:     'performance',  // 'performance' | 'grading-details'
  _currentSemester: null,           // '1st' | '2nd' — resolved on first load, defaults to 1st
  _currentSubject: null,            // null = All subjects
  _currentTerm:    null,            // null = All terms; else '1st'/'2nd'/'3rd'/'4th'
  _filterRevision: 0,
  _targetGrade:    85,              // For improvement probability
  _descData:       null,
  _bayesData:      null,
  _subjects:       [],
  _charts:         {},              // { chartId: Chart instance }

  // ── Entry point ───────────────────────────────────────────────────────────

  /**
   * Called by DashboardController._postRender when sectionId === 'analytics'.
   * Renders the shell, loads subjects, then loads the active tab data.
   */
  async load() {
    const area = document.getElementById('content-area');

    this._currentTab = 'performance';
    this._filterRevision++;

    // Reset state on each entry
    this._destroyAllCharts();
    this._descData  = null;
    this._bayesData = null;

    try {
      // Resolve the default semester once per session — reuses the same
      // "prefer 1st" logic as My Subjects, so behavior stays consistent
      // across the app. Preserved across re-entries into this section so
      // a user's manual selection isn't reset every time they navigate away
      // and back, but always starts at 1st Semester on first load.
      if (this._currentSemester === null) {
        this._currentSemester = await api.getStudentCurrentSemester();
      }

      api.clearCache("student:mysubjects:");
      // Fetch subjects for the filter dropdown — scoped to the current
      // semester only, so 1st and 2nd semester subjects are never mixed
      // together in the same dropdown/analytics run.
      this._subjects = await api.getStudentSubjects(this._currentSemester);
      if (this._currentSubject && !this._subjects.some(subject =>
        String(subject.subject_id) === String(this._currentSubject)
      )) {
        this._currentSubject = null;
      }
    } catch (_) {
      this._subjects = [];
    }

    // Render shell (tabs + filter)
    area.innerHTML = AnalyticsView.shell(
      this._subjects,
      this._currentSemester,
      this._currentTerm,
      this._currentSubject,
    );

    await this._loadPerformance();
  },

  // ── Public: tab switching ─────────────────────────────────────────────────

  async switchTab(tab, btnEl) {
    if (tab === this._currentTab) return;
    this._currentTab = tab;

    // Update tab button styles
    document.querySelectorAll('.analytics-tab').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');

    // Show / hide panels
    document.getElementById('analytics-panel-performance')
      .classList.toggle('hidden', tab !== 'performance');
    document.getElementById('analytics-panel-grading-details')
      .classList.toggle('hidden', tab !== 'grading-details');

    if (tab === 'performance') await this._loadPerformance();
    if (tab === 'grading-details') await this._loadGradingDetails();
  },

  // ── Public: semester filter ───────────────────────────────────────────────

  async onSemesterChange(val) {
    this._filterRevision++;
    const requestRevision = this._filterRevision;
    this._currentSemester = val || '1st';
    // Previous subject selection may not belong to the new semester at all
    // — reset to "All Subjects" for that semester rather than carrying over
    // a stale subject_id that no longer matches anything in the dropdown.
    this._currentSubject = null;

    try {
      this._subjects = await api.getStudentSubjects(this._currentSemester);
    } catch (_) {
      this._subjects = [];
    }
    if (requestRevision !== this._filterRevision) return;

    // Refresh just the subject dropdown's options in place — a full shell
    // re-render would also reset the term filter and active tab, which
    // switching semesters shouldn't do.
    const subjectSelect = document.getElementById('analytics-subject-filter');
    if (subjectSelect) {
      const opts = this._subjects.map(s =>
        `<option value="${s.subject_id}">${escHtml(s.subject_name)}</option>`
      ).join('');
      subjectSelect.innerHTML = `<option value="">All Subjects</option>${opts}`;
    }

    this._descData  = null;
    this._bayesData = null;
    this._destroyAllCharts();

    if (this._currentTab === 'performance') await this._loadPerformance();
    else                                     await this._loadGradingDetails();
  },

  // ── Public: subject filter ────────────────────────────────────────────────

  async onSubjectChange(val) {
    this._filterRevision++;
    this._currentSubject = val ? parseInt(val, 10) : null;
    // Invalidate cached data for both tabs so they refetch
    this._descData  = null;
    this._bayesData = null;
    this._destroyAllCharts();

    if (this._currentTab === 'performance') await this._loadPerformance();
    else                                     await this._loadGradingDetails();
  },

  // ── Public: term filter ───────────────────────────────────────────────────

  async onTermChange(val) {
    this._filterRevision++;
    this._currentTerm = val || null;
    this._descData  = null;
    this._bayesData = null;
    this._destroyAllCharts();

    if (this._currentTab === 'performance') await this._loadPerformance();
    else                                     await this._loadGradingDetails();
  },

  // ── Public: target grade control ─────────────────────────────────────────

  adjustTarget(delta) {
    this._targetGrade = Math.max(0, Math.min(100, this._targetGrade + delta));
    this._bayesData = null;  // force refetch with new target
    if (this._currentTab === 'performance') this._loadPerformance();
    else this._loadGradingDetails();
  },

  // ── Public: reload on error ───────────────────────────────────────────────

  async reload() {
    this._descData  = null;
    this._bayesData = null;
    await this.load();
  },

  // ── Private: load combined performance analysis ──────────────────────────

  async _loadPerformance() {
    const panel = document.getElementById('analytics-panel-performance');
    if (!panel) return;
    const requestRevision = this._filterRevision;
    const requestTarget = this._targetGrade;

    if (this._descData && this._bayesData
      && this._bayesData.improvement_probability?.target_grade === this._targetGrade) {
      panel.innerHTML = AnalyticsView.performancePanel(this._descData, this._bayesData);
      await this._renderDescriptiveCharts(this._descData, requestRevision);
      return;
    }

    panel.innerHTML = AnalyticsView.performanceSkeleton();

    try {
      const [descriptiveData, gradingData] = await Promise.all([
        this._descData
          ? Promise.resolve(this._descData)
          : api.getDescriptiveAnalytics(this._currentSubject, this._currentTerm, this._currentSemester),
        this._bayesData?.improvement_probability?.target_grade === this._targetGrade
          ? Promise.resolve(this._bayesData)
          : api.getBayesianAnalytics(this._targetGrade, this._currentSubject, this._currentTerm, this._currentSemester),
      ]);
      if (!panel.isConnected || requestRevision !== this._filterRevision || requestTarget !== this._targetGrade) return;
      this._descData = descriptiveData;
      this._bayesData = gradingData;
      panel.innerHTML = AnalyticsView.performancePanel(descriptiveData, gradingData);
      await this._renderDescriptiveCharts(descriptiveData, requestRevision);
    } catch (err) {
      if (!panel.isConnected || requestRevision !== this._filterRevision || requestTarget !== this._targetGrade) return;
      panel.innerHTML = AnalyticsView.error(err.message);
    }
  },

  // ── Private: load grading details ─────────────────────────────────────────

  async _loadGradingDetails() {
    const panel = document.getElementById('analytics-panel-grading-details');
    if (!panel) return;
    const requestRevision = this._filterRevision;
    const requestTarget = this._targetGrade;

    if (this._bayesData
      && this._bayesData.improvement_probability?.target_grade === this._targetGrade) {
      panel.innerHTML = AnalyticsView.gradingDetailsPanel(this._bayesData);
      return;
    }

    panel.innerHTML = AnalyticsView.gradingDetailsSkeleton();

    try {
      const data = await api.getBayesianAnalytics(this._targetGrade, this._currentSubject, this._currentTerm, this._currentSemester);
      if (!panel.isConnected || requestRevision !== this._filterRevision || requestTarget !== this._targetGrade) return;
      this._bayesData = data;
      panel.innerHTML = AnalyticsView.gradingDetailsPanel(data);
    } catch (err) {
      if (!panel.isConnected || requestRevision !== this._filterRevision || requestTarget !== this._targetGrade) return;
      panel.innerHTML = AnalyticsView.error(err.message);
    }
  },

  // ── Chart.js lazy loader ──────────────────────────────────────────────────

  async _ensureChartJs() {
    if (window.Chart) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  },

  _destroyAllCharts() {
    Object.values(this._charts).forEach(c => { try { c.destroy(); } catch (_) {} });
    this._charts = {};
  },

  _destroyChart(id) {
    if (this._charts[id]) { try { this._charts[id].destroy(); } catch (_) {} delete this._charts[id]; }
  },

  // ── Private: render all descriptive charts ───────────────────────────────

  async _renderDescriptiveCharts(data, requestRevision = this._filterRevision) {
    try {
      await this._ensureChartJs();
    } catch (_) {
      console.warn('Analytics: Chart.js failed to load.');
      return;
    }
    if (requestRevision !== this._filterRevision) return;

    const { grade_progress, score_vs_avg, subject_radar } = data;

    // ── 1. Grade Progress — Line Chart ────────────────────────────────────
    const gpCanvas = document.getElementById('chart-grade-progress');
    if (gpCanvas && grade_progress.data.length) {
      this._destroyChart('grade-progress');
      const classAverages = new Map((score_vs_avg?.data || []).map(item => [String(item.activity_id), item]));
      const labels = grade_progress.data.map(d =>
        d.activity_name.length > 18 ? `${d.activity_name.slice(0, 16)}…` : d.activity_name
      );
      const pcts   = grade_progress.data.map(d => d.pct);
      const averagePcts = grade_progress.data.map(item => {
        const averageValue = classAverages.get(String(item.activity_id))?.class_avg_pct;
        if (averageValue == null) return null;
        const average = Number(averageValue);
        return Number.isFinite(average) ? average : null;
      });
      const isDarkMode = document.body.classList.contains('dark-mode');

      this._charts['grade-progress'] = new Chart(gpCanvas, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'My Score (%)',
              data: pcts,
              borderColor: '#6d0019',
              backgroundColor: 'rgba(109,0,25,0.10)',
              fill: true,
              tension: 0.35,
              pointBackgroundColor: '#6d0019',
              pointRadius: 5,
              pointHoverRadius: 7,
            },
            {
              label: 'Class Average (%)',
              data: averagePcts,
              borderColor: '#d4a017',
              backgroundColor: 'rgba(212,160,23,0.12)',
              fill: false,
              tension: 0.35,
              spanGaps: false,
              pointBackgroundColor: '#d4a017',
              pointRadius: 4,
              pointHoverRadius: 6,
            },
            {
              label: 'Passing (75%)',
              data: Array(pcts.length).fill(75),
              borderColor: '#f59e0b',
              borderDash: [6, 4],
              borderWidth: 1.5,
              pointRadius: 0,
              fill: false,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { color: isDarkMode ? '#ead6db' : '#6b5558', font: { family: 'Nunito', size: 12 } } },
            tooltip: {
              callbacks: {
                afterBody(ctx) {
                  const idx  = ctx[0]?.dataIndex;
                  const item = grade_progress.data[idx];
                  if (!item) return [];
                  return [
                    `Activity: ${item.activity_name}`,
                    `Type: ${item.activity_type}`,
                    `Score: ${item.score}/${item.max_score}`,
                  ];
                },
              },
            },
          },
          scales: {
            y: {
              min: 0, max: 105,
              ticks: { color: isDarkMode ? '#ead6db' : '#6b5558', callback: v => v + '%', font: { family: 'Nunito' } },
              grid: { color: isDarkMode ? 'rgba(234,214,219,0.22)' : 'rgba(0,0,0,0.10)' },
            },
            x: {
              ticks: { color: isDarkMode ? '#ead6db' : '#6b5558', font: { family: 'Nunito', size: 11 }, maxRotation: 45 },
              grid: { display: false },
            },
          },
        },
      });
    }

    // ── Subject performance chart ────────────────────────────────────────
    const radarCanvas = document.getElementById('chart-subject-radar');
    if (radarCanvas) {
      this._destroyChart('subject-radar');
      const axes = subject_radar.axes;
      const hasSubjectScores = axes.length > 0;
      const subjectColors = ['#8B1E3F', '#1B998B', '#2D6CDF', '#F28E2B', '#7B2CBF', '#0081A7', '#C99700', '#D1495B', '#3A5A40', '#6A4C93', '#E76F51', '#264653'];
      const isDarkMode = document.body.classList.contains('dark-mode');
      this._charts['subject-radar'] = new Chart(radarCanvas, {
        type: 'polarArea',
        data: {
          labels: hasSubjectScores ? axes.map(a => a.subject_name) : ['No scores yet'],
          datasets: [{
            label: 'Average Performance (%)',
            data: hasSubjectScores ? axes.map(a => a.avg_pct) : [0],
            backgroundColor: hasSubjectScores
              ? axes.map((_, index) => `${subjectColors[index % subjectColors.length]}${isDarkMode ? 'dd' : 'cc'}`)
              : ['transparent'],
            borderColor: '#fff',
            borderWidth: 2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { enabled: hasSubjectScores },
          },
          scales: {
            r: {
              min: 0, max: 100,
              ticks: { stepSize: 25, color: '#9b7f8a', font: { family: 'Nunito', size: 11 }, backdropColor: 'transparent' },
              grid: { color: 'rgba(155,127,138,0.5)', lineWidth: 1 },
              angleLines: { color: 'rgba(155,127,138,0.5)', lineWidth: 1 },
            },
          },
        },
      });
    }
  },
};
