import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getCookie, getSessionUser, COOKIE_NAME } from "./_shared/session.mts";
import { verifyPassword } from "./_shared/password.mts";
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
      user: {
        name: user.name, email: user.email, is_owner: user.is_owner,
        can_edit_content: user.can_edit_content, can_edit_bookings: user.can_edit_bookings,
        can_edit_leads: user.can_edit_leads, can_edit_tasks: user.can_edit_tasks,
        can_edit_notes: user.can_edit_notes, can_view_square: user.can_view_square,
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
  path: ["/api/auth/login", "/api/auth/logout", "/api/auth/check"],
};
