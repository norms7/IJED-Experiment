"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const controllerSource = fs.readFileSync(
  "lms-frontend/controllers/calendar.controller.js",
  "utf8",
) + "\nglobalThis.CalendarControllerTest = CalendarController;";
const context = {
  DashboardController: { currentUser: { id: 1, role: "student" } },
  escHtml: value => String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]),
  document: {
    getElementById() { return null; },
    querySelectorAll() { return []; },
  },
};
vm.runInNewContext(controllerSource, context);

const calendar = context.CalendarControllerTest;
assert.deepEqual(
  Array.from(context._parseScheduleDays("MWF 4:00-5:00 PM")),
  [1, 3, 5],
);
assert.deepEqual(
  Array.from(context._parseScheduleDays("TTh 12:00-1:00 PM")),
  [2, 4],
);
assert.deepEqual(
  Array.from(context._parseScheduleDays("Sat 2:00-3:00 PM")),
  [6],
);

calendar._scheduleMap = {
  1: [{ subject_name: "Math", section_name: "G11-A", schedule: "MWF 4:00-5:00 PM" }],
  3: [{ subject_name: "Science", section_name: "G11-B", schedule: "MWF 4:00-5:00 PM" }],
};
calendar._eventMap = {
  "2026-10-05": [{
    id: "due-1",
    title: "Quiz 1",
    type: "activity-due",
    dateLabel: "Due",
    time: "5:00 PM",
  }],
};

assert.deepEqual(
  Array.from(calendar._eventsForDate("2026-10-05"), event => event.title),
  ["Quiz 1", "Math"],
);
assert.deepEqual(
  Array.from(calendar._eventsForDate("2026-10-07"), event => event.title),
  ["Science"],
);
assert.deepEqual(
  Array.from(calendar._eventsForDate("2026-10-06"), event => event.title),
  [],
);
assert.equal(calendar._calendarDateKey("2026-10-05"), "2026-10-05");
assert.equal(calendar._calendarDateKey("invalid"), null);

calendar._viewYear = 2026;
calendar._viewMonth = 9;
calendar._viewMode = "month";
assert.equal(
  (calendar._renderCalendarCells().match(/role="gridcell"/g) || []).length,
  35,
);
calendar._viewMode = "week";
calendar._selectedDate = "2026-10-05";
assert.equal(
  (calendar._renderCalendarCells().match(/role="gridcell"/g) || []).length,
  7,
);

const viewSource = fs.readFileSync(
  "lms-frontend/views/calendar.view.js",
  "utf8",
) + "\nglobalThis.CalendarViewTest = CalendarView;";
vm.runInNewContext(viewSource, context);
const studentHtml = context.CalendarViewTest.render({
  role: "student",
  name: "Student",
});
const adminHtml = context.CalendarViewTest.render({
  role: "admin",
  name: "Admin",
});
assert.match(studentHtml, /data-cal-view="month"/);
assert.match(studentHtml, /cal-grid-body/);
assert.doesNotMatch(studentHtml, /Add event/);
assert.match(adminHtml, /CalendarController\.openAddEvent/);

async function verifyCalendarApi() {
  const apiSource = fs.readFileSync(
    "lms-frontend/assets/js/lms-supabase-api.js",
    "utf8",
  ).replace(
    "const api = new LMSAdminAPI();",
    "globalThis.LMSAdminAPITest = LMSAdminAPI;",
  );
  const apiContext = { Map };
  vm.runInNewContext(apiSource, apiContext);
  const api = Object.create(apiContext.LMSAdminAPITest.prototype);
  api._throwIfError = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  api.getTeacherActivities = async () => [{ title: "Teacher activity" }];
  api.getStudentActivities = async () => [{ title: "Student activity" }];
  assert.equal((await api.getCalendarActivities("teacher"))[0].title, "Teacher activity");
  assert.equal((await api.getCalendarActivities("student"))[0].title, "Student activity");
  assert.equal((await api.getCalendarActivities("unknown")).length, 0);
  api.sb = {
    from(table) {
      assert.equal(table, "activities");
      return {
        select(columns) {
          assert.match(columns, /start_date, due_date/);
          return {
            order: async () => ({ data: [{ title: "Admin activity" }], error: null }),
          };
        },
      };
    },
  };
  assert.equal((await api.getCalendarActivities("admin"))[0].title, "Admin activity");
  api.sb = {
    from(table) {
      assert.equal(table, "teacher_class_assignments");
      return {
        select: async () => ({
          data: [{
            subject_id: 3,
            schedule: "MWF 4:00-5:00 PM",
            subjects: { name: "Science" },
            classes: { name: "G11 Science", grade_level: "Grade 11" },
            sections: { name: "G11-A" },
            teachers: { users: { first_name: "Alex", last_name: "Teacher" } },
          }],
          error: null,
        }),
      };
    },
  };
  const adminSchedule = await api.getAdminCalendarSchedule();
  assert.equal(adminSchedule[0].subject_name, "Science");
  assert.equal(adminSchedule[0].section_name, "G11-A");
  assert.equal(adminSchedule[0].teacher_name, "Alex Teacher");
}

verifyCalendarApi().then(
  () => console.log("Calendar scheduling, dates, views, and role controls passed."),
  error => {
    console.error(error);
    process.exitCode = 1;
  },
);
