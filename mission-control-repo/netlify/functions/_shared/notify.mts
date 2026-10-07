import { getDatabase } from "@netlify/database";
import { normalizeUsPhone, sendAndLog, type SendResult } from "./messaging.mts";

type NotifyOptions = { requestId?: number | null; baseUrl?: string | null };

// Alerts every team member who opted in for this kind of event, by email and text.
// All sends run in parallel with per-send timeouts, and each one is logged.
export async function notifyOptedInUsers(
  kind: "bookings" | "recovery", subject: string, message: string, opts: NotifyOptions = {},
): Promise<SendResult[]> {
  const db = getDatabase();
  const rows = kind === "bookings"
    ? await db.sql`SELECT name, email, phone FROM users WHERE notify_new_bookings = TRUE`
    : await db.sql`SELECT name, email, phone FROM users WHERE notify_new_recovery = TRUE`;

  const ctx = { requestId: opts.requestId ?? null, audience: "team" as const, baseUrl: opts.baseUrl ?? null };
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const sends: Promise<SendResult>[] = [];

  for (const user of rows) {
    const email = ((user.email as string) || "").trim().toLowerCase();
    if (email && !seenEmails.has(email)) {
      seenEmails.add(email);
      sends.push(sendAndLog("email", email, message, subject, ctx));
    }
    // Two accounts sharing one phone number get one text, not two.
    const phone = normalizeUsPhone((user.phone as string) || "");
    if (phone && !seenPhones.has(phone)) {
      seenPhones.add(phone);
      sends.push(sendAndLog("sms", phone, message, null, ctx));
    }
  }

  const settled = await Promise.allSettled(sends);
  return settled.map(s => s.status === "fulfilled"
    ? s.value
    : { ok: false, status: "failed", providerId: null, error: String(s.reason) });
}
