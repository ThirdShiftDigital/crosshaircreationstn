import type { Context, Config } from "@netlify/functions";
import crypto from "node:crypto";
import { getDatabase } from "@netlify/database";
import { notifyOptedInUsers } from "./_shared/notify.mts";

const NOTIFICATION_URL = "https://crosshaircreationstn.com/api/square-webhook";

function isValidSquareSignature(rawBody: string, signatureHeader: string | null): boolean {
  const signingKey = Netlify.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY");
  if (!signingKey || !signatureHeader) return false;

  const hmac = crypto.createHmac("sha256", signingKey);
  hmac.update(NOTIFICATION_URL + rawBody);
  const expected = hmac.digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-square-hmacsha256-signature");

  if (!isValidSquareSignature(rawBody, signature)) {
    return new Response("Invalid signature", { status: 403 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // Square retries deliveries it isn't sure about. Record each event_id once and
  // ignore repeats so one booking never produces two alerts.
  if (event.event_id) {
    const db = getDatabase();
    const fresh = await db.sql`
      INSERT INTO square_webhook_events (event_id, event_type)
      VALUES (${String(event.event_id)}, ${event.type || null})
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id
    `;
    if (!fresh.length) {
      return new Response("Duplicate event ignored", { status: 200 });
    }
  }

  if (event.type === "booking.created") {
    const work = notifyOptedInUsers(
      "bookings",
      "New Square Booking",
      `A new booking just came in through Square.\n\nCheck Mission Control's Square Bookings tab for full details: https://crosshaircreationstn.com/dashboard`
    ).catch(e => console.error("booking alert failed", e));
    // Answer Square quickly (it retries slow responses); alerts finish in the background.
    const waitUntil = (context as any)?.waitUntil;
    if (typeof waitUntil === "function") waitUntil.call(context, work);
    else await work;
  }

  return new Response("OK", { status: 200 });
};

export const config: Config = {
  path: "/api/square-webhook",
};
