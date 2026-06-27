/* ============================================================
   utils/utils.js
   Shared helper utilities used across the entire application.
   ============================================================ */

"use strict";

/* ── Storage Utility ────────────────────────────────────────
   Thin wrapper around localStorage for type-safe access.
   ────────────────────────────────────────────────────────── */
const Storage = {
  get:    (k)    => JSON.parse(localStorage.getItem(k)),
  set:    (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  remove: (k)    => localStorage.removeItem(k),
};

/* ── Toast Notification System ──────────────────────────────
   Displays auto-dismissing toast messages.
   Types: 'success' | 'error' | 'info' | 'warning'
   ────────────────────────────────────────────────────────── */
const Toast = {
  icons: { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' },

  show(message, type = 'info', duration = 3200) {
    const container = document.getElementById('toast-container');
    const toast     = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${this.icons[type] || 'ℹ'}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut .3s ease forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },
};

/* ── Modal System ───────────────────────────────────────────
   Programmatic modal dialog with title, body, and footer.
   Closes on overlay click or close button.
   ────────────────────────────────────────────────────────── */
const Modal = {
  show(title, bodyHTML, footerHTML = '', opts = {}) {
    const container = document.getElementById('modal-container');
    const wideStyle = opts.wide ? 'max-width:860px;width:96%;' : '';
    container.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal" style="${wideStyle}">
          <div class="modal-header">
            <span class="modal-title">${title}</span>
            <button class="modal-close" onclick="Modal.close()" aria-label="Close">&times;</button>
          </div>
          <div class="modal-body">${bodyHTML}</div>
          ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ''}
        </div>
      </div>`;

    // Close on backdrop click
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') Modal.close();
    });

    // Close on ESC key
    this._escHandler = (e) => { if (e.key === 'Escape') Modal.close(); };
    document.addEventListener('keydown', this._escHandler);
  },

  close() {
    document.getElementById('modal-container').innerHTML = '';
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
  },
};

/* ── HTML Escape ────────────────────────────────────────────
   Prevents XSS when rendering user-supplied data into HTML.
   ────────────────────────────────────────────────────────── */
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Grade Helpers ──────────────────────────────────────────
   Convert numeric percentage to CSS class and letter grade.
   ────────────────────────────────────────────────────────── */
function gradeClass(pct) {
  if (pct >= 90) return 'grade-a';
  if (pct >= 75) return 'grade-b';
  if (pct >= 60) return 'grade-c';
  return 'grade-d';
}

function gradeLabel(pct) {
  if (pct >= 90) return 'A';
  if (pct >= 75) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 50) return 'D';
  return 'F';
}

/* ── Date Formatter ─────────────────────────────────────────
   Formats ISO date strings into readable PH locale format.
   ────────────────────────────────────────────────────────── */
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

/* ── Activity Type Helpers ──────────────────────────────────
   Returns background style and emoji for activity types.
   ────────────────────────────────────────────────────────── */
function typeBg(type) {
  const map = {
    quiz:       'background: #fde8ec;',
    assignment: 'background: #e6f4ea;',
    essay:      'background: #fff0e6;',
  };
  return map[type] || 'background: var(--gray-100);';
}

function typeEmoji(type) {
  const map = { quiz: '📝', assignment: '📋', essay: '✍️' };
  return map[type] || '📌';
}

/* ── Input Validation ───────────────────────────────────────
   Basic form validation helpers.
   ────────────────────────────────────────────────────────── */
const Validate = {
  required(value, fieldName = 'This field') {
    if (!value || !String(value).trim()) {
      Toast.show(`${fieldName} is required.`, 'error');
      return false;
    }
    return true;
  },
  email(value) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(value)) {
      Toast.show('Please enter a valid email address.', 'error');
      return false;
    }
    return true;
  },
  minLength(value, min, fieldName = 'Password') {
    if (!value || value.length < min) {
      Toast.show(`${fieldName} must be at least ${min} characters.`, 'error');
      return false;
    }
    return true;
  },
};
