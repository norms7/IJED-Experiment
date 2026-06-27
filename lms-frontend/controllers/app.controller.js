/* ============================================================
   controllers/app.controller.js
   Global UI state: page routing, sidebar, clock, dark mode.
   ============================================================ */

"use strict";

const App = {
  sidebarCollapsed: false,

  /** Switch between landing, login, and app pages */
  showPage(page) {
    document.getElementById('page-landing').classList.toggle('hidden', page !== 'landing');
    document.getElementById('page-login').classList.toggle('hidden',   page !== 'login');
    document.getElementById('page-app').classList.toggle('hidden',     page !== 'app');
  },

  /** Toggle sidebar collapse (desktop) or slide-out (mobile) */
  toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    if (window.innerWidth <= 768) {
      sb.classList.toggle('mobile-open');
      ov.classList.toggle('show');
    } else {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      sb.classList.toggle('collapsed', this.sidebarCollapsed);
    }
  },

  /** Update topbar clock every second */
  updateClock() {
    const el = document.getElementById('topbar-time');
    if (el) el.textContent = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  },

  /** Bootstrap the app: dark mode, clock, session restore */
  init() {
    DarkMode.init();
    document.getElementById('sidebar-overlay').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('mobile-open');
      document.getElementById('sidebar-overlay').classList.remove('show');
    });
    // Close mobile sidebar when a nav-item is tapped
    document.getElementById('sidebar-nav').addEventListener('click', (e) => {
      if (window.innerWidth <= 768 && e.target.closest('.nav-item')) {
        document.getElementById('sidebar').classList.remove('mobile-open');
        document.getElementById('sidebar-overlay').classList.remove('show');
      }
    });
    // Close mobile sidebar on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.getElementById('sidebar').classList.remove('mobile-open');
        document.getElementById('sidebar-overlay').classList.remove('show');
      }
    });
    // Prevent body scroll when mobile sidebar is open
    const _sb = document.getElementById('sidebar');
    const observer = new MutationObserver(() => {
      document.body.style.overflow = _sb.classList.contains('mobile-open') ? 'hidden' : '';
    });
    observer.observe(_sb, { attributes: true, attributeFilter: ['class'] });
    // Close profile dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const wrapper = document.getElementById('topbar-avatar-wrapper');
      if (wrapper && !wrapper.contains(e.target)) {
        document.getElementById('profile-dropdown')?.classList.remove('open');
      }
    });
    this.updateClock();
    setInterval(() => this.updateClock(), 1000);
    const session = Storage.get('ijla_session');
    if (session) {
      if (session._token) api._saveToken(session._token);
      this.showPage('app');
      Loader.init();  // Init after page is visible so content-area has dimensions
      this.populateProfileDropdown(session);
      DashboardController.load(session);
      NotificationController.init();
    } else {
      this.showPage('landing');
    }
  },

  /** Populate profile dropdown with user info */
  populateProfileDropdown(session) {
    const name  = session.full_name || session.name || 'User';
    const role  = (session.role || '').charAt(0).toUpperCase() + (session.role || '').slice(1);
    const email = session.email || '—';
    const init  = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

    const av = document.getElementById('topbar-avatar');
    if (av) av.textContent = init;

    const ddAv    = document.getElementById('profile-dd-avatar');
    const ddName  = document.getElementById('profile-dd-name');
    const ddRole  = document.getElementById('profile-dd-role');
    const ddEmail = document.getElementById('profile-dd-email');
    if (ddAv)    ddAv.textContent    = init;
    if (ddName)  ddName.textContent  = name;
    if (ddRole)  ddRole.textContent  = role;
    if (ddEmail) ddEmail.textContent = email;
  },

  /** Toggle profile dropdown open/close */
  toggleProfileMenu() {
    document.getElementById('profile-dropdown')?.classList.toggle('open');
  },
};

/* ── Dark Mode ──────────────────────────────────────────────── */
const DarkMode = {
  KEY: 'ijed_dark_mode',
  init()   { if (Storage.get(this.KEY) === true) { document.body.classList.add('dark-mode'); this._setIcon(true); } },
  toggle() { const isDark = document.body.classList.toggle('dark-mode'); Storage.set(this.KEY, isDark); this._setIcon(isDark); },
  _setIcon(isDark) {
    const btn = document.getElementById('dark-mode-toggle');
    if (btn) btn.textContent = isDark ? '☀️' : '🌙';
  },
};