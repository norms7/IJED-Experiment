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
  constructor(table, calls) {
    this.table = table;
    this.calls = calls;
    this.filters = [];
    this.calls.push(this);
  }

  select() { return this; }
  eq(column, value) {
    this.filters.push(["eq", column, value]);
    return this;
  }
  in(column, values) {
    this.filters.push(["in", column, values]);
    return this;
  }
  order() { return this; }

  then(resolve, reject) {
    let data = {
      student_subject_enrollments: [{ subject_id: 9 }],
      student_section_assignments: [{ section_id: 102 }],
      modules: [
        { id: 501, subject_id: 9, section_id: 101, is_published: true },
        { id: 502, subject_id: 9, section_id: 102, is_published: true },
      ],
      student_module_reads: [],
      activities: [
        { id: 701, subject_id: 9, module_id: 501, is_published: false },
        { id: 702, subject_id: 9, module_id: 502, is_published: true },
      ],
      activity_submissions: [{
        id: 801,
        activity_id: 701,
        student_id: 55,
        is_graded: true,
        score: 8,
        max_score: 10,
        submitted_at: "2025-01-01T00:00:00Z",
      }],
    }[this.table] || [];
    data = data.filter(row => this.filters.every(([operator, column, value]) =>
      operator === "eq"
        ? row[column] === value
        : value.includes(row[column]),
    ));
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  }
}

async function run() {
  const calls = [];
  const api = Object.create(context.LMSAdminAPITest.prototype);
  api._cache = new Map();
  api._myStudentId = async () => 55;
  api._throwIfError = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  api.sb = {
    from: table => new Query(table, calls),
    rpc: async name => {
      if (name === "get_student_active_subjects") {
        return { data: [{ subject_id: 9 }], error: null };
      }
      if (name === "get_student_weekly_schedule") {
        return { data: [], error: null };
      }
      if (name === "get_student_archive_context") {
        return {
          data: [{
            section_id: 101,
            section_name: "Former section",
            class_name: "Grade 10",
            subject_id: 9,
            subject_name: "Subject 9",
            semester: "1st",
          }],
          error: null,
        };
      }
      return { data: [], error: null };
    },
  };

  const modules = await api.getStudentModules();
  assert.deepEqual(
    JSON.parse(JSON.stringify(modules.map(module => module.id))),
    [502],
  );
  const moduleQuery = calls.find(query => query.table === "modules");
  assert.ok(moduleQuery.filters.some(filter =>
    filter[1] === "section_id" && filter[2].includes(102),
  ));

  const activities = await api.getStudentActivities();
  assert.deepEqual(
    JSON.parse(JSON.stringify(activities.map(activity => activity.id))),
    [702],
  );
  const activityQuery = calls.find(query => query.table === "activities");
  assert.ok(activityQuery.filters.some(filter =>
    filter[1] === "module_id" && filter[2].includes(502),
  ));

  api._cache.clear();
  const archive = await api.getStudentArchive();
  assert.deepEqual(
    JSON.parse(JSON.stringify(archive.modules.map(module => module.id))),
    [501],
    "previous-section modules should appear only in the archive",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(archive.activities.map(activity => activity.id))),
    [701],
  );
  assert.equal(archive.activities[0].is_published, false);
  assert.equal(archive.activities[0].submission.id, 801);

  const migration = fs.readFileSync(
    "supabase-migration/12_section_scoped_learning_content.sql",
    "utf8",
  );
  assert.match(migration, /add column if not exists section_id integer references public\.sections/);
  assert.match(migration, /having count\(distinct tca\.section_id\) = 1/);
  assert.match(migration, /create policy modules_select/);
  const transferMigration = fs.readFileSync(
    "supabase-migration/16_transfer_students_by_semester.sql",
    "utf8",
  );
  assert.match(transferMigration, /create or replace function public\.student_can_access_module/);
  assert.match(transferMigration, /transfer\.changed_fields #>> '\{section_id,old\}' = module\.section_id::text/);
  const archiveMigration = fs.readFileSync(
    "supabase-migration/17_student_archive.sql",
    "utf8",
  );
  assert.match(archiveMigration, /create or replace function public\.get_student_active_subjects/);
  assert.match(archiveMigration, /create or replace function public\.get_student_archive_context/);
  assert.match(archiveMigration, /create or replace function public\.get_my_attendance_history/);
  assert.match(archiveMigration, /drop policy if exists activities_select on public\.activities/);
  assert.match(archiveMigration, /submission\.student_id = public\.auth_student_id\(\)/);
  assert.match(archiveMigration, /drop policy if exists activity_files_select on storage\.objects/);
  assert.match(archiveMigration, /This activity is archived and read-only/);
  const dashboardController = fs.readFileSync(
    "lms-frontend/controllers/dashboard.controller.js",
    "utf8",
  );
  const studentController = fs.readFileSync(
    "lms-frontend/controllers/student.controller.js",
    "utf8",
  );
  const studentView = fs.readFileSync(
    "lms-frontend/views/student.view.js",
    "utf8",
  );
  assert.doesNotMatch(dashboardController, /id:\s*"archive"/);
  assert.doesNotMatch(dashboardController, /sectionId === "archive"/);
  assert.match(dashboardController, /StudentView\.mySubjects\(subjects, modules, activities, currentSem, archive\)/);
  assert.match(dashboardController, /StudentView\.archiveHistory\(\{/);
  assert.match(studentController, /StudentView\.archiveHistory\(\{/);
  assert.match(studentView, /Previous section records/);
  assert.match(migration, /create policy activities_select/);
  assert.match(migration, /student_can_access_module\(a\.module_id\)/);
  assert.match(migration, /activity_submissions_section_guard/);
  assert.match(migration, /activity_files_select/);

  console.log("Section-scoped student content tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
