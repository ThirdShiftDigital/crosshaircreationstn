import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import crypto from "node:crypto";
import { twilioStatusCallbackUrl } from "./_shared/messaging.mts";

// Twilio calls this as a text moves through queued -> sent -> delivered (or fails).
// We update the matching message_log row so the dashboard shows real delivery status.

function expectedSignature(url: string, params: URLSearchParams, authToken: string): string {
  const keys = Array.from(new Set(Array.from(params.keys()))).sort();
  let data = url;
  for (const k of keys) for (const v of params.getAll(k)) data += k + v;
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const authToken = Netlify.env.get("TWILIO_AUTH_TOKEN");
  if (!authToken) return new Response("Not configured", { status: 503 });

  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const signature = req.headers.get("x-twilio-signature") || "";

  // Twilio signs the exact URL it called; check the URL we registered and the one we received.
  const candidates = new Set<string>([req.url]);
  const registered = twilioStatusCallbackUrl(context.site?.url || null);
  if (registered) candidates.add(registered);
  const valid = Array.from(candidates).some(u => safeEqual(expectedSignature(u, params, authToken), signature));
  if (!valid) return new Response("Invalid signature", { status: 403 });

  const sid = params.get("MessageSid") || params.get("SmsSid");
  const status = (params.get("MessageStatus") || params.get("SmsStatus") || "").toLowerCase();
  const errorCode = params.get("ErrorCode");
  if (!sid || !status) return new Response("Missing fields", { status: 400 });

  // Callbacks can arrive out of order; never move a message backwards (e.g. delivered -> sent).
  const RANK: Record<string, number> = { accepted: 0, queued: 0, scheduled: 0, sending: 1, sent: 2, delivered: 3, undelivered: 3, failed: 3, read: 4 };
  const db = getDatabase();
  const rows = await db.sql`SELECT id, status FROM message_log WHERE provider_id = ${sid}`;
  for (const row of rows) {
    if ((RANK[status] ?? 0) < (RANK[row.status as string] ?? 0)) continue;
    await db.sql`
      UPDATE message_log
      SET status = ${status},
          error = COALESCE(${errorCode ? `Twilio error ${errorCode}` : null}, error),
          updated_at = NOW()
      WHERE id = ${row.id}
    `;
  }
  return new Response(null, { status: 204 });
};

export const config: Config = {
  path: "/api/twilio-status",
};
