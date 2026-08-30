import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { isAuthenticated, unauthorized } from "./_shared/session.mts";

export default async (req: Request, context: Context) => {
  if (!(await isAuthenticated(req))) return unauthorized();
  const db = getDatabase();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    const rows = await db.sql`SELECT * FROM bookings ORDER BY scheduled_date NULLS LAST, created_at DESC`;
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const [row] = await db.sql`
      INSERT INTO bookings (customer_name, service, contact, scheduled_date, scheduled_time, status, price, notes)
      VALUES (${b.customer_name}, ${b.service || null}, ${b.contact || null}, ${b.scheduled_date || null}, ${b.scheduled_time || null}, ${b.status || "pending"}, ${b.price || null}, ${b.notes || null})
      RETURNING *
    `;
    return new Response(JSON.stringify(row), { status: 201, headers: { "content-type": "application/json" } });
  }

  if (req.method === "PUT" && id) {
    const b = await req.json().catch(() => ({}));
    const [row] = await db.sql`
      UPDATE bookings SET
        customer_name = ${b.customer_name}, service = ${b.service || null}, contact = ${b.contact || null},
        scheduled_date = ${b.scheduled_date || null}, scheduled_time = ${b.scheduled_time || null},
        status = ${b.status || "pending"}, price = ${b.price || null}, notes = ${b.notes || null}
      WHERE id = ${id}
      RETURNING *
    `;
    return new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (req.method === "DELETE" && id) {
    await db.sql`DELETE FROM bookings WHERE id = ${id}`;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: { "content-type": "application/json" } });
};

export const config: Config = {
  path: "/api/bookings",
};
