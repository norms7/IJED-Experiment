/* ============================================================
   utils/session-guard.js
   Session lifetime + clean logout.

   • The login session lives in sessionStorage, so closing the tab /
     browser ends it (nothing is kept on disk between browser runs).
   • After IDLE_LIMIT_MS without any user activity (tab left open, laptop
     closed/asleep, phone app in the background) the user is signed out.
     Timestamps are wall-clock, so time spent asleep still counts.
   • On any logout the screen is wiped, every user-specific storage key is
     purged and the page is reloaded, so no previous user's data (DOM,
     controller state, caches, timers, realtime channels) can survive.
   ============================================================ */

"use strict";

/** sessionStorage twin of `Storage` — used for anything tied to the login session. */
const SessionStore = {
  get(k) {
    try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; }
  },
  set(k, v) { sessionStorage.setItem(k, JSON.stringify(v)); },
  remove(k) { sessionStorage.removeItem(k); },
};

const SessionGuard = {
  IDLE_LIMIT_MS: 5 * 60 * 1000,   // sign out after 5 minutes without activity
  CHECK_EVERY_MS: 15 * 1000,      // how often the idle timer checks
  ACTIVITY_KEY: "ijed_last_active",
  NOTICE_KEY: "ijed_logout_notice",

  // Preferences that are NOT user data and survive logout.
  _KEEP_KEYS: ["ijla_sidebar_collapsed", "ijed_dark_mode", "ijed_logout_notice"],
  // Everything else with these prefixes is wiped on logout.
  _PURGE_PREFIXES: ["sb-", "lms_", "ijla_", "ijed_"],

  _lastActive: Date.now(),
  _lastWrite: 0,
  _timer: null,
  _started: false,
  _ending: false,

  // ── Lifecycle ────────────────────────────────────────────────────────────
  start() {
    if (this._started) return;
    this._started = true;
    this._ending = false;
    this._touch(true);
    ["pointerdown", "keydown", "wheel", "touchstart", "scroll", "mousemove"]
      .forEach((e) => window.addEventListener(e, this._onActivity, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", this._onResume);
    window.addEventListener("pageshow", this._onResume);
    window.addEventListener("focus", this._onResume);
    window.addEventListener("online", this._onResume);
    this._timer = setInterval(() => this.check(), this.CHECK_EVERY_MS);
  },

  stop() {
    if (!this._started) return;
    this._started = false;
    ["pointerdown", "keydown", "wheel", "touchstart", "scroll", "mousemove"]
      .forEach((e) => window.removeEventListener(e, this._onActivity, { capture: true }));
    document.removeEventListener("visibilitychange", this._onResume);
    window.removeEventListener("pageshow", this._onResume);
    window.removeEventListener("focus", this._onResume);
    window.removeEventListener("online", this._onResume);
    clearInterval(this._timer);
    this._timer = null;
  },

  // ── Activity tracking ────────────────────────────────────────────────────
  _touch(force = false) {
    const now = Date.now();
    this._lastActive = now;
    // sessionStorage writes are throttled; the timestamp is also flushed when
    // the page is hidden so a restored tab can be judged on next open.
    if (force || now - this._lastWrite > 5000) {
      this._lastWrite = now;
      try { SessionStore.set(this.ACTIVITY_KEY, now); } catch { /* storage full/blocked */ }
    }
  },

  _onActivity: () => {
    const g = SessionGuard;
    // First activity after sleep/background must NOT revive an expired session.
    if (Date.now() - g._lastActive >= g.IDLE_LIMIT_MS) { g.expire("idle"); return; }
    g._touch();
  },

  _onResume: () => {
    const g = SessionGuard;
    if (document.visibilityState === "hidden") {
      try { SessionStore.set(g.ACTIVITY_KEY, g._lastActive); } catch {}
      return;
    }
    g.check();
  },

  check() {
    if (!this.hasSession()) return;
    if (Date.now() - this._lastActive >= this.IDLE_LIMIT_MS) this.expire("idle");
  },

  hasSession() {
    return !!SessionStore.get("ijla_session");
  },

  /** True if a stored session was idle for longer than the limit (checked on page load). */
  isStale() {
    const last = SessionStore.get(this.ACTIVITY_KEY);
    return !last || Date.now() - last >= this.IDLE_LIMIT_MS;
  },

  expire(reason = "idle") {
    if (this._ending) return;
    this._ending = true;
    AuthController.logout({ reason });
  },

  // ── Clean-up ─────────────────────────────────────────────────────────────
  /** Immediately remove everything user-specific from the visible page. */
  wipeScreen() {
    try { Modal.close(); } catch {}
    ["content-area", "sidebar-nav", "modal-container"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });
    ["sb-username", "sb-role", "sb-avatar", "topbar-avatar",
     "profile-dd-name", "profile-dd-role", "profile-dd-email", "profile-dd-avatar"]
      .forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = "";
      });
    document.querySelectorAll(".profile-avatar-image").forEach((n) => n.remove());
    document.getElementById("page-app")?.classList.add("hidden");
    document.getElementById("page-login")?.classList.add("hidden");
    document.getElementById("page-landing")?.classList.remove("hidden");
  },

  /** Remove every user-specific key from both storages (keeps UI preferences). */
  purgeStorage() {
    const wipe = (store) => {
      Object.keys(store).forEach((k) => {
        if (this._KEEP_KEYS.includes(k)) return;
        if (this._PURGE_PREFIXES.some((p) => k.startsWith(p))) store.removeItem(k);
      });
    };
    try { wipe(localStorage); } catch {}
    try { wipe(sessionStorage); } catch {}
  },

  // ── "You were signed out" message that survives the reload ───────────────
  setNotice(reason) {
    try { SessionStore.set(this.NOTICE_KEY, reason); } catch {}
  },

  showPendingNotice() {
    const reason = SessionStore.get(this.NOTICE_KEY);
    if (!reason) return;
    SessionStore.remove(this.NOTICE_KEY);
    const mins = Math.round(this.IDLE_LIMIT_MS / 60000);
    const msg = {
      idle: `You were signed out after ${mins} minutes of inactivity.`,
      expired: "Your session expired. Please sign in again.",
      manual: "You have been signed out.",
    }[reason] || "You have been signed out.";
    if (reason === "idle" || reason === "expired") {
      window.alert(msg);
      App.showPage("landing");
      return;
    }
    Toast.show(msg, "info", 6000);
  },
};
