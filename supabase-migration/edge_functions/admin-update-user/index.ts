// @ts-nocheck
// Admin-only Supabase Auth password update.
// Deploy with: supabase functions deploy admin-update-user
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  try {
    const authorization = req.headers.get("Authorization") || "";
    const adminClient = createClient(url, serviceRoleKey, { global: { headers: { Authorization: authorization } } });
    const { data: caller, error: callerError } = await adminClient.auth.getUser();
    if (callerError || !caller?.user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });

    const serviceClient = createClient(url, serviceRoleKey);
    const { data: adminProfile } = await serviceClient.from("users").select("roles(name)").eq("auth_uid", caller.user.id).single();
    if (adminProfile?.roles?.name !== "admin") return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403 });

    const { user_id, password, email } = await req.json();
    if (!user_id || (!password && !email)) {
      return new Response(JSON.stringify({ error: "An email or password update is required" }), { status: 400 });
    }
    if (password && (password.length < 8 || !/\d/.test(password))) {
      return new Response(JSON.stringify({ error: "Password must be at least 8 characters and contain a number" }), { status: 400 });
    }
    const { data: target } = await serviceClient.from("users").select("auth_uid").eq("id", user_id).single();
    if (!target?.auth_uid) return new Response(JSON.stringify({ error: "User is not linked to Supabase Auth" }), { status: 400 });

    const authUpdate: { password?: string; email?: string } = {};
    if (password) authUpdate.password = password;
    if (email) authUpdate.email = email;
    const { error } = await serviceClient.auth.admin.updateUserById(target.auth_uid, authUpdate);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
});
