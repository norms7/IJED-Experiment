"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function run() {
  const apiSource = fs.readFileSync(
    "lms-frontend/assets/js/lms-supabase-api.js",
    "utf8",
  ).replace(
    "const api = new LMSAdminAPI();",
    "globalThis.LMSAdminAPITest = LMSAdminAPI;",
  );
  const apiContext = { Map };
  vm.runInNewContext(apiSource, apiContext);

  const calls = [];
  const api = Object.create(apiContext.LMSAdminAPITest.prototype);
  api._cache = new Map();
  api._throwIfError = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  api.sb = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        data: name === "get_admin_audit_stats"
          ? { total_activities: 12, today_activities: 2, admins_with_activities: 1 }
          : [{ id: 7 }],
        error: null,
      };
    },
  };

  const filters = {
    search: "assignment",
    action: "ASSIGN",
    area: "Teachers",
    fromDate: "2026-03-01",
    toDate: "2026-03-20",
  };
  assert.deepEqual(
    await api.getAuditLogs(50, 100, filters),
    [{ id: 7 }],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    name: "get_admin_audit_logs",
    args: {
      p_limit: 50,
      p_offset: 100,
      p_search: "assignment",
      p_action: "ASSIGN",
      p_area: "Teachers",
      p_from_date: "2026-03-01",
      p_to_date: "2026-03-20",
    },
  });
  assert.equal((await api.getAuditStats()).total_activities, 12);
  assert.equal(calls[1].name, "get_admin_audit_stats");

  await api.createSection({
    name: "Section A",
    class_name: "ICT G11",
    grade_level: "Grade 11",
    school_year: "2025-2026",
  });
  assert.equal(calls[2].name, "create_admin_section");
  assert.equal(calls[2].args.p_name, "Section A");
  assert.equal(calls[2].args.p_class_name, "ICT G11");

  const viewSource = fs.readFileSync(
    "lms-frontend/views/admin.view.js",
    "utf8",
  ) + "\nglobalThis.AdminViewTest = AdminView;";
  const viewContext = {
    escHtml(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]);
    },
    fmtDate(value) {
      return value;
    },
  };
  vm.runInNewContext(viewSource, viewContext);
  const auditHtml = viewContext.AdminViewTest._auditPane({
    logs: [{
      action: "DELETE",
      area: "Users",
      actor_name: "<script>actor</script>",
      summary: "<script>summary</script>",
      created_at: "2026-03-20",
      changed_fields: {},
    }],
    stats: { total_activities: 12, today_activities: 2, admins_with_activities: 1 },
    hasMore: true,
  }, { search: "", action: "DELETE", area: "", fromDate: "", toDate: "" });
  assert.match(auditHtml, /Total activities/);
  assert.match(auditHtml, /audit-action-delete/);
  assert.match(auditHtml, /value="DELETE" selected/);
  assert.match(auditHtml, /&lt;script&gt;actor&lt;\/script&gt;/);
  assert.doesNotMatch(auditHtml, /<script>actor/);
  const errorHtml = viewContext.AdminViewTest._auditPane({
    error: "RPC missing",
    logs: [],
    stats: {},
  });
  assert.match(errorHtml, /Could not load audit history/);
  assert.doesNotMatch(errorHtml, />undefined</);

  const controllerSource = fs.readFileSync(
    "lms-frontend/controllers/admin.controller.js",
    "utf8",
  ) + "\nglobalThis.AdminControllerTest = AdminController;";
  const controllerContext = {};
  vm.runInNewContext(controllerSource, controllerContext);
  const csvCell = controllerContext.AdminControllerTest._auditCsvCell;
  assert.equal(csvCell("normal, value"), '"normal, value"');
  assert.equal(csvCell('quoted "value"'), '"quoted ""value"""');
  assert.equal(
    csvCell("=HYPERLINK(\"https://example.test\")"),
    String.raw`"'=HYPERLINK(""https://example.test"")"`,
  );

  console.log("Audit API filters, summary retrieval, and CSV safety tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
