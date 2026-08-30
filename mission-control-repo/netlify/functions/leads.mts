import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { isAuthenticated, unauthorized } from "./_shared/session.mts";

export default async (req: Request, context: Context) => {
  if (!(await isAuthenticated(req))) return unauthorized();
  const db = getDatabase();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    const rows = await db.sql`SELECT * FROM leads ORDER BY created_at DESC`;
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (req.method === "POST") {
    const l = await req.json().catch(() => ({}));
    const [row] = await db.sql`
      INSERT INTO leads (name, contact, interest, status, notes)
      VALUES (${l.name}, ${l.contact || null}, ${l.interest || null}, ${l.status || "new"}, ${l.notes || null})
      RETURNING *
    `;
    return new Response(JSON.stringify(row), { status: 201, headers: { "content-type": "application/json" } });
  }

  if (req.method === "PUT" && id) {
    const l = await req.json().catch(() => ({}));
    const [row] = await db.sql`
      UPDATE leads SET name = ${l.name}, contact = ${l.contact || null}, interest = ${l.interest || null},
        status = ${l.status || "new"}, notes = ${l.notes || null}
      WHERE id = ${id}
      RETURNING *
    `;
    return new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (req.method === "DELETE" && id) {
    await db.sql`DELETE FROM leads WHERE id = ${id}`;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: { "content-type": "application/json" } });
};

export const config: Config = {
  path: "/api/leads",
};
