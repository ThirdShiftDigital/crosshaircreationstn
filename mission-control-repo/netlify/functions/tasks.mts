import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { isAuthenticated, unauthorized } from "./_shared/session.mts";

export default async (req: Request, context: Context) => {
  if (!(await isAuthenticated(req))) return unauthorized();
  const db = getDatabase();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    const rows = await db.sql`SELECT * FROM tasks ORDER BY done ASC, due_date NULLS LAST, created_at DESC`;
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (req.method === "POST") {
    const t = await req.json().catch(() => ({}));
    const [row] = await db.sql`
      INSERT INTO tasks (title, due_date) VALUES (${t.title}, ${t.due_date || null})
      RETURNING *
    `;
    return new Response(JSON.stringify(row), { status: 201, headers: { "content-type": "application/json" } });
  }

  if (req.method === "PUT" && id) {
    const t = await req.json().catch(() => ({}));
    const [row] = await db.sql`
      UPDATE tasks SET title = ${t.title}, done = ${!!t.done}, due_date = ${t.due_date || null}
      WHERE id = ${id}
      RETURNING *
    `;
    return new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (req.method === "DELETE" && id) {
    await db.sql`DELETE FROM tasks WHERE id = ${id}`;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: { "content-type": "application/json" } });
};

export const config: Config = {
  path: "/api/tasks",
};
