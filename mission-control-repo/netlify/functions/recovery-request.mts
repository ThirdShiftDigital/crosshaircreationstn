import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";

const PET_INSTRUCTIONS = [
  "Stay in the area if it's safe to do so — pets often circle back to where they were last seen.",
  "Don't chase if you spot them; sudden movement can send a scared animal running further. Crouch down, stay calm, and call gently.",
  "Leave something familiar out — their bed, a worn piece of your clothing, or food — near where they were last seen.",
  "Try to pin down the exact spot and time they were last seen, and which direction they were headed.",
  "Keep your phone nearby and charged. We'll call you directly to coordinate the flight.",
];

const DEER_INSTRUCTIONS = [
  "Stop tracking and stay put once you've marked the last sign — continuing to push forward can drive the deer further and disturb the trail.",
  "Mark your GPS location (drop a pin, hang flagging tape, or note landmarks) at the last blood sign or the shot location.",
  "Note the direction the deer traveled, if known.",
  "If it's after dark or the terrain is thick, wait for us rather than continuing on foot — the thermal camera covers ground far faster and won't miss what's hard to see at night.",
  "Keep your phone nearby and charged. We'll call you directly to coordinate the flight.",
];

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { "content-type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const name = (body.name || "").trim();
  const phone = (body.phone || "").trim();
  const email = (body.email || "").trim();
  const recoveryType = body.recovery_type === "deer" ? "deer" : "pet";
  const locationDescription = (body.location_description || "").trim();
  const details = (body.details || "").trim();
  const agreedToDisclaimer = body.agreed_to_disclaimer === true;

  if (!name || !phone) {
    return new Response(JSON.stringify({ error: "Name and phone number are required." }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }
  if (!agreedToDisclaimer) {
    return new Response(JSON.stringify({ error: "You must agree to the disclaimer before submitting." }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }

  const db = getDatabase();
  const [row] = await db.sql`
    INSERT INTO recovery_requests (name, phone, email, recovery_type, location_description, details, agreed_to_disclaimer)
    VALUES (${name}, ${phone}, ${email || null}, ${recoveryType}, ${locationDescription || null}, ${details || null}, ${agreedToDisclaimer})
    RETURNING id, created_at
  `;

  // Fire off the email alert — never let an email failure block the customer's response
  try {
    const resendKey = Netlify.env.get("RESEND_API_KEY");
    const alertTo = Netlify.env.get("ALERT_EMAIL") || "chris@crosshaircreationstn.com";
    if (resendKey) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Crosshair Recovery Alerts <onboarding@resend.dev>",
          to: [alertTo],
          subject: `🚨 New ${recoveryType === "deer" ? "Deer" : "Pet"} Recovery Request — ${name}`,
          text: `New recovery request just came in.\n\nName: ${name}\nPhone: ${phone}\nEmail: ${email || "not provided"}\nType: ${recoveryType === "deer" ? "Deer Recovery" : "Pet Recovery"}\nLocation: ${locationDescription || "not provided"}\nDetails: ${details || "none"}\n\nView it in Mission Control: https://crosshaircreationstn.com/dashboard`,
        }),
      });
    }
  } catch {
    // swallow — the request is already saved, email is a nice-to-have alert
  }

  const instructions = recoveryType === "deer" ? DEER_INSTRUCTIONS : PET_INSTRUCTIONS;

  return new Response(JSON.stringify({ ok: true, id: row.id, instructions }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/recovery-request",
};
