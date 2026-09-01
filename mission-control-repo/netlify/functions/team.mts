import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser, unauthorized, forbidden } from "./_shared/session.mts";
import { hashPassword } from "./_shared/password.mts";

const PERMISSION_KEYS = [
  "can_edit_content", "can_edit_bookings", "can_edit_leads",
  "can_edit_tasks", "can_edit_notes", "can_view_square", "can_manage_square_bookings", "can_view_recovery_requests", "can_manage_team",
];

export default async (req: Request, context: Context) => {
  const me = await getSessionUser(req);
  if (!me) return unauthorized();
  if (!me.can_manage_team) return forbidden("Only users with Team Access permission can manage accounts.");

  const db = getDatabase();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    const rows = await db.sql`
      SELECT id, name, email, is_owner, can_edit_content, can_edit_bookings, can_edit_leads,
             can_edit_tasks, can_edit_notes, can_view_square, can_manage_square_bookings, can_view_recovery_requests, can_manage_team, created_at
      FROM users ORDER BY is_owner DESC, created_at ASC
    `;
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const name = (b.name || "").trim();
    const email = (b.email || "").trim().toLowerCase();
    const password = b.password || "";
    if (!name || !email || password.length < 6) {
      return new Response(JSON.stringify({ error: "Name, email, and a password of at least 6 characters are required." }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    }
    const { hash, salt } = hashPassword(password);
    const perms: Record<string, boolean> = {};
    for (const key of PERMISSION_KEYS) perms[key] = !!b[key];

    try {
      const [row] = await db.sql`
        INSERT INTO users (name, email, password_hash, password_salt, is_owner,
          can_edit_content, can_edit_bookings, can_edit_leads, can_edit_tasks, can_edit_notes, can_view_square, can_manage_square_bookings, can_view_recovery_requests, can_manage_team)
        VALUES (${name}, ${email}, ${hash}, ${salt}, FALSE,
          ${perms.can_edit_content}, ${perms.can_edit_bookings}, ${perms.can_edit_leads},
          ${perms.can_edit_tasks}, ${perms.can_edit_notes}, ${perms.can_view_square}, ${perms.can_manage_square_bookings}, ${perms.can_view_recovery_requests}, ${perms.can_manage_team})
        RETURNING id, name, email, is_owner, can_edit_content, can_edit_bookings, can_edit_leads,
                  can_edit_tasks, can_edit_notes, can_view_square, can_manage_square_bookings, can_view_recovery_requests, can_manage_team
      `;
      return new Response(JSON.stringify(row), { status: 201, headers: { "content-type": "application/json" } });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: "That email is already in use." }), {
        status: 409, headers: { "content-type": "application/json" },
      });
    }
  }

  if (req.method === "PUT" && id) {
    const targetRows = await db.sql`SELECT is_owner FROM users WHERE id = ${id}`;
    if (!targetRows.length) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json" } });
    if (targetRows[0].is_owner) return forbidden("The owner account's permissions can't be changed.");

    const b = await req.json().catch(() => ({}));
    const perms: Record<string, boolean> = {};
    for (const key of PERMISSION_KEYS) perms[key] = !!b[key];

    if (b.password) {
      const { hash, salt } = hashPassword(b.password);
      await db.sql`
        UPDATE users SET
          can_edit_content = ${perms.can_edit_content}, can_edit_bookings = ${perms.can_edit_bookings},
          can_edit_leads = ${perms.can_edit_leads}, can_edit_tasks = ${perms.can_edit_tasks},
          can_edit_notes = ${perms.can_edit_notes}, can_view_square = ${perms.can_view_square},
          can_manage_square_bookings = ${perms.can_manage_square_bookings},
          can_view_recovery_requests = ${perms.can_view_recovery_requests},
          can_manage_team = ${perms.can_manage_team}, password_hash = ${hash}, password_salt = ${salt}
        WHERE id = ${id}
      `;
    } else {
      await db.sql`
        UPDATE users SET
          can_edit_content = ${perms.can_edit_content}, can_edit_bookings = ${perms.can_edit_bookings},
          can_edit_leads = ${perms.can_edit_leads}, can_edit_tasks = ${perms.can_edit_tasks},
          can_edit_notes = ${perms.can_edit_notes}, can_view_square = ${perms.can_view_square},
          can_manage_square_bookings = ${perms.can_manage_square_bookings},
          can_view_recovery_requests = ${perms.can_view_recovery_requests},
          can_manage_team = ${perms.can_manage_team}
        WHERE id = ${id}
      `;
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (req.method === "DELETE" && id) {
    const targetRows = await db.sql`SELECT is_owner FROM users WHERE id = ${id}`;
    if (targetRows.length && targetRows[0].is_owner) return forbidden("The owner account can't be removed.");
    await db.sql`DELETE FROM users WHERE id = ${id}`;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: { "content-type": "application/json" } });
};

export const config: Config = {
  path: "/api/team",
};
