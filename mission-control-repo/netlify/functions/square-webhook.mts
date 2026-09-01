import type { Context, Config } from "@netlify/functions";
import crypto from "node:crypto";
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

  const event = JSON.parse(rawBody);

  if (event.type === "booking.created") {
    await notifyOptedInUsers(
      "bookings",
      "New Square Booking",
      `A new booking just came in through Square.\n\nCheck Mission Control's Square Bookings tab for full details: https://crosshaircreationstn.com/dashboard`
    );
  }

  return new Response("OK", { status: 200 });
};

export const config: Config = {
  path: "/api/square-webhook",
};
