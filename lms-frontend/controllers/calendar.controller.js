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

  init() {
    const now = new Date();
    if (this._viewYear  === null) this._viewYear  = now.getFullYear();
    if (this._viewMonth === null) this._viewMonth = now.getMonth();
    // Return the promise so callers (dashboard controller) can .finally() on it
    return this._buildActivityEvents(DashboardController.currentUser).then(() => {
      this._render();
    });
  },

  prev() {
    if (this._viewMonth === 0) { this._viewMonth = 11; this._viewYear--; }
    else this._viewMonth--;
    this._render();
  },

  next() {
    if (this._viewMonth === 11) { this._viewMonth = 0; this._viewYear++; }
    else this._viewMonth++;
    this._render();
  },

  // ── Fetch activity due-dates from the API and merge with localStorage events ──
  async _buildActivityEvents(user) {
    if (!user) return;
    this._eventMap = {};

    // 1. Load persisted events from localStorage (announcements, holidays, exams, etc.)
    const storedEvents = calendarModel.getForUser(user.id, user.role);
    for (const ev of storedEvents) {
      if (!ev.date) continue;
      if (!this._eventMap[ev.date]) this._eventMap[ev.date] = [];
      this._eventMap[ev.date].push(ev);
    }

    // 2. Pull activity due-dates from the backend (role-aware)
    try {
      let activities = [];
      if (user.role === 'teacher') {
        const res = await api.getTeacherActivities();
        activities = Array.isArray(res) ? res : (res?.activities || []);
      } else if (user.role === 'student') {
        const res = await api.getStudentActivities();
        activities = Array.isArray(res) ? res : (res?.activities || []);
      }
      // admin has no activity feed — skip

      for (const act of activities) {
        if (!act.due_date) continue;
        // due_date may be ISO string: "2026-05-30T00:00:00" — keep only YYYY-MM-DD
        const dateKey = act.due_date.slice(0, 10);
        if (!this._eventMap[dateKey]) this._eventMap[dateKey] = [];
        this._eventMap[dateKey].push({
          id:         'api-act-' + act.id,
          date:       dateKey,
          title:      act.title || 'Activity Due',
          type:       'activity-due',
          visibility: 'all',
          _source:    'api',
        });
      }
    } catch (err) {
      console.warn('[CalendarController] Could not fetch activities:', err);
    }
  },

  // ── Render the calendar grid for the current month ──
  _render() {
    const user  = DashboardController.currentUser;
    const year  = this._viewYear;
    const month = this._viewMonth;

    // Update month label
    const label = document.getElementById('cal-month-label');
    if (label) {
      label.textContent = new Date(year, month, 1).toLocaleDateString('en-PH', {
        month: 'long', year: 'numeric'
      });
    }

    // Build grid cells
    const firstDay = new Date(year, month, 1).getDay(); // 0 = Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date().toISOString().slice(0, 10);

    let cells = '';
    // Empty cells before the 1st
    for (let i = 0; i < firstDay; i++) {
      cells += `<div class="cal-cell cal-empty"></div>`;
    }
    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const events  = this._eventMap[dateStr] || [];
      const isToday = dateStr === today;
      const isSel   = dateStr === this._selectedDate;

      // Dot indicators (up to 3 distinct types)
      const dotColors = {
        'holiday':      '#d4a017',
        'meeting':      '#1a4a8a',
        'exam':         '#8b0020',
        'activity-due': '#2e6b3e',
        'announcement': '#c04a00',
        'student-due':  '#6d0019',
        'todo':         '#888',
        'class':        '#555',
      };
      const seenTypes = [...new Set(events.map(e => e.type))].slice(0, 3);
      const dots = seenTypes.map(t =>
        `<span style="width:6px;height:6px;border-radius:50%;background:${dotColors[t] || '#888'};display:inline-block;margin:0 1px"></span>`
      ).join('');

      cells += `
        <div class="cal-cell${isToday ? ' cal-today' : ''}${isSel ? ' cal-selected' : ''}"
             onclick="CalendarController.selectDay('${dateStr}')"
             data-date="${dateStr}">
          <span class="cal-day-num">${d}</span>
          ${dots ? `<div style="display:flex;justify-content:center;gap:2px;margin-top:2px">${dots}</div>` : ''}
        </div>`;
    }

    const gridBody = document.getElementById('cal-grid-body');
    if (gridBody) gridBody.innerHTML = cells;

    // Re-highlight selected if still in same month
    if (this._selectedDate) this._highlightSelected(this._selectedDate);

    // Render upcoming events (next 7 days)
    this._renderUpcoming(user);
  },

  // ── Re-apply selected class after grid rebuild ──
  _highlightSelected(dateStr) {
    document.querySelectorAll('.cal-cell').forEach(el => {
      el.classList.toggle('cal-selected', el.dataset.date === dateStr);
    });
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
    this._selectedDate = dateStr;
    this._highlightSelected(dateStr);
    const user     = DashboardController.currentUser;
    const events   = this._eventMap[dateStr] || [];
    const todos    = todoModel.getForUserDate(user.id, dateStr);
    this._renderDayPanel(dateStr, user, events, todos);
  },

  // ── Render the right-hand day detail panel ──
  _renderDayPanel(dateStr, user, events, todos) {
    const panel = document.getElementById('cal-day-panel');
    if (!panel) return;

    const dotColors = {
      'holiday':'#d4a017','meeting':'#1a4a8a','exam':'#8b0020',
      'activity-due':'#2e6b3e','announcement':'#c04a00','student-due':'#6d0019',
      'todo':'#888','class':'#555',
    };

    const canAddEvent = user.role === 'admin' || user.role === 'teacher';

    const eventCards = events.map(ev => {
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

        ${events.length ? `
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
      <div style="background:#fff;border-radius:12px;padding:24px;width:340px;box-shadow:0 8px 32px rgba(0,0,0,.18)">
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