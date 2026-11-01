/* ============================================================
   controllers/calendar.controller.js
   Calendar navigation, event display, and todo management.
   ============================================================ */

"use strict";

const CalendarController = {
  _viewYear:     null,
  _viewMonth:    null,
  _selectedDate: null,
  _eventMap:     {},   // { "YYYY-MM-DD": [event, ...] }
  _scheduleMap:  {},   // { 0-6 (day-of-week): [scheduleEntry, ...] }
  _viewMode:     "month",

  init() {
    const now = new Date();
    if (this._viewYear  === null) this._viewYear  = now.getFullYear();
    if (this._viewMonth === null) this._viewMonth = now.getMonth();
    // FIX: previously this only called _render() inside .then() — if
    // _buildActivityEvents() (or _buildWeeklySchedule()) ever rejected for
    // any reason (bad localStorage data, an API hiccup not already caught
    // internally, etc.), _render() never ran at all, leaving the grid shell
    // completely blank until prev()/next() triggered a direct _render()
    // call. Now the grid always renders regardless of whether the extra
    // data finished loading — .catch() guarantees it, and Promise.allSettled
    // means one failing fetch can't block the other.
    return Promise.allSettled([
      this._buildActivityEvents(DashboardController.currentUser),
      this._buildWeeklySchedule(DashboardController.currentUser),
    ]).then((results) => {
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.error(`[CalendarController] init() step ${i} failed:`, r.reason);
        }
      });
      this._render();
    }).catch((err) => {
      console.error('[CalendarController] init() failed unexpectedly:', err);
      this._render();
    });
  },

  prev() {
    if (this._viewMode === "week") {
      const base = this._selectedDate ? new Date(`${this._selectedDate}T00:00:00`) : new Date();
      base.setDate(base.getDate() - 7);
      this._selectedDate = this._dateKey(base);
      this._viewYear = base.getFullYear();
      this._viewMonth = base.getMonth();
      this._render();
      return;
    }
    this._selectedDate = null;
    if (this._viewMonth === 0) { this._viewMonth = 11; this._viewYear--; }
    else this._viewMonth--;
    this._render();
  },

  next() {
    if (this._viewMode === "week") {
      const base = this._selectedDate ? new Date(`${this._selectedDate}T00:00:00`) : new Date();
      base.setDate(base.getDate() + 7);
      this._selectedDate = this._dateKey(base);
      this._viewYear = base.getFullYear();
      this._viewMonth = base.getMonth();
      this._render();
      return;
    }
    this._selectedDate = null;
    if (this._viewMonth === 11) { this._viewMonth = 0; this._viewYear++; }
    else this._viewMonth++;
    this._render();
  },

  today() {
    const now = new Date();
    this._viewYear = now.getFullYear();
    this._viewMonth = now.getMonth();
    this._selectedDate = this._dateKey(now);
    this._render();
  },

  setView(mode) {
    if (!["month", "week", "agenda"].includes(mode)) return;
    this._viewMode = mode;
    this._render();
  },

  _dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  },

  _todayKey() {
    return this._dateKey(new Date());
  },

  _calendarDateKey(value) {
    if (!value) return null;
    value = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : this._dateKey(date);
  },

  // ── Fetch activity due-dates from the API and merge with localStorage events ──
  async _buildActivityEvents(user) {
    if (!user) return;
    this._eventMap = {};

    // 1. Load persisted events from localStorage (announcements, holidays, exams, etc.)
    // FIX: wrapped in try/catch — a corrupted localStorage entry used to
    // throw here, OUTSIDE any try/catch, which silently killed the whole
    // init() promise chain and left the calendar grid blank on first load.
    try {
      const storedEvents = calendarModel.getForUser(user.id, user.role);
      for (const ev of storedEvents) {
        if (!ev.date) continue;
        if (!this._eventMap[ev.date]) this._eventMap[ev.date] = [];
        this._eventMap[ev.date].push(ev);
      }
    } catch (err) {
      console.warn('[CalendarController] Could not load stored events:', err);
    }

    // 2. Pull activity due-dates from the backend (role-aware)
    try {
      const activities = await api.getCalendarActivities(user.role);

      for (const act of activities) {
        if (user.role === "student" && !act.is_published) continue;
        const dates = [
          { value: act.start_date, suffix: "opens", label: "Opens" },
          { value: act.due_date, suffix: "due", label: "Due" },
        ];
        dates.forEach(({ value, suffix, label }) => {
          const dateKey = this._calendarDateKey(value);
          if (!dateKey) return;
          if (!this._eventMap[dateKey]) this._eventMap[dateKey] = [];
          this._eventMap[dateKey].push({
            id: `api-act-${act.id}-${suffix}`,
            date: dateKey,
            title: act.title || "Activity",
            type: "activity-due",
            time: this._formatEventTime(value),
            dateLabel: label,
            visibility: "all",
            _source: "api",
          });
        });
      }
    } catch (err) {
      console.warn('[CalendarController] Could not fetch activities:', err);
    }
  },

  // ── Fetch the logged-in user's own recurring weekly class schedule ──
  // Teacher: from their teacher_class_assignments (via getMySubjects()).
  // Student: from getStudentWeeklySchedule(), scoped through their actual
  // section — never another section's schedule.
  // Admin: show class schedules across the academy.
  async _buildWeeklySchedule(user) {
    this._scheduleMap = {};
    if (!user) return;
    try {
      let entries = [];
      if (user.role === 'teacher') {
        entries = await api.getMySubjects();
      } else if (user.role === 'student') {
        entries = await api.getStudentWeeklySchedule();
      } else if (user.role === "admin") {
        entries = await api.getAdminCalendarSchedule();
      }
      for (const entry of entries) {
        const days = _parseScheduleDays(entry.schedule);
        for (const dow of days) {
          if (!this._scheduleMap[dow]) this._scheduleMap[dow] = [];
          this._scheduleMap[dow].push(entry);
        }
      }
    } catch (err) {
      console.warn('[CalendarController] Could not build weekly schedule:', err);
    }
  },

  _formatEventTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || !/[T ]\d{2}:\d{2}/.test(value)) return "";
    return date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  },

  // ── Render the calendar grid for the current month ──
  _render() {
    const year = this._viewYear;
    const month = this._viewMonth;
    const label = document.getElementById('cal-month-label');
    if (label) {
      label.textContent = this._viewMode === "week"
        ? this._weekLabel()
        : new Date(year, month, 1).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    }

    const gridBody = document.getElementById('cal-grid-body');
    const agendaBody = document.getElementById("cal-agenda-body");
    const grid = document.querySelector(".cal-grid");
    const agenda = this._viewMode === "agenda";
    if (gridBody) gridBody.innerHTML = agenda ? "" : this._renderCalendarCells();
    if (agendaBody) {
      agendaBody.hidden = !agenda;
      agendaBody.innerHTML = agenda ? this._renderAgenda() : "";
    }
    if (grid) grid.classList.toggle("cal-grid-agenda", agenda);
    document.querySelectorAll("[data-cal-view]").forEach(button => {
      const active = button.dataset.calView === this._viewMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (this._selectedDate) {
      this.selectDay(this._selectedDate);
    } else {
      const panel = document.getElementById("cal-day-panel");
      if (panel) {
        panel.innerHTML = `<div class="cal-day-empty"><span class="calendar-empty-icon">${CALENDAR_ICONS.calendar}</span><strong>Select a day</strong><span>Choose a date to see its schedule and to-dos.</span></div>`;
      }
    }
  },

  _weekStart(date) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    start.setDate(start.getDate() - start.getDay());
    return start;
  },

  _weekLabel() {
    const anchor = this._selectedDate
      ? new Date(`${this._selectedDate}T00:00:00`)
      : new Date();
    const start = this._weekStart(anchor);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const startLabel = start.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
    const endLabel = end.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
    return `${startLabel} – ${endLabel}`;
  },

  _eventsForDate(dateStr) {
    const dow = new Date(`${dateStr}T00:00:00`).getDay();
    const classes = (this._scheduleMap[dow] || []).map((entry, index) => ({
      id: `class-${entry.teacher_id || entry.subject_id || "schedule"}-${entry.section_id || entry.class_id || index}-${dateStr}`,
      date: dateStr,
      title: entry.subject_name || entry.subjects?.name || "Class",
      type: "class",
      schedule: entry.schedule || "",
      section_name: entry.section_name || entry.sections?.name || entry.class_name || "",
      grade_level: entry.grade_level || entry.classes?.grade_level || "",
      teacher_name: entry.teacher_name || "",
      _source: "schedule",
    }));
    return [...(this._eventMap[dateStr] || []), ...classes];
  },

  _eventTime(event) {
    if (event.time) return event.time;
    if (event.type !== "class" || !event.schedule) return "";
    const time = String(event.schedule).match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s*[-–]\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i);
    return time ? time[0].replace(/\s+/g, " ").trim() : "";
  },

  _eventMarkup(event, dateStr, compact = false) {
    const type = event.type === "activity-due"
      ? "activity"
      : event.type === "class"
        ? "class"
        : "event";
    const time = this._eventTime(event);
    const label = event.dateLabel || (event.type === "activity-due" ? "Due" : "");
    const meta = [time, label].filter(Boolean).join(" ");
    const title = event.type === "class"
      ? [event.title, event.section_name].filter(Boolean).join(" · ")
      : (event.title || _calTypeLabel(event.type));
    return `<button type="button" class="cal-event-chip cal-event-${type}${compact ? " cal-event-chip-compact" : ""}" title="${escHtml([meta, title].filter(Boolean).join(" · "))}" onclick="event.stopPropagation();CalendarController.selectDay('${dateStr}')">
      ${meta ? `<span class="cal-event-meta">${escHtml(meta)}</span>` : ""}
      <span class="cal-event-name">${escHtml(title)}</span>
    </button>`;
  },

  _renderCalendarCells() {
    const today = this._todayKey();
    let start;
    let count;
    if (this._viewMode === "week") {
      const anchor = this._selectedDate
        ? new Date(`${this._selectedDate}T00:00:00`)
        : new Date();
      start = this._weekStart(anchor);
      count = 7;
    } else {
      start = new Date(this._viewYear, this._viewMonth, 1);
      start.setDate(start.getDate() - start.getDay());
      count = Math.ceil((new Date(this._viewYear, this._viewMonth + 1, 0).getDate() + new Date(this._viewYear, this._viewMonth, 1).getDay()) / 7) * 7;
    }

    return Array.from({ length: count }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const dateStr = this._dateKey(date);
      const events = this._eventsForDate(dateStr);
      const isToday = dateStr === today;
      const isSelected = dateStr === this._selectedDate;
      const isOtherMonth = date.getMonth() !== this._viewMonth;
      const chips = events.slice(0, 3).map(event => this._eventMarkup(event, dateStr, true)).join("");
      const overflow = events.length > 3
        ? `<span class="cal-event-overflow">+${events.length - 3} more</span>`
        : "";
      return `<div role="gridcell" tabindex="0" aria-label="${escHtml(date.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}${events.length ? `, ${events.length} scheduled item${events.length === 1 ? "" : "s"}` : ""}" aria-pressed="${isSelected}" class="cal-cell${isToday ? " cal-today" : ""}${isSelected ? " cal-selected" : ""}${isOtherMonth && this._viewMode === "month" ? " cal-other-month" : ""}${events.length ? " cal-has-events" : ""}" data-date="${dateStr}" onclick="CalendarController.selectDay('${dateStr}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();CalendarController.selectDay('${dateStr}')}">
        <span class="cal-day-num">${date.getDate()}</span>
        <span class="cal-cell-events">${chips}${overflow}</span>
      </div>`;
    }).join("");
  },

  _renderAgenda() {
    const daysInMonth = new Date(this._viewYear, this._viewMonth + 1, 0).getDate();
    const today = this._todayKey();
    let rows = "";
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = this._dateKey(new Date(this._viewYear, this._viewMonth, day));
      const events = this._eventsForDate(dateStr);
      if (!events.length) continue;
      rows += `<div class="cal-agenda-day${dateStr === today ? " cal-today" : ""}" role="button" tabindex="0" onclick="CalendarController.selectDay('${dateStr}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();CalendarController.selectDay('${dateStr}')}">
        <span class="cal-agenda-date">${new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" })}</span>
        <span class="cal-agenda-events">${events.map(event => this._eventMarkup(event, dateStr)).join("")}</span>
      </div>`;
    }
    return rows || `<div class="cal-agenda-empty">No scheduled items this month.</div>`;
  },

  // ── Upcoming events strip (next 7 days from today) ──
  _renderUpcoming(user) {
    const container = document.getElementById('cal-upcoming-list');
    if (!container) return;

    const today = new Date();
    const items = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const evs = this._eventMap[key] || [];
      for (const ev of evs) items.push({ ...ev, date: key });
    }

    if (!items.length) {
      container.innerHTML = `<div style="font-size:12px;color:var(--gray-400);padding:4px 0">No upcoming events in the next 7 days.</div>`;
      return;
    }

    const dotColors = {
      'holiday':'#d4a017','meeting':'#1a4a8a','exam':'#8b0020',
      'activity-due':'#2e6b3e','announcement':'#c04a00','student-due':'#6d0019',
      'todo':'#888','class':'#555',
    };

    container.innerHTML = items.slice(0, 8).map(ev => {
      const color = dotColors[ev.type] || '#888';
      const label = _calTypeLabel(ev.type);
      return `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--gray-100)">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
          <div style="min-width:0">
            <div style="font-size:12px;font-weight:600;color:var(--gray-700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(ev.title || label)}</div>
            <div style="font-size:11px;color:var(--gray-400)">${ev.date} · ${label}</div>
          </div>
        </div>`;
    }).join('');
  },

  // ── Select a day and show its events in the right panel ──
  selectDay(dateStr) {
    const selected = new Date(`${dateStr}T00:00:00`);
    if (selected.getFullYear() !== this._viewYear || selected.getMonth() !== this._viewMonth) {
      this._viewYear = selected.getFullYear();
      this._viewMonth = selected.getMonth();
      this._selectedDate = dateStr;
      this._render();
    }
    this._selectedDate = dateStr;
    this._highlightSelected(dateStr);
    try {
      const user     = DashboardController.currentUser;
      const events   = this._eventsForDate(dateStr);
      const todos    = todoModel.getForUserDate(user.id, dateStr);
      const dow      = new Date(dateStr + 'T00:00:00').getDay();
      const classesToday = this._scheduleMap[dow] || [];
      this._renderDayPanel(dateStr, user, events, todos, classesToday);
    } catch (err) {
      // Surface the error directly in the panel instead of failing silently
      // — makes phone-only debugging possible without DevTools.
      console.error('[CalendarController] selectDay failed:', err);
      const panel = document.getElementById('cal-day-panel');
      if (panel) {
        panel.innerHTML = `<div style="padding:12px;background:#fdecec;border:1px solid #f5b5b5;border-radius:8px;color:#8b0020;font-size:12px;white-space:pre-wrap">⚠️ Calendar error — please screenshot this and send it back:\n\n${escHtml(err.message || String(err))}\n\n${escHtml(err.stack || '')}</div>`;
      }
    }
  },

  _highlightSelected(dateStr) {
    document.querySelectorAll(".cal-cell").forEach(cell => {
      const selected = cell.dataset.date === dateStr;
      cell.classList.toggle("cal-selected", selected);
      cell.setAttribute("aria-pressed", String(selected));
    });
  },

  // ── Render the right-hand day detail panel ──
  _renderDayPanel(dateStr, user, events, todos, classesToday = []) {
    const panel = document.getElementById('cal-day-panel');
    if (!panel) return;

    const dotColors = {
      'holiday':'#d4a017','meeting':'#1a4a8a','exam':'#8b0020',
      'activity-due':'#2e6b3e','announcement':'#c04a00','student-due':'#6d0019',
      'todo':'#888','class':'#555',
    };

    const canAddEvent = user.role === 'admin' || user.role === 'teacher';

    const classCards = classesToday.map(c => `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:var(--gray-50);border-radius:8px;border-left:3px solid ${dotColors['class']}">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--gray-700)">📘 ${escHtml(c.subject_name)}</div>
          <div style="font-size:11px;color:var(--gray-400);margin-top:2px">
            ${escHtml(c.section_name || '')}${c.grade_level ? ' · ' + escHtml(c.grade_level) : ''}
          </div>
          <div style="font-size:12px;color:var(--gray-500);margin-top:4px">⏰ ${escHtml(c.schedule || 'No time set')}</div>
          ${c.teacher_name ? `<div style="font-size:11px;color:var(--gray-400);margin-top:2px">👩‍🏫 ${escHtml(c.teacher_name)}</div>` : ''}
        </div>
      </div>`).join('');

    const nonClassEvents = events.filter(ev => ev.type !== "class");
    const eventCards = nonClassEvents.map(ev => {
      const color = dotColors[ev.type] || '#888';
      const isApi = ev._source === 'api'; // API events can't be deleted
      return `
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px;background:var(--gray-50);border-radius:8px;border-left:3px solid ${color}">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--gray-700)">${escHtml(ev.title || _calTypeLabel(ev.type))}</div>
            <div style="font-size:11px;color:var(--gray-400);margin-top:2px">${_calTypeLabel(ev.type)}</div>
            ${ev.description ? `<div style="font-size:12px;color:var(--gray-500);margin-top:4px">${escHtml(ev.description)}</div>` : ''}
          </div>
          ${!isApi && canAddEvent ? `<button class="btn btn-sm" style="font-size:11px;padding:2px 8px;background:#8b0020;color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="CalendarController.deleteEvent('${ev.id}')">✕</button>` : ''}
        </div>`;
    }).join('');

    const todoItems = todos.map(td => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--gray-100)">
        <input type="checkbox" ${td.done ? 'checked' : ''} onchange="CalendarController.toggleTodo('${td.id}','${dateStr}')" style="cursor:pointer;accent-color:#8b0020">
        <span style="flex:1;font-size:13px;color:var(--gray-700);${td.done ? 'text-decoration:line-through;opacity:.5' : ''}">${escHtml(td.text)}</span>
        <button onclick="CalendarController.deleteTodo('${td.id}','${dateStr}')" style="background:none;border:none;cursor:pointer;color:var(--gray-300);font-size:14px;padding:0 2px">✕</button>
      </div>`).join('');

    const prettyDate = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-PH', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    panel.innerHTML = `
      <div>
        <div style="font-size:15px;font-weight:700;color:var(--primary);margin-bottom:14px">${prettyDate}</div>

        ${classesToday.length || user.role !== 'admin' ? `
          <div style="font-size:12px;font-weight:600;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">📚 Classes</div>
          ${classesToday.length ? `
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">${classCards}</div>
          ` : `
            <div style="font-size:12px;color:var(--gray-400);margin-bottom:16px">No classes scheduled on this day.</div>
          `}
        ` : ''}

        ${nonClassEvents.length ? `
          <div style="font-size:12px;font-weight:600;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Events</div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">${eventCards}</div>
        ` : `
          <div style="font-size:12px;color:var(--gray-400);margin-bottom:16px">No events on this day.</div>
        `}

        ${canAddEvent ? `
          <button class="btn btn-outline btn-sm" style="margin-bottom:16px;width:100%" onclick="CalendarController.openAddEvent('${dateStr}')">+ Add Event</button>
        ` : ''}

        <div style="font-size:12px;font-weight:600;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">To-Do</div>
        <div id="todo-list-${dateStr}">${todoItems || '<div style="font-size:12px;color:var(--gray-400)">Nothing here yet.</div>'}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <input id="todo-input-${dateStr}" type="text" placeholder="Add a to-do…" style="flex:1;padding:6px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;outline:none"
            onkeydown="if(event.key==='Enter') CalendarController.addTodo('${dateStr}')">
          <button class="btn btn-sm" style="background:#8b0020;color:#fff;border:none;border-radius:8px;padding:6px 12px;cursor:pointer" onclick="CalendarController.addTodo('${dateStr}')">Add</button>
        </div>
      </div>`;
  },

  // ── To-Do CRUD ──
  toggleTodo(id, dateStr) {
    todoModel.toggle(id);
    this.selectDay(dateStr); // re-render panel
  },

  deleteTodo(id, dateStr) {
    todoModel.delete(id);
    this.selectDay(dateStr);
  },

  addTodo(dateStr) {
    const input = document.getElementById(`todo-input-${dateStr}`);
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    const user = DashboardController.currentUser;
    todoModel.add(user.id, text, dateStr);
    input.value = '';
    this.selectDay(dateStr);
  },

  // ── Calendar Event CRUD (admin/teacher) ──
  deleteEvent(id) {
    calendarModel.delete(id);
    if (this._selectedDate) {
      // Remove from in-memory map too
      const key = this._selectedDate;
      if (this._eventMap[key]) {
        this._eventMap[key] = this._eventMap[key].filter(e => e.id !== id);
      }
      this.selectDay(key);
    }
    this._render();
  },

  openAddEvent(dateStr) {
    // Build a simple inline modal
    const existing = document.getElementById('cal-add-event-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'cal-add-event-modal';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center`;
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:24px;width:min(340px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.18)">
        <div style="font-size:16px;font-weight:700;color:var(--primary);margin-bottom:16px">Add Event — ${dateStr}</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <input id="new-ev-title" placeholder="Title" style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;outline:none">
          <select id="new-ev-type" style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px">
            <option value="announcement">📢 Announcement</option>
            <option value="holiday">🎉 Holiday / No Class</option>
            <option value="exam">📝 Exam</option>
            <option value="meeting">🤝 Meeting</option>
            <option value="activity-due">⏰ Activity Due</option>
          </select>
          <textarea id="new-ev-desc" placeholder="Description (optional)" rows="2" style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;resize:vertical;outline:none"></textarea>
          <select id="new-ev-visibility" style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px">
            <option value="all">Visible to Everyone</option>
            <option value="teacher">Teachers Only</option>
            <option value="student">Students Only</option>
          </select>
          <div style="display:flex;gap:8px;margin-top:4px">
            <button onclick="CalendarController.saveEvent('${dateStr}')" style="flex:1;padding:9px;background:#8b0020;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Save</button>
            <button onclick="document.getElementById('cal-add-event-modal').remove()" style="flex:1;padding:9px;background:#eee;color:#333;border:none;border-radius:8px;font-size:13px;cursor:pointer">Cancel</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('new-ev-title').focus();
  },

  saveEvent(dateStr) {
    const title      = document.getElementById('new-ev-title')?.value.trim();
    const type       = document.getElementById('new-ev-type')?.value;
    const desc       = document.getElementById('new-ev-desc')?.value.trim();
    const visibility = document.getElementById('new-ev-visibility')?.value;

    if (!title) { alert('Please enter a title.'); return; }

    const ev = calendarModel.add({ date: dateStr, title, type, description: desc, visibility });
    document.getElementById('cal-add-event-modal')?.remove();

    // Merge into in-memory map
    if (!this._eventMap[dateStr]) this._eventMap[dateStr] = [];
    this._eventMap[dateStr].push(ev);

    this._render();
    this.selectDay(dateStr);
  },
};

