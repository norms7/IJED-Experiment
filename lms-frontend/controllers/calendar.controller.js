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

  // ── Fetch the logged-in user's own recurring weekly class schedule ──
  // Teacher: from their teacher_class_assignments (via getMySubjects()).
  // Student: from getStudentWeeklySchedule(), scoped through their actual
  // section — never another section's schedule.
  // Admin: no personal teaching schedule — left empty.
  async _buildWeeklySchedule(user) {
    this._scheduleMap = {};
    if (!user) return;
    try {
      let entries = [];
      if (user.role === 'teacher') {
        entries = await api.getMySubjects();
      } else if (user.role === 'student') {
        entries = await api.getStudentWeeklySchedule();
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
      const dow     = new Date(year, month, d).getDay();
      const classesToday = this._scheduleMap[dow] || [];
      const hasClass = classesToday.length > 0;

      // Dot indicators (up to 3 distinct types) — a recurring class counts
      // as a "class" dot alongside any one-off events that day.
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
      const types = events.map(e => e.type);
      if (hasClass) types.unshift('class');
      const seenTypes = [...new Set(types)].slice(0, 3);
      const dots = seenTypes.map(t =>
        `<span style="width:6px;height:6px;border-radius:50%;background:${dotColors[t] || '#888'};display:inline-block;margin:0 1px"></span>`
      ).join('');

      cells += `
        <div class="cal-cell${isToday ? ' cal-today' : ''}${isSel ? ' cal-selected' : ''}${hasClass ? ' cal-has-class' : ''}"
             onclick="CalendarController.selectDay('${dateStr}')"
             data-date="${dateStr}"
             ${hasClass ? `title="${classesToday.length} class(es) scheduled"` : ''}>
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
    try {
      const user     = DashboardController.currentUser;
      const events   = this._eventMap[dateStr] || [];
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
          ${user.role === 'student' && c.teacher_name ? `<div style="font-size:11px;color:var(--gray-400);margin-top:2px">👩‍🏫 ${escHtml(c.teacher_name)}</div>` : ''}
        </div>
      </div>`).join('');

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

        ${user.role !== 'admin' ? `
          <div style="font-size:12px;font-weight:600;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">📚 Classes Today</div>
          ${classesToday.length ? `
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">${classCards}</div>
          ` : `
            <div style="font-size:12px;color:var(--gray-400);margin-bottom:16px">No classes scheduled on this day.</div>
          `}
        ` : ''}

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
