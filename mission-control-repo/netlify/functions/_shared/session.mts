import { getDatabase } from "@netlify/database";

const COOKIE_NAME = "cc_session";

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  is_owner: boolean;
  can_edit_content: boolean;
  can_edit_bookings: boolean;
  can_edit_leads: boolean;
  can_edit_tasks: boolean;
  can_edit_notes: boolean;
  can_view_square: boolean;
  can_manage_square_bookings: boolean;
  can_manage_team: boolean;
};

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const match = header.split(";").map(c => c.trim()).find(c => c.startsWith(name + "="));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
}

export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = getCookie(req, COOKIE_NAME);
  if (!token) return null;
  const db = getDatabase();
  const rows = await db.sql`
    SELECT u.id, u.name, u.email, u.is_owner,
           u.can_edit_content, u.can_edit_bookings, u.can_edit_leads,
           u.can_edit_tasks, u.can_edit_notes, u.can_view_square, u.can_manage_square_bookings, u.can_manage_team
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > NOW()
  `;
  return rows.length ? (rows[0] as unknown as SessionUser) : null;
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export function forbidden(message = "You don't have permission to do that."): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

export { COOKIE_NAME };
