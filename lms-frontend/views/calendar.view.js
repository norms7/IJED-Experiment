/* ============================================================
   views/calendar.view.js
   Pure render function for the Calendar section.
   ============================================================ */

"use strict";

const CALENDAR_ICONS = {
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 3v4M16 3v4M3 10h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const CalendarView = {
  render(user) {
    const roleLabel = {
      admin: "Administrator",
      teacher: "Teacher",
      student: "Student",
    }[user.role] || user.role;

    return `
      <section class="cal-page">
        <header class="cal-page-header">
          <div class="cal-page-heading">
            <span class="cal-page-icon">${CALENDAR_ICONS.calendar}</span>
            <div>
              <h2>Calendar</h2>
              <p>${escHtml(roleLabel)} schedule and upcoming dates</p>
            </div>
          </div>
          ${user.role === "admin" || user.role === "teacher" ? '<button class="btn btn-primary cal-add-event" onclick="CalendarController.openAddEvent(CalendarController._selectedDate || CalendarController._todayKey())">+ Add event</button>' : ""}
        </header>

        <div class="cal-toolbar">
          <div class="cal-date-controls">
            <h3 id="cal-month-label" class="cal-month-label"></h3>
            <button class="btn btn-outline btn-sm cal-today-button" onclick="CalendarController.today()">Today</button>
            <div class="cal-step-controls">
              <button class="btn btn-outline btn-sm" aria-label="Previous period" onclick="CalendarController.prev()">‹</button>
              <button class="btn btn-outline btn-sm" aria-label="Next period" onclick="CalendarController.next()">›</button>
            </div>
          </div>
          <div class="cal-view-switch" role="group" aria-label="Calendar view">
            <button class="cal-view-button" data-cal-view="week" onclick="CalendarController.setView('week')">Week</button>
            <button class="cal-view-button" data-cal-view="month" onclick="CalendarController.setView('month')">Month</button>
            <button class="cal-view-button" data-cal-view="agenda" onclick="CalendarController.setView('agenda')">Agenda</button>
          </div>
        </div>

        <div class="cal-legend" aria-label="Event types">
          <span><i class="cal-legend-dot cal-legend-activity"></i>Activities</span>
          <span><i class="cal-legend-dot cal-legend-class"></i>Classes</span>
          <span><i class="cal-legend-dot cal-legend-event"></i>Events</span>
        </div>

        <div class="cal-calendar-shell">
          <div class="cal-grid" role="grid" aria-label="Calendar dates">
            <div class="cal-dow" role="columnheader">Sun</div>
            <div class="cal-dow" role="columnheader">Mon</div>
            <div class="cal-dow" role="columnheader">Tue</div>
            <div class="cal-dow" role="columnheader">Wed</div>
            <div class="cal-dow" role="columnheader">Thu</div>
            <div class="cal-dow" role="columnheader">Fri</div>
            <div class="cal-dow" role="columnheader">Sat</div>
            <div id="cal-grid-body" class="cal-grid-body"></div>
          </div>
          <div id="cal-agenda-body" class="cal-agenda-body" hidden></div>
        </div>

        <section class="card cal-day-card" aria-live="polite">
          <div id="cal-day-panel" class="cal-day-panel">
            <div class="cal-day-empty">
              <span class="calendar-empty-icon">${CALENDAR_ICONS.calendar}</span>
              <strong>Select a day</strong>
              <span>Choose a date to see its schedule and to-dos.</span>
            </div>
          </div>
        </section>
      </section>`;
  },
};
