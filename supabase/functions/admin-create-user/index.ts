// @ts-nocheck
// supabase/functions/admin-create-user/index.ts
//
// Deploy with: supabase functions deploy admin-create-user
//
// WHY THIS EXISTS: creating a Supabase Auth account with a chosen password
// requires the service_role key, which must NEVER be shipped to the browser.
// This Edge Function holds that key server-side (as a Supabase secret) and
// is the one piece of "backend" code in this whole experiment — it's still
// 100% Supabase (no FastAPI/Render), just running as a Supabase Edge
// Function instead of in the browser.
//
// Caller must be an authenticated admin (checked below via the caller's JWT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonResponse = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the caller is logged in and is an admin
    const { data: callerUser, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerUser?.user) {
      return jsonResponse({ error: "Not authenticated" }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: profile, error: profileErr } = await admin
      .from("users")
      .select("id, first_name, last_name, role_id, roles(name)")
      .eq("auth_uid", callerUser.user.id)
      .single();

    if (profileErr && profileErr.code !== "PGRST116") {
      return jsonResponse({ error: `Could not verify the administrator profile: ${profileErr.message}` }, 500);
    }
    if (!profile || profile.roles?.name !== "admin") {
      return jsonResponse({ error: "Admin access required" }, 403);
    }

    const body = await req.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const first_name = typeof body.first_name === "string" ? body.first_name.trim() : "";
    const last_name = typeof body.last_name === "string" ? body.last_name.trim() : "";
    const roleName = typeof body.role === "string" ? body.role.trim().toLowerCase() : "";
    const roleId = Number.isInteger(body.role_id) ? body.role_id : null;
    if (!email || !password || !first_name || !last_name || (!roleName && !roleId)) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "Enter a valid email address" }, 400);
    }
    if (password.length < 8 || !/\d/.test(password)) {
      return jsonResponse({ error: "Password must be at least 8 characters and contain a number" }, 400);
    }
    if (first_name.length > 100 || last_name.length > 100) {
      return jsonResponse({ error: "Name fields must be 100 characters or fewer" }, 400);
    }

    const roleQuery = admin.from("roles").select("id, name");
    const { data: role, error: roleErr } = roleName
      ? await roleQuery.eq("name", roleName).maybeSingle()
      : await roleQuery.eq("id", roleId).maybeSingle();
    if (roleErr) {
      return jsonResponse({ error: `Could not validate the selected role: ${roleErr.message}` }, 500);
    }
    if (!role || !["admin", "teacher", "student"].includes(role.name)) {
      return jsonResponse({ error: "The selected role does not exist or is not supported" }, 400);
    }

    const { data: existingProfile, error: existingProfileErr } = await admin
      .from("users")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (existingProfileErr) {
      return jsonResponse({ error: `Could not check for an existing account: ${existingProfileErr.message}` }, 500);
    }
    if (existingProfile) {
      return jsonResponse({ error: "An account with this email already exists in the LMS" }, 409);
    }

    // 1. Create the Supabase Auth account
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createErr) {
      return jsonResponse({ error: createErr.message }, 400);
    }

    // 2. Insert the profile row, linked via auth_uid
    const { data: userRow, error: insertErr } = await admin
      .from("users")
      .insert({
        auth_uid: created.user.id,
        email, first_name, last_name, role_id: role.id, is_active: true,
      })
      .select()
      .single();

    if (insertErr) {
      // Roll back the auth account so we don't leave an orphaned login
      const { error: rollbackError } = await admin.auth.admin.deleteUser(created.user.id);
      const message = rollbackError
        ? `Could not create the LMS profile (${insertErr.message}); Auth rollback failed (${rollbackError.message}).`
        : insertErr.message;
      return jsonResponse({ error: message }, rollbackError ? 500 : 400);
    }

    const actorName = `${profile.first_name} ${profile.last_name}`.trim() || "Administrator";
    const recordName = `${first_name} ${last_name}`.trim();
    const { error: auditErr } = await admin.from("audit_logs").insert({
      actor_user_id: profile.id,
      actor_auth_uid: callerUser.user.id,
      actor_name: actorName,
      action: "CREATE",
      area: "Users",
      table_name: "users",
      record_id: String(userRow.id),
      record_label: recordName,
      summary: `Created user account: ${recordName}`,
      changed_fields: {
        first_name: { old: null, new: first_name },
        last_name: { old: null, new: last_name },
        role_id: { old: null, new: role.id },
      },
      metadata: { source: "admin-create-user" },
    });

    if (auditErr) {
      const { error: authRollbackError } = await admin.auth.admin.deleteUser(created.user.id);
      if (authRollbackError) {
        return jsonResponse({
          error: `Audit logging failed (${auditErr.message}) and the created account could not be rolled back (${authRollbackError.message}).`,
        }, 500);
      }
      return jsonResponse({ error: `Audit logging failed; user creation was rolled back (${auditErr.message}).` }, 500);
    }

    return jsonResponse(userRow, 201);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
