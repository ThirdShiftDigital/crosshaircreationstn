import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser, unauthorized, forbidden } from "./_shared/session.mts";

export default async (req: Request, context: Context) => {
  const user = await getSessionUser(req);
  if (!user) return unauthorized();
  if (!user.can_view_recovery_requests) return forbidden();

  const db = getDatabase();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    const rows = await db.sql`SELECT * FROM recovery_requests ORDER BY created_at DESC`;
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (req.method === "PUT" && id) {
    const b = await req.json().catch(() => ({}));
    const status = b.status || "new";
    const [row] = await db.sql`UPDATE recovery_requests SET status = ${status} WHERE id = ${id} RETURNING *`;
    return new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (req.method === "DELETE" && id) {
    await db.sql`DELETE FROM recovery_requests WHERE id = ${id}`;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: { "content-type": "application/json" } });
};

export const config: Config = {
  path: "/api/recovery-requests",
};
