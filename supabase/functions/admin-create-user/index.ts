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

    const { data: profile } = await admin
      .from("users")
      .select("id, first_name, last_name, role_id, roles(name)")
      .eq("auth_uid", callerUser.user.id)
      .single();

    if (!profile || profile.roles?.name !== "admin") {
      return jsonResponse({ error: "Admin access required" }, 403);
    }

    const { email, password, first_name, last_name, role_id } = await req.json();
    if (!email || !password || !first_name || !last_name || !role_id) {
      return jsonResponse({ error: "Missing required fields" }, 400);
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
        email, first_name, last_name, role_id, is_active: true,
      })
      .select()
      .single();

    if (insertErr) {
      // Roll back the auth account so we don't leave an orphaned login
      await admin.auth.admin.deleteUser(created.user.id);
      return jsonResponse({ error: insertErr.message }, 400);
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
        role_id: { old: null, new: role_id },
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
