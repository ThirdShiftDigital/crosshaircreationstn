import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getCookie, isAuthenticated, COOKIE_NAME } from "./_shared/session.mts";
import crypto from "node:crypto";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const action = url.pathname.split("/").pop();

  if (req.method === "POST" && action === "login") {
    const body = await req.json().catch(() => ({}));
    const password = body.password || "";
    const expected = Netlify.env.get("DASHBOARD_PASSWORD") || "";

    if (!expected || password !== expected) {
      return new Response(JSON.stringify({ error: "Incorrect password" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const token = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();

    const db = getDatabase();
    await db.sql`INSERT INTO sessions (token, expires_at) VALUES (${token}, ${expiresAt})`;

    const cookie = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${THIRTY_DAYS_MS / 1000}`;

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json", "set-cookie": cookie },
    });
  }

  if (req.method === "POST" && action === "logout") {
    const token = getCookie(req, COOKIE_NAME);
    if (token) {
      const db = getDatabase();
      await db.sql`DELETE FROM sessions WHERE token = ${token}`;
    }
    const cookie = `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json", "set-cookie": cookie },
    });
  }

  if (req.method === "GET" && action === "check") {
    const ok = await isAuthenticated(req);
    return new Response(JSON.stringify({ authenticated: ok }), {
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
