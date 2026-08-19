/* ============================================================
   controllers/auth.controller.js
   Handles login, role selection, and logout.
   ============================================================ */

"use strict";

const AuthController = {
  selectedRole: 'admin',

  /** Switch role tabs */
  selectRole(role) {
    this.selectedRole = role;
    document.querySelectorAll('.role-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.role === role)
    );
  },

  /** Authenticate user via API, validate role, load dashboard */
  async login() {
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();
    if (!email || !password) {
      Toast.show('Please fill in all fields.', 'error');
      return;
    }
    try {
      const data = await api.login(email, password);
      const user = api.getCurrentUser();
      if (user.role !== this.selectedRole) {
        api.logout();
        Toast.show(`This account is a "${user.role}". Please select the correct role tab.`, 'error');
        return;
      }
      Toast.show(`Welcome back, ${data.full_name}! 👋`, 'success');
      App.showPage('app');
      DashboardController.load(user);
      
      // ── NOTIFICATION SYSTEM INIT ──────────────────────────────────────────
      // Starts Realtime subscription, builds the bell UI, and sets up polling.
      NotificationController.init();
      // ───────────────────────────────────────────────────────────────────────
      
    } catch (err) {
      Toast.show(err.message || 'Invalid credentials.', 'error');
    }
  },

  /** Clear session and return to landing page */
  logout() {
    // ── CLEANUP: destroy notification channel, polling, and state ──────────
    NotificationController.destroy();
    // ─────────────────────────────────────────────────────────────────────────

    api.logout();
    
    // Clear all session artifacts (use localStorage consistently)
    localStorage.removeItem('lms_token');
    localStorage.removeItem('lms_user');
    localStorage.removeItem('ijla_session');
    
    App.showPage('landing');
    Toast.show('You have been signed out.', 'info');
  },
};