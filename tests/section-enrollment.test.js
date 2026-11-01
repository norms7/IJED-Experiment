"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const apiSource = fs.readFileSync(
  "lms-frontend/assets/js/lms-supabase-api.js",
  "utf8",
).replace(
  "const api = new LMSAdminAPI();",
  "globalThis.LMSAdminAPITest = LMSAdminAPI;",
);
const context = { Map };
vm.runInNewContext(apiSource, context);

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.action = "select";
    this.payload = null;
  }

  select() { return this; }
  eq() { return this; }
  in() { return this; }
  insert(payload) {
    this.action = "insert";
    this.payload = payload;
    return this;
  }
  upsert(payload, options) {
    this.action = "upsert";
    this.payload = payload;
    this.options = options;
    return this;
  }
  single() { return Promise.resolve(this.result()); }
  then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); }

  result() {
    if (this.action === "upsert") {
      this.db.upserts.push({
        table: this.table,
        payload: this.payload,
        options: this.options,
      });
      if (this.db.upsertError) {
        return { data: null, error: { message: this.db.upsertError } };
      }
      return { data: [], error: null };
    }
    if (this.table === "student_section_assignments") {
      return { data: [{ student_id: 11 }, { student_id: 12 }], error: null };
    }
    if (this.table === "teacher_class_assignments") {
      if (this.action === "insert") {
        return { data: { id: 8 }, error: null };
      }
      return { data: [{ subject_id: 20 }, { subject_id: 21 }], error: null };
    }
    if (this.table === "student_subject_enrollments") {
      return {
        data: [
          { student_id: 11, subject_id: 20 },
          { student_id: 12, subject_id: 20 },
          { student_id: 11, subject_id: 22 },
        ],
        error: null,
      };
    }
    return { data: [], error: null };
  }
}

function createApi() {
  const db = { upserts: [], upsertError: null };
  const api = Object.create(context.LMSAdminAPITest.prototype);
  api._cache = new Map();
  api.sb = { from: table => new Query(db, table) };
  return { api, db };
}

async function run() {
  const { api, db } = createApi();
  const state = await api.getSectionSubjectEnrollmentState(3);
  assert.equal(state.studentCount, 2);
  assert.deepEqual(Array.from(state.assignedSubjectIds), [20, 21]);
  assert.equal(state.enrolledCounts[20], 2);
  assert.equal(state.enrolledCounts[22], 1);

  const enrollment = await api.enrollSectionStudentsInSubjects(3, [20, 21, 20]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(enrollment)),
    { studentCount: 2, subjectCount: 2 },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(db.upserts[0].payload)),
    [
      { student_id: 11, subject_id: 20 },
      { student_id: 11, subject_id: 21 },
      { student_id: 12, subject_id: 20 },
      { student_id: 12, subject_id: 21 },
    ],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(db.upserts[0].options)),
    { onConflict: "student_id,subject_id", ignoreDuplicates: true },
  );

  await api.assignTeacherToClass({
    teacher_id: 6,
    class_id: 4,
    section_id: 3,
    subject_id: 20,
  });
  assert.equal(db.upserts.length, 2);
  assert.equal(db.upserts[1].payload.length, 2);

  db.upsertError = "permission denied";
  await assert.rejects(
    api.addStudentSubjects(11, [20]),
    /permission denied/,
  );

  console.log("Section enrollment and teacher-assignment sync tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
