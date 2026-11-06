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
    const data = {
      student_subject_enrollments: [{ subject_id: 9 }],
      student_section_assignments: [{ section_id: 102 }],
      modules: [{ id: 501, subject_id: 9, section_id: 101 }],
      student_module_reads: [],
      activities: [{ id: 701, subject_id: 9, module_id: 501 }],
      activity_submissions: [],
    }[this.table] || [];
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
  api.sb = { from: table => new Query(table, calls) };

  const modules = await api.getStudentModules();
  assert.deepEqual(
    JSON.parse(JSON.stringify(modules.map(module => module.id))),
    [501],
  );
  const moduleQuery = calls.find(query => query.table === "modules");
  assert.ok(!moduleQuery.filters.some(filter => filter[1] === "section_id"));

  const activities = await api.getStudentActivities();
  assert.deepEqual(
    JSON.parse(JSON.stringify(activities.map(activity => activity.id))),
    [701],
  );
  const activityQuery = calls.find(query => query.table === "activities");
  assert.ok(activityQuery.filters.some(filter =>
    filter[1] === "module_id" && filter[2].includes(501),
  ));

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
