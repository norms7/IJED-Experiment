/* ============================================================
   controllers/notification.controller.js
   Real-time notifications via Supabase Realtime (replaces FastAPI SSE).
   Robust version with reconnection, dedup, and polling.
   ============================================================ */

"use strict";

const NotificationController = {
  _channel: null,
  _pollingInterval: null,
  _unreadCount: 0,
  _notifications: [],
  _initialized: false,
  _knownIds: new Set(), // dedup

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  init(force = false) {
    if (this._initialized && !force) return;
    this._buildBellUI();
    this._fetchInitial();
    this._subscribeRealtime();
    this._setupReconnection();
    this._startPolling(30000); // fallback every 30s
    this._initialized = true;
  },

  // ── Build bell icon into topbar ───────────────────────────────────────────
  _buildBellUI() {
    const topbarRight = document.querySelector(".topbar-right");
    if (!topbarRight || document.getElementById("notif-bell-btn")) return;
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
    if (darkBtn) darkBtn.insertAdjacentHTML("beforebegin", bellHTML);
    else topbarRight.insertAdjacentHTML("afterbegin", bellHTML);
  },

  // ── Supabase Realtime subscription ────────────────────────────────────────
  _subscribeRealtime() {
    const user = api.getCurrentUser();
    if (!user?.id) return;

    // Remove existing channel if any
    if (this._channel) {
      api.sb.removeChannel(this._channel);
      this._channel = null;
    }

    this._channel = api.sb
      .channel("notifications_" + user.id)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `target_user_id=eq.${user.id}`,
      }, (payload) => {
        this._addNotification(payload.new);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("Notification Realtime connected");
        } else if (status === "CHANNEL_ERROR") {
          // Try to resubscribe after a delay
          setTimeout(() => this._subscribeRealtime(), 3000);
        }
      });
  },

  // ── Add notification with dedup ───────────────────────────────────────────
  _addNotification(n) {
    if (this._knownIds.has(n.id)) return;
    this._knownIds.add(n.id);
    this._notifications.unshift(n);
    if (!n.is_read) this._unreadCount++;
    this._updateBadge(this._unreadCount);
    this._renderList();
    Toast.show(`🔔 ${n.title}: ${n.message}`, "info");
  },

  // ── Fetch initial list from DB ────────────────────────────────────────────
  async _fetchInitial() {
    try {
      const rows = await api.getNotifications(30);
      // Merge, preserving order and dedup
      const newIds = new Set(rows.map(n => n.id));
      this._knownIds = new Set([...this._knownIds, ...newIds]);
      // Keep only the 30 most recent
      const combined = [...rows, ...this._notifications];
      const seen = new Set();
      const merged = combined.filter(n => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      });
      merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      this._notifications = merged.slice(0, 30);
      this._unreadCount = this._notifications.filter(n => !n.is_read).length;
      this._updateBadge(this._unreadCount);
      this._renderList();
    } catch (err) {
      console.warn("Could not load notifications:", err.message);
    }
  },

  // ── Reconnection handling (visibility change) ─────────────────────────────
  _setupReconnection() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        // Re-fetch and re-subscribe to catch missed events
        this._fetchInitial();
        this._subscribeRealtime();
      }
    });
  },

  // ── Polling fallback ───────────────────────────────────────────────────────
  _startPolling(interval = 30000) {
    if (this._pollingInterval) clearInterval(this._pollingInterval);
    this._pollingInterval = setInterval(() => {
      if (document.visibilityState === "visible") {
        this._fetchInitial();
      }
    }, interval);
  },

  // ── Toggle dropdown ───────────────────────────────────────────────────────
  toggleDropdown() {
    const dropdown = document.getElementById("notif-dropdown");
    const isOpening = !dropdown.classList.contains("open");
    dropdown.classList.toggle("open");
    if (isOpening) this._fetchInitial();
  },

  // ── Render list ──────────────────────────────────────────────────────────
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
        <div class="notif-item-icon">${ICONS[n.notification_type] || "🔔"}</div>
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
    try { await api.markNotificationRead(id); } catch {}
    const n = this._notifications.find(x => x.id === id);
    if (n && !n.is_read) {
      n.is_read = true;
      this._unreadCount = Math.max(0, this._unreadCount - 1);
      this._updateBadge(this._unreadCount);
      this._renderList();
    }
    if (linkType === "module")   DashboardController.loadSection("modules");
    if (linkType === "activity") DashboardController.loadSection("activities");
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
    } catch {
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
    if (diff < 60)    return "just now";
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  },

  // ── Cleanup on logout ─────────────────────────────────────────────────────
  destroy() {
    if (this._channel) {
      api.sb.removeChannel(this._channel);
      this._channel = null;
    }
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
    }
    this._notifications = [];
    this._unreadCount = 0;
    this._knownIds.clear();
    this._initialized = false;
  },
};

document.addEventListener("DOMContentLoaded", () => {
  NotificationController._buildBellUI();
});