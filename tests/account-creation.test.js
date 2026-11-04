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
const context = { Map, Response };
vm.runInNewContext(apiSource, context);

function createApi(invoke) {
  const api = Object.create(context.LMSAdminAPITest.prototype);
  api._cache = new Map();
  api.sb = {
    functions: { invoke },
    from: table => ({
      select: () => ({
        eq: (column, value) => ({
          single: async () => ({
            data: table === "roles" && column === "name" && value === "teacher"
              ? { id: 2 }
              : null,
            error: null,
          }),
        }),
      }),
    }),
  };
  return api;
}

async function run() {
  let invocation;
  const createdUser = { id: 42 };
  const api = createApi(async (name, options) => {
    invocation = { name, options };
    return { data: createdUser, error: null };
  });
  assert.equal(await api.createUser({
    email: "teacher@example.edu",
    password: "pass1234",
    first_name: "Test",
    last_name: "Teacher",
    role: "teacher",
  }), createdUser);
  assert.equal(invocation.name, "admin-create-user");
  assert.equal(invocation.options.body.role, "teacher");
  assert.equal(invocation.options.body.role_id, 2);

  const failingApi = createApi(async () => ({
    data: null,
    error: {
      message: "Edge Function returned a non-2xx status code",
      context: new Response(JSON.stringify({ error: "An account with this email already exists in the LMS" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    },
  }));
  await assert.rejects(
    failingApi.createUser({
      email: "teacher@example.edu",
      password: "pass1234",
      first_name: "Test",
      last_name: "Teacher",
      role: "teacher",
    }),
    /An account with this email already exists in the LMS/,
  );

  console.log("Account creation role payload and Edge Function error tests passed.");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
