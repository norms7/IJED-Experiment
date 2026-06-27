/* ============================================================
   utils/loader.js
   Global loading-indicator utility for IJED LMS.

   USAGE SUMMARY
   ─────────────
   Loader.start()          — show top progress bar
   Loader.done()           — finish/hide progress bar
   Loader.section(msg?)    — overlay spinner over content-area
   Loader.clearSection()   — hide the overlay
   Loader.skeleton(type)   — return skeleton HTML string
   Loader.btn(el, bool)    — toggle loading state on a button
   Loader.wrap(promise, opts?) — run a promise with auto indicators

   ============================================================ */

"use strict";

const Loader = {

  /* ── Internal state ──────────────────────────────────────── */
  _pendingCount: 0,
  _progressBar:  null,
  _overlay:      null,

  /* ── Bootstrap (called once from App.init) ───────────────── */
  init() {
    // Top progress bar
    if (!document.getElementById('ijed-progress-bar')) {
      const bar = document.createElement('div');
      bar.id = 'ijed-progress-bar';
      document.body.prepend(bar);
    }
    this._progressBar = document.getElementById('ijed-progress-bar');

    // Section overlay (inside content-area so position:absolute works)
    const area = document.getElementById('content-area');
    if (area && !document.getElementById('ijed-section-overlay')) {
      const ov = document.createElement('div');
      ov.id = 'ijed-section-overlay';
      ov.innerHTML = `
        <div class="ijed-spin-wrap">
          <div class="ijed-spinner-lg"></div>
          <span class="ijed-spin-label" id="ijed-spin-label">Loading…</span>
        </div>`;
      area.prepend(ov);
    }
    this._overlay = document.getElementById('ijed-section-overlay');
  },

  /* ── 1. Top Progress Bar ─────────────────────────────────── */
  start() {
    this._pendingCount++;
    if (!this._progressBar) return;
    this._progressBar.classList.remove('done');
    this._progressBar.classList.add('loading');
  },

  done() {
    this._pendingCount = Math.max(0, this._pendingCount - 1);
    if (this._pendingCount > 0) return; // still other requests in flight
    if (!this._progressBar) return;
    this._progressBar.classList.remove('loading');
    this._progressBar.classList.add('done');
    setTimeout(() => {
      if (this._progressBar) this._progressBar.classList.remove('done');
    }, 600);
  },

  /* ── 2. Full-section overlay spinner ─────────────────────── */
  section(label = 'Loading…') {
    const ov = document.getElementById('ijed-section-overlay');
    if (!ov) return;
    const lbl = document.getElementById('ijed-spin-label');
    if (lbl) lbl.textContent = label;
    ov.classList.add('active');
  },

  clearSection() {
    const ov = document.getElementById('ijed-section-overlay');
    if (ov) ov.classList.remove('active');
  },

  /* ── 3. Skeleton HTML factory ────────────────────────────── */
  /**
   * Returns a ready-to-inject HTML string for common section types.
   * @param {'dashboard'|'table'|'list'|'calendar'|'cards'|'grades'} type
   */
  skeleton(type = 'list') {
    const s = (cls, style = '') =>
      `<div class="skel ${cls}" style="${style}"></div>`;

    const header = `
      <div class="skel-page-header">
        ${s('skel-title')}
        ${s('skel-btn')}
      </div>`;

    if (type === 'dashboard') {
      return `
        <div style="padding:4px 0">
          ${s('skel-title', 'width:180px;margin-bottom:20px')}
          <div class="skel-stats-row">
            ${Array(4).fill(s('skel skel-card skel-stat-card')).join('')}
          </div>
          <div class="skel-stats-row" style="margin-top:8px">
            ${Array(2).fill(s('skel skel-card', 'height:160px')).join('')}
          </div>
        </div>`;
    }

    if (type === 'table') {
      return `
        ${header}
        <div class="card">
          <div class="skel-table-wrap" style="padding:16px">
            ${Array(6).fill(s('skel skel-table-row')).join('')}
          </div>
        </div>`;
    }

    if (type === 'list') {
      return `
        ${header}
        <div class="skel-list">
          ${Array(5).fill(s('skel skel-list-card')).join('')}
        </div>`;
    }

    if (type === 'cards') {
      return `
        ${header}
        <div class="skel-stats-row">
          ${Array(6).fill(s('skel skel-card', 'height:120px')).join('')}
        </div>`;
    }

    if (type === 'grades') {
      return `
        ${header}
        <div class="card" style="margin-bottom:16px">
          <div style="padding:14px 16px">
            ${s('skel skel-title', 'width:140px;margin-bottom:12px')}
            ${s('skel skel-text', 'width:60%;margin-bottom:8px')}
            ${s('skel skel-text', 'width:40%')}
          </div>
        </div>
        <div class="card">
          <div class="skel-table-wrap" style="padding:16px">
            ${Array(7).fill(s('skel skel-table-row')).join('')}
          </div>
        </div>`;
    }

    if (type === 'calendar') {
      return `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <div>
            ${s('skel', 'height:48px;margin-bottom:14px;border-radius:10px')}
            <div class="card" style="padding:14px;margin-bottom:14px">
              ${s('skel skel-text', 'width:160px;margin:0 auto 14px')}
              <div class="skel-cal-grid">
                ${Array(35).fill(s('skel skel-cal-cell')).join('')}
              </div>
            </div>
            <div class="card" style="padding:14px">
              ${s('skel skel-text', 'width:100px;margin-bottom:10px')}
              ${Array(3).fill(s('skel skel-text', 'margin-bottom:8px')).join('')}
            </div>
          </div>
          <div class="card" style="padding:20px">
            ${s('skel', 'height:200px')}
          </div>
        </div>`;
    }

    // fallback — generic
    return `<div class="skel-list">${Array(4).fill(s('skel skel-list-card')).join('')}</div>`;
  },

  /* ── 4. Button loading state ─────────────────────────────── */
  /**
   * @param {HTMLElement} btn
   * @param {boolean} loading
   * @param {string} [loadingText]  — replaces button text when loading
   */
  btn(btn, loading, loadingText) {
    if (!btn) return;
    if (loading) {
      btn._originalHTML = btn.innerHTML;
      if (loadingText) {
        btn.innerHTML = `<span class="ijed-spinner ijed-spinner-white"></span> ${loadingText}`;
      } else {
        btn.innerHTML = `<span class="btn-text">${btn.innerHTML}</span>`;
        btn.classList.add('btn-loading');
      }
      btn.disabled = true;
    } else {
      btn.classList.remove('btn-loading');
      if (btn._originalHTML !== undefined) {
        btn.innerHTML = btn._originalHTML;
        delete btn._originalHTML;
      }
      btn.disabled = false;
    }
  },

  /* ── 5. High-level wrapper ───────────────────────────────── */
  /**
   * Run a promise with automatic loading indicators.
   *
   * @param {Promise}  promise
   * @param {Object}   [opts]
   * @param {boolean}  [opts.bar=true]       — show top progress bar
   * @param {boolean}  [opts.overlay=false]  — show section overlay
   * @param {string}   [opts.label]          — overlay label
   * @param {string}   [opts.skeleton]       — if set, injects skeleton into #content-area
   * @param {HTMLElement} [opts.btn]         — button to put in loading state
   * @returns {Promise}
   */
  async wrap(promise, opts = {}) {
    const { bar = true, overlay = false, label, skeleton, btn } = opts;

    if (bar)     this.start();
    if (overlay) this.section(label || 'Loading…');
    if (skeleton) {
      const area = document.getElementById('content-area');
      if (area) area.innerHTML = this.skeleton(skeleton);
      // Re-attach overlay after innerHTML reset
      this.init();
    }
    if (btn) this.btn(btn, true, label);

    try {
      return await promise;
    } finally {
      if (bar)     this.done();
      if (overlay) this.clearSection();
      if (btn)     this.btn(btn, false);
    }
  },
};