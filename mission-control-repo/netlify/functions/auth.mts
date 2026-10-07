import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getCookie, getSessionUser, COOKIE_NAME } from "./_shared/session.mts";
import { hashPassword, validateNewPassword, verifyPassword } from "./_shared/password.mts";
import crypto from "node:crypto";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const action = url.pathname.split("/").pop();
  const db = getDatabase();

  if (req.method === "POST" && action === "login") {
    const body = await req.json().catch(() => ({}));
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";

    const rows = await db.sql`SELECT * FROM users WHERE LOWER(email) = ${email}`;
    const user = rows[0];

    if (!user || !verifyPassword(password, user.password_hash as string, user.password_salt as string)) {
      return new Response(JSON.stringify({ error: "Incorrect email or password" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const token = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();
    await db.sql`INSERT INTO sessions (token, expires_at, user_id) VALUES (${token}, ${expiresAt}, ${user.id})`;

    const cookie = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${THIRTY_DAYS_MS / 1000}`;

    return new Response(JSON.stringify({
      ok: true,
      // Same shape as /api/auth/check so the dashboard shows the right tabs right after login.
      user: {
        id: user.id, name: user.name, email: user.email, is_owner: user.is_owner,
        can_edit_content: user.can_edit_content, can_edit_bookings: user.can_edit_bookings,
        can_edit_leads: user.can_edit_leads, can_edit_tasks: user.can_edit_tasks,
        can_edit_notes: user.can_edit_notes, can_view_square: user.can_view_square,
        can_manage_square_bookings: user.can_manage_square_bookings,
        can_view_recovery_requests: user.can_view_recovery_requests,
        can_manage_team: user.can_manage_team,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json", "set-cookie": cookie },
    });
  }

  if (req.method === "POST" && action === "logout") {
    const token = getCookie(req, COOKIE_NAME);
    if (token) await db.sql`DELETE FROM sessions WHERE token = ${token}`;
    const cookie = `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json", "set-cookie": cookie },
    });
  }

  if (req.method === "POST" && action === "change-password") {
    const me = await getSessionUser(req);
    if (!me) {
      return new Response(JSON.stringify({ error: "Your session expired. Log in again." }), {
        status: 401, headers: { "content-type": "application/json" },
      });
    }
    const body = await req.json().catch(() => ({}));
    const currentPassword = typeof body.current_password === "string" ? body.current_password : "";
    const newPassword = body.new_password;

    const rows = await db.sql`SELECT password_hash, password_salt FROM users WHERE id = ${me.id}`;
    const row = rows[0];
    if (!row || !verifyPassword(currentPassword, row.password_hash as string, row.password_salt as string)) {
      return new Response(JSON.stringify({ error: "Current password is incorrect." }), {
        status: 403, headers: { "content-type": "application/json" },
      });
    }
    const problem = validateNewPassword(newPassword);
    if (problem) {
      return new Response(JSON.stringify({ error: problem }), { status: 400, headers: { "content-type": "application/json" } });
    }
    if (newPassword === currentPassword) {
      return new Response(JSON.stringify({ error: "New password must be different from the current one." }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    }

    const { hash, salt } = hashPassword(newPassword as string);
    await db.sql`UPDATE users SET password_hash = ${hash}, password_salt = ${salt} WHERE id = ${me.id}`;
    // Sign out every other device; keep this one logged in.
    const token = getCookie(req, COOKIE_NAME);
    const removed = await db.sql`DELETE FROM sessions WHERE user_id = ${me.id} AND token <> ${token || ""} RETURNING token`;
    return new Response(JSON.stringify({ ok: true, signed_out_sessions: removed.length }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }

  if (req.method === "GET" && action === "check") {
    const user = await getSessionUser(req);
    if (!user) return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ authenticated: true, user }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  path: ["/api/auth/login", "/api/auth/logout", "/api/auth/check", "/api/auth/change-password"],
};
