import type { Context, Config } from "@netlify/functions";
import { isAuthenticated, unauthorized } from "./_shared/session.mts";

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
  if (!(await isAuthenticated(req))) return unauthorized();

  const locationId = Netlify.env.get("SQUARE_LOCATION_ID") || "";
  const token = Netlify.env.get("SQUARE_ACCESS_TOKEN") || "";

  if (!token || !locationId) {
    return new Response(JSON.stringify({ error: "Square isn't connected yet — missing access token or location ID." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    // 1. List bookings for this location (upcoming + recent)
    const bookingsRes = await fetch(
      `${BASE}/bookings?location_id=${encodeURIComponent(locationId)}&limit=50`,
      { headers: squareHeaders() }
    );
    const bookingsData = await bookingsRes.json();

    if (!bookingsRes.ok) {
      return new Response(JSON.stringify({ error: "Square API error", detail: bookingsData }), {
        status: bookingsRes.status,
        headers: { "content-type": "application/json" },
      });
    }

    const bookings = bookingsData.bookings || [];
    if (bookings.length === 0) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    }

    // 2. Collect unique customer IDs and service variation IDs
    const customerIds = [...new Set(bookings.map((b: any) => b.customer_id).filter(Boolean))];
    const serviceVariationIds = [...new Set(
      bookings.flatMap((b: any) => (b.appointment_segments || []).map((s: any) => s.service_variation_id)).filter(Boolean)
    )];

    // 3. Bulk-resolve customer names/contact info
    let customers: Record<string, any> = {};
    if (customerIds.length > 0) {
      const custRes = await fetch(`${BASE}/customers/bulk-retrieve`, {
        method: "POST",
        headers: squareHeaders(),
        body: JSON.stringify({ customer_ids: customerIds }),
      });
      const custData = await custRes.json();
      if (custRes.ok && custData.responses) {
        for (const key of Object.keys(custData.responses)) {
          customers[key] = custData.responses[key].customer;
        }
      }
    }

    // 4. Bulk-resolve service names from the catalog
    let services: Record<string, any> = {};
    if (serviceVariationIds.length > 0) {
      const catRes = await fetch(`${BASE}/catalog/batch-retrieve`, {
        method: "POST",
        headers: squareHeaders(),
        body: JSON.stringify({ object_ids: serviceVariationIds }),
      });
      const catData = await catRes.json();
      if (catRes.ok && catData.objects) {
        for (const obj of catData.objects) {
          services[obj.id] = obj.item_variation_data?.name || "Service";
        }
      }
    }

    // 5. Merge into a clean, dashboard-friendly shape
    const merged = bookings.map((b: any) => {
      const customer = customers[b.customer_id];
      const segment = (b.appointment_segments || [])[0];
      const serviceName = segment ? services[segment.service_variation_id] : null;
      return {
        id: b.id,
        status: b.status,
        start_at: b.start_at,
        duration_minutes: segment?.duration_minutes || null,
        service_name: serviceName,
        customer_name: customer ? [customer.given_name, customer.family_name].filter(Boolean).join(" ") || "Unknown" : "Unknown",
        customer_phone: customer?.phone_number || null,
        customer_email: customer?.email_address || null,
      };
    });

    merged.sort((a, b) => (a.start_at || "").localeCompare(b.start_at || ""));

    return new Response(JSON.stringify(merged), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "private, max-age=30" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: "Failed to reach Square", detail: String(err) }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/square-bookings",
};
