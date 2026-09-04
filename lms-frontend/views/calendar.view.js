/* ============================================================
   views/calendar.view.js
   Pure render function for the Calendar section.
   No direct DOM manipulation; CalendarController handles that.
   ============================================================ */

"use strict";

const CALENDAR_ICONS = {
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 3v4M16 3v4M3 10h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 20c.7-3.5 3-5.2 7-5.2s6.3 1.7 7 5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v6l9 9 7-7-9-9H4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="9" r="1" fill="currentColor"/></svg>',
};

const CalendarView = {
  render(user) {
    const roleLabel  = { admin: 'Administrator', teacher: 'Teacher', student: 'Student' }[user.role] || user.role;
    const roleColors = {
      admin:   { bg: '#fde8ec', color: '#8b0020' },
      teacher: { bg: '#e8f0fa', color: '#1a4a8a' },
      student: { bg: '#e6f4ea', color: '#2e6b3e' },
    };
    const rc = roleColors[user.role] || roleColors.student;

    const eventTypeLegend = [
      ['#555',    'Class (your schedule)'],
      ['#d4a017', 'Holiday / No Class'],
      ['#1a4a8a', 'Meeting'],
      ['#8b0020', 'Exam'],
      ['#2e6b3e', 'Activity Due'],
      ['#c04a00', 'Announcement'],
      ['#6d0019', 'Student Due Date'],
    ].map(([c, l]) =>
      `<span style="display:flex;align-items:center;gap:5px;font-size:12px">
         <span style="width:10px;height:10px;border-radius:50%;background:${c};flex-shrink:0;display:inline-block"></span>
         ${l}
       </span>`
    ).join('');

    return `
      <div class="cal-page">
          <div class="cal-left" style="min-width:0">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;background:${rc.bg};border-radius:10px;padding:10px 14px">
            <span class="calendar-role-icon">${CALENDAR_ICONS.user}</span>
            <div>
              <div style="font-weight:700;font-size:14px;color:${rc.color}">${escHtml(user.name)}</div>
              <div style="font-size:12px;color:${rc.color};opacity:.8;text-transform:capitalize">${roleLabel} Calendar</div>
            </div>
          </div>

          <div class="card" style="margin-bottom:14px">
            <div class="cal-nav">
              <button class="btn btn-outline btn-sm" onclick="CalendarController.prev()">‹</button>
              <span id="cal-month-label" style="font-weight:700;font-size:16px"></span>
              <button class="btn btn-outline btn-sm" onclick="CalendarController.next()">›</button>
            </div>
            <div class="cal-grid">
              <div class="cal-dow">Sun</div>
              <div class="cal-dow">Mon</div>
              <div class="cal-dow">Tue</div>
              <div class="cal-dow">Wed</div>
              <div class="cal-dow">Thu</div>
              <div class="cal-dow">Fri</div>
              <div class="cal-dow">Sat</div>
              <div id="cal-grid-body" style="display:contents"></div>
            </div>
          </div>

          <div class="card" style="margin-bottom:14px">
            <div class="card-header"><div class="card-title calendar-card-title"><span>${CALENDAR_ICONS.clock}</span> Upcoming</div></div>
            <div id="cal-upcoming-list" style="padding:10px 14px;display:flex;flex-direction:column;gap:8px"></div>
          </div>

          <div class="card">
            <div class="card-header"><div class="card-title calendar-card-title"><span>${CALENDAR_ICONS.tag}</span> Event Types</div></div>
            <div style="padding:12px 16px;display:flex;flex-wrap:wrap;gap:8px">${eventTypeLegend}</div>
          </div>
        </div>

        <div class="cal-right">
          <div class="card" style="min-height:280px">
            <div id="cal-day-panel" style="padding:20px;overflow-y:auto;max-height:75vh">
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;color:var(--gray-400);text-align:center;gap:10px">
                <div class="calendar-empty-icon">${CALENDAR_ICONS.calendar}</div>
                <div style="font-size:14px;font-weight:600;color:var(--gray-600)">Select a day</div>
                <div style="font-size:12px">Tap any date on the calendar to see events</div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  },
};
