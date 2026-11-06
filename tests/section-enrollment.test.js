"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const transferMigration = fs.readFileSync(
  "supabase-migration/16_transfer_students_by_semester.sql",
  "utf8",
);
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
    if (this.table === "students") {
      return {
        data: { current_semester: this.db.currentSemester },
        error: null,
      };
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
        data: this.db.subjectEnrollments || [
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
  const db = {
    upserts: [],
    upsertError: null,
    currentSemester: null,
    subjectEnrollments: null,
    rpcCalls: [],
    rpcError: null,
  };
  const api = Object.create(context.LMSAdminAPITest.prototype);
  api._cache = new Map();
  api._myStudentId = async () => 11;
  api.sb = {
    from: table => new Query(db, table),
    rpc: async (name, args) => {
      if (name === "get_student_weekly_schedule") {
        return { data: [], error: null };
      }
      if (name === "get_student_active_subjects") {
        return {
          data: (db.subjectEnrollments || [
            { subject_id: 20 },
            { subject_id: 22 },
            { subject_id: 23 },
          ]).map(row => ({ subject_id: row.subject_id })),
          error: null,
        };
      }
      db.rpcCalls.push({ name, args });
      return db.rpcError
        ? { data: null, error: db.rpcError }
        : { data: { students_selected: 2, subjects_added: 4 }, error: null };
    },
  };
  return { api, db };
}

async function run() {
  assert.match(
    transferMigration,
    /coalesce\(subject\.semester::text,\s*''\)/,
    "transfer semester matching must support integer semester values and nulls",
  );
  assert.match(
    transferMigration,
    /assignment\.section_id\s*=\s*p_from_section_id/,
    "transfers must preserve source-section subjects as enrollments",
  );
  assert.match(
    transferMigration,
    /nullif\(trim\(coalesce\(subject\.semester::text,\s*''\)\),\s*''\)\s+is\s+null\s+then\s+'1st'/,
    "subjects without a semester must be included in first-semester transfers",
  );
  assert.match(
    transferMigration,
    /audit\.metadata\s*->>\s*'source'\s*=\s*'transfer_students_to_section_with_semester'/,
    "migration must repair enrollments for previously transferred students",
  );

  const { api, db } = createApi();
  const state = await api.getSectionSubjectEnrollmentState(3);
  assert.equal(state.studentCount, 2);
  assert.deepEqual(Array.from(state.assignedSubjectIds), [20, 21]);
  assert.equal(state.enrolledCounts[20], 2);
  assert.equal(state.enrolledCounts[22], 1);

  db.subjectEnrollments = [
    {
      student_id: 11,
      subject_id: 20,
      subjects: { id: 20, name: "First semester subject", semester: "1st" },
    },
    {
      student_id: 11,
      subject_id: 22,
      subjects: { id: 22, name: "Legacy subject", semester: null },
    },
    {
      student_id: 11,
      subject_id: 23,
      subjects: { id: 23, name: "Second semester subject", semester: "2nd" },
    },
    {
      student_id: 11,
      subject_id: 24,
      subjects: { id: 24, name: "Legacy formatted semester", semester: "First Semester" },
    },
  ];
  const firstSemesterSubjects = await api.getStudentSubjects("1st");
  assert.deepEqual(
    JSON.parse(JSON.stringify(firstSemesterSubjects.map(subject => subject.subject_id))),
    [20, 22, 24],
    "untagged and legacy-formatted first-semester subjects should remain visible",
  );
  const secondSemesterSubjects = await api.getStudentSubjects("2nd");
  assert.deepEqual(
    JSON.parse(JSON.stringify(secondSemesterSubjects.map(subject => subject.subject_id))),
    [23],
  );

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

  const transfer = await api.transferStudents({
    studentIds: [11, 12],
    fromSectionId: 3,
    toSectionId: 4,
    semester: "2nd",
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(db.rpcCalls[0])),
    {
      name: "transfer_students_to_section_with_semester",
      args: {
        p_student_ids: [11, 12],
        p_from_section_id: 3,
        p_to_section_id: 4,
        p_semester: "2nd",
      },
    },
  );
  assert.equal(transfer.subjects_added, 4);
  db.currentSemester = "2nd";
  assert.equal(await api.getStudentCurrentSemester(), "2nd");
  db.rpcError = { message: "function not found in schema cache", code: "PGRST202" };
  await assert.rejects(
    api.transferStudents({
      studentIds: [11],
      fromSectionId: 3,
      toSectionId: 4,
      semester: "1st",
    }),
    /semester transfer database function is missing or its schema cache is stale/,
  );

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
