/* ============================================================
   controllers/auth.controller.js
   Handles login, role selection, and logout.
   ============================================================ */

"use strict";

const AuthController = {
  /** Authenticate user via API and load the dashboard based on their actual role */
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

      if (!user || !user.role) {
        api.logout();
        Toast.show('Unable to determine your account role.', 'error');
        return;
      }

      Toast.show(`Welcome back, ${data.full_name}! 👋`, 'success');
      SessionGuard.start();   // begin idle tracking (5-minute auto sign-out)
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

  /**
   * Sign out and wipe everything belonging to the previous session.
   * @param {{reason?: 'manual'|'idle'|'expired'}} opts
   *
   * Ends with a full page reload on purpose: it is the only way to guarantee
   * no old DOM, controller state, cache, timer or realtime channel survives.
   */
  async logout(opts = {}) {
    const reason = opts.reason || 'manual';
    SessionGuard._ending = true;
    SessionGuard.stop();

    // 1. Remove old data from the screen right away.
    SessionGuard.wipeScreen();

    // 2. Stop realtime channel + polling.
    try { NotificationController.destroy(); } catch {}

    // 3. End the Supabase session (don't let a dead network block the logout).
    try {
      await Promise.race([api.logout(), new Promise((r) => setTimeout(r, 2500))]);
    } catch {}

    // 4. Purge every user-specific key, then leave a one-time message.
    SessionGuard.purgeStorage();
    SessionGuard.setNotice(reason);

    // 5. Fresh page = fresh memory.
    window.location.reload();
  },
};
