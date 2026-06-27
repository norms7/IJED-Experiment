/* ============================================================
   controllers/notification.controller.js
   Manages real-time SSE notifications + bell UI in the topbar.
   ============================================================ */

"use strict";

const NotificationController = {
  _eventSource: null,
  _unreadCount: 0,
  _notifications: [],

  _retryCount: 0,
  _maxRetries: 5,

  // ── Bootstrap: call this right after DashboardController.load() ──────────
  init() {
    this._buildBellUI();
    this._connectSSE();
    this._fetchInitial();
    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      const dropdown = document.getElementById("notif-dropdown");
      const bell = document.getElementById("notif-bell-btn");
      if (dropdown && !dropdown.contains(e.target) && !bell.contains(e.target)) {
        dropdown.classList.remove("open");
      }
    });
  },

  // ── Build bell icon HTML into the topbar ─────────────────────────────────
  _buildBellUI() {
    const topbarRight = document.querySelector(".topbar-right");
    if (!topbarRight || document.getElementById("notif-bell-btn")) return; // already built

    // Insert bell before the dark mode toggle
    const bellHTML = `
      <div class="notif-wrapper" id="notif-wrapper">
        <button class="notif-bell-btn" id="notif-bell-btn"
          onclick="NotificationController.toggleDropdown()" title="Notifications"
          aria-label="Notifications">
          🔔
          <span class="notif-badge" id="notif-badge" style="display:none">0</span>
        </button>
        <div class="notif-dropdown" id="notif-dropdown">
          <div class="notif-dropdown-header">
            <span class="notif-dropdown-title">Notifications</span>
            <button class="notif-mark-all-btn" onclick="NotificationController.markAllRead()">
              Mark all read
            </button>
          </div>
          <div class="notif-list" id="notif-list">
            <div class="notif-empty">Loading…</div>
          </div>
        </div>
      </div>`;

    const darkBtn = topbarRight.querySelector("#dark-mode-toggle");
    if (darkBtn) {
      darkBtn.insertAdjacentHTML("beforebegin", bellHTML);
    } else {
      topbarRight.insertAdjacentHTML("afterbegin", bellHTML);
    }
  },

  // ── SSE connection ────────────────────────────────────────────────────────
  _connectSSE() {
    if (this._retryCount >= this._maxRetries) {
      console.warn("SSE: max retries reached, stopping reconnect. Falling back to polling.");
      this._startPolling();
      return;
    }
    if (this._eventSource) {
      this._eventSource.close();
    }
    const token = localStorage.getItem("lms_token");
    if (!token) return;

    const url = `${api.baseURL}/notifications/stream?token=${token}`;
    this._eventSource = new EventSource(url);

    this._eventSource.onmessage = (e) => {
      this._retryCount = 0; // reset on successful message
      const data = JSON.parse(e.data);

      if (data.type === "connected") {
        this._updateBadge(data.unread_count);
        return;
      }

      this._unreadCount++;
      this._notifications.unshift(data);
      this._updateBadge(this._unreadCount);
      this._renderList();
      Toast.show(`🔔 ${data.title}: ${data.message}`, "info");
    };

    this._eventSource.onerror = () => {
      this._retryCount++;
      const delay = Math.min(5000 * this._retryCount, 30000); // back-off: 5s, 10s, 15s... max 30s
      setTimeout(() => this._connectSSE(), delay);
    };
  },

  // ── Polling fallback (when SSE is unavailable) ────────────────────────────
  _pollingInterval: null,
  _startPolling() {
    if (this._pollingInterval) return;
    this._pollingInterval = setInterval(async () => {
      try {
        const result = await api.getNotifications();
        const prevCount = this._unreadCount;
        this._unreadCount = result.unread_count;
        this._notifications = result.notifications;
        this._updateBadge(this._unreadCount);
        this._renderList();
        // Toast new ones
        if (result.unread_count > prevCount) {
          const newest = result.notifications.find(n => !n.is_read);
          if (newest) Toast.show(`🔔 ${newest.title}: ${newest.message}`, "info");
        }
      } catch {}
    }, 30000); // poll every 30s
  },

  // ── Fetch initial notification list ──────────────────────────────────────
  async _fetchInitial() {
    try {
      const result = await api.getNotifications();
      this._unreadCount = result.unread_count;
      this._notifications = result.notifications;
      this._updateBadge(this._unreadCount);
      this._renderList();
    } catch (err) {
      console.warn("Could not load notifications:", err.message);
    }
  },

  // ── Toggle dropdown ───────────────────────────────────────────────────────
  toggleDropdown() {
    const dropdown = document.getElementById("notif-dropdown");
    const isOpening = !dropdown.classList.contains("open");
    dropdown.classList.toggle("open");
    // Refresh list from DB every time dropdown is opened
    if (isOpening) this._fetchInitial();
  },

  // ── Render notification list ──────────────────────────────────────────────
  _renderList() {
    const list = document.getElementById("notif-list");
    if (!list) return;

    if (!this._notifications.length) {
      list.innerHTML = `<div class="notif-empty">No notifications yet</div>`;
      return;
    }

    const ICONS = {
      module_uploaded:     "📄",
      activity_created:    "📝",
      activity_graded:     "✅",
      submission_received: "📤",
      announcement:        "📢",
    };

    list.innerHTML = this._notifications.slice(0, 30).map(n => `
      <div class="notif-item ${n.is_read ? "" : "notif-unread"}"
        onclick="NotificationController.handleClick(${n.id}, '${n.link_type || ""}', ${n.link_id || "null"})">
        <div class="notif-item-icon">${ICONS[n.type] || "🔔"}</div>
        <div class="notif-item-body">
          <div class="notif-item-title">${escHtml(n.title)}</div>
          <div class="notif-item-msg">${escHtml(n.message)}</div>
          <div class="notif-item-time">${this._timeAgo(n.created_at)}</div>
        </div>
        ${!n.is_read ? `<div class="notif-dot"></div>` : ""}
      </div>`).join("");
  },

  // ── Handle click: mark read + navigate ───────────────────────────────────
  async handleClick(id, linkType, linkId) {
    // Mark read in backend
    try { await api.markNotificationRead(id); } catch {}

    // Update local state
    const n = this._notifications.find(x => x.id === id);
    if (n && !n.is_read) {
      n.is_read = true;
      this._unreadCount = Math.max(0, this._unreadCount - 1);
      this._updateBadge(this._unreadCount);
      this._renderList();
    }

    // Navigate to relevant section
    if (linkType === "module") {
      DashboardController.loadSection("modules");
    } else if (linkType === "activity") {
      DashboardController.loadSection("activities");
    }

    document.getElementById("notif-dropdown")?.classList.remove("open");
  },

  // ── Mark all read ─────────────────────────────────────────────────────────
  async markAllRead() {
    try {
      await api.markAllNotificationsRead();
      this._notifications.forEach(n => n.is_read = true);
      this._unreadCount = 0;
      this._updateBadge(0);
      this._renderList();
    } catch (err) {
      Toast.show("Could not mark notifications as read.", "error");
    }
  },

  // ── Badge update ──────────────────────────────────────────────────────────
  _updateBadge(count) {
    const badge = document.getElementById("notif-badge");
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count > 99 ? "99+" : count;
      badge.style.display = "flex";
    } else {
      badge.style.display = "none";
    }
  },

  // ── Time ago helper ───────────────────────────────────────────────────────
  _timeAgo(isoStr) {
    const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
    if (diff < 60)   return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  },

  // ── Cleanup on logout ─────────────────────────────────────────────────────
  destroy() {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
    }
    this._retryCount = 0;
  },
};

// Build the bell HTML into the topbar as soon as the DOM is ready,
// regardless of login state — so it's always present on first paint.
document.addEventListener('DOMContentLoaded', () => {
  NotificationController._buildBellUI();
});