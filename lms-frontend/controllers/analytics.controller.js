/* ============================================================
   controllers/analytics.controller.js
   Handles the Performance Analytics tab.

   Responsibilities:
     • Load subject list for the filter dropdown
     • Fetch and cache descriptive + Bayesian data
     • Render chart canvases via Chart.js
     • Handle sub-tab switching (Descriptive / Bayesian)
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

  _currentTab:     'descriptive',   // 'descriptive' | 'bayesian'
  _currentSubject: null,            // null = All subjects
  _targetGrade:    90,              // For improvement probability
  _descData:       null,
  _bayesData:      null,
  _subjects:       [],
  _charts:         {},              // { chartId: Chart instance }

  // ── Entry point ───────────────────────────────────────────────────────────

  /**
   * Called by DashboardController._postRender when sectionId === 'analytics'.
   * Renders the shell, loads subjects, then loads the active sub-tab data.
   */
  async load() {
    const area = document.getElementById('content-area');

    // BUG FIX (2025-06): shell() always renders with the Descriptive tab
    // marked active and the Bayesian panel hidden, regardless of whatever
    // _currentTab happened to be set to from a previous visit. If the user
    // had switched to Bayesian, then navigated away and back, _currentTab
    // stayed 'bayesian' in memory while the screen visually reset to
    // Descriptive — a state/DOM mismatch. The next click on "Bayesian" then
    // hit the early-return guard in switchTab() ("if tab === _currentTab,
    // do nothing") and silently no-op'd, making the tab look broken.
    //
    // Fix: explicitly reset _currentTab to 'descriptive' here, matching
    // exactly what shell() always renders. This keeps state and DOM in sync
    // on every fresh entry into the Analytics section.
    this._currentTab = 'descriptive';

    // Reset state on each entry
    this._destroyAllCharts();
    this._descData  = null;
    this._bayesData = null;

    try {
      // Fetch subjects for the filter dropdown
      this._subjects = await api.getStudentSubjects();
    } catch (_) {
      this._subjects = [];
    }

    // Render shell (tabs + filter)
    area.innerHTML = AnalyticsView.shell(this._subjects);

    // Load the default tab
    await this._loadDescriptive();

    // PERF FIX (2025-06): prefetch the Bayesian bundle in the background
    // once Descriptive has finished. The user is looking at Descriptive
    // data already, so this costs nothing perceived — but by the time they
    // click the Bayesian tab, _bayesData is already populated and
    // switchTab() renders instantly instead of showing a loading skeleton.
    // Caught and ignored on failure: if this silently fails, the user just
    // sees the normal loading skeleton when they actually click the tab,
    // same as before this fix existed.
    this._prefetchBayesian();
  },

  /**
   * Background prefetch — never shown to the user, never throws into the
   * caller. If it fails, _bayesData stays null and _loadBayesian() will
   * just fetch normally (with its own loading skeleton) when the tab is
   * actually clicked.
   */
  async _prefetchBayesian() {
    if (this._bayesData) return; // already have it somehow
    try {
      this._bayesData = await api.getBayesianAnalytics(this._targetGrade, this._currentSubject);
    } catch (_) {
      this._bayesData = null; // let the normal click-triggered load retry
    }
  },

  // ── Public: tab switching ─────────────────────────────────────────────────

  async switchTab(tab, btnEl) {
    if (tab === this._currentTab) return;
    this._currentTab = tab;

    // Update tab button styles
    document.querySelectorAll('.analytics-tab').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');

    // Show / hide panels
    document.getElementById('analytics-panel-descriptive')
      .classList.toggle('hidden', tab !== 'descriptive');
    document.getElementById('analytics-panel-bayesian')
      .classList.toggle('hidden', tab !== 'bayesian');

    if (tab === 'descriptive') await this._loadDescriptive();
    if (tab === 'bayesian')    await this._loadBayesian();
  },

  // ── Public: subject filter ────────────────────────────────────────────────

  async onSubjectChange(val) {
    this._currentSubject = val ? parseInt(val, 10) : null;
    // Invalidate cached data for both tabs so they refetch
    this._descData  = null;
    this._bayesData = null;
    this._destroyAllCharts();

    if (this._currentTab === 'descriptive') await this._loadDescriptive();
    else                                     await this._loadBayesian();
  },

  // ── Public: target grade control ─────────────────────────────────────────

  adjustTarget(delta) {
    this._targetGrade = Math.max(0, Math.min(100, this._targetGrade + delta));
    this._bayesData = null;  // force refetch with new target
    this._loadBayesian();
  },

  // ── Public: reload on error ───────────────────────────────────────────────

  async reload() {
    this._descData  = null;
    this._bayesData = null;
    await this.load();
  },

  // ── Private: load descriptive ─────────────────────────────────────────────

  async _loadDescriptive() {
    const panel = document.getElementById('analytics-panel-descriptive');
    if (!panel) return;

    if (this._descData) {
      // Re-render from cache (e.g. returning to tab)
      panel.innerHTML = AnalyticsView.descriptivePanel(this._descData);
      await this._renderDescriptiveCharts(this._descData);
      return;
    }

    panel.innerHTML = AnalyticsView.descriptiveSkeleton();

    try {
      this._descData = await api.getDescriptiveAnalytics(this._currentSubject);
      if (!panel.isConnected) return;  // user navigated away
      panel.innerHTML = AnalyticsView.descriptivePanel(this._descData);
      await this._renderDescriptiveCharts(this._descData);
    } catch (err) {
      if (!panel.isConnected) return;
      panel.innerHTML = AnalyticsView.error(err.message);
    }
  },

  // ── Private: load Bayesian ────────────────────────────────────────────────

  async _loadBayesian() {
    const panel = document.getElementById('analytics-panel-bayesian');
    if (!panel) return;

    if (this._bayesData) {
      panel.innerHTML = AnalyticsView.bayesianPanel(this._bayesData);
      return;
    }

    panel.innerHTML = AnalyticsView.bayesianSkeleton();

    try {
      this._bayesData = await api.getBayesianAnalytics(this._targetGrade, this._currentSubject);
      if (!panel.isConnected) return;
      panel.innerHTML = AnalyticsView.bayesianPanel(this._bayesData);
    } catch (err) {
      if (!panel.isConnected) return;
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

  async _renderDescriptiveCharts(data) {
    try {
      await this._ensureChartJs();
    } catch (_) {
      console.warn('Analytics: Chart.js failed to load.');
      return;
    }

    const { grade_progress, score_vs_avg, subject_radar } = data;

    // ── 1. Grade Progress — Line Chart ────────────────────────────────────
    const gpCanvas = document.getElementById('chart-grade-progress');
    if (gpCanvas && grade_progress.data.length) {
      this._destroyChart('grade-progress');
      const labels = grade_progress.data.map(d => d.date);
      const pcts   = grade_progress.data.map(d => d.pct);

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
            legend: { position: 'top', labels: { font: { family: 'Nunito', size: 12 } } },
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
              ticks: { callback: v => v + '%', font: { family: 'Nunito' } },
              grid: { color: 'rgba(0,0,0,0.06)' },
            },
            x: {
              ticks: { font: { family: 'Nunito', size: 11 }, maxRotation: 45 },
              grid: { display: false },
            },
          },
        },
      });
    }

    // ── 3. Score vs Class Average — Bar Chart ────────────────────────────
    const svaCanvas = document.getElementById('chart-score-vs-avg');
    if (svaCanvas && score_vs_avg.data.length) {
      this._destroyChart('score-vs-avg');
      const items  = score_vs_avg.data.slice(0, 20);  // cap at 20 for readability
      const labels = items.map(d => d.activity_name.length > 16 ? d.activity_name.slice(0,14)+'…' : d.activity_name);

      this._charts['score-vs-avg'] = new Chart(svaCanvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'My Score (%)',
              data: items.map(d => d.my_score_pct ?? 0),
              backgroundColor: 'rgba(109,0,25,0.8)',
              borderRadius: 5,
            },
            {
              label: 'Class Average (%)',
              data: items.map(d => d.class_avg_pct),
              backgroundColor: 'rgba(212,160,23,0.75)',
              borderRadius: 5,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index' },
          plugins: {
            legend: { position: 'top', labels: { font: { family: 'Nunito', size: 12 } } },
            tooltip: {
              callbacks: {
                afterBody(ctx) {
                  const idx  = ctx[0]?.dataIndex;
                  const item = items[idx];
                  if (!item || item.diff_pct === null) return [];
                  const sign = item.diff_pct >= 0 ? '+' : '';
                  return [`Difference: ${sign}${item.diff_pct}%`];
                },
              },
            },
          },
          scales: {
            y: {
              min: 0, max: 110,
              ticks: { callback: v => v + '%', font: { family: 'Nunito' } },
              grid: { color: 'rgba(0,0,0,0.06)' },
            },
            x: {
              ticks: { font: { family: 'Nunito', size: 10 }, maxRotation: 40 },
              grid: { display: false },
            },
          },
        },
      });
    }

    // ── 5. Subject Radar ──────────────────────────────────────────────────
    const radarCanvas = document.getElementById('chart-subject-radar');
    if (radarCanvas && subject_radar.axes.length >= 3) {
      this._destroyChart('subject-radar');
      const axes = subject_radar.axes;

      this._charts['subject-radar'] = new Chart(radarCanvas, {
        type: 'radar',
        data: {
          labels: axes.map(a => a.subject_name),
          datasets: [{
            label: 'My Performance (%)',
            data: axes.map(a => a.avg_pct),
            backgroundColor: 'rgba(109,0,25,0.15)',
            borderColor: '#6d0019',
            borderWidth: 2,
            pointBackgroundColor: '#6d0019',
            pointRadius: 5,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
          },
          scales: {
            r: {
              min: 0, max: 100,
              ticks: { stepSize: 25, font: { family: 'Nunito', size: 10 }, backdropColor: 'transparent' },
              pointLabels: { font: { family: 'Nunito', size: 12, weight: '600' } },
              grid: { color: 'rgba(109,0,25,0.12)' },
              angleLines: { color: 'rgba(109,0,25,0.12)' },
            },
          },
        },
      });
    }
  },
};