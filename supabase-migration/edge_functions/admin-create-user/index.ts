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

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify the caller is logged in and is an admin
    const { data: callerUser, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerUser?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: profile } = await admin
      .from("users")
      .select("role_id, roles(name)")
      .eq("auth_uid", callerUser.user.id)
      .single();

    if (!profile || profile.roles?.name !== "admin") {
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403 });
    }

    const { email, password, first_name, last_name, role_id } = await req.json();
    if (!email || !password || !first_name || !last_name || !role_id) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400 });
    }

    // 1. Create the Supabase Auth account
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createErr) {
      return new Response(JSON.stringify({ error: createErr.message }), { status: 400 });
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
      return new Response(JSON.stringify({ error: insertErr.message }), { status: 400 });
    }

    return new Response(JSON.stringify(userRow), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
