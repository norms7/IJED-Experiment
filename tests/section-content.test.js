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
    rpc: async (name) => {
      if (name === "get_student_active_subjects") {
        return {
          data: [{ subject_id: 9, subject_name: "Subject 9", semester: "2nd" }],
          error: null,
        };
      }
      if (name === "get_student_weekly_schedule") {
        return { data: [], error: null };
      }
      if (name === "get_student_history_context") {
        return {
          data: [{
            section_id: 101,
            section_name: "Former section",
            class_id: 1,
            class_name: "Grade 10",
            subject_id: 9,
            subject_name: "Subject 9",
            semester: "1st",
          }],
          error: null,
        };
      }
      if (name === "get_my_semester_attendance") {
        return { data: [], error: null };
      }
      if (name === "get_my_attendance_by_semester") {
        return { data: [], error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
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

  const activeSubjects = await api.getStudentSubjects("2nd");
  assert.deepEqual(
    JSON.parse(JSON.stringify(activeSubjects.map(subject => subject.subject_id))),
    [9],
    "active subjects should be filtered to the selected semester",
  );
  const activities = await api.getStudentActivities(null, "2nd");
  assert.deepEqual(
    JSON.parse(JSON.stringify(activities.map(activity => activity.id))),
    [702],
  );
  const activityQuery = calls.find(query => query.table === "activities");
  assert.ok(activityQuery.filters.some(filter =>
    filter[1] === "module_id" && filter[2].includes(502),
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

  api._cache.clear();
  const history = await api.getStudentHistory();
  assert.deepEqual(
    JSON.parse(JSON.stringify(history.modules.map(module => module.id))),
    [501],
    "previous-section modules should be included as read-only history",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(history.activities.map(activity => activity.id))),
    [701],
  );
  assert.equal(history.activities[0].can_answer, false);
  assert.equal(history.activities[0].submission.id, 801);
  assert.equal(history.activities[0]._semester, "1st");
  assert.deepEqual(
    JSON.parse(JSON.stringify(await api.getMyAttendanceBySemester("2nd"))),
    [],
  );

  const historyMigration = fs.readFileSync(
    "supabase-migration/18_student_semester_history.sql",
    "utf8",
  );
  assert.match(historyMigration, /create or replace function public\.get_student_active_subjects/);
  assert.match(historyMigration, /create or replace function public\.get_student_history_context/);
  assert.match(historyMigration, /previous_semester_active as/);
  assert.match(historyMigration, /create or replace function public\.get_my_semester_attendance/);
  assert.match(historyMigration, /create or replace function public\.get_student_active_dashboard_stats\(p_semester text\)/);
  assert.match(historyMigration, /student_can_submit_module/);
  assert.match(historyMigration, /student_can_submit_module\(activity\.module_id\)/);
  assert.match(historyMigration, /student_has_activity_submission\(activities\.id\)/);
  const recursionFixMigration = fs.readFileSync(
    "supabase-migration/19_fix_student_activity_policy_recursion.sql",
    "utf8",
  );
  assert.match(recursionFixMigration, /security definer/);
  assert.match(recursionFixMigration, /student_has_activity_submission\(activities\.id\)/);
  assert.match(recursionFixMigration, /student_has_module_submission\(modules\.id\)/);
  const enrolledSubjectsMigration = fs.readFileSync(
    "supabase-migration/20_restore_enrolled_semester_subjects.sql",
    "utf8",
  );
  assert.match(enrolledSubjectsMigration, /from public\.student_subject_enrollments enrollment/);
  assert.match(enrolledSubjectsMigration, /where enrollment\.student_id = public\.auth_student_id\(\)/);
  const semesterAttendanceMigration = fs.readFileSync(
    "supabase-migration/21_student_semester_tab_attendance.sql",
    "utf8",
  );
  assert.match(semesterAttendanceMigration, /get_my_attendance_by_semester\(p_semester text\)/);
  assert.match(semesterAttendanceMigration, /grant execute on function public\.get_my_attendance_by_semester\(text\) to authenticated/);
  const scopedAttendanceMigration = fs.readFileSync(
    "supabase-migration/22_scope_attendance_to_student_sections.sql",
    "utf8",
  );
  assert.match(scopedAttendanceMigration, /student_subject_enrollments enrollment/);
  assert.match(scopedAttendanceMigration, /active_subject\.section_id = active_assignment\.section_id/);
  assert.match(scopedAttendanceMigration, /former_subject\.section_id = former_section\.id/);
  assert.match(scopedAttendanceMigration, /transfer\.changed_fields #>> '\{section_id,old\}'/);

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
  assert.match(dashboardController, /StudentView\.mySubjects\([\s\S]*?currentSem,\s*history,\s*actualCurrentSem/);
  assert.match(studentController, /getMyAttendanceBySemester\(selectedSemester\)/);
  assert.match(studentController, /StudentView\.activities\(\[\.\.\.activityById\.values\(\)\], selectedSemester\)/);
  assert.match(studentController, /StudentView\.activitiesLoading\(selectedSemester\)/);
  assert.match(studentController, /StudentView\.attendanceLoading\(selectedSemester\)/);
  assert.match(studentController, /requestId !== this\._activitiesLoadId/);
  assert.match(studentController, /requestId !== this\._attendanceLoadId/);
  assert.match(dashboardController, /StudentView\.myGrades\(currentSem\)/);
  assert.match(dashboardController, /area\.innerHTML = StudentView\.myGrades\(selectedSemester\)/);
  assert.doesNotMatch(dashboardController, /StudentController\.loadActivities\(opts\?\.semester\)\.finally\(\(\) => Loader\.done\(\)\)/);
  assert.doesNotMatch(dashboardController, /StudentController\.loadAttendance\(opts\?\.semester\)\.finally\(\(\) => Loader\.done\(\)\)/);
  assert.match(studentView, /semesterTabs\('activities', semester\)/);
  assert.match(studentView, /semesterTabs\('my-grades', semester\)/);
  assert.match(studentView, /semesterTabs\('attendance', semester\)/);
  assert.match(studentView, /activitiesLoading\(semester = '1st'\)[\s\S]*?semesterTabs\('activities', semester\)/);
  assert.match(studentView, /attendanceLoading\(semester = '1st'\)[\s\S]*?semesterTabs\('attendance', semester\)/);
  assert.match(studentView, /viewingPreviousSemester = normalizeSemester\(sem\) !== normalizeSemester\(actualCurrentSem\)/);
  assert.match(studentView, /semesterSubjectsToDisplay = viewingPreviousSemester \? \[\] : apiSubjects/);
  assert.match(studentView, /hasSemesterHistory \? '' : `<div class="empty-state"/);

  console.log("Section-scoped student content tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
