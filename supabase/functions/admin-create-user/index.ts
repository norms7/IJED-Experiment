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
      .select("role_id, roles(name)")
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

    return jsonResponse(userRow, 201);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
