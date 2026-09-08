import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser, unauthorized, forbidden } from "./_shared/session.mts";
import { syncPriceToSquare } from "./_shared/square-sync.mts";

export default async (req: Request, context: Context) => {
  const db = getDatabase();

  if (req.method === "GET") {
    // Public — the live website fetches this on every page load
    const rows = await db.sql`SELECT key, value FROM site_content`;
    const content: Record<string, string> = {};
    for (const row of rows) content[row.key as string] = row.value as string;
    return new Response(JSON.stringify(content), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
    });
  }

  if (req.method === "PUT") {
    const user = await getSessionUser(req);
    if (!user) return unauthorized();
    if (!user.can_edit_content) return forbidden();
    const body = await req.json().catch(() => ({}));
    const entries = Object.entries(body) as [string, string][];

    // Look up which of these keys have a Square mapping, before we start writing
    const mappingRows = await db.sql`SELECT content_key, square_variation_id FROM price_sync_mapping`;
    const mappingByKey: Record<string, string> = {};
    for (const row of mappingRows) mappingByKey[row.content_key as string] = row.square_variation_id as string;

    const squareSyncErrors: Record<string, string> = {};

    for (const [key, value] of entries) {
      await db.sql`
        INSERT INTO site_content (key, value, updated_at) VALUES (${key}, ${value}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
      `;

      if (mappingByKey[key]) {
        const result = await syncPriceToSquare(mappingByKey[key], value);
        if (!result.ok) squareSyncErrors[key] = result.error || "Unknown error";
      }
    }

    return new Response(JSON.stringify({ ok: true, squareSyncErrors }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/content",
};
