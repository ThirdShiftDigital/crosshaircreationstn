import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser, unauthorized, forbidden } from "./_shared/session.mts";

const SQUARE_VERSION = "2026-01-22";
const BASE = "https://connect.squareup.com/v2";

function squareHeaders() {
  const token = Netlify.env.get("SQUARE_ACCESS_TOKEN") || "";
  return {
    "Square-Version": SQUARE_VERSION,
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export default async (req: Request, context: Context) => {
  const user = await getSessionUser(req);
  if (!user) return unauthorized();
  if (!user.can_edit_content) return forbidden();

  const db = getDatabase();
  const url = new URL(req.url);

  // List Square catalog items + their variations, and current mappings
  if (req.method === "GET") {
    const token = Netlify.env.get("SQUARE_ACCESS_TOKEN") || "";
    if (!token) {
      return new Response(JSON.stringify({ error: "Square isn't connected yet." }), {
        status: 500, headers: { "content-type": "application/json" },
      });
    }

    try {
      const res = await fetch(`${BASE}/catalog/list?types=ITEM`, { headers: squareHeaders() });
      const data = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: "Square API error", detail: data }), {
          status: res.status, headers: { "content-type": "application/json" },
        });
      }

      const variations: any[] = [];
      for (const item of data.objects || []) {
        const itemName = item.item_data?.name || "Unnamed";
        for (const v of item.item_data?.variations || []) {
          variations.push({
            id: v.id,
            name: `${itemName} — ${v.item_variation_data?.name || "Default"}`,
            price_cents: v.item_variation_data?.price_money?.amount ?? null,
          });
        }
      }

      const mappingRows = await db.sql`SELECT content_key, square_variation_id, square_variation_name FROM price_sync_mapping`;
      const mappings: Record<string, any> = {};
      for (const row of mappingRows) mappings[row.content_key as string] = row;

      return new Response(JSON.stringify({ variations, mappings }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: "Failed to reach Square", detail: String(err) }), {
        status: 502, headers: { "content-type": "application/json" },
      });
    }
  }

  // Set or clear a mapping for a given content key
  if (req.method === "PUT") {
    const body = await req.json().catch(() => ({}));
    const contentKey = body.content_key;
    const variationId = body.square_variation_id;
    const variationName = body.square_variation_name || null;

    if (!contentKey) {
      return new Response(JSON.stringify({ error: "Missing content_key" }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    }

    if (!variationId) {
      await db.sql`DELETE FROM price_sync_mapping WHERE content_key = ${contentKey}`;
      return new Response(JSON.stringify({ ok: true, cleared: true }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }

    await db.sql`
      INSERT INTO price_sync_mapping (content_key, square_variation_id, square_variation_name, updated_at)
      VALUES (${contentKey}, ${variationId}, ${variationName}, NOW())
      ON CONFLICT (content_key) DO UPDATE SET
        square_variation_id = ${variationId}, square_variation_name = ${variationName}, updated_at = NOW()
    `;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405, headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/square-catalog",
};
