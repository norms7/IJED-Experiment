/* ============================================================
   controllers/app.controller.js
   Global UI state: page routing, sidebar, clock, dark mode.
   ============================================================ */

"use strict";

const App = {
  sidebarCollapsed: false,

    initLandingNav() {
      const nav = document.querySelector('.landing-nav');
      if (!nav) return;

      const syncSurface = () => {
        const rect = nav.getBoundingClientRect();
        const element = document.elementFromPoint(window.innerWidth / 2, rect.bottom + 8);
        const section = element && element.closest('section, footer');
        const isLight = section && (section.classList.contains('features') || section.classList.contains('about-section'));
        nav.dataset.surface = isLight ? 'light' : 'dark';
      };

      syncSurface();
      window.addEventListener('scroll', syncSurface, { passive: true });
      window.addEventListener('resize', syncSurface);
    },

  /** Switch between landing, login, and app pages */
  showPage(page) {
    document.getElementById('page-landing').classList.toggle('hidden', page !== 'landing');
    document.getElementById('page-login').classList.toggle('hidden',   page !== 'login');
    document.getElementById('page-app').classList.toggle('hidden',     page !== 'app');
    if (typeof DarkMode !== 'undefined') {
      if (page === 'app') DarkMode.init();
      else DarkMode.disable();
    }
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

  applyProfileImage(user = DashboardController.currentUser || Storage.get('ijla_session')) {
    const image = user?.id ? Storage.get(`ijed_profile_image_${user.id}`) : null;
    if (!image) return;
    const imageUrl = `url("${image}")`;
    ['settings-image-preview', 'sb-avatar', 'topbar-avatar'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.backgroundImage = imageUrl;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
    });
  },

  previewProfileImage(input) {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const user = DashboardController.currentUser || Storage.get('ijla_session');
      this._pendingProfileImage = reader.result;
      this.applyProfileImage(user);
    };
    reader.readAsDataURL(file);
  },
};
/* ── Dark Mode ──────────────────────────────────────────────── */
const DarkMode = {
  KEY: 'ijed_dark_mode',
  getTheme() {
    const saved = Storage.get(this.KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    return saved === true ? 'dark' : 'system';
  },
  init() { this.apply(this.getTheme()); },
  setTheme(theme) {
    if (!['light', 'dark', 'system'].includes(theme)) theme = 'system';
    Storage.set(this.KEY, theme);
    this.apply(theme);
  },
  apply(theme) {
    const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('dark-mode', isDark);
    this._setIcon(isDark);
  },
  disable() {
    document.body.classList.remove('dark-mode');
    this._setIcon(false);
  },
  toggle() { this.setTheme(document.body.classList.contains('dark-mode') ? 'light' : 'dark'); },
  _setIcon(isDark) {
    const btn = document.getElementById('dark-mode-toggle');
    if (btn) btn.textContent = isDark ? '☀️' : '🌙';
  },
};

