import { getDatabase } from "@netlify/database";

const COOKIE_NAME = "cc_session";

export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const match = header.split(";").map(c => c.trim()).find(c => c.startsWith(name + "="));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
}

export async function isAuthenticated(req: Request): Promise<boolean> {
  const token = getCookie(req, COOKIE_NAME);
  if (!token) return false;
  const db = getDatabase();
  const rows = await db.sql`SELECT token FROM sessions WHERE token = ${token} AND expires_at > NOW()`;
  return rows.length > 0;
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export { COOKIE_NAME };
