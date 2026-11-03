"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const elements = {
  "att-date": { value: "2026-11-03" },
  "att-term": { value: "2nd" },
  "att-notes": { value: "" },
  "att-subject": { value: "42" },
};
let savedPayload;
let renderedFilters;
const context = vm.createContext({
  document: {
    getElementById: id => elements[id] || null,
    querySelector: selector => selector === 'input[name="att_has_class"]:checked'
      ? { value: "yes" }
      : null,
  },
  api: {
    createAttendanceSession: async payload => {
      savedPayload = payload;
    },
  },
  Modal: { close() {} },
  Toast: { show() {} },
  console,
});

vm.runInContext(
  fs.readFileSync("lms-frontend/controllers/attendance.controller.js", "utf8"),
  context,
);

const controller = vm.runInContext("AttendanceController", context);
controller._currentSectionId = 7;
controller._currentSubjectId = 13;
controller._currentTerm = "1st";
controller._renderSectionDetail = async function () {
  renderedFilters = {
    subjectId: this._currentSubjectId,
    term: this._currentTerm,
  };
};

controller.saveAttendance().then(() => {
  assert.equal(savedPayload.term, "2nd");
  assert.equal(savedPayload.subject_id, 42);
  assert.deepEqual(renderedFilters, { subjectId: 42, term: "2nd" });
  console.log("Attendance save reloads the history using the saved subject and term.");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
