import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { isAuthenticated, unauthorized } from "./_shared/session.mts";

export default async (req: Request, context: Context) => {
  if (!(await isAuthenticated(req))) return unauthorized();
  const db = getDatabase();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    const rows = await db.sql`SELECT * FROM notes ORDER BY pinned DESC, created_at DESC`;
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (req.method === "POST") {
    const n = await req.json().catch(() => ({}));
    const [row] = await db.sql`
      INSERT INTO notes (content, pinned) VALUES (${n.content}, ${!!n.pinned})
      RETURNING *
    `;
    return new Response(JSON.stringify(row), { status: 201, headers: { "content-type": "application/json" } });
  }

  if (req.method === "PUT" && id) {
    const n = await req.json().catch(() => ({}));
    const [row] = await db.sql`
      UPDATE notes SET content = ${n.content}, pinned = ${!!n.pinned}
      WHERE id = ${id}
      RETURNING *
    `;
    return new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (req.method === "DELETE" && id) {
    await db.sql`DELETE FROM notes WHERE id = ${id}`;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: { "content-type": "application/json" } });
};

export const config: Config = {
  path: "/api/notes",
};
