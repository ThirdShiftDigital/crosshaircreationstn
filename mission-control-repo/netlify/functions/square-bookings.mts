import type { Context, Config } from "@netlify/functions";
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

function missingConfig() {
  return new Response(JSON.stringify({ error: "Square isn't connected yet — missing access token or location ID." }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
}

async function listBookings() {
  const locationId = Netlify.env.get("SQUARE_LOCATION_ID") || "";

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
      version: b.version,
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
}

async function confirmBooking(bookingId: string, version: number) {
  const res = await fetch(`${BASE}/bookings/${bookingId}`, {
    method: "PUT",
    headers: squareHeaders(),
    body: JSON.stringify({ booking: { version, status: "ACCEPTED" } }),
  });
  const data = await res.json();
  if (!res.ok) {
    return new Response(JSON.stringify({ error: "Square couldn't confirm this booking.", detail: data }), {
      status: res.status, headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, booking: data.booking }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

async function rescheduleBooking(bookingId: string, version: number, newStartAt: string) {
  const res = await fetch(`${BASE}/bookings/${bookingId}`, {
    method: "PUT",
    headers: squareHeaders(),
    body: JSON.stringify({ booking: { version, start_at: newStartAt } }),
  });
  const data = await res.json();
  if (!res.ok) {
    return new Response(JSON.stringify({ error: "Square couldn't reschedule this booking.", detail: data }), {
      status: res.status, headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, booking: data.booking }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

async function cancelBooking(bookingId: string, version: number) {
  const res = await fetch(`${BASE}/bookings/${bookingId}/cancel`, {
    method: "POST",
    headers: squareHeaders(),
    body: JSON.stringify({ booking_version: version }),
  });
  const data = await res.json();
  if (!res.ok) {
    return new Response(JSON.stringify({ error: "Square couldn't cancel this booking.", detail: data }), {
      status: res.status, headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, booking: data.booking }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

export default async (req: Request, context: Context) => {
  const user = await getSessionUser(req);
  if (!user) return unauthorized();

  const token = Netlify.env.get("SQUARE_ACCESS_TOKEN") || "";
  const locationId = Netlify.env.get("SQUARE_LOCATION_ID") || "";
  if (!token || !locationId) return missingConfig();

  try {
    if (req.method === "GET") {
      if (!user.can_view_square) return forbidden();
      return await listBookings();
    }

    if (req.method === "PUT") {
      if (!user.can_manage_square_bookings) return forbidden("You don't have permission to manage Square bookings.");
      const url = new URL(req.url);
      const bookingId = url.searchParams.get("id");
      const action = url.searchParams.get("action"); // confirm | reschedule | cancel
      if (!bookingId || !action) {
        return new Response(JSON.stringify({ error: "Missing booking id or action" }), {
          status: 400, headers: { "content-type": "application/json" },
        });
      }
      const body = await req.json().catch(() => ({}));
      const version = body.version;
      if (typeof version !== "number") {
        return new Response(JSON.stringify({ error: "Missing booking version" }), {
          status: 400, headers: { "content-type": "application/json" },
        });
      }

      if (action === "confirm") return await confirmBooking(bookingId, version);
      if (action === "cancel") return await cancelBooking(bookingId, version);
      if (action === "reschedule") {
        if (!body.start_at) {
          return new Response(JSON.stringify({ error: "Missing new start_at time" }), {
            status: 400, headers: { "content-type": "application/json" },
          });
        }
        return await rescheduleBooking(bookingId, version, body.start_at);
      }
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { "content-type": "application/json" },
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
