"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const storage = new Map();
let now = 1_000;
let intervalCallback = null;
let intervalCleared = false;
let autoSubmitted = null;
const timerDisplay = { textContent: "" };
const submitButton = { disabled: false };

class TestDate extends Date {
  static now() { return now; }
}

const studentSource = fs.readFileSync(
  "lms-frontend/controllers/student.controller.js",
  "utf8",
).replace(
  "const StudentController =",
  "globalThis.StudentController =",
);
const studentContext = {
  Date: TestDate,
  Map,
  document: {
    getElementById(id) {
      if (id === "activity-timer") return timerDisplay;
      if (id === "submit-activity-btn") return submitButton;
      return null;
    },
  },
  sessionStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  },
  setInterval(callback) {
    intervalCallback = callback;
    return 1;
  },
  clearInterval() { intervalCleared = true; },
  console,
};
vm.runInNewContext(studentSource, studentContext);

const controller = studentContext.StudentController;
controller.confirmSubmit = (activityId, options) => {
  autoSubmitted = { activityId, options };
};
controller._startActivityTimer({
  id: 42,
  grading_mode: "auto",
  timer_minutes: 1,
});
assert.equal(timerDisplay.textContent, "01:00");
assert.equal(storage.get("ijed_activity_timer_42"), "1000");

now = 61_000;
intervalCallback();
assert.equal(timerDisplay.textContent, "00:00");
assert.equal(intervalCleared, true);
assert.deepEqual(
  JSON.parse(JSON.stringify(autoSubmitted)),
  { activityId: 42, options: { timedOut: true } },
);

intervalCallback = null;
controller._startActivityTimer({
  id: 43,
  grading_mode: "manual",
  timer_minutes: 5,
});
assert.equal(intervalCallback, null);
assert.equal(storage.has("ijed_activity_timer_43"), false);
assert.equal(controller._formatActivityTime(3_661), "01:01:01");

const viewSource = fs.readFileSync(
  "lms-frontend/views/student.view.js",
  "utf8",
).replace(
  "const StudentView =",
  "globalThis.StudentView =",
);
const viewContext = {
  escHtml: value => String(value),
  lmsIcon: () => "",
};
vm.runInNewContext(viewSource, viewContext);
const answerSheet = viewContext.StudentView.activityAnswerSheet({
  id: 42,
  title: "Timed quiz",
  grading_mode: "auto",
  timer_minutes: 60,
  questions: [],
});
assert.match(answerSheet, /id="activity-timer"/);
assert.match(answerSheet, />01:00:00<\/span>/);

const teacherSource = fs.readFileSync(
  "lms-frontend/controllers/teacher.controller.js",
  "utf8",
).replace(
  "const TeacherController =",
  "globalThis.TeacherController =",
);
const formValues = {
  "act-title": "Timed quiz",
  "act-subject": "9:101",
  "act-term": "1st",
  "act-module": "501",
  "act-type": "quiz",
  "act-format": "multiple_choice",
  "act-start": "2026-01-01T10:00",
  "act-due": "2026-01-01T11:00",
  "act-instructions": "Answer all questions.",
  "act-timer": "1441",
};
const teacherContext = {
  document: {
    getElementById: id => id === "act-allow-late"
      ? { checked: false }
      : { value: formValues[id] ?? "" },
  },
};
vm.runInNewContext(teacherSource, teacherContext);
const teacher = teacherContext.TeacherController;
assert.equal(
  teacher._activityValidationMessage(),
  "Enter a whole-number time limit from 1 to 1440 minutes.",
);
formValues["act-timer"] = "15";
teacher._questions = [];
assert.equal(teacher._activityValidationMessage(), "Please add at least one question.");
formValues["act-format"] = "hybrid";
formValues["act-timer"] = "1441";
assert.equal(teacher._activityValidationMessage(), "Please add at least one question.");

const migration = fs.readFileSync(
  "supabase-migration/13_activity_timers.sql",
  "utf8",
);
assert.match(migration, /add column if not exists timer_minutes integer/);

console.log("Activity timer behavior tests passed.");
