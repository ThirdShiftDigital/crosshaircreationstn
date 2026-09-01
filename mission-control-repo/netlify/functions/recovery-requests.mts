import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser, unauthorized, forbidden } from "./_shared/session.mts";
import { sendSms, normalizeUsPhone } from "./_shared/sms.mts";

const CUSTOMER_STATUS_MESSAGES: Record<string, string> = {
  contacted: "We've reviewed your request and will be reaching out shortly to coordinate.",
  en_route: "Good news — our pilot is heading out to your location now.",
  resolved: "Your recovery mission has been marked complete. Thank you for trusting Crosshair Creations.",
  closed: "This request has been closed. If you still need help, feel free to reach back out.",
};

async function notifyCustomer(request: any, newStatus: string) {
  const message = CUSTOMER_STATUS_MESSAGES[newStatus];
  if (!message) return;

  // Email — only if they left one
  const resendKey = Netlify.env.get("RESEND_API_KEY");
  if (resendKey && request.email) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Crosshair Creations <alerts@crosshaircreationstn.com>",
          to: [request.email],
          subject: `Update on your ${request.recovery_type === "deer" ? "deer" : "pet"} recovery request`,
          text: `Hi ${request.name},\n\n${message}\n\nQuestions? Call or text us at (615) 549-5067.\n\n— Crosshair Creations`,
        }),
      });
    } catch {
      // never let a notification failure block the status update itself
    }
  }

  // Text — phone is always provided, so this is the more reliable channel
  const normalizedPhone = normalizeUsPhone(request.phone);
  if (normalizedPhone) {
    await sendSms(normalizedPhone, `Crosshair Creations: ${message} Questions? Call/text (615) 549-5067.`);
  }
}

export default async (req: Request, context: Context) => {
  const user = await getSessionUser(req);
  if (!user) return unauthorized();
  if (!user.can_view_recovery_requests) return forbidden();

  const db = getDatabase();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (req.method === "GET") {
    const rows = await db.sql`SELECT * FROM recovery_requests ORDER BY created_at DESC`;
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (req.method === "PUT" && id) {
    const b = await req.json().catch(() => ({}));
    const newStatus = b.status || "new";

    const existingRows = await db.sql`SELECT * FROM recovery_requests WHERE id = ${id}`;
    const existing = existingRows[0];
    if (!existing) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "content-type": "application/json" } });
    }

    const [row] = await db.sql`UPDATE recovery_requests SET status = ${newStatus} WHERE id = ${id} RETURNING *`;

    // Only notify if the status actually changed
    if (existing.status !== newStatus) {
      await notifyCustomer(row, newStatus);
    }

    return new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } });
  }

  if (req.method === "DELETE" && id) {
    await db.sql`DELETE FROM recovery_requests WHERE id = ${id}`;
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: { "content-type": "application/json" } });
};

export const config: Config = {
  path: "/api/recovery-requests",
};
