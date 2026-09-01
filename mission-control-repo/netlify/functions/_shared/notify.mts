import { getDatabase } from "@netlify/database";
import { sendSms, normalizeUsPhone } from "./sms.mts";

async function sendEmail(to: string, subject: string, text: string) {
  const resendKey = Netlify.env.get("RESEND_API_KEY");
  if (!resendKey) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Crosshair Creations Alerts <alerts@crosshaircreationstn.com>",
        to: [to],
        subject,
        text,
      }),
    });
  } catch {
    // never let one failed email block the rest
  }
}

export async function notifyOptedInUsers(kind: "bookings" | "recovery", subject: string, message: string) {
  const db = getDatabase();

  const rows = kind === "bookings"
    ? await db.sql`SELECT name, email, phone FROM users WHERE notify_new_bookings = TRUE`
    : await db.sql`SELECT name, email, phone FROM users WHERE notify_new_recovery = TRUE`;

  for (const user of rows) {
    if (user.email) {
      await sendEmail(user.email as string, subject, message);
    }
    const phone = normalizeUsPhone((user.phone as string) || "");
    if (phone) {
      await sendSms(phone, message);
    }
  }
}