function _calTypeLabel(type) {
  const map = {
    announcement:   '📢 Announcement',
    holiday:        '🎉 Holiday',
    exam:           '📝 Exam',
    meeting:        '🤝 Meeting',
    class:          '🏫 Class',
    'activity-due': '⏰ Due Date',
    'student-due':  '📌 Student Due Date',
    todo:           '✅ To-Do',
  };
  return map[type] || type;
}

// Parses the freeform "schedule" text stored on a teacher_class_assignments
// row (e.g. "MWF 4:00-5:00 PM (Room 101)", "TTh 12:00-1:00 PM (Library)",
// "Sat 2:00-3:00 PM (Room 202)") into an array of JS day-of-week numbers
// (0=Sun .. 6=Sat). Handles every token the Add/Edit Teacher form's Days
// dropdown produces (MWF, TTh, MTuWThF, MTuTh, WThF, Sat) and degrades
// gracefully on freeform text typed into the Edit form's schedule field.
function _parseScheduleDays(scheduleStr) {
  if (!scheduleStr) return [];
  const m = String(scheduleStr).match(/^[A-Za-z]+/);
  if (!m) return [];
  const s = m[0];

  // Longest tokens first so e.g. "Tue" isn't mis-split into "T" + "ue".
  const tokenMap = [
    ['Sun', 0], ['Sat', 6], ['Tue', 2], ['Thu', 4], ['Mon', 1], ['Wed', 3], ['Fri', 5],
    ['Su', 0], ['Sa', 6], ['Th', 4], ['Tu', 2],
    ['M', 1], ['W', 3], ['F', 5],
    ['T', 2], // bare "T" fallback = Tuesday, matching this app's "TTh" convention
  ];

  const days = [];
  let i = 0;
  while (i < s.length) {
    let matched = false;
    for (const [tok, dow] of tokenMap) {
      if (s.slice(i, i + tok.length).toLowerCase() === tok.toLowerCase()) {
        if (!days.includes(dow)) days.push(dow);
        i += tok.length;
        matched = true;
        break;
      }
    }
    if (!matched) i++; // skip anything unrecognized rather than getting stuck
  }
  return days;
}
